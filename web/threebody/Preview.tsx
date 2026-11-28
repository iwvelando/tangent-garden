// Three bodies: the planar Newtonian problem as a study over the notebook.
// One request prepares a finite, immutable history in the worker; playback,
// seeking, stills and movies select its samples by physical time. Nothing
// reintegrates or interpolates, and nothing is drawn past the terminal
// state. The configuration descriptor (configurations.ts) and the Go
// corpus supply every case's text and defaults.
import {
  count as formatCount,
  elapsed,
  liveReadout,
  mebibytes,
  progressPercent,
  readout,
} from "../number-format";
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
import { LineWeightField } from "../LineWeightField";
import { MotionExportSettings, useMotionExport } from "../MotionExportSettings";
import { useDisclosure } from "../useDisclosure";
import { ProgressSlider } from "../ProgressSlider";
import { revealDrawing } from "../revealDrawing";
import { play } from "../playback";
import { plotPalette } from "../palette";
import type { ThreeBodyEntry } from "./Context";
import {
  bodyInks,
  frameOf,
  shownState,
  ThreeBodyDrawing,
  type ThreeBodyDrawingProps,
} from "./Drawing";
import { threeBodyMovie, threeBodyStill } from "./export";
import {
  threeBodyConfigurations,
  threeBodyNames,
  type ThreeBodyName,
} from "./configurations";
import {
  defaultThreeBody,
  edited,
  endOf,
  massesTotalOne,
  massTotal,
  refusedField,
  studyBodies,
  studyDuration,
  switchConfiguration,
  terminalText,
  threeBodyHelp,
  threeBodyLimits,
  threeBodyPage,
  threeBodyRequest,
  type ThreeBodyBodies,
  type ThreeBodyBody,
  type ThreeBodyCase,
  type ThreeBodyFraming,
  type ThreeBodyPrepared,
  type ThreeBodyRequest,
  type ThreeBodyStudy,
  type Trail,
} from "./model";
import "../garden/garden.css";
import "./threebody.css";

// The corpus, read once from the engine for every study.
let corpusLoad: Promise<ThreeBodyCase[]> | undefined;
function loadCorpus() {
  if (!corpusLoad) {
    const client = new EngineClient();
    corpusLoad = client.threeBodyCorpus().finally(() => client.dispose());
    corpusLoad.catch(() => (corpusLoad = undefined));
  }
  return corpusLoad;
}

type Shown = {
  key: string;
  history: ThreeBodyPrepared;
  request: ThreeBodyRequest;
  prepare: number;
};
const bodyName = (i: number) => `Body ${i + 1}`;
const topics = {
  mass: (i: number) => `${bodyName(i)} mass`,
  position: (i: number, axis: "x" | "y") => `${bodyName(i)} position ${axis}`,
  velocity: (i: number, axis: "x" | "y") => `${bodyName(i)} velocity ${axis}`,
};
// An engine refusal's path as the field that shows it: a coordinate's own
// control, and the speed and a close start on the vector's x.
function topicOf(path: string) {
  const f = refusedField(path);
  if (!f) return undefined;
  if (f === "duration") return "Duration";
  const [kind, index, axis] = f.split("-");
  const i = Number(index);
  return kind === "mass"
    ? topics.mass(i)
    : kind === "position"
      ? topics.position(i, axis as "x" | "y")
      : topics.velocity(i, axis as "x" | "y");
}

// How published values become the study's units, when they differ: masses
// over their total, lengths over the farthest body's distance and times
// times √(M/λ³).
function rescaling(c: ThreeBodyCase) {
  const off = (v: number) => Math.abs(v - 1) > 1e-6;
  const parts = [
    ...(off(c.length) ? [`lengths by ${readout(c.length, 6)}`] : []),
    ...(off(c.timeFactor)
      ? [`times multiplied by ${readout(c.timeFactor, 6)}`]
      : []),
  ];
  return parts.length
    ? `Published masses are divided by their total, ${parts.join(" and ")}.`
    : "";
}

// A total near 1 keeps the digits that show how far it is from 1.
const totalText = (total: number) =>
  readout(total, Math.abs(total - 1) < 1e-5 ? 12 : 6);

