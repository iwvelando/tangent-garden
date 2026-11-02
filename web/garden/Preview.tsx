import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { AppHeader } from "../AppHeader";
import { ExportImageMenu } from "../ExportImageMenu";
import type { Still } from "../export-image";
import { EngineClient, EngineError } from "../engine-client";
import {
  Field,
  FieldErrorContext,
  HelpText,
  HelpToggle,
  useHelp,
} from "../Field";
import type { PlotCamera } from "../planar-link";
import { ScalarInput, ScalarStatus, type ScalarState } from "../ScalarInput";
import { ShareLink } from "../ShareLink";
import { useTheme } from "../useTheme";
import { useQuietFocus } from "../quiet-focus";
import { LegendEntries } from "../Legend";
import { LineWeightField } from "../LineWeightField";
import { MotionExportSettings, useMotionExport } from "../MotionExportSettings";
import { useDisclosure } from "../useDisclosure";
import { ProgressSlider } from "../ProgressSlider";
import { revealDrawing } from "../revealDrawing";
import { play } from "../playback";
import { cycles, progressAt, repeatChoices, type Repeat } from "../timing";
import { loopLead } from "../loop-check";
import type { GardenEntry } from "./Context";
import { GardenSession } from "./session";
import { GardenDrawing, type GardenDrawingProps } from "./Drawing";
import { gardenMovie, gardenStill } from "./export";
import {
  circleName,
  cutoffSummary,
  defaultGarden,
  defaultReveal,
  detailFor,
  revealCount,
  revealLoops,
  describeCircle,
  explain,
  followView,
  gardenHelp,
  gardenScale,
  toModel,
  gardenLimits,
  gardenPage,
  gardenRequest,
  identity,
  indexOf,
  type GardenPresentation,
  type GardenResult,
  type GardenStudy,
} from "./model";
import "./garden.css";

const labels: Record<string, string> = {
  depth: "Depth",
  minRadius: "Minimum radius",
  maxCircles: "Circle limit",
  seed: "Seed",
};
// A frozen reveal: the packing it shows, the request that made it, and
// where its timeline stands, from 0 to 1.
type Film = { result: GardenResult; key: string; time: number };

