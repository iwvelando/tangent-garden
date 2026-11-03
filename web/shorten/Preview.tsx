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
import { Field, FieldErrorContext } from "../Field";
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
import { loopLead } from "../loop-check";
import type { ShortenEntry } from "./Context";
import { ShortenDrawing, type ShortenDrawingProps } from "./Drawing";
import { shortenMovie, shortenStill } from "./export";
import {
  defaultShorten,
  defaultShortenMotion,
  extentOf,
  familyTimes,
  refusedField,
  shortenHelp,
  shortenLimits,
  shortenPage,
  shortenRequest,
  stopText,
  timeAt,
  type Framing,
  type Nest,
  type ShortenContour,
  type ShortenMotion,
  type ShortenReply,
  type ShortenRequest,
  type ShortenStudy,
  type Spacing,
} from "./model";
import "../garden/garden.css";
import "./shorten.css";

const labels: Partial<
  Record<keyof ShortenStudy | "duration" | "repeat", string>
> = {
  petals: "Petals",
  depth: "Petal depth",
  ruffles: "Ruffles",
  ruffle: "Ruffle depth",
  phase: "Phase",
  lobes: "Lobes",
  ripple: "Ripple",
  contours: "Loops",
  duration: "Duration",
  repeat: "Repeat",
};
const fmt = (v: number | undefined, digits = 4) =>
  v !== undefined && Number.isFinite(v) ? v.toPrecision(digits) : "—";
// What generation asks for: the film's settings and the family's times.
type Generation = { study: ShortenStudy; contours: number; spacing: Spacing };
const generationOf = (s: ShortenStudy): Generation => ({
  study: s,
  contours: s.contours,
  spacing: s.spacing,
});
// A motion frozen while it plays, is paused or seeks: where its timeline
// stands, from 0 to 1, and the loop drawn, with the timeline time it is for.
type Film = { time: number; frame?: ShortenContour; frameTime?: number };