export function ThreeBodyPreview({
  entry,
  onReturn,
}: {
  entry: ThreeBodyEntry;
  onReturn: (via: "keyboard" | "pointer") => void;
}) {
  const theme = useTheme(),
    dialog = useRef<HTMLDialogElement>(null),
    back = useRef<HTMLButtonElement>(null),
    quiet = useQuietFocus(dialog);
  const [study, setStudy] = useState<ThreeBodyStudy>(() =>
    structuredClone(entry.study.threeBody ?? defaultThreeBody),
  );
  const [corpus, setCorpus] = useState<ThreeBodyCase[]>();
  const [shown, setShown] = useState<Shown>();
  const [error, setError] = useState<{
    message: string;
    field?: string;
    key?: string;
  }>({ message: "" });
  const [scalars, setScalars] = useState<Record<string, ScalarState>>({});
  const [attempt, setAttempt] = useState(0);
  // The mass last changed, which a total other than 1 is refused under.
  const [lastMass, setLastMass] = useState(2);
  const scalarClient = useRef<EngineClient | null>(null),
    generation = useRef(0),
    jobs = useRef(new Set<Promise<void>>());
  const session = useRef<LatestSession<
    ThreeBodyRequest,
    { result: ThreeBodyPrepared; prepare: number }
  > | null>(null);
  // Where the motion stands, from 0 to 1 of the history's span, while it
  // plays, is paused or has been sought; absent, the opening moment.
  const [film, setFilm] = useState<{ progress: number }>();
  const [playing, setPlaying] = useState(false);
  const [finished, setFinished] = useState(false);
  const [exporting, setExporting] = useState(false),
    [exportProgress, setExportProgress] = useState(0);
  const stopClock = useRef<() => void>(() => {}),
    exportGeneration = useRef(0),
    movieGeneration = useRef(0),
    exportAbort = useRef<AbortController | null>(null);
  const exportState = useMotionExport();
  const exportSection = useDisclosure("threebody-export");
  const view = useRef<HTMLDivElement>(null),
    playback = useRef<HTMLDivElement>(null);

  const chosen = corpus?.find((c) => c.name === study.configuration);
  const request = chosen && threeBodyRequest(study, chosen);
  const key = request ? JSON.stringify(request) : "";
  const current = !!shown && shown.key === key;
  const history = shown?.history;
  const end = history ? endOf(history) : 0;
  const bodies = chosen && studyBodies(study, chosen);
  const masses = useMemo(
    () => (shown?.request.bodies ?? bodies ?? []).map((b) => b.mass),
    [shown, JSON.stringify(bodies?.map((b) => b.mass))],
  );

  // Every number the engine admits is checked there; the total mass is
  // checked here too, so the refusal can name the mass just changed.
  const massError =
    bodies &&
    bodies.every((b) => Number.isFinite(b.mass)) &&
    !massesTotalOne(bodies)
      ? {
          field: topics.mass(lastMass),
          message: `The masses must total 1; these total ${totalText(massTotal(bodies))}.`,
        }
      : undefined;
  const { speeds, windows } = threeBodyLimits;
  const speedError =
    !Number.isFinite(study.speed) ||
    study.speed < speeds[0] ||
    study.speed > speeds[1]
      ? `Speed must be ${speeds[0]}–${speeds[1]} time units per second.`
      : history && end / study.speed > 3600
        ? `At this speed the motion would last over an hour; it must be at least ${readout(end / 3600, 3)}.`
        : "";
  const windowError =
    study.trail === "window" &&
    (!Number.isFinite(study.window) ||
      study.window < windows[0] ||
      study.window > windows[1])
      ? `Trail length must be ${windows[0]}–${windows[1]} time units.`
      : "";
  const scalarError = Object.values(scalars).find((s) => s.error);
  const scalarPending = Object.values(scalars).some((s) => s.pending);
  const activeError =
    massError ??
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
    session.current = new LatestSession(
      () => new EngineClient(),
      async (client, q: ThreeBodyRequest) => client.threeBody(q),
    );
    scalarClient.current = new EngineClient();
    let live = true;
    loadCorpus().then(
      (cases) => live && setCorpus(cases),
      (e: Error) => live && setError({ message: e.message }),
    );
    return () => {
      live = false;
      exportGeneration.current++;
      movieGeneration.current++;
      exportAbort.current?.abort();
      stopClock.current();
      session.current?.cancel();
      scalarClient.current?.dispose();
      generation.current++;
    };
  }, [attempt]);
  useLayoutEffect(() => {
    if (entry.via === "pointer") quiet.onPointerDown();
    dialog.current!.showModal();
    quiet.quiet();
    back.current!.focus();
    document.documentElement.classList.add("garden-open");
    return () => document.documentElement.classList.remove("garden-open");
  }, []);
  // The history follows the initial state and duration. Typed edits wait
  // briefly, as the ordinary editor does; the session keeps only the newest
  // unsent request, and a reply for an older one never replaces it.
  useEffect(() => {
    if (!request || current || massError || scalarError || scalarPending)
      return;
    const q = request;
    const timer = setTimeout(
      () =>
        session.current!.update(
          q,
          (r) => {
            setShown({
              key,
              history: r.result,
              request: q,
              prepare: r.prepare,
            });
            setError({ message: "" });
          },
          (e) =>
            setError({
              message: e.message,
              field:
                e instanceof EngineError && e.field
                  ? (topicOf(e.field) ?? e.field)
                  : undefined,
              key,
            }),
        ),
      history ? 120 : 0,
    );
    return () => {
      clearTimeout(timer);
      session.current?.invalidate();
    };
  }, [key, !!massError, !!scalarError, scalarPending, attempt]);

  const pause = () => {
    stopClock.current();
    stopClock.current = () => {};
    setPlaying(false);
  };
  // Stop and any edit to the history end a motion and return to its start.
  const endFilm = () => {
    pause();
    setFilm(undefined);
    setFinished(false);
  };
  const canPlay = ready && !!history && !speedError && !exporting && end > 0;
  const start = () => {
    if (!canPlay || !history) return;
    const from =
      finished || (film?.progress ?? 0) >= 1 ? 0 : (film?.progress ?? 0);
    setFilm({ progress: from });
    setFinished(false);
    setPlaying(true);
    revealDrawing(view.current, playback.current);
    stopClock.current = play<number>({
      from,
      duration: (end / study.speed) * 1000,
      redraw: true,
      lanes: [(p) => Promise.resolve(p)],
      show: (p) => setFilm({ progress: p }),
      end: () => {
        stopClock.current = () => {};
        setPlaying(false);
        setFinished(true);
      },
      fail: () => endFilm(),
    });
  };
  const seek = (progress: number) => {
    if (!ready || !history || exporting) return;
    pause();
    setFinished(false);
    setFilm({ progress });
  };
  // The initial state, duration and configuration end a motion before they
  // change; speed pauses it; presentation keeps it.
  const edit = (change: (s: ThreeBodyStudy) => ThreeBodyStudy) => {
    endFilm();
    setStudy(change);
  };
  const present = (change: Partial<ThreeBodyStudy>) =>
    setStudy((s) => ({ ...s, ...change }));
  // A whole initial state replaces every field's value: evaluations begun
  // before it are dropped rather than applied to it.
  const replace = (change: (s: ThreeBodyStudy) => ThreeBodyStudy) => {
    generation.current++;
    setLastMass(2);
    edit(change);
  };
  // One value of one body, from the configuration's state the first time;
  // every other value stays as it was.
  const editBody = (i: number, change: (b: ThreeBodyBody) => ThreeBodyBody) =>
    edit((s) => {
      const c = corpus!.find((k) => k.name === s.configuration)!;
      const next = structuredClone(studyBodies(s, c)) as ThreeBodyBodies;
      next[i] = change(next[i]);
      return { ...s, bodies: next };
    });
  const manual = (camera: PlotCamera) =>
    setStudy((s) => ({ ...s, view: camera }));

  const time = (film?.progress ?? (finished ? 1 : 0)) * end;
  const frame = useMemo(
    () =>
      history && frameOf(history, masses, study.framing as ThreeBodyFraming),
    [history, study.framing],
  );
  const drawing = (): ThreeBodyDrawingProps | undefined =>
    history &&
    frame && {
      history,
      masses,
      frame,
      time,
      trail: study.trail,
      window: study.window,
      ghost: study.ghost,
      triangle: study.triangle,
      camera: study.view,
      dark: theme.dark,
      scheme: theme.scheme,
      weight: study.weight,
    };
  const record = () => {
    const q = shown!.request;
    const h = shown!.history;
    return {
      kind: "three-bodies",
      model:
        "planar Newtonian point masses, G = 1: r̈ᵢ = Σⱼ≠ᵢ mⱼ (rⱼ − rᵢ)/|rⱼ − rᵢ|³",
      units:
        "G = 1, total mass 1; the configurations put the body farthest from the center of mass at distance 1; time unit √(L³/GM)",
      configuration: study.configuration,
      source: chosen?.source,
      edited: edited(study),
      bodies: q.bodies,
      duration: q.duration,
      method: {
        integrator: "Dormand–Prince 5(4)",
        tolerance: h.diagnostics.tolerance,
        floor: h.diagnostics.floor,
        attempts: threeBodyLimits.attempts,
        rejections: threeBodyLimits.rejections,
        drift: threeBodyLimits.drift,
      },
      samples: {
        count: q.samples,
        available: h.available,
        end: h.times.at(-1),
      },
      terminal: h.terminal,
      final: h.final,
      quality: {
        accepted: h.accepted,
        rejected: h.rejected,
        energyError: h.diagnostics.energyError,
        momentumError: h.diagnostics.momentumError,
        angularError: h.diagnostics.angularError,
        centerError: h.diagnostics.centerError,
        closest: h.diagnostics.closest,
        closestTime: h.diagnostics.closestTime,
        stepError: h.diagnostics.stepError,
      },
      bodyInks: ["base", "derived", "third"],
      // Page coordinates of a point (x, y) at zoom 1 before the pan:
      // (500 + (x − cx)·k, 380 − (y − cy)·k).
      frame,
      trail: study.trail === "whole" ? "whole" : { window: study.window },
      ghost: study.ghost,
      triangle: study.triangle,
      framing: study.framing,
      view: study.view,
      theme: theme.dark ? "dark" : "light",
      scheme: theme.scheme,
      weight: study.weight,
    };
  };
  const motionRecord = () => ({
    speed: study.speed,
    duration: end / study.speed,
    repeat: "once",
    time: "physical t = p · end, end the history's last time",
  });
  async function still(format: string, settings: Still) {
    const props = drawing();
    if (!ready || !props) return;
    const id = ++exportGeneration.current;
    try {
      await threeBodyStill(
        format as "svg" | "png",
        props,
        { ...record(), time: props.time, shown: shownState(history!, time) },
        () => id === exportGeneration.current,
        settings,
      );
    } catch (e) {
      if (id === exportGeneration.current)
        setError({ message: (e as Error).message, key });
    }
  }
  // The movie freezes the history, view and appearance when it starts;
  // only Cancel or Return discards it.
  async function movie() {
    const props = drawing();
    if (!canPlay || !props) return;
    pause();
    setExporting(true);
    setExportProgress(0);
    const id = ++movieGeneration.current;
    const controller = new AbortController();
    exportAbort.current = controller;
    try {
      await threeBodyMovie({
        drawing: props,
        metadata: { ...record(), motion: motionRecord() },
        duration: end / study.speed,
        end,
        options: {
          format: exportState.chosen,
          fps: exportState.fps,
          settings: { scale: exportState.scale, quality: exportState.quality },
          loop: false,
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
    time,
    study.trail,
    study.window,
    study.ghost,
    study.triangle,
    study.framing,
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
    : (activeError?.message ?? (speedError || windowError));
  const title =
    scalarError?.name ??
    (activeError
      ? activeError.field
      : speedError
        ? "Speed"
        : windowError
          ? "Trail length"
          : undefined);
  const [claimed, setClaimed] = useState(false);
  const claim = useCallback((_key: string, on: boolean) => setClaimed(on), []);
  const target = useMemo(
    () => ({ label: title, message, claim, touch: () => {} }),
    [title, message, claim],
  );
  const props = drawing();
  const palette = plotPalette(theme.dark, theme.scheme);
  const inks = bodyInks(palette);
  const progress = film?.progress ?? (finished ? 1 : 0);
  const t = history?.terminal;
  const d = history?.diagnostics;
  const description = threeBodyConfigurations[study.configuration];
  const changed =
    !!chosen &&
    ((study.bodies !== undefined &&
      JSON.stringify(study.bodies) !== JSON.stringify(chosen.bodies)) ||
      (study.duration !== undefined && study.duration !== chosen.duration));

  const scalar = (
    topic: string,
    label: string,
    value: number,
    onChange: (v: number) => void,
    help: (typeof threeBodyHelp)[keyof typeof threeBodyHelp],
  ) => (
    <Field label={label} topic={topic} help={help}>
      <ScalarInput name={topic} value={value} onChange={onChange} />
    </Field>
  );
  const select = <T extends string>(
    label: string,
    value: T,
    options: [T, string][],
    onChange: (v: T) => void,
    help: (typeof threeBodyHelp)[keyof typeof threeBodyHelp],
  ) => (
    <Field label={label} help={help}>
      <select
        value={value}
        onChange={(e) => onChange(e.currentTarget.value as T)}
      >
        {options.map(([o, text]) => (
          <option key={o} value={o}>
            {text}
          </option>
        ))}
      </select>
    </Field>
  );
  const vector = (
    i: number,
    b: ThreeBodyBody,
    kind: "position" | "velocity",
  ) => (
    <div className="pair">
      {(["x", "y"] as const).map((axis) =>
        scalar(
          topics[kind](i, axis),
          `${kind === "position" ? "Position" : "Velocity"} ${axis}`,
          b[kind][axis],
          (v) =>
            editBody(i, (x) => ({ ...x, [kind]: { ...x[kind], [axis]: v } })),
          threeBodyHelp[kind],
        ),
      )}
    </div>
  );
  const bodyEditor = (b: ThreeBodyBody, i: number) => (
    <fieldset key={i} className="threebody-body" data-body={i + 1}>
      <legend>
        <span className="threebody-swatch" style={{ background: inks[i] }} />
        {bodyName(i)}
      </legend>
      {scalar(
        topics.mass(i),
        "Mass",
        b.mass,
        (mass) => {
          setLastMass(i);
          editBody(i, (x) => ({ ...x, mass }));
        },
        threeBodyHelp.mass,
      )}
      {vector(i, b, "position")}
      {vector(i, b, "velocity")}
    </fieldset>
  );
  const artwork = (
    <div ref={view} className="garden-view">
      {props ? (
        <ThreeBodyDrawing {...props} busy={!ready} onCamera={manual} />
      ) : (
        <p className="garden-placeholder" role="status">
          {message || "Integrating the history…"}
        </p>
      )}
    </div>
  );
  const playbackControls = (
    <div
      ref={playback}
      id="threebody-playback"
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
            : film && film.progress < 1 && !finished
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
          help={threeBodyHelp.progress}
          helpBeforeControl
        >
          <ProgressSlider
            progress={progress}
            disabled={!ready || exporting}
            onSeek={seek}
          />
        </Field>
        <p
          className="note garden-reveal-status threebody-clock"
          aria-live="off"
        >
          {history ? (
            <>
              {speedError
                ? "—"
                : elapsed((progress * end) / study.speed, end / study.speed)}
              {` · t = ${liveReadout(time, [0, end || 1])} of ${readout(end, 6)}`}
              {film && !playing && !finished && film.progress < 1
                ? " · Paused"
                : ""}
            </>
          ) : (
            "—"
          )}
        </p>
      </div>
    </div>
  );
  return (
    <dialog
      ref={dialog}
      className="garden threebody"
      aria-labelledby="threebody-title"
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
          // One mode per link: another overlay there would open instead.
          study={() => {
            const { garden: _, lace: __, shorten: ___, ...base } = entry.study;
            return { ...base, threeBody: study };
          }}
          disabled={!valid || !current}
        />
        <ExportImageMenu
          kind="three-bodies"
          revision={drawn}
          disabled={!ready || playing || exporting}
          base={threeBodyPage}
          onSave={still}
        />
      </AppHeader>
      <div className="garden-content">
        <div className="garden-heading">
          <p className="eyebrow">Newtonian gravity · G = 1, total mass 1</p>
          <h2 id="threebody-title">Three bodies</h2>
          <p>
            Three point masses pull on one another. Their history is integrated
            once; playback, the slider and every export choose among its samples
            by physical time.
          </p>
        </div>
        <ScalarStatus.Provider value={scalarStatus}>
          <FieldErrorContext.Provider value={target}>
            <div className="garden-layout">
              <main>
                {artwork}
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
                <ul className="threebody-legend">
                  {masses.map((m, i) => (
                    <li key={i} data-body={i + 1}>
                      <span
                        className="threebody-swatch"
                        style={{ background: inks[i] }}
                      />
                      {bodyName(i)} · mass {readout(m, 4)}
                    </li>
                  ))}
                </ul>
                {history && t && d && (
                  <div className="threebody-about">
                    <h3>This history</h3>
                    <p role="status" className="threebody-status">
                      The integration {terminalText[t.reason]} at t ={" "}
                      {readout(t.time, 6)}
                      {t.reason === "encounter"
                        ? `: bodies ${t.pair[0]} and ${t.pair[1]} came within ${readout(t.separation, 3)}`
                        : ""}
                      {t.reason !== "end"
                        ? `, before the ${readout(shown!.request.duration, 6)} asked for`
                        : ""}
                      .
                    </p>
                    <dl className="threebody-facts">
                      <dt>Steps</dt>
                      <dd>
                        {formatCount(history.accepted)} accepted,{" "}
                        {formatCount(history.rejected)} rejected
                      </dd>
                      <dt>Samples</dt>
                      <dd>
                        {formatCount(history.available)} of{" "}
                        {formatCount(history.times.length)}
                      </dd>
                      <dt>Energy error</dt>
                      <dd>{readout(d.energyError, 2)}, relative</dd>
                      <dt>Momentum change</dt>
                      <dd>{readout(d.momentumError, 2)}</dd>
                      <dt>Angular momentum change</dt>
                      <dd>{readout(d.angularError, 2)}, relative</dd>
                      <dt>Center of mass off its line</dt>
                      <dd>{readout(d.centerError, 2)}</dd>
                      <dt>Closest approach</dt>
                      <dd>
                        {readout(d.closest, 3)} at t ={" "}
                        {readout(d.closestTime, 4)}
                      </dd>
                      <dt>Largest step error</dt>
                      <dd>
                        {readout(d.stepError, 2)} of the tolerance{" "}
                        {readout(d.tolerance)}
                      </dd>
                      <dt>Prepared</dt>
                      <dd>
                        {readout(shown!.prepare, 3)} ms in the worker;{" "}
                        {mebibytes(d.retainedBytes)} retained
                      </dd>
                    </dl>
                  </div>
                )}
              </main>
              <aside>
                <h3 className="garden-section threebody-first">
                  Configuration
                </h3>
                {corpus && chosen && bodies ? (
                  <>
                    {select<ThreeBodyName>(
                      "Configuration",
                      study.configuration,
                      threeBodyNames.map((n) => [
                        n,
                        corpus.find((c) => c.name === n)?.title ?? n,
                      ]),
                      (name) => replace((s) => switchConfiguration(s, name)),
                      threeBodyHelp.configuration,
                    )}
                    {changed && (
                      <p className="note threebody-edited">
                        Edited from {chosen.title}.{" "}
                        <button
                          type="button"
                          className="text-button"
                          onClick={() =>
                            replace(({ bodies: _, duration: __, ...s }) => s)
                          }
                        >
                          Restore {chosen.title}
                        </button>
                      </p>
                    )}
                    <p className="threebody-explanation">
                      {description.explanation}
                    </p>
                  </>
                ) : (
                  <p className="note">Reading the configurations…</p>
                )}
                <h3 className="garden-section">Motion</h3>
                {playbackControls}
                <fieldset disabled={exporting} className="garden-reveal">
                  <Field label="Speed" help={threeBodyHelp.speed}>
                    <input
                      type="number"
                      min={speeds[0]}
                      max={speeds[1]}
                      step="any"
                      value={Number.isNaN(study.speed) ? "" : study.speed}
                      onChange={(e) => {
                        pause();
                        present({ speed: e.currentTarget.valueAsNumber });
                      }}
                    />
                  </Field>
                  <MotionExportSettings
                    state={exportState}
                    id="threebody-export-settings"
                    cyclic={false}
                    disclosure={exportSection}
                  />
                </fieldset>
                <button
                  className="animation-export"
                  disabled={
                    !canPlay ||
                    exportState.formats?.[exportState.chosen] !== "yes" ||
                    Math.ceil((end / study.speed) * exportState.fps) > 7200
                  }
                  onClick={() => void movie()}
                >
                  Export {exportState.text.name} ↗
                </button>
                {exporting && (
                  <p role="status" aria-live="off">
                    Exporting {exportState.text.short}…{" "}
                    {progressPercent(exportProgress)}
                  </p>
                )}
                <h3 className="garden-section">Trails and frame</h3>
                <div className="pair">
                  {select<Trail>(
                    "Trail",
                    study.trail,
                    [
                      ["whole", "Whole so far"],
                      ["window", "Moving window"],
                    ],
                    (trail) => present({ trail }),
                    threeBodyHelp.trail,
                  )}
                  <Field label="Trail length" help={threeBodyHelp.window}>
                    <input
                      type="number"
                      min={windows[0]}
                      max={windows[1]}
                      step="any"
                      disabled={study.trail !== "window"}
                      value={Number.isNaN(study.window) ? "" : study.window}
                      onChange={(e) =>
                        present({ window: e.currentTarget.valueAsNumber })
                      }
                    />
                  </Field>
                </div>
                {select<ThreeBodyFraming>(
                  "Frame",
                  study.framing,
                  [
                    ["whole", "The whole history"],
                    ["close", "The close dance"],
                  ],
                  (framing) =>
                    present({ framing, view: { x: 0, y: 0, zoom: 1 } }),
                  threeBodyHelp.framing,
                )}
                <label className="check">
                  <input
                    type="checkbox"
                    checked={study.ghost}
                    onChange={(e) =>
                      present({ ghost: e.currentTarget.checked })
                    }
                  />
                  The whole path, faintly
                </label>
                <label className="check">
                  <input
                    type="checkbox"
                    checked={study.triangle}
                    onChange={(e) =>
                      present({ triangle: e.currentTarget.checked })
                    }
                  />
                  Connecting triangle
                </label>
                {corpus && chosen && bodies && (
                  <>
                    <h3 className="garden-section">Initial state</h3>
                    <p className="note threebody-units">
                      {threeBodyHelp.units.brief}
                    </p>
                    {bodies.map(bodyEditor)}
                    {scalar(
                      "Duration",
                      "Duration",
                      studyDuration(study, chosen),
                      (duration) => edit((s) => ({ ...s, duration })),
                      threeBodyHelp.duration,
                    )}
                  </>
                )}
                <h3 className="garden-section">About this configuration</h3>
                {corpus && chosen && bodies && (
                  <>
                    <div className="threebody-about">
                      {changed && (
                        <p className="note">
                          These statements are about {chosen.title} as
                          published, not about your edited state.
                        </p>
                      )}
                      <p>
                        <strong>Periodicity.</strong> {chosen.periodicity}.
                      </p>
                      <p>
                        <strong>Stability.</strong> {chosen.stability}.
                      </p>
                      <p>
                        <strong>Numerical evidence.</strong> {chosen.observed}.
                      </p>
                      {chosen.period > 0 && (
                        <p>Period {readout(chosen.period, 9)} time units.</p>
                      )}
                      <p className="note">
                        {chosen.source}. {rescaling(chosen)}
                      </p>
                    </div>
                  </>
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