export function GardenPreview({
  entry,
  onReturn,
}: {
  entry: GardenEntry;
  onReturn: (via: "keyboard" | "pointer") => void;
}) {
  const theme = useTheme(),
    dialog = useRef<HTMLDialogElement>(null),
    back = useRef<HTMLButtonElement>(null),
    quiet = useQuietFocus(dialog);
  const [study, setStudy] = useState<GardenStudy>(() =>
    structuredClone(entry.study.garden ?? defaultGarden),
  );
  // The result shown and the generation settings it answers.
  const [shown, setShown] = useState<{ key: string; result: GardenResult }>();
  const [error, setError] = useState<{
    message: string;
    field?: string;
    key?: string;
  }>({ message: "" });
  const [scalars, setScalars] = useState<Record<string, ScalarState>>({});
  const followHelp = useHelp(),
    detailHelp = useHelp();
  // The circle number as typed, while it is being typed.
  const [circleDraft, setCircleDraft] = useState<string>();
  // Asking again after a failure that names no field, such as a timeout.
  const [attempt, setAttempt] = useState(0);
  const scalarClient = useRef<EngineClient | null>(null),
    generation = useRef(0),
    jobs = useRef(new Set<Promise<void>>());
  const session = useRef<GardenSession | null>(null);
  const exportGeneration = useRef(0);
  const key = JSON.stringify(gardenRequest(study));
  const current = shown?.key === key;
  // While a reveal is playing, paused or being exported, its frozen packing
  // is drawn; otherwise the shown result. Generation waits for its end.
  const [film, setFilm] = useState<Film>();
  const [playing, setPlaying] = useState(false);
  // A reveal played once to its end leaves its slider at the end.
  const [finished, setFinished] = useState(false);
  const [exporting, setExporting] = useState(false),
    [exportProgress, setExportProgress] = useState(0);
  const stopClock = useRef<() => void>(() => {}),
    movieGeneration = useRef(0),
    exportAbort = useRef<AbortController | null>(null);
  const exportState = useMotionExport();
  const exportSection = useDisclosure("garden-export");
  const view = useRef<HTMLDivElement>(null),
    playback = useRef<HTMLDivElement>(null);
  const result = film?.result ?? shown?.result;
  const reveal = study.reveal ?? defaultReveal;
  const total = result?.curvature.length ?? 0;
  const count = film
    ? revealCount(total, progressAt(film.time, reveal.repeat, "steady"))
    : undefined;
  const durationError =
    !Number.isFinite(reveal.duration) ||
    reveal.duration < 0.1 ||
    reveal.duration > 3600
      ? "Reveal duration must be 0.1–3,600 seconds."
      : "";
  const loopError =
    reveal.repeat === "loop" && result && !revealLoops(total)
      ? `${loopLead} the reveal starts with the 4 seed circles and ends with all ${total.toLocaleString("en-US")}. Back and forth returns smoothly.`
      : "";
  const revealError = durationError || loopError;
  // Whole-number fields are checked here, as the worker would, so the
  // refusal names the field without a round trip.
  const countError = !Number.isInteger(study.depth)
    ? { field: "depth", message: "Enter a whole number." }
    : !Number.isInteger(study.maxCircles)
      ? { field: "maxCircles", message: "Enter a whole number." }
      : undefined;
  const scalarError = Object.values(scalars).find((s) => s.error);
  const scalarPending = Object.values(scalars).some((s) => s.pending);
  const activeError =
    countError ??
    (error.message && error.key === key
      ? { field: error.field, message: error.message }
      : undefined);
  const valid = !activeError && !scalarError && !scalarPending;
  const ready = valid && current;
  const selected = result ? indexOf(result, study.selected) : -1;
  const scalarStatus = useMemo(
    () => ({
      client: scalarClient,
      generation,
      track: (job: Promise<void>) => {
        jobs.current.add(job);
        void job.finally(() => jobs.current.delete(job));
      },
      report: (id: string, state: ScalarState | null) =>
        setScalars((s) => {
          const next = { ...s };
          if (state) next[id] = state;
          else delete next[id];
          return next;
        }),
    }),
    [],
  );
  useEffect(() => {
    session.current = new GardenSession(() => new EngineClient());
    scalarClient.current = new EngineClient();
    return () => {
      exportGeneration.current++;
      movieGeneration.current++;
      exportAbort.current?.abort();
      stopClock.current();
      session.current?.cancel();
      scalarClient.current?.dispose();
      generation.current++;
    };
  }, []);
  useLayoutEffect(() => {
    if (entry.via === "pointer") quiet.onPointerDown();
    dialog.current!.showModal();
    quiet.quiet();
    back.current!.focus();
    document.documentElement.classList.add("garden-open");
    return () => document.documentElement.classList.remove("garden-open");
  }, []);
  // Generation follows the settings. Typed edits wait briefly, as the
  // ordinary editor does; the session keeps only the newest unsent intent.
  useEffect(() => {
    if (film || current || countError || scalarError || scalarPending) return;
    const request = gardenRequest(study);
    const timer = setTimeout(
      () =>
        session.current!.update(
          request,
          (r) => {
            setShown({ key, result: r });
            setError({ message: "" });
          },
          (e) =>
            setError({
              message: e.message,
              field: e instanceof EngineError ? e.field : undefined,
              key,
            }),
        ),
      result ? 120 : 0,
    );
    return () => {
      clearTimeout(timer);
      session.current?.invalidate();
    };
  }, [key, !!countError, !!scalarError, scalarPending, attempt, !!film]);
  // The camera's eased move to a view, or a jump when reduced motion is
  // requested. It interpolates the model point at the page's center and the
  // logarithm of zoom, so the zoom changes monotonically and the target
  // ends exactly where it was aimed. A manual change stops it.
  const camera = useRef(study.view);
  camera.current = study.view;
  const move = useRef(0);
  const halt = () => {
    cancelAnimationFrame(move.current);
    move.current = 0;
  };
  useEffect(() => halt, []);
  const moveTo = (target: PlotCamera) => {
    halt();
    const from = camera.current;
    if (matchMedia("(prefers-reduced-motion: reduce)").matches) {
      setStudy((s) => ({ ...s, view: target }));
      return;
    }
    const center = { x: gardenPage.width / 2, y: gardenPage.height / 2 };
    const a = toModel(center, from),
      b = toModel(center, target);
    const start = performance.now();
    const step = (now: number) => {
      const t = Math.min(1, (now - start) / 250);
      const e = t < 0.5 ? 4 * t ** 3 : 1 - (-2 * t + 2) ** 3 / 2;
      let view = target;
      if (t < 1) {
        const zoom = from.zoom * (target.zoom / from.zoom) ** e;
        const k = gardenScale * zoom;
        view = {
          zoom,
          x: -(a.x + (b.x - a.x) * e) * k,
          y: (a.y + (b.y - a.y) * e) * k,
        };
      }
      setStudy((s) => ({ ...s, view }));
      move.current = t < 1 ? requestAnimationFrame(step) : 0;
    };
    move.current = requestAnimationFrame(step);
  };
  // The reveal's clock. Pause keeps the frozen packing and its time; Stop
  // and any edit to what generation needs end it and restore the static
  // drawing.
  const pause = () => {
    stopClock.current();
    stopClock.current = () => {};
    setPlaying(false);
  };
  const endFilm = () => {
    pause();
    setFilm(undefined);
    setFinished(false);
  };
  // The packing a reveal freezes: the playing one, or the current result.
  const source = film ?? (ready && shown ? { ...shown, time: 0 } : undefined);
  const canReveal = !!source && !revealError && !exporting;
  const start = () => {
    if (!canReveal || !source) return;
    const from = finished || source.time >= 1 ? 0 : source.time;
    const frozen = { ...source, time: from };
    const { duration, repeat } = reveal;
    setFilm(frozen);
    setFinished(false);
    setPlaying(true);
    revealDrawing(view.current, playback.current);
    stopClock.current = play<number>({
      from,
      duration: duration * 1000,
      repeat: cycles(repeat),
      redraw: true,
      lanes: [async (p) => p],
      show: (p) => setFilm((f) => f && { ...f, time: p }),
      end: () => {
        stopClock.current = () => {};
        setPlaying(false);
        setFilm(undefined);
        setFinished(true);
      },
      fail: () => endFilm(),
    });
  };
  const seek = (time: number) => {
    if (!source || exporting) return;
    pause();
    setFinished(false);
    setFilm({ ...source, time });
  };
  // Generation settings end a reveal before they change.
  const edit = (change: (s: GardenStudy) => GardenStudy) => {
    endFilm();
    setStudy(change);
  };
  const setReveal = (change: Partial<typeof reveal>) => {
    pause();
    setStudy((s) => ({
      ...s,
      reveal: { ...(s.reveal ?? defaultReveal), ...change },
    }));
  };
  const select = (i: number, typed = false) => {
    if (!result) return;
    if (!typed) setCircleDraft(undefined);
    setStudy((s) => ({
      ...s,
      selected: i >= 0 ? identity(result, i) : undefined,
    }));
    if (study.follow && i >= 0) moveTo(followView(result, i));
  };
  // Following starts by remembering the reader's view, and ends by going
  // back to it.
  const setFollow = (on: boolean) => {
    if (on) {
      setStudy((s) => ({ ...s, follow: true, viewBeforeFollow: s.view }));
      if (result && selected >= 0) moveTo(followView(result, selected));
    } else {
      const back = study.viewBeforeFollow ?? study.view;
      setStudy(({ follow: _, viewBeforeFollow: __, ...s }) => s);
      moveTo(back);
    }
  };
  const manual = (view: PlotCamera) => {
    halt();
    setStudy((s) => ({ ...s, view }));
  };
  const drawing = (): GardenDrawingProps | undefined =>
    result && {
      result,
      presentation: study.presentation,
      selected,
      camera: study.view,
      dark: theme.dark,
      scheme: theme.scheme,
      weight: study.weight,
      count,
    };
  const metadata = () => ({
    kind: "apollonian-garden",
    seed: study.seed,
    curvatures: [-1, 2, 2, 3],
    depth: study.depth,
    minRadius: study.minRadius,
    units: "enclosing radius = 1",
    maxCircles: study.maxCircles,
    ...detailRecord(),
    circles: result?.curvature.length,
    omitted: result?.omitted,
    stopped: result?.stopped || undefined,
    presentation: study.presentation,
    ...(selected >= 0 &&
      result && {
        selected: {
          number: selected + 1,
          ...identity(result, selected),
          generators:
            result.generation[selected] > 0
              ? result.parents[selected].map((p) => ({
                  number: p + 1,
                  ...identity(result, p),
                }))
              : [],
        },
      }),
    view: study.view,
    theme: theme.dark ? "dark" : "light",
    scheme: theme.scheme,
    weight: study.weight,
    ...(film && {
      reveal: {
        ...revealRecord(),
        time: film.time,
        shown: count,
      },
    }),
  });
  // The detail policy and request behind the drawn packing, when detail
  // changed them; a reveal records its frozen request.
  function detailRecord() {
    const q = JSON.parse(film?.key ?? shown?.key ?? key);
    const d = study.detail ? detailFor(study) : undefined;
    return {
      ...(study.detail && { detail: true }),
      ...(q.window && {
        detailRequest: {
          minRadius: q.minRadius,
          window: q.window,
          ...(q.keep && { keep: q.keep }),
          ...(d && { level: d.level, factor: d.factor }),
        },
      }),
    };
  }
  const revealRecord = () => ({
    duration: reveal.duration,
    repeat: reveal.repeat,
    total,
    membership:
      "the first n circles in breadth-first order; n = 4 for progress p ≤ 0.06, n = floor(4·(N/4)^s) with s = (p − 0.06)/0.8, n = N for p ≥ 0.86",
  });
  async function still(format: string, settings: Still) {
    const props = drawing();
    if (!(ready || film) || !props) return;
    const id = ++exportGeneration.current;
    try {
      await gardenStill(
        format as "svg" | "png",
        props,
        metadata(),
        () => id === exportGeneration.current,
        settings,
      );
    } catch (e) {
      if (id === exportGeneration.current)
        setError({ message: (e as Error).message, key });
    }
  }
  // Any change to what the still would show discards one being made.
  useEffect(() => {
    exportGeneration.current++;
  }, [
    key,
    count,
    selected,
    study.presentation,
    study.view,
    study.weight,
    theme.dark,
    theme.scheme,
  ]);
  // The movie freezes the packing, view and appearance when it starts;
  // only Cancel or Return discards it.
  async function movie() {
    const props = drawing();
    if (!canReveal || !source || !props) return;
    pause();
    setExporting(true);
    setExportProgress(0);
    const id = ++movieGeneration.current;
    const controller = new AbortController();
    exportAbort.current = controller;
    try {
      await gardenMovie({
        drawing: { ...props, result: source.result, count: undefined },
        metadata: {
          ...metadata(),
          circles: source.result.curvature.length,
          reveal: revealRecord(),
        },
        reveal: { ...reveal },
        options: {
          format: exportState.chosen,
          fps: exportState.fps,
          settings: { scale: exportState.scale, quality: exportState.quality },
          loop: exportState.loop,
        },
        signal: controller.signal,
        current: () => id === movieGeneration.current,
        progress: setExportProgress,
      });
    } catch (e) {
      if (id === movieGeneration.current && !controller.signal.aborted)
        setError({ message: (e as Error).message, key });
    } finally {
      if (id === movieGeneration.current) setExporting(false);
    }
  }
  function cancelExport() {
    movieGeneration.current++;
    exportAbort.current?.abort();
    setExporting(false);
  }
  const message = scalarError
    ? `${scalarError.name}: ${scalarError.error}`
    : (activeError?.message ?? revealError);
  const title =
    scalarError?.name ??
    (activeError
      ? activeError.field
        ? labels[activeError.field]
        : undefined
      : durationError
        ? "Reveal duration"
        : loopError
          ? "Repeat"
          : undefined);
  const [claimed, setClaimed] = useState(false);
  const claim = useCallback((_key: string, on: boolean) => setClaimed(on), []);
  const target = useMemo(
    () => ({ label: title, message, claim, touch: () => {} }),
    [title, message, claim],
  );
  const props = drawing();
  const summary = film
    ? cutoffSummary(film.result, JSON.parse(film.key), study.view.zoom)
    : shown &&
      cutoffSummary(shown.result, JSON.parse(shown.key), study.view.zoom);
  const about = result && selected >= 0 ? explain(result, selected) : undefined;
  const whole = (
    k: "depth" | "maxCircles",
    label: string,
    min: number,
    max: number,
  ) => (
    <Field label={label} help={gardenHelp[k]}>
      <input
        type="number"
        min={min}
        max={max}
        value={Number.isNaN(study[k]) ? "" : study[k]}
        onChange={(e) => {
          const value = e.currentTarget.valueAsNumber;
          edit((s) => ({ ...s, [k]: value }));
        }}
      />
    </Field>
  );
  return (
    <dialog
      ref={dialog}
      className="garden"
      aria-labelledby="garden-title"
      onCancel={(e) => {
        e.preventDefault();
        onReturn("keyboard");
      }}
      onPointerDown={quiet.onPointerDown}
      onKeyDownCapture={quiet.onKeyDownCapture}
    >
      <AppHeader theme={theme} appearance={false}>
        <button
          ref={back}
          onClick={(e) => onReturn(e.detail === 0 ? "keyboard" : "pointer")}
        >
          Return to study
        </button>
        <ShareLink
          notebook="2d"
          study={() => ({ ...entry.study, garden: study })}
          disabled={!valid || !(current || film)}
        />
        <ExportImageMenu
          kind="apollonian-garden"
          revision={JSON.stringify([
            key,
            count,
            selected,
            study.presentation,
            study.view,
            study.weight,
            theme.dark,
            theme.scheme,
          ])}
          disabled={!(ready || (film && valid)) || exporting}
          base={gardenPage}
          onSave={still}
        />
      </AppHeader>
      <div className="garden-content">
        <div className="garden-heading">
          <p className="eyebrow">Apollonian packing · curvatures −1, 2, 2, 3</p>
          <h2 id="garden-title">The Apollonian garden</h2>
          <p>
            Three tangent circles leave a curved gap that one more circle fits
            exactly. Here every gap is filled, down to a finite cutoff.
          </p>
        </div>
        <ScalarStatus.Provider value={scalarStatus}>
          <FieldErrorContext.Provider value={target}>
            <div className="garden-layout">
              <main>
                <div
                  className="garden-view"
                  ref={view}
                  data-reveal-time={film?.time}
                  data-playing={playing || undefined}
                >
                  {props ? (
                    <GardenDrawing
                      {...props}
                      busy={!ready && !film}
                      onCamera={manual}
                      onSelect={select}
                    />
                  ) : (
                    <p className="garden-placeholder" role="status">
                      Growing the packing…
                    </p>
                  )}
                </div>
                <p className="note garden-gestures">
                  Click or tap near a circle to select it. Drag to pan; scroll
                  or pinch to zoom
                  {study.detail
                    ? film
                      ? ", which only enlarges the reveal's circles until it stops"
                      : ", which grows finer circles for the view"
                    : ", which enlarges these circles without adding any"}
                  . Keys: arrows, + / −, Home.{" "}
                  <button
                    type="button"
                    className="text-button"
                    onClick={() => manual({ x: 0, y: 0, zoom: 1 })}
                  >
                    Reset view
                  </button>
                </p>
                <div className="legend garden-legend">
                  <LegendEntries
                    entries={[
                      {
                        key: "base",
                        shown: true,
                        content: (
                          <>
                            <span className="base-dot" />
                            Circles
                          </>
                        ),
                      },
                      {
                        key: "generators",
                        shown: selected > 0 && !!result?.generation[selected],
                        content: (
                          <>
                            <span className="base-dot garden-thick" />
                            Generators
                          </>
                        ),
                      },
                      {
                        key: "selected",
                        shown: selected >= 0,
                        content: (
                          <>
                            <span className="derived-dot" />
                            Selected
                          </>
                        ),
                      },
                    ]}
                  />
                </div>
              </main>
              <aside>
                <section
                  className="garden-selection"
                  aria-label="Selected circle"
                >
                  {result && (
                    <>
                      <div className="garden-picker">
                        <Field label="Circle" help={gardenHelp.circle}>
                          <input
                            type="number"
                            min={1}
                            max={result.curvature.length}
                            value={
                              circleDraft ?? (selected >= 0 ? selected + 1 : "")
                            }
                            placeholder="None"
                            onChange={(e) => {
                              // An emptied or out-of-range entry stays as
                              // typed until it names a circle or is left.
                              setCircleDraft(e.currentTarget.value);
                              const n = e.currentTarget.valueAsNumber;
                              if (
                                Number.isInteger(n) &&
                                n >= 1 &&
                                n <= result.curvature.length
                              )
                                select(n - 1, true);
                            }}
                            onBlur={() => setCircleDraft(undefined)}
                          />
                        </Field>
                        <div
                          className="garden-step"
                          role="group"
                          aria-label="Step through circles"
                        >
                          <button
                            type="button"
                            disabled={selected === 0}
                            onClick={() =>
                              select(selected < 0 ? 0 : selected - 1)
                            }
                            aria-label="Previous circle"
                          >
                            ‹ Previous
                          </button>
                          <button
                            type="button"
                            disabled={selected === result.curvature.length - 1}
                            onClick={() => select(selected + 1)}
                            aria-label="Next circle"
                          >
                            Next ›
                          </button>
                          <button
                            type="button"
                            disabled={selected < 0 && !study.selected}
                            onClick={() => {
                              setCircleDraft(undefined);
                              setStudy((s) => ({ ...s, selected: undefined }));
                            }}
                          >
                            Clear selection
                          </button>
                        </div>
                      </div>
                      <div className="garden-follow">
                        <label className="check">
                          <input
                            type="checkbox"
                            checked={!!study.follow}
                            onChange={(e) => setFollow(e.target.checked)}
                          />
                          Follow selection
                        </label>
                        <HelpToggle
                          topic="following the selection"
                          help={followHelp}
                        />
                      </div>
                      <HelpText help={followHelp}>{gardenHelp.follow}</HelpText>
                      {about ? (
                        <div className="garden-about">
                          <h3>{circleName(selected)}</h3>
                          <p className="garden-facts">{about.facts}</p>
                          <p>{about.text}</p>
                          {result.generation[selected] > 0 && (
                            <div
                              className="garden-generators"
                              role="group"
                              aria-label="Generating circles"
                            >
                              {result.parents[selected].map((p) => (
                                <button
                                  key={p}
                                  type="button"
                                  onClick={() => select(p)}
                                >
                                  {describeCircle(result, p)}
                                </button>
                              ))}
                            </div>
                          )}
                        </div>
                      ) : (
                        <p className="note">
                          {study.selected
                            ? "The selected circle lies beyond the current cutoffs."
                            : "No circle selected."}
                        </p>
                      )}
                    </>
                  )}
                </section>
                <Field label="Presentation" help={gardenHelp.presentation}>
                  <select
                    value={study.presentation}
                    onChange={(e) => {
                      const presentation = e.currentTarget
                        .value as GardenPresentation;
                      setStudy((s) => ({ ...s, presentation }));
                    }}
                  >
                    <option value="complete">Complete packing</option>
                    <option value="selected">
                      Selected circle and its generators
                    </option>
                  </select>
                </Field>
                {study.presentation === "selected" && selected < 0 && (
                  <p className="note">
                    Select a circle to see the three that generated it; until
                    then only the enclosing circle is drawn.
                  </p>
                )}
                <h3 className="garden-section">Reveal</h3>
                <div
                  ref={playback}
                  id="garden-playback"
                  className={`playback ${film || playing || exporting ? "active" : ""}`}
                  role="group"
                  aria-label="Reveal playback"
                >
                  <div className="animation-buttons">
                    <button
                      disabled={(!canReveal && !playing) || exporting}
                      onClick={() => (playing ? pause() : start())}
                    >
                      {playing
                        ? "Pause reveal"
                        : film && film.time < 1
                          ? "Resume reveal"
                          : "Play reveal"}
                    </button>
                    <button
                      disabled={!film && !playing && !exporting && !finished}
                      onClick={() => (exporting ? cancelExport() : endFilm())}
                    >
                      {exporting ? "Cancel export" : "Stop reveal"}
                    </button>
                  </div>
                  <div className="timeline">
                    <Field
                      label="Animation progress"
                      help={gardenHelp.progress}
                      helpBeforeControl
                    >
                      <ProgressSlider
                        progress={film?.time ?? (finished ? 1 : 0)}
                        disabled={!source || exporting}
                        onSeek={seek}
                      />
                    </Field>
                    <p className="note garden-reveal-status" aria-live="off">
                      {(
                        (film?.time ?? (finished ? 1 : 0)) *
                        (durationError ? 0 : reveal.duration)
                      ).toFixed(1)}{" "}
                      / {durationError ? "—" : reveal.duration} s
                      {film && result
                        ? ` · ${count!.toLocaleString("en-US")} of ${total.toLocaleString("en-US")} circles`
                        : ""}
                      {film && !playing && film.time < 1 ? " · Paused" : ""}
                    </p>
                  </div>
                </div>
                <fieldset disabled={exporting} className="garden-reveal">
                  <div className="pair">
                    <Field label="Reveal duration" help={gardenHelp.duration}>
                      <input
                        type="number"
                        min={0.1}
                        max={3600}
                        step="any"
                        value={
                          Number.isNaN(reveal.duration) ? "" : reveal.duration
                        }
                        onChange={(e) =>
                          setReveal({ duration: e.currentTarget.valueAsNumber })
                        }
                      />
                    </Field>
                    <Field label="Repeat" help={gardenHelp.repeat}>
                      <select
                        value={reveal.repeat}
                        onChange={(e) =>
                          setReveal({
                            repeat: e.currentTarget.value as Repeat,
                          })
                        }
                      >
                        {repeatChoices.map((c) => (
                          <option key={c.value} value={c.value}>
                            {c.label}
                          </option>
                        ))}
                      </select>
                    </Field>
                  </div>
                  <MotionExportSettings
                    state={exportState}
                    id="garden-export-settings"
                    cyclic={cycles(reveal.repeat)}
                    disclosure={exportSection}
                  />
                </fieldset>
                <button
                  className="animation-export"
                  disabled={
                    !canReveal ||
                    exportState.formats?.[exportState.chosen] !== "yes" ||
                    Math.ceil(reveal.duration * exportState.fps) > 7200
                  }
                  onClick={() => void movie()}
                >
                  Export {exportState.text.name} ↗
                </button>
                {exporting && (
                  <p role="status" aria-live="off">
                    Exporting {exportState.text.short}…{" "}
                    {Math.round(exportProgress * 100)}%
                  </p>
                )}
                <h3 className="garden-section">Cutoffs</h3>
                <Field label="Minimum radius" help={gardenHelp.minRadius}>
                  <ScalarInput
                    name="Minimum radius"
                    value={study.minRadius}
                    onChange={(v) => edit((s) => ({ ...s, minRadius: v }))}
                  />
                </Field>
                <div className="pair">
                  {whole("depth", "Depth", 0, gardenLimits.depth)}
                  {whole("maxCircles", "Circle limit", 4, gardenLimits.circles)}
                </div>
                <div className="garden-follow">
                  <label className="check">
                    <input
                      type="checkbox"
                      checked={!!study.detail}
                      onChange={(e) => {
                        const on = e.target.checked;
                        edit(({ detail: _, ...s }) =>
                          on ? { ...s, detail: true } : s,
                        );
                      }}
                    />
                    Finer circles when zoomed in
                  </label>
                  <HelpToggle topic="zoom detail" help={detailHelp} />
                </div>
                <HelpText help={detailHelp}>{gardenHelp.detail}</HelpText>
                <p
                  className="note garden-summary"
                  data-current={current || undefined}
                  data-frozen={film ? true : undefined}
                >
                  {summary ? (
                    <>
                      {summary.text}
                      {summary.stopped && (
                        <>
                          {" "}
                          <strong className="garden-stopped">
                            {summary.stopped}
                          </strong>
                        </>
                      )}
                    </>
                  ) : (
                    "Generating…"
                  )}
                </p>
                <LineWeightField
                  value={study.weight}
                  onChange={(weight) => setStudy((s) => ({ ...s, weight }))}
                />
                {!claimed && message && (
                  <div className="study-error" role="alert">
                    <p>
                      {title ? `${title}: ` : ""}
                      {message}
                    </p>
                    {!title && (
                      <button
                        type="button"
                        onClick={() => {
                          // The constant parser's worker may have failed too.
                          scalarClient.current?.dispose();
                          scalarClient.current = new EngineClient();
                          setError({ message: "" });
                          setAttempt((n) => n + 1);
                        }}
                      >
                        Try again
                      </button>
                    )}
                  </div>
                )}
              </aside>
            </div>
          </FieldErrorContext.Provider>
        </ScalarStatus.Provider>
      </div>
    </dialog>
  );
}
