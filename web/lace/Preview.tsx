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
  CheckSetting,
  Field,
  FieldErrorContext,
  HelpText,
  HelpToggle,
  useHelp,
} from "../Field";
import { useCameraMove } from "../camera-move";
import { LatestSession } from "../latest-session";
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
import type { LaceEntry } from "./Context";
import { LaceDrawing, type LaceDrawingProps } from "./Drawing";
import { laceLoopRefusal, laceMovie, laceStill } from "./export";
import {
  addressOf,
  addressText,
  centered,
  cutoffSummary,
  defaultLace,
  defaultLaceMotion,
  explain,
  followView,
  indexOf,
  isIdentity,
  laceHelp,
  laceLimits,
  lacePage,
  laceRequest,
  laceScale,
  movedResult,
  neighbors,
  sideName,
  tileName,
  type LaceFrame,
  type LaceFrameRequest,
  type LaceIsometry,
  type LacePresentation,
  type LaceRequest,
  type LaceResult,
  type LaceStudy,
  type LaceStudyMotion,
} from "./model";
import "../garden/garden.css";
import "./lace.css";

const labels: Record<string, string> = {
  depth: "Depth",
  maxTiles: "Tile limit",
  starPoint: "Star point",
  tiling: "Tiling",
  "isometry.offset": "Offset",
  "isometry.direction": "Direction",
  "isometry.rotation": "Rotation",
  "motion.offset": "Farthest offset",
  "motion.orbits": "Orbits",
  "motion.turns": "Turns",
};
// A motion frozen while it plays, is paused or seeks: the static patch it
// moves and the request that made it, where its timeline stands from 0 to
// 1, and the moved patch drawn, with the time it is for. Generation and
// path edits end it.
type Film = {
  source: LaceResult;
  key: string;
  request: LaceRequest;
  time: number;
  frame?: LaceResult;
  frameTime?: number;
};
const pathOf = ({ offset, orbits, turns }: LaceStudyMotion) => ({
  offset,
  orbits,
  turns,
});