export function ShortenPreview({
  entry,
  onReturn,
}: {
  entry: ShortenEntry;
  onReturn: (via: "keyboard" | "pointer") => void;
}) {
  const theme = useTheme(),
    dialog = useRef<HTMLDialogElement>(null),
    back = useRef<HTMLButtonElement>(null),
    quiet = useQuietFocus(dialog);
  const [study, setStudy] = useState<ShortenStudy>(() =>
    structuredClone(entry.study.shorten ?? defaultShorten),
  );
  // The nest shown and the settings it answers.
  const [shown, setShown] = useState<{ key: string; reply: ShortenReply }>();
  const [error, setError] = useState<{
    message: string;
    field?: string;
    key?: string;
  }>({ message: "" });
  const [scalars, setScalars] = useState<Record<string, ScalarState>>({});
  // Asking again after a failure that names no field, such as a timeout.
  const [attempt, setAttempt] = useState(0);
  const scalarClient = useRef<EngineClient | null>(null),
    generation = useRef(0),
    jobs = useRef(new Set<Promise<void>>());
  const session = useRef<LatestSession<Generation, ShortenReply> | null>(null);
  // The motion's loops: one request at a time and one replaceable intent,
  // on a worker that keeps the film it samples.
  const frames = useRef<LatestSession<ShortenRequest, ShortenContour> | null>(
    null,
  );
  const exportGeneration = useRef(0);
  // The film's settings, and the nest's: the family's count and spacing too.
  const filmKey = JSON.stringify(shortenRequest(study, []));
  const key = JSON.stringify([filmKey, study.contours, study.spacing]);
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
  const exportSection = useDisclosure("shorten-export");
  const view = useRef<HTMLDivElement>(null),
    playback = useRef<HTMLDivElement>(null);
  const motion = study.motion ?? defaultShortenMotion;
  const reply = shown?.reply;
  const durationError =
    !Number.isFinite(motion.duration) ||
    motion.duration < 0.1 ||
    motion.duration > 3600
      ? "Duration must be 0.1–3,600 seconds."
      : "";
  const repeatError =
    motion.repeat === "loop"
      ? `${loopLead} the loop ends far smaller than it starts. Back and forth returns smoothly.`
      : "";
  // Whole-number fields are checked here, as the worker would, so the
  // refusal names the field without a round trip.
  const whole = (v: number) => Number.isInteger(v);
  const countError =
    study.family === "flower" && !whole(study.petals)
      ? { field: "petals", message: "Enter a whole number." }
      : study.family === "flower" && !whole(study.ruffles)
        ? { field: "ruffles", message: "Enter a whole number." }
        : !whole(study.contours) ||
            study.contours < 1 ||
            study.contours > shortenLimits.contours
          ? {
              field: "contours",
              message: `Loops must be a whole number, 1–${shortenLimits.contours}.`,
            }
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
    // The film's summary first, then the family at times within it; the
    // worker keeps the film, so the second request only samples it.
    session.current = new LatestSession(
      () => new EngineClient(),
      async (client, g: Generation) => {
        const head = await client.shorten(shortenRequest(g.study, []));
        const times = familyTimes(head.result.end, g.contours, g.spacing);
        return (await client.shorten(shortenRequest(g.study, times))).result;
      },
    );
    frames.current = new LatestSession(
      () => new EngineClient(),
      async (client, q: ShortenRequest) =>
        (await client.shorten(q)).result.contours[0],
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
    const g = generationOf(study);
    const timer = setTimeout(
      () =>
        session.current!.update(
          g,
          (r) => {
            setShown({ key, reply: r });
            setError({ message: "" });
          },
          (e) =>
            setError({
              message: e.message,
              field:
                e instanceof EngineError && e.field
                  ? (refusedField[e.field] ?? e.field)
                  : undefined,
              key,
            }),
        ),
      reply ? 120 : 0,
    );
    return () => {
      clearTimeout(timer);
      session.current?.invalidate();
    };
  }, [key, !!countError, !!scalarError, scalarPending, attempt, !!film]);
  const pause = () => {
    stopClock.current();
    stopClock.current = () => {};
    setPlaying(false);
  };
  // Stop and any edit to the film end a motion and restore the whole nest.
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
  const canPlay =
    ready && !!reply && !durationError && !repeatError && !exporting;
  // The loop at a timeline time: its progress through the motion, then the
  // flow's physical time by the pacing.
  const physical = (time: number, path: ShortenMotion, end: number) =>
    timeAt(progressAt(time, path.repeat, "steady"), end, path.pacing);
  const frameAt = (time: number, path: ShortenMotion, end: number) =>
    new Promise<ShortenContour>((resolve, reject) =>
      frames.current!.update(
        shortenRequest(study, [physical(time, path, end)]),
        resolve,
        reject,
      ),
    );
  const start = () => {
    if (!canPlay || !reply) return;
    const from = finished || (film?.time ?? 0) >= 1 ? 0 : (film?.time ?? 0);
    const path = { ...motion };
    const end = reply.end;
    setFilm((f) => ({ ...f, time: from }));
    setFinished(false);
    setPlaying(true);
    revealDrawing(view.current, playback.current);
    stopClock.current = play<ShortenContour>({
      from,
      duration: path.duration * 1000,
      repeat: cycles(path.repeat),
      lanes: [(t) => frameAt(t, path, end)],
      show: (frame, t) => setFilm({ time: t, frame, frameTime: t }),
      end: () => {
        stopClock.current = () => {};
        setPlaying(false);
        setFinished(true);
      },
      fail,
    });
  };
  const seek = (time: number) => {
    if (!ready || !reply || exporting) return;
    pause();
    setFinished(false);
    setFilm((f) => ({ ...f, time }));
    void frameAt(time, motion, reply.end).then(
      (frame) =>
        setFilm((f) =>
          f && f.time === time ? { ...f, frame, frameTime: time } : f,
        ),
      // A newer seek or Stop replaces this one without settling it; any
      // other failure ends the motion.
      fail,
    );
  };
  // Seed, family and nest settings end a motion before they change; its
  // timing pauses it; presentation keeps it.
  const edit = (change: (s: ShortenStudy) => ShortenStudy) => {
    endFilm();
    setStudy(change);
  };
  const present = (change: Partial<ShortenStudy>) =>
    setStudy((s) => ({ ...s, ...change }));
  const setTiming = (change: Partial<ShortenMotion>) => {
    pause();
    setStudy((s) => ({
      ...s,
      motion: { ...(s.motion ?? defaultShortenMotion), ...change },
    }));
  };
  const manual = (view: PlotCamera) => setStudy((s) => ({ ...s, view }));
  const drawing = (): ShortenDrawingProps | undefined =>
    reply && {
      extent: extentOf(study),
      family: reply.contours,
      current: film?.frame,
      framing: study.framing,
      nest: study.nest,
      camera: study.view,
      dark: theme.dark,
      scheme: theme.scheme,
      weight: study.weight,
    };
  const solver = () => {
    const q = shortenRequest(study, []);
    return study.family === "flower"
      ? {
          flow: "dX/dt = −κ n_out as a radial graph: (ln r)_t = e^{−2ℓ}(ℓ_φφ − 1 − ℓ_φ²)/(1 + ℓ_φ²)",
          method:
            "central differences on equally spaced polar angles, ROS2 with the exact Jacobian, steps τ / max|ℓ_t|",
          nodes: q.bloom!.nodes,
          tau: q.bloom!.tau,
        }
      : {
          flow: "dX/dt = −κ n_out by the support function: h_t = −1/(h + h_θθ)",
          method:
            "second differences on equally spaced normal angles, ROS2 with the exact Jacobian",
          nodes: q.convex!.nodes,
          tau: q.convex!.tau,
        };
  };
  const motionRecord = () => ({
    duration: motion.duration,
    repeat: motion.repeat,
    pacing: motion.pacing,
    time: "physical t = end·f(p): f = p³ (early), 1 − (1 − p)² (equal radius) or p (physical time)",
  });
  const metadata = () => ({
    kind: "curve-shortening",
    seed:
      study.family === "flower"
        ? {
            family: "flower",
            curve: "r(φ) = 1 + a cos kφ + b cos(jφ + ψ)",
            petals: study.petals,
            depth: study.depth,
            ruffles: study.ruffles,
            ruffle: study.ruffle,
            phase: study.phase,
          }
        : {
            family: "convex",
            curve: "h(θ) = 1 + ε cos mθ",
            lobes: study.lobes,
            ripple: study.ripple,
          },
    ...solver(),
    units: "starting radius 1; time in length²",
    extinction: reply?.extinction,
    end: reply?.end,
    stop: reply?.stop,
    family: reply?.contours.map((c) => c.t),
    spacing: study.spacing,
    nest: study.nest,
    framing:
      study.framing === "normalized"
        ? "each loop scaled by √(A₀/A) about its centroid, measured from the drawn loop (presentation only)"
        : "physical",
    view: study.view,
    theme: theme.dark ? "dark" : "light",
    scheme: theme.scheme,
    weight: study.weight,
    ...(film?.frame && { time: film.frame.t, motion: motionRecord() }),
  });
  async function still(format: string, settings: Still) {
    const props = drawing();
    if (!ready || !props) return;
    const id = ++exportGeneration.current;
    try {
      await shortenStill(
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
  // The movie freezes the study, view and appearance when it starts, and
  // samples the film on its own engine; only Cancel or Return discards it.
  async function movie() {
    const props = drawing();
    if (!canPlay || !props || !reply) return;
    pause();
    const path = { ...motion };
    const frozen = structuredClone(study);
    const end = reply.end;
    setExporting(true);
    setExportProgress(0);
    const id = ++movieGeneration.current;
    const controller = new AbortController();
    exportAbort.current = controller;
    const engine = new EngineClient();
    controller.signal.addEventListener("abort", () => engine.dispose());
    try {
      await shortenMovie({
        drawing: { ...props, current: undefined },
        metadata: { ...metadata(), motion: motionRecord() },
        duration: path.duration,
        repeat: path.repeat,
        sample: async (time) =>
          (
            await engine.shorten(
              shortenRequest(frozen, [physical(time, path, end)]),
            )
          ).result.contours[0],
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
      engine.dispose();
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
    study.framing,
    study.nest,
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
    : (activeError?.message ?? (durationError || repeatError));
  const errorField = activeError
    ? activeError.field
    : durationError
      ? "duration"
      : repeatError
        ? "repeat"
        : undefined;
  const title =
    scalarError?.name ??
    (errorField ? labels[errorField as keyof typeof labels] : undefined);
  const [claimed, setClaimed] = useState(false);
  const claim = useCallback((_key: string, on: boolean) => setClaimed(on), []);
  const target = useMemo(
    () => ({ label: title, message, claim, touch: () => {} }),
    [title, message, claim],
  );
  const props = drawing();
  const time = film?.time ?? (finished ? 1 : 0);
  const frame = film?.frame;
  const a0 = reply?.contours[0]?.area;
  const select = <T extends string | number>(
    label: string,
    value: T,
    options: [T, string][],
    onChange: (v: T) => void,
    help: (typeof shortenHelp)[keyof typeof shortenHelp],
  ) => (
    <Field label={label} help={help}>
      <select
        value={String(value)}
        onChange={(e) =>
          onChange(
            options.find(([o]) => String(o) === e.currentTarget.value)![0],
          )
        }
      >
        {options.map(([o, text]) => (
          <option key={String(o)} value={String(o)}>
            {text}
          </option>
        ))}
      </select>
    </Field>
  );
  const count = (
    k: "petals" | "ruffles" | "contours",
    min: number,
    max: number,
  ) => (
    <Field label={labels[k]!} help={shortenHelp[k]}>
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
  const scalar = (k: "depth" | "ruffle" | "phase" | "ripple") => (
    <Field label={labels[k]!} help={shortenHelp[k]}>
      <ScalarInput
        name={labels[k]!}
        value={study[k]}
        onChange={(v) => edit((s) => ({ ...s, [k]: v }))}
      />
    </Field>
  );
  return (
    <dialog
      ref={dialog}
      className="garden shorten"
      aria-labelledby="shorten-title"
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
          // One mode per link: a garden or lace there would open instead.
          study={() => {
            const { garden: _, lace: __, ...base } = entry.study;
            return { ...base, shorten: study };
          }}
          disabled={!valid || !current}
        />
        <ExportImageMenu
          kind="curve-shortening"
          revision={drawn}
          disabled={!ready || playing || exporting}
          base={shortenPage}
          onSave={still}
        />
      </AppHeader>
      <div className="garden-content">
        <div className="garden-heading">
          <p className="eyebrow">Curve-shortening flow · dX/dt = κN</p>
          <h2 id="shorten-title">Curves that smooth themselves</h2>
          <p>
            Every point of the loop moves inward at its curvature. Petal tips
            retract, notches fill, and the loop rounds itself off as it shrinks
            toward a point.
          </p>
        </div>
        <ScalarStatus.Provider value={scalarStatus}>
          <FieldErrorContext.Provider value={target}>
            <div className="garden-layout">
              <main>
                <div ref={view} className="garden-view">
                  {props ? (
                    <ShortenDrawing
                      {...props}
                      busy={!ready || (!!film && film.frameTime !== film.time)}
                      progress={time}
                      onCamera={manual}
                    />
                  ) : (
                    <p className="garden-placeholder" role="status">
                      {message || "Smoothing the loop…"}
                    </p>
                  )}
                </div>
                <p className="note garden-gestures">
                  Drag to pan; scroll or pinch to zoom. Keys: arrows, + / −,
                  Home.{" "}
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
                        key: "nest",
                        shown: true,
                        content: (
                          <>
                            <span className="base-dot" />
                            Loops
                          </>
                        ),
                      },
                      {
                        key: "current",
                        shown: !!frame,
                        content: (
                          <>
                            <span className="derived-dot" />
                            Shown loop
                          </>
                        ),
                      },
                      {
                        key: "framing",
                        shown: true,
                        content:
                          study.framing === "normalized"
                            ? "Normalized to the starting area"
                            : "Physical scale",
                      },
                    ]}
                  />
                </div>
                <div className="note shorten-readout" aria-live="off">
                  {frame && reply ? (
                    <>
                      <p>
                        t = {fmt(frame.t)} of extinction T ={" "}
                        {fmt(reply.extinction)} (
                        {fmt((100 * frame.t) / reply.extinction, 3)}%)
                      </p>
                      <p>
                        Area {fmt(frame.area, 6)}; A₀ − 2πt ={" "}
                        {fmt(
                          a0 === undefined ? NaN : a0 - 2 * Math.PI * frame.t,
                          6,
                        )}{" "}
                        · length {fmt(frame.length, 5)} ·{" "}
                        {frame.minKappa !== undefined
                          ? `κ from ${fmt(frame.minKappa, 3)} to ${fmt(frame.maxKappa, 3)}`
                          : `ρ from ${fmt(frame.minRho, 3)} to ${fmt(frame.maxRho, 3)}`}
                      </p>
                    </>
                  ) : null}
                </div>
              </main>
              <aside>
                <h3 className="garden-section shorten-first">Seed</h3>
                {select(
                  "Seed",
                  study.family,
                  [
                    ["flower", "Flower"],
                    ["convex", "Convex loop"],
                  ],
                  (family) => edit((s) => ({ ...s, family })),
                  shortenHelp.family,
                )}
                {study.family === "flower" ? (
                  <>
                    <div className="pair">
                      {count("petals", 0, shortenLimits.petals)}
                      {scalar("depth")}
                    </div>
                    <div className="pair">
                      {count("ruffles", 0, shortenLimits.ruffles[1])}
                      {scalar("ruffle")}
                    </div>
                    {scalar("phase")}
                  </>
                ) : (
                  <div className="pair">
                    {select(
                      "Lobes",
                      study.lobes,
                      [
                        [3, "Three"],
                        [6, "Six"],
                      ],
                      (lobes) => edit((s) => ({ ...s, lobes })),
                      shortenHelp.lobes,
                    )}
                    {scalar("ripple")}
                  </div>
                )}
                <h3 className="garden-section">Nest</h3>
                <div className="pair">
                  {count("contours", 1, shortenLimits.contours)}
                  {select<Spacing>(
                    "Spacing",
                    study.spacing,
                    [
                      ["early", "Dense early"],
                      ["radius", "Equal radius"],
                      ["time", "Equal time"],
                    ],
                    (spacing) => edit((s) => ({ ...s, spacing })),
                    shortenHelp.spacing,
                  )}
                </div>
                <div className="pair">
                  {select<Nest>(
                    "Nest",
                    study.nest,
                    [
                      ["whole", "Whole"],
                      ["ghost", "Later loops faint"],
                      ["grows", "Grows with the motion"],
                    ],
                    (nest) => present({ nest }),
                    shortenHelp.nest,
                  )}
                  {select<Framing>(
                    "View",
                    study.framing,
                    [
                      ["physical", "Physical"],
                      ["normalized", "Normalized"],
                    ],
                    (framing) => present({ framing }),
                    shortenHelp.framing,
                  )}
                </div>
                <p
                  className="note garden-summary shorten-summary"
                  data-end={reply && current ? reply.end : undefined}
                >
                  {reply && current
                    ? `${reply.contours.length} loops from the seed to ${fmt((100 * reply.end) / reply.extinction, 4)}% of the extinction time; the flow ${stopText[reply.stop] ?? reply.stop}. ${shortenHelp.limits}`
                    : "Solving…"}
                </p>
                <h3 className="garden-section">Motion</h3>
                <div
                  ref={playback}
                  id="shorten-playback"
                  className={`playback ${film || playing || exporting ? "active" : ""}`}
                  role="group"
                  aria-label="Motion playback"
                >
                  <div className="animation-buttons">
                    <button
                      disabled={(!canPlay && !playing) || exporting}
                      onClick={() => (playing ? pause() : start())}
                    >
                      {playing
                        ? "Pause motion"
                        : film && film.time < 1 && !finished
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
                      help={shortenHelp.progress}
                      helpBeforeControl
                    >
                      <ProgressSlider
                        progress={time}
                        disabled={!ready || exporting}
                        onSeek={seek}
                      />
                    </Field>
                    <p className="note garden-reveal-status" aria-live="off">
                      {(time * (durationError ? 0 : motion.duration)).toFixed(
                        1,
                      )}{" "}
                      / {durationError ? "—" : motion.duration} s
                      {frame ? ` · t = ${fmt(frame.t, 3)}` : ""}
                      {film && !playing && !finished && film.time < 1
                        ? " · Paused"
                        : ""}
                    </p>
                  </div>
                </div>
                <fieldset disabled={exporting} className="garden-reveal">
                  <div className="pair">
                    <Field label="Duration" help={shortenHelp.duration}>
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
                    <Field label="Repeat" help={shortenHelp.repeat}>
                      <select
                        value={motion.repeat}
                        onChange={(e) =>
                          setTiming({ repeat: e.currentTarget.value as Repeat })
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
                  {select<Spacing>(
                    "Pacing",
                    motion.pacing,
                    [
                      ["early", "Dense early"],
                      ["radius", "Equal radius"],
                      ["time", "Physical time"],
                    ],
                    (pacing) => setTiming({ pacing }),
                    shortenHelp.pacing,
                  )}
                  <MotionExportSettings
                    state={exportState}
                    id="shorten-export-settings"
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
                <h3 className="garden-section">Appearance</h3>
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