export function LacePreview({
  entry,
  onReturn,
}: {
  entry: LaceEntry;
  onReturn: (via: "keyboard" | "pointer") => void;
}) {
  const theme = useTheme(),
    dialog = useRef<HTMLDialogElement>(null),
    back = useRef<HTMLButtonElement>(null),
    quiet = useQuietFocus(dialog);
  const [study, setStudy] = useState<LaceStudy>(() =>
    structuredClone(entry.study.lace ?? defaultLace),
  );
  // The result shown and the generation settings it answers.
  const [shown, setShown] = useState<{ key: string; result: LaceResult }>();
  const [error, setError] = useState<{
    message: string;
    field?: string;
    key?: string;
  }>({ message: "" });
  const [scalars, setScalars] = useState<Record<string, ScalarState>>({});
  const followHelp = useHelp();
  // The tile number as typed, while it is being typed.
  const [tileDraft, setTileDraft] = useState<string>();
  // Asking again after a failure that names no field, such as a timeout.
  const [attempt, setAttempt] = useState(0);
  const scalarClient = useRef<EngineClient | null>(null),
    generation = useRef(0),
    jobs = useRef(new Set<Promise<void>>());
  const session = useRef<LatestSession<LaceRequest, LaceResult> | null>(null);
  // The motion's frames: one request at a time and one replaceable intent,
  // on a worker that keeps the one frozen patch it moves.
  const frames = useRef<LatestSession<LaceFrameRequest, LaceFrame> | null>(
    null,
  );
  const exportGeneration = useRef(0);
  const key = JSON.stringify(laceRequest(study));
  const current = shown?.key === key;
  const [film, setFilm] = useState<Film>();
  const [playing, setPlaying] = useState(false);
  // A motion played once to its end leaves its slider at the end.
  const [finished, setFinished] = useState(false);
  const [exporting, setExporting] = useState(false),
    [exportProgress, setExportProgress] = useState(0);
  const stopClock = useRef<() => void>(() => {}),
    movieGeneration = useRef(0),
    exportAbort = useRef<AbortController | null>(null);
  const exportState = useMotionExport();
  const exportSection = useDisclosure("lace-export");
  const view = useRef<HTMLDivElement>(null),
    playback = useRef<HTMLDivElement>(null);
  // While a motion is frozen, its frame is drawn, or its static patch
  // until the first frame arrives; otherwise the shown result.
  const result = film ? (film.frame ?? film.source) : shown?.result;
  const motion = study.motion ?? defaultLaceMotion;
  const isometry = study.isometry ?? centered;
  const durationError =
    !Number.isFinite(motion.duration) ||
    motion.duration < 0.1 ||
    motion.duration > 3600
      ? "Duration must be 0.1–3,600 seconds."
      : "";
  // Whole-number fields are checked here, as the worker would, so the
  // refusal names the field without a round trip; the farthest offset's
  // range too, so a path Go would refuse is never played.
  const countError = !Number.isInteger(study.depth)
    ? { field: "depth", message: "Enter a whole number." }
    : !Number.isInteger(study.maxTiles)
      ? { field: "maxTiles", message: "Enter a whole number." }
      : undefined;
  const motionError =
    !Number.isFinite(motion.offset) ||
    motion.offset < 0 ||
    motion.offset > laceLimits.offset
      ? {
          field: "motion.offset",
          message: `farthest offset must be 0–${laceLimits.offset}`,
        }
      : (["orbits", "turns"] as const)
          .map((k) =>
            !Number.isInteger(motion[k])
              ? { field: `motion.${k}`, message: "Enter a whole number." }
              : Math.abs(motion[k]) > laceLimits.turns
                ? {
                    field: `motion.${k}`,
                    message: `${k} must be −${laceLimits.turns}–${laceLimits.turns}`,
                  }
                : undefined,
          )
          .find(Boolean);
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
    session.current = new LatestSession(
      () => new EngineClient(),
      (client, q: LaceRequest) => client.lace(q),
    );
    frames.current = new LatestSession(
      () => new EngineClient(),
      (client, f: LaceFrameRequest) => client.laceFrame(f),
    );
    scalarClient.current = new EngineClient();
    return () => {
      exportGeneration.current++;
      movieGeneration.current++;
      exportAbort.current?.abort();
      stopClock.current();
      session.current?.cancel();
      frames.current?.cancel();
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
    const request = laceRequest(study);
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
  // Follow selection's eased camera move, which a manual change stops.
  const { moveTo, halt } = useCameraMove({
    view: study.view,
    setView: (view) => setStudy((s) => ({ ...s, view })),
    scale: laceScale,
  });
  // The motion's clock. Pause keeps the frozen patch, its time and its
  // frame; Stop and any edit to generation or the path end it and restore
  // the static drawing.
  const pause = () => {
    stopClock.current();
    stopClock.current = () => {};
    setPlaying(false);
  };
  const endFilm = () => {
    pause();
    frames.current?.invalidate();
    setFilm(undefined);
    setFinished(false);
  };
  const fail = (e: unknown) => {
    endFilm();
    setError({
      message: (e as Error).message,
      field: e instanceof EngineError ? e.field : undefined,
      key,
    });
  };
  // The patch a motion freezes: the frozen one, or the current result.
  const source: Film | undefined =
    film ??
    (ready && shown
      ? {
          source: shown.result,
          key: shown.key,
          request: laceRequest(study),
          time: 0,
        }
      : undefined);
  // Pending constants wait, as does a paused motion's Resume.
  const canPlay =
    !!source && valid && !durationError && !motionError && !exporting;
  // The frame at a time on the timeline. The motion starts and ends at the
  // static patch exactly (Go returns the start's isometry at progress 0
  // and 1), so those times need no request.
  const frameAt = (f: Film, path: LaceStudyMotion, time: number) => {
    const progress = progressAt(time, path.repeat, "steady");
    if (progress === 0 || progress === 1) return Promise.resolve(f.source);
    return new Promise<LaceResult>((resolve, reject) =>
      frames.current!.update(
        { lace: f.request, motion: pathOf(path), progress },
        (frame) => resolve(movedResult(f.source, frame)),
        reject,
      ),
    );
  };
  // A loop is offered only when its last frame, drawn with the frozen
  // tiles, camera, layers and appearance, is its first.
  const loopRefusal = async (f: Film, path: LaceStudyMotion) => {
    if (path.repeat !== "loop") return null;
    const props = drawing(f.source)!;
    const end = await new Promise<LaceResult>((resolve, reject) =>
      frames.current!.update(
        { lace: f.request, motion: pathOf(path), progress: 1 },
        (frame) => resolve(movedResult(f.source, frame)),
        reject,
      ),
    );
    return laceLoopRefusal(props, { ...props, result: end });
  };
  const start = async () => {
    if (!canPlay || !source) return;
    const from = finished || source.time >= 1 ? 0 : source.time;
    const frozen: Film = { ...source, time: from };
    const path = { ...motion };
    setFilm(frozen);
    setFinished(false);
    setPlaying(true);
    revealDrawing(view.current, playback.current);
    let refusal: string | null;
    try {
      refusal = await loopRefusal(frozen, path);
    } catch (e) {
      fail(e);
      return;
    }
    if (refusal) {
      endFilm();
      setError({ message: refusal, field: "repeat", key });
      return;
    }
    stopClock.current = play<LaceResult>({
      from,
      duration: path.duration * 1000,
      repeat: cycles(path.repeat),
      lanes: [(t) => frameAt(frozen, path, t)],
      show: (frame, t) =>
        setFilm((f) => f && { ...f, time: t, frame, frameTime: t }),
      end: () => {
        stopClock.current = () => {};
        setPlaying(false);
        setFilm(undefined);
        setFinished(true);
      },
      fail,
    });
  };
  const seek = (time: number) => {
    if (!source || exporting) return;
    pause();
    setFinished(false);
    const frozen = { ...source, time };
    setFilm(frozen);
    void frameAt(frozen, motion, time).then(
      (frame) =>
        setFilm((f) =>
          f && f.time === time ? { ...f, frame, frameTime: time } : f,
        ),
      // A newer seek or Stop replaces this one without settling it; any
      // other failure ends the motion.
      fail,
    );
  };
  // Generation settings, the static isometry and the motion's path end a
  // motion before they change; its timing pauses it.
  const edit = (change: (s: LaceStudy) => LaceStudy) => {
    endFilm();
    setStudy(change);
  };
  const setIsometry = (change: Partial<LaceIsometry>) =>
    edit((s) => ({
      ...s,
      isometry: { ...(s.isometry ?? centered), ...change },
    }));
  const setPath = (change: Partial<LaceStudyMotion>) =>
    edit((s) => ({
      ...s,
      motion: { ...(s.motion ?? defaultLaceMotion), ...change },
    }));
  const setTiming = (change: Partial<LaceStudyMotion>) => {
    pause();
    setStudy((s) => ({
      ...s,
      motion: { ...(s.motion ?? defaultLaceMotion), ...change },
    }));
  };
  const select = (i: number, typed = false) => {
    if (!result) return;
    if (!typed) setTileDraft(undefined);
    setStudy((s) => ({
      ...s,
      selected: i >= 0 ? addressOf(result, i) : undefined,
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
  const drawing = (drawn = result): LaceDrawingProps | undefined =>
    drawn && {
      result: drawn,
      edges: study.edges,
      motif: study.motif,
      presentation: study.presentation,
      selected,
      camera: study.view,
      dark: theme.dark,
      scheme: theme.scheme,
      weight: study.weight,
    };
  const metadata = () => ({
    kind: "hyperbolic-lace",
    tiling: "{7,3}",
    model: "Poincaré disk",
    metric: "ds² = 4|dz|²/(1 − |z|²)², curvature −1",
    units: "rim radius = 1",
    depth: study.depth,
    maxTiles: study.maxTiles,
    starPoint: study.starPoint,
    tiles: result?.center.length,
    omitted: result?.omitted,
    stopped: result?.stopped || undefined,
    finite: result
      ? `A finite patch of an infinite tiling: ${result.center.length} tiles within ${Math.max(0, ...result.depth)} reflections of the center tile. The rim is the disk's boundary at infinity; no tile reaches it.`
      : undefined,
    edges: study.edges,
    motif: study.motif,
    presentation: study.presentation,
    ...(selected >= 0 &&
      result && {
        selected: {
          number: selected + 1,
          address: addressOf(result, selected),
          depth: result.depth[selected],
          reversed: result.reversed[selected],
        },
      }),
    view: study.view,
    theme: theme.dark ? "dark" : "light",
    scheme: theme.scheme,
    weight: study.weight,
    ...(!isIdentity(study.isometry) && {
      isometry: { ...isometry, coverage: (film?.source ?? result)?.coverage },
    }),
    ...(film && {
      motion: {
        ...motionRecord(),
        time: film.frameTime ?? film.time,
        isometry: result?.isometry,
        coverage: result?.coverage,
      },
    }),
  });
  // The motion's definition, as a still of a frame and a movie record it.
  const motionRecord = () => ({
    start: isometry,
    farthestOffset: motion.offset,
    orbits: motion.orbits,
    turns: motion.turns,
    duration: motion.duration,
    repeat: motion.repeat,
    isometry:
      "T(z) = e^{iθ}(z − a)/(1 − āz), a = offset·e^{i·direction}, θ = rotation",
    path: "offset (1 − s)·start + s·farthest with s = (1 − cos 2πp)/2; direction + 2π·orbits·p; rotation + 2π·turns·p",
    membership: `the same ${source?.source.center.length ?? 0} tiles at every time; the camera holds`,
  });
  async function still(format: string, settings: Still) {
    const props = drawing();
    if (!(ready || (film && valid)) || !props) return;
    const id = ++exportGeneration.current;
    try {
      await laceStill(
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
  // The movie freezes the patch, motion, view and appearance when it
  // starts; only Cancel or Return discards it.
  async function movie() {
    const props = drawing(source?.source);
    if (!canPlay || !source || !props) return;
    pause();
    const path = { ...motion };
    const frozen = { ...source };
    setExporting(true);
    setExportProgress(0);
    const id = ++movieGeneration.current;
    const controller = new AbortController();
    exportAbort.current = controller;
    try {
      const refusal = await loopRefusal(frozen, path);
      if (refusal) throw new Error(refusal);
      await laceMovie({
        drawing: props,
        request: frozen.request,
        motion: path,
        metadata: { ...metadata(), motion: motionRecord() },
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
  const drawn = JSON.stringify([
    key,
    film?.frameTime,
    selected,
    study.edges,
    study.motif,
    study.presentation,
    study.view,
    study.weight,
    theme.dark,
    theme.scheme,
  ]);
  // Any change to what the still would show discards one being made.
  useEffect(() => {
    exportGeneration.current++;
  }, [drawn]);
  const message = scalarError
    ? `${scalarError.name}: ${scalarError.error}`
    : (activeError?.message ?? motionError?.message ?? durationError);
  const errorField = activeError
    ? activeError.field
    : (motionError?.field ?? (durationError ? "duration" : undefined));
  const title =
    scalarError?.name ??
    (errorField === "duration"
      ? "Duration"
      : errorField === "repeat"
        ? "Repeat"
        : errorField
          ? labels[errorField]
          : undefined);
  const [claimed, setClaimed] = useState(false);
  const claim = useCallback((_key: string, on: boolean) => setClaimed(on), []);
  const target = useMemo(
    () => ({ label: title, message, claim, touch: () => {} }),
    [title, message, claim],
  );
  const props = drawing();
  // The summary describes the drawn patch: a frame's coverage as it moves.
  const summary = film
    ? cutoffSummary(result!, JSON.parse(film.key))
    : shown && cutoffSummary(shown.result, JSON.parse(shown.key));
  const time = film?.time ?? (finished ? 1 : 0);
  const drawnIsometry = result?.isometry ?? isometry;
  const about = result && selected >= 0 ? explain(result, selected) : undefined;
  const around = result && selected >= 0 ? neighbors(result, selected) : [];
  const whole = (
    k: "depth" | "maxTiles",
    label: string,
    min: number,
    max: number,
  ) => (
    <Field label={label} help={laceHelp[k]}>
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
  // The motion's whole-number counts, which are path settings.
  const whole2 = (k: "orbits" | "turns", label: string) => (
    <Field label={label} help={laceHelp[k]}>
      <input
        type="number"
        min={-laceLimits.turns}
        max={laceLimits.turns}
        value={Number.isNaN(motion[k]) ? "" : motion[k]}
        onChange={(e) => {
          const value = e.currentTarget.valueAsNumber;
          setPath({ [k]: value });
        }}
      />
    </Field>
  );
  const layer = (k: "edges" | "motif", label: string) => (
    <CheckSetting
      label={label}
      topic={label}
      checked={study[k]}
      onChange={(on) => setStudy((s) => ({ ...s, [k]: on }))}
      help={laceHelp[k]}
    />
  );
  return (
    <dialog
      ref={dialog}
      className="garden lace"
      aria-labelledby="lace-title"
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
          // One mode per link: a garden there would open instead.
          study={() => {
            const { garden: _, ...base } = entry.study;
            return { ...base, lace: study };
          }}
          disabled={!valid || !(current || film)}
        />
        <ExportImageMenu
          kind="hyperbolic-lace"
          revision={drawn}
          disabled={!(ready || (film && valid)) || playing || exporting}
          base={lacePage}
          onSave={still}
        />
      </AppHeader>
      <div className="garden-content">
        <div className="garden-heading">
          <p className="eyebrow">Poincaré disk · regular tiling {"{7,3}"}</p>
          <h2 id="lace-title">Hyperbolic lace</h2>
          <p>
            Heptagons meeting three at a corner cannot tile a flat plane, but
            they tile the hyperbolic plane, drawn here in a disk whose rim is
            infinitely far away. Every tile is the center tile reflected across
            sides, as is its motif.
          </p>
        </div>
        <ScalarStatus.Provider value={scalarStatus}>
          <FieldErrorContext.Provider value={target}>
            <div className="garden-layout">
              <main>
                <div
                  ref={view}
                  className="garden-view"
                  data-motion-time={film?.frameTime}
                >
                  {props ? (
                    <LaceDrawing
                      {...props}
                      busy={film ? film.frameTime !== film.time : !ready}
                      onCamera={manual}
                      onSelect={select}
                    />
                  ) : (
                    <p className="garden-placeholder" role="status">
                      Reflecting tiles…
                    </p>
                  )}
                </div>
                <p className="note garden-gestures">
                  Click or tap a tile to select it. Drag to pan; scroll or pinch
                  to zoom, which enlarges the drawing without moving the disk.
                  Keys: arrows, + / −, Home.{" "}
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
                        key: "motif",
                        shown: study.motif,
                        content: (
                          <>
                            <span className="base-dot" />
                            Motif
                          </>
                        ),
                      },
                      {
                        key: "edges",
                        shown: study.edges,
                        content: (
                          <>
                            <span className="line-dot" />
                            Tile sides
                          </>
                        ),
                      },
                      {
                        key: "rim",
                        shown: true,
                        content: (
                          <>
                            <span className="base-dot garden-thick" />
                            Rim
                          </>
                        ),
                      },
                      {
                        key: "selected",
                        shown: selected >= 0,
                        content: (
                          <>
                            <span className="derived-dot" />
                            Selected tile
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
                  aria-label="Selected tile"
                >
                  {result && (
                    <>
                      <div className="garden-picker">
                        <Field label="Tile" help={laceHelp.tile}>
                          <input
                            type="number"
                            min={1}
                            max={result.center.length}
                            value={
                              tileDraft ?? (selected >= 0 ? selected + 1 : "")
                            }
                            placeholder="None"
                            onChange={(e) => {
                              // An emptied or out-of-range entry stays as
                              // typed until it names a tile or is left.
                              setTileDraft(e.currentTarget.value);
                              const n = e.currentTarget.valueAsNumber;
                              if (
                                Number.isInteger(n) &&
                                n >= 1 &&
                                n <= result.center.length
                              )
                                select(n - 1, true);
                            }}
                            onBlur={() => setTileDraft(undefined)}
                          />
                        </Field>
                        <div
                          className="garden-step"
                          role="group"
                          aria-label="Step through tiles"
                        >
                          <button
                            type="button"
                            disabled={selected === 0}
                            onClick={() =>
                              select(selected < 0 ? 0 : selected - 1)
                            }
                            aria-label="Previous tile"
                          >
                            ‹ Previous
                          </button>
                          <button
                            type="button"
                            disabled={selected === result.center.length - 1}
                            onClick={() => select(selected + 1)}
                            aria-label="Next tile"
                          >
                            Next ›
                          </button>
                          <button
                            type="button"
                            disabled={selected < 0 && !study.selected}
                            onClick={() => {
                              setTileDraft(undefined);
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
                      <HelpText help={followHelp}>{laceHelp.follow}</HelpText>
                      {about ? (
                        <div className="garden-about">
                          <h3>{tileName(selected)}</h3>
                          <p className="garden-facts">{about.facts}</p>
                          <p className="garden-facts">
                            Sides crossed from the center:{" "}
                            {addressText(addressOf(result, selected))}
                          </p>
                          <p>{about.text}</p>
                          <div
                            className="garden-generators lace-neighbors"
                            role="group"
                            aria-label="Neighboring tiles"
                          >
                            {around.map((t, k) => (
                              <button
                                key={k}
                                type="button"
                                disabled={t < 0}
                                onClick={() => select(t)}
                                aria-label={
                                  t < 0
                                    ? `Across ${sideName(k)}: beyond the patch`
                                    : `Across ${sideName(k)}: ${tileName(t)}`
                                }
                              >
                                {k + 1}: {t < 0 ? "—" : t + 1}
                              </button>
                            ))}
                          </div>
                          <p className="hint">
                            The tile across each side, as side: tile; a dash
                            lies beyond the patch.
                          </p>
                        </div>
                      ) : (
                        <p className="note">
                          {study.selected
                            ? "The selected tile lies beyond the current cutoffs."
                            : "No tile selected."}
                        </p>
                      )}
                    </>
                  )}
                </section>
                <Field label="Presentation" help={laceHelp.presentation}>
                  <select
                    value={study.presentation}
                    onChange={(e) => {
                      const presentation = e.currentTarget
                        .value as LacePresentation;
                      setStudy((s) => ({ ...s, presentation }));
                    }}
                  >
                    <option value="complete">Every tile</option>
                    <option value="selected">Selected tile and its path</option>
                  </select>
                </Field>
                {study.presentation === "selected" && selected < 0 && (
                  <p className="note">
                    Select a tile to see the tiles crossed to reach it; until
                    then only the center tile is drawn.
                  </p>
                )}
                <div className="lace-layers">
                  {layer("motif", "Motif")}
                  {layer("edges", "Tile sides")}
                </div>
                <h3 className="garden-section">Motion</h3>
                <div
                  ref={playback}
                  id="lace-playback"
                  className={`playback ${film || playing || exporting ? "active" : ""}`}
                  role="group"
                  aria-label="Motion playback"
                >
                  <div className="animation-buttons">
                    <button
                      disabled={(!canPlay && !playing) || exporting}
                      onClick={() => (playing ? pause() : void start())}
                    >
                      {playing
                        ? "Pause motion"
                        : film && film.time < 1
                          ? "Resume motion"
                          : "Play motion"}
                    </button>
                    <button
                      disabled={!film && !playing && !exporting && !finished}
                      onClick={() => (exporting ? cancelExport() : endFilm())}
                    >
                      {exporting ? "Cancel export" : "Stop motion"}
                    </button>
                  </div>
                  <div className="timeline">
                    <Field
                      label="Animation progress"
                      help={laceHelp.progress}
                      helpBeforeControl
                    >
                      <ProgressSlider
                        progress={time}
                        disabled={!source || exporting || !!motionError}
                        onSeek={seek}
                      />
                    </Field>
                    <p
                      className="note garden-reveal-status lace-motion-status"
                      aria-live="off"
                    >
                      {(time * (durationError ? 0 : motion.duration)).toFixed(
                        1,
                      )}{" "}
                      / {durationError ? "—" : motion.duration} s · offset{" "}
                      {drawnIsometry.offset.toFixed(3)}, direction{" "}
                      {drawnIsometry.direction.toFixed(3)}, rotation{" "}
                      {drawnIsometry.rotation.toFixed(3)}
                      {film && !playing && film.time < 1 ? " · Paused" : ""}
                    </p>
                  </div>
                </div>
                <fieldset disabled={exporting} className="garden-reveal">
                  <Field label="Farthest offset" help={laceHelp.motionOffset}>
                    <ScalarInput
                      name="Farthest offset"
                      value={motion.offset}
                      onChange={(v) => setPath({ offset: v })}
                    />
                  </Field>
                  <div className="pair">
                    {whole2("orbits", "Orbits")}
                    {whole2("turns", "Turns")}
                  </div>
                  <div className="pair">
                    <Field label="Duration" help={laceHelp.duration}>
                      <input
                        type="number"
                        min={0.1}
                        max={3600}
                        step="any"
                        value={
                          Number.isNaN(motion.duration) ? "" : motion.duration
                        }
                        onChange={(e) =>
                          setTiming({ duration: e.currentTarget.valueAsNumber })
                        }
                      />
                    </Field>
                    <Field label="Repeat" help={laceHelp.repeat}>
                      <select
                        value={motion.repeat}
                        onChange={(e) => {
                          if (errorField === "repeat")
                            setError({ message: "" });
                          setTiming({
                            repeat: e.currentTarget.value as Repeat,
                          });
                        }}
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
                    id="lace-export-settings"
                    cyclic={cycles(motion.repeat)}
                    disclosure={exportSection}
                  />
                </fieldset>
                <button
                  className="animation-export"
                  disabled={
                    !canPlay ||
                    exportState.formats?.[exportState.chosen] !== "yes" ||
                    Math.ceil(motion.duration * exportState.fps) > 7200
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
                <h3 className="garden-section">Disk isometry</h3>
                <div className="pair">
                  <Field label="Offset" help={laceHelp.offset}>
                    <ScalarInput
                      name="Offset"
                      value={isometry.offset}
                      onChange={(v) => setIsometry({ offset: v })}
                    />
                  </Field>
                  <Field label="Direction" help={laceHelp.direction}>
                    <ScalarInput
                      name="Direction"
                      value={isometry.direction}
                      onChange={(v) => setIsometry({ direction: v })}
                    />
                  </Field>
                </div>
                <Field label="Rotation" help={laceHelp.rotation}>
                  <ScalarInput
                    name="Rotation"
                    value={isometry.rotation}
                    onChange={(v) => setIsometry({ rotation: v })}
                  />
                </Field>
                <p className="note">
                  The isometry and the motion move the lace inside a fixed rim,
                  every tile keeping its hyperbolic size; zoom and pan move the
                  camera, rim and all.{" "}
                  <button
                    type="button"
                    className="text-button"
                    disabled={isIdentity(study.isometry)}
                    onClick={() => setIsometry(centered)}
                  >
                    Center the lace
                  </button>
                </p>
                <h3 className="garden-section">Motif</h3>
                <Field label="Star point" help={laceHelp.starPoint}>
                  <ScalarInput
                    name="Star point"
                    value={study.starPoint}
                    onChange={(v) => edit((s) => ({ ...s, starPoint: v }))}
                  />
                </Field>
                <h3 className="garden-section">Cutoffs</h3>
                <div className="pair">
                  {whole("depth", "Depth", 0, laceLimits.depth)}
                  {whole("maxTiles", "Tile limit", 1, laceLimits.tiles)}
                </div>
                <p
                  className="note garden-summary lace-summary"
                  data-current={current || undefined}
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
