import { useEffect, useRef, useState, type RefObject } from "react";
import { FrameRateField } from "./FrameRateField";
import { ProgressSlider } from "./ProgressSlider";
import type { PlanarAnimation } from "./planar-link";
import {
  EngineClient,
  exportEngineCount,
  playbackEngineCount,
} from "./engine-client";
import { play } from "./playback";
import type { LineWeight } from "./line-weight";
import {
  curveProbeMotionHelp,
  curveProbeMotions,
  heldCurveSample,
  probeIndex,
  type ProbeMotion,
} from "./probe";
import { probeReadout, type PlanarProbe } from "./planar-probe";
import {
  applyTracks,
  availableTargets,
  canTrace,
  integerTargets,
  loops,
  repeatHelp,
  reveal,
  revealConfig,
  targetLabel,
  targetValue,
  type AnimationMode,
  type AnimationView,
  type CameraMode,
  type NumericTrack,
  type Target,
  type Track,
  type Viewport,
} from "./animation";
import { studyName, type Frame } from "./types";
import { fitFrame, viewRect, type Layers } from "./Plot";
import { trace, traceTimeline, type Timeline } from "./raytrace";
import { defaultScale, exportEncoding, exportTiming } from "./export-quality";
import {
  cycles,
  paceChoices,
  paceHelp,
  progressAt,
  repeatChoices,
  type Pace,
  type Repeat,
} from "./timing";
import {
  defaultQuality,
  detectFormats,
  formatText,
  type ExportFormat,
  type Formats,
} from "./export-formats";
import { saveFile } from "./export-image";
import { Field } from "./Field";
import { useDisclosure } from "./useDisclosure";

type Status =
  "idle" | "preparing" | "playing" | "paused" | "complete" | "exporting";
type Session = {
  original: Frame;
  first: Frame;
  final: Frame;
  tracks: NumericTrack[];
  mode: AnimationMode;
  // Present only while tracing rays.
  timeline?: Timeline;
  camera: CameraMode;
  heldView?: Viewport;
  duration: number;
  repeat: Repeat;
  pace: Pace;
  length: number;
  // Where the timeline stands (timing.ts), from which the progress follows.
  progress: number;
  // The probe, when the animation moves it or holds it while the
  // parameters vary, and how it moves then.
  probe?: PlanarProbe;
  motion?: ProbeMotion;
};
// Whether the session's frames between its ends are calculated by an engine:
// parameter tracks other than the ray length, and an iterated map's reveal.
// Every other frame is cut from the prepared study.
const calculates = (s: Pick<Session, "mode" | "tracks" | "original">) =>
  (s.mode === "parameters" &&
    !s.tracks.every((t) => t.target === "rayLength")) ||
  (s.mode === "reveal" && !!s.original.result.attractor);
type Props = {
  frame: Frame | null;
  client: RefObject<EngineClient | null>;
  length: number;
  revision: string;
  disabled: boolean;
  dark: boolean;
  layers: Layers;
  weight: LineWeight;
  // The probe, when it is on (planar-probe.ts).
  probe: PlanarProbe | null;
  getCurrentView: () => Viewport | undefined;
  onView: (view: AnimationView | null) => void;
  onRunning: (running: boolean) => void;
  // Called when playback starts or resumes, so the drawing can be shown.
  onPlay: () => void;
  // The animation setup, kept current for a study link.
  settings?: { current: PlanarAnimation | null };
  // A setup from a study link, applied once per id. The notebook passes it
  // only once the frame belongs to the linked study, so neither its tracks
  // nor a trace mode is judged against the previous study.
  restore?: { id: number; settings: PlanarAnimation } | null;
};

export function AnimationPanel({
  frame,
  client,
  length,
  revision,
  disabled,
  dark,
  layers,
  weight,
  probe,
  getCurrentView,
  onView,
  onRunning,
  onPlay,
  settings,
  restore,
}: Props) {
  const [mode, setMode] = useState<AnimationMode>("reveal");
  const [camera, setCamera] = useState<CameraMode>("hold");
  const [duration, setDuration] = useState(10);
  const [repeat, setRepeat] = useState<Repeat>("once");
  const [pace, setPace] = useState<Pace>("steady");
  const [tracks, setTracks] = useState<Track[]>([]);
  const [probeMotion, setProbeMotion] = useState<ProbeMotion>("stays");
  const [status, setStatus] = useState<Status>("idle");
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState("");
  const [live, setLive] = useState("");
  const section = useDisclosure("animation", true);
  const exportSection = useDisclosure("export");
  const [fps, setFPS] = useState(30);
  const [loop, setLoop] = useState(false);
  const [exportScale, setExportScale] = useState(defaultScale);
  // Each format keeps its own quality, starting from its default.
  const [qualities, setQualities] = useState(defaultQuality);
  const [exportNotice, setExportNotice] = useState("");
  const [format, setFormat] = useState<ExportFormat>("mp4");
  const [formats, setFormats] = useState<Formats | null>(null);
  // Offer only what this browser can encode. Safari and every iOS browser
  // cannot encode canvas WebP; some encoders refuse large H.264 frames.
  useEffect(() => {
    let current = true;
    const settings = { scale: exportScale, quality: qualities.mp4 };
    void detectFormats(settings, fps).then((found) => {
      if (current) setFormats(found);
    });
    return () => {
      current = false;
    };
  }, [exportScale, qualities.mp4, fps]);
  // MP4 is far smaller at comparable quality, so it leads when available.
  const offered = (["mp4", "webp"] satisfies ExportFormat[]).filter(
    (f) => formats && formats[f] !== "no",
  );
  const chosen = offered.includes(format) ? format : (offered[0] ?? format);
  const text = formatText[chosen];
  const quality = qualities[chosen];
  const setQuality = (value: number) =>
    setQualities((q) => ({ ...q, [chosen]: value }));
  const exportSize = exportEncoding({ scale: exportScale, quality });
  const defaultSize = exportEncoding({ scale: defaultScale, quality });
  const exportReady = formats?.[chosen] === "yes";
  const exportHint = !formats
    ? ""
    : offered.length === 0
      ? "This browser can't save animations. You can still save single frames as SVG."
      : formats[chosen] === "size"
        ? `This browser can't save ${text.name} at ${exportSize.width} × ${exportSize.height}. Choose a lower export resolution${offered.length > 1 ? " or another format" : ""}.`
        : "";
  const exportAbort = useRef<AbortController | null>(null);
  const seekTarget = useRef<number | null>(null),
    scrubbing = useRef(-1);
  const epoch = useRef(0),
    playing = useRef<(() => void) | null>(null),
    session = useRef<Session | null>(null);
  // A second engine for parameter playback, alive only while it plays.
  const helper = useRef<EngineClient | null>(null);
  const release = () => {
    helper.current?.dispose();
    helper.current = null;
  };
  const targets = frame ? availableTargets(frame.config) : [];
  const iterated = frame?.config.curve.format === "attractor";
  const traceable = !!frame && canTrace(frame.config);
  // Light is traced only in an optical study; another falls back to drawing.
  useEffect(() => {
    if (!traceable && mode === "trace") setMode("reveal");
  }, [traceable, mode]);
  // The probe moves only while it is on; otherwise the curve is drawn.
  useEffect(() => {
    if (!probe && mode === "probe") setMode("reveal");
  }, [!probe, mode]);
  // Only parameter tracks can return to their start; others keep
  // repeating, back and forth.
  useEffect(() => {
    if (!loops(mode) && repeat === "loop") setRepeat("back-and-forth");
  }, [mode, repeat]);
  useEffect(() => {
    setTracks((previous) => {
      const retained = previous.filter((track) =>
        targets.includes(track.target),
      );
      if (retained.length === previous.length) return previous;
      return retained.length
        ? retained
        : targets.length
          ? [defaultTrack(targets[0])]
          : [];
    });
  }, [targets.join(",")]);
  if (settings)
    settings.current = {
      mode,
      camera,
      duration,
      tracks,
      repeat,
      pace,
      probeMotion,
    };
  // After the retention and trace fallbacks above, which then see the
  // linked study's own frame.
  const restored = useRef<number | null>(null);
  useEffect(() => {
    if (!restore || restore.id === restored.current) return;
    restored.current = restore.id;
    setMode(restore.settings.mode);
    setCamera(restore.settings.camera);
    setDuration(restore.settings.duration);
    setTracks(restore.settings.tracks);
    setRepeat(restore.settings.repeat);
    setPace(restore.settings.pace);
    setProbeMotion(restore.settings.probeMotion);
    // A refusal belongs to the setup it judged.
    setError("");
  }, [restore]);
  const running =
    status === "playing" || status === "preparing" || status === "exporting";
  const active = status !== "idle";
  const changeStatus = (next: Status) => {
    setStatus(next);
    onRunning(
      next === "playing" || next === "preparing" || next === "exporting",
    );
  };
  const cancel = (keepHelper = false) => {
    epoch.current++;
    seekTarget.current = null;
    playing.current?.();
    playing.current = null;
    if (!keepHelper) release();
    exportAbort.current?.abort();
    exportAbort.current = null;
  };
  const stop = () => {
    cancel();
    session.current = null;
    onView(null);
    changeStatus("idle");
    setProgress(0);
    setLive("");
    setError("");
    setExportNotice("");
  };
  useEffect(() => {
    stop();
  }, [revision]);
  useEffect(
    () => () => {
      epoch.current++;
      playing.current?.();
      release();
      exportAbort.current?.abort();
    },
    [],
  );
  // Don't count time in a background tab. Resume is explicit when returning.
  useEffect(() => {
    const hidden = () => {
      if (document.hidden && status === "playing") pause();
    };
    document.addEventListener("visibilitychange", hidden);
    return () => document.removeEventListener("visibilitychange", hidden);
  }, [status]);

  function defaultTrack(target: Target): Track {
    const from = frame ? targetValue(frame.config, target, length) : 0;
    const to =
      target === "sourceX" && from === 1
        ? 0.75
        : target === "sourceTheta"
          ? from + Math.PI / 2
          : target.endsWith("Phase")
            ? from + 2 * Math.PI
            : // Shrinking keeps a circle rolling inside smaller than R.
              target === "rollRadius" || target === "rollingRadius"
              ? from / 2
              : target === "angle"
                ? from + 360
                : target === "samples"
                  ? Math.min(32768, Math.max(64, from * 2))
                  : target === "lines"
                    ? Math.min(2048, frame?.config.samples ?? 2048, from + 20)
                    : target === "stackCount"
                      ? Math.min(64, from + 6)
                      : target === "rayLength"
                        ? from * 1.5
                        : target === "nIncident" || target === "nTransmitted"
                          ? 1.5
                          : target === "pursuitCapture"
                            ? from * 20
                            : from + 1;
    return { target, from: String(from), to: String(to) };
  }
  function parameterMode(next: AnimationMode) {
    setMode(next);
    // Traced light enters a fixed view; a moving camera would chase it.
    if (next === "trace" && (camera === "follow" || camera === "fit"))
      setCamera("hold");
    if (next === "parameters" && !tracks.length && targets.length)
      setTracks([defaultTrack(targets[0])]);
  }
  // The frame at a time on the timeline, drawn at the progress the repeat
  // and pace give it (timing.ts).
  async function sample(
    s: Session,
    time: number,
    engine = client.current!,
  ): Promise<AnimationView> {
    return {
      ...(await frameAt(s, progressAt(time, s.repeat, s.pace), engine)),
      time,
      complete: s.repeat === "once" && time === 1,
    };
  }
  async function frameAt(
    s: Session,
    p: number,
    engine = client.current!,
  ): Promise<AnimationView> {
    const values = applyTracks(s.original.config, s.tracks, p, s.length);
    let current: Frame;
    const attractor = s.original.result.attractor;
    // An iterated map's density cannot be cut back, so each revealed frame
    // counts a prefix of the iterates afresh, live and exported alike.
    if (s.mode === "reveal" && attractor)
      current =
        p === 1
          ? s.original
          : {
              config: s.original.config,
              result: (
                await engine.compute(
                  revealConfig(s.original.config, attractor, p),
                )
              ).result,
            };
    else if (s.mode === "reveal")
      current = {
        config: s.original.config,
        result: reveal(s.original.result, p),
      };
    else if (s.mode === "trace")
      current = {
        config: s.original.config,
        result: trace(s.original.result, s.timeline!, p),
      };
    else if (s.mode === "probe") current = s.original;
    else if (p === 0) current = s.first;
    else if (p === 1) current = s.final;
    else if (s.tracks.every((t) => t.target === "rayLength"))
      current = s.original;
    else
      current = await engine.compute(values.config, undefined, {
        diagnostics: !!s.probe,
      });
    // The probe moves along the fixed study one sample at a time, from the
    // first sample at the start to the last at the end, exactly; while the
    // parameters vary it stands on each frame's own diagnostics, or is
    // absent from it with a reason.
    const held =
      s.mode === "probe"
        ? probeIndex(p, s.original.result.diagnostics!.curvature.length - 1)
        : s.mode === "parameters" && s.probe
          ? current.result.diagnostics
            ? heldCurveSample(
                s.original.result.diagnostics!,
                s.probe.position,
                s.motion!,
                current.result.diagnostics,
                p,
              )
            : "This frame has no curve for the probe to describe."
          : null;
    return {
      frame: current,
      final: s.final,
      camera: s.camera,
      heldView: s.heldView,
      length: s.mode === "parameters" ? values.length : s.length,
      progress: p,
      mode: s.mode,
      complete: p === 1,
      ...(typeof held === "number" && { probe: held }),
      ...(typeof held === "string" && { probeAway: held }),
    };
  }
  function display(s: Session, view: AnimationView) {
    s.progress = view.time ?? view.progress;
    setProgress(s.progress);
    onView(view);
    if (s.mode === "reveal" && view.frame.result.attractor)
      setLive(
        `Accumulated iterates = ${view.frame.result.attractor.accumulated.toLocaleString("en-US")}`,
      );
    else if (s.mode === "trace")
      setLive(
        `Optical path τ = ${(view.progress * s.timeline!.total).toPrecision(4)} · ${view.frame.result.derived.filter((q) => q).length.toLocaleString("en-US")} caustic points reached`,
      );
    else if (s.mode === "reveal")
      setLive(
        `t = ${(s.original.config.curve.min + (s.original.config.curve.max - s.original.config.curve.min) * view.progress).toPrecision(6)}`,
      );
    else if (s.mode === "probe") setLive(probeWhere(view));
    else
      setLive(
        [
          ...s.tracks.map(
            (t) =>
              `${targetLabel(t.target)} = ${targetValue(view.frame.config, t.target, view.length).toPrecision(6)}`,
          ),
          // A probe that moves as the parameters vary says where it stands.
          ...(s.probe && s.motion !== "stays" && view.probe !== undefined
            ? [probeWhere(view)]
            : []),
        ].join(" · "),
      );
  }
  // Where the probe stands in a frame, by its parameter.
  function probeWhere(view: AnimationView) {
    const r = probeReadout(view.frame.result, view.probe!);
    return r ? `Probe at t = ${Number(r.t.toPrecision(6))}` : "";
  }
  function fail(reason: unknown, what = "Animation") {
    cancel();
    session.current = null;
    onView(null);
    changeStatus("idle");
    setError(
      `${what} stopped: ${reason instanceof Error ? reason.message : String(reason)}`,
    );
  }
  function schedule(s: Session, from: number) {
    cancel(true);
    const token = epoch.current;
    changeStatus("playing");
    // Parameter frames are calculated; while one engine calculates, a helper
    // can calculate the next. Other modes draw from the prepared study.
    const computes = calculates(s);
    if (computes && !helper.current && playbackEngineCount() > 1)
      helper.current = new EngineClient();
    const engines =
      computes && helper.current
        ? [client.current!, helper.current]
        : [client.current!];
    // Each engine holds at most one calculation. Slow devices skip
    // intermediate times instead of queuing work or lengthening a 30-second
    // animation.
    playing.current = play({
      from,
      duration: s.duration * 1000,
      repeat: cycles(s.repeat),
      lanes: engines.map((engine) => (time: number) => sample(s, time, engine)),
      show: (view) => {
        if (epoch.current === token) display(s, view);
      },
      end: () => {
        if (epoch.current !== token) return;
        playing.current = null;
        release();
        changeStatus("complete");
      },
      fail: (error) => {
        if (epoch.current === token) fail(error);
      },
    });
  }
  async function start(save = false) {
    if (!frame || !client.current) return;
    if (!save) onPlay();
    cancel();
    const token = epoch.current;
    setError("");
    setExportNotice("");
    changeStatus("preparing");
    const heldView = camera === "current" ? getCurrentView() : undefined;
    try {
      if (!Number.isFinite(duration) || duration < 0.1 || duration > 3600)
        throw new Error("Duration must be between 0.1 and 3600 seconds.");
      if (camera === "current" && !heldView)
        throw new Error("The current view is not ready yet.");
      if (save) exportTiming(duration, fps);
      // The probe moves along the curve, or is held while the parameters
      // vary, on the diagnostics of the study as it begins.
      const drawsProbe = !!probe && (mode === "probe" || mode === "parameters");
      if (drawsProbe && !frame.result.diagnostics)
        throw new Error("The probe is still finding the curvature.");
      let numeric: NumericTrack[] = [];
      if (mode === "parameters") {
        if (!tracks.length)
          throw new Error("Add at least one parameter track.");
        if (
          tracks.some((t) => !targets.includes(t.target)) ||
          new Set(tracks.map((t) => t.target)).size !== tracks.length
        )
          throw new Error(
            "Choose distinct parameters available in this study.",
          );
        const values = await client.current.scalars(
          tracks.flatMap((t) => [t.from, t.to]),
        );
        numeric = tracks.map((t, i) => ({
          target: t.target,
          from: values[2 * i],
          to: values[2 * i + 1],
        }));
        for (const t of numeric) {
          if (
            integerTargets.includes(t.target) &&
            (!Number.isInteger(t.from) || !Number.isInteger(t.to))
          )
            throw new Error(
              "Sample, line, and offset count endpoints must be whole numbers.",
            );
          if (
            t.target === "rayLength" &&
            (Math.min(t.from, t.to) < 0.01 || Math.max(t.from, t.to) > 100)
          )
            throw new Error("Ray lengths must be 0.01–100.");
        }
      }
      if (epoch.current !== token) return;
      let first = frame,
        final = frame;
      if (mode === "parameters") {
        // Playback's helper engine prepares the end while the app's engine
        // prepares the start.
        if (
          !save &&
          calculates({ mode, tracks: numeric, original: frame }) &&
          playbackEngineCount() > 1
        )
          helper.current = new EngineClient();
        const results = await Promise.all([
          client.current
            .compute(
              applyTracks(frame.config, numeric, 0, length).config,
              undefined,
              { diagnostics: drawsProbe },
            )
            .catch((reason) => {
              throw new Error(`At animation start: ${reason.message}`);
            }),
          (helper.current ?? client.current)
            .compute(
              applyTracks(frame.config, numeric, 1, length).config,
              undefined,
              { diagnostics: drawsProbe },
            )
            .catch((reason) => {
              throw new Error(`At animation end: ${reason.message}`);
            }),
        ]);
        [first, final] = results;
      }
      if (epoch.current !== token) return;
      // Light enters the view the animation holds, and each ray is drawn as
      // far as the study draws it.
      const fitted = fitFrame(frame.result, frame.config);
      const timeline =
        mode === "trace"
          ? traceTimeline(
              frame.result,
              frame.config,
              viewRect(heldView ?? fitted),
              fitted.span * length,
            )
          : undefined;
      const s: Session = {
        original: frame,
        first,
        final,
        tracks: numeric,
        mode,
        timeline,
        camera,
        heldView,
        duration,
        repeat,
        pace,
        length,
        progress: 0,
        probe: drawsProbe ? probe! : undefined,
        motion: probeMotion,
      };
      // A loop joins the end to the start, so they must be the same drawing.
      if (repeat === "loop") {
        const { planarLoopGap } = await import("./planar-loop");
        if (epoch.current !== token) return;
        const gap = await planarLoopGap(
          await frameAt(s, 0),
          await frameAt(s, 1),
          layers,
          weight,
        );
        if (gap) throw new Error(gap);
      }
      if (epoch.current !== token) return;
      session.current = s;
      if (save) {
        const controller = new AbortController();
        exportAbort.current = controller;
        changeStatus("exporting");
        setProgress(0);
        onView(null);
        const { exportAnimation } = await import("./export-animation");
        if (epoch.current !== token) return;
        // Parameter frames each need a calculation. Temporary engines compute
        // them in parallel for this export only; frames are still drawn in order.
        const extras = Array.from(
          { length: calculates(s) ? exportEngineCount() - 1 : 0 },
          () => new EngineClient(),
        );
        const release = () => extras.forEach((engine) => engine.dispose());
        controller.signal.addEventListener("abort", release);
        const engines = [client.current, ...extras];
        let next = 0;
        const blob = await exportAnimation({
          format: chosen,
          duration,
          fps: fps,
          loop: chosen === "webp" && (loop || cycles(repeat)),
          cyclic: cycles(repeat),
          settings: { scale: exportScale, quality },
          dark,
          layers: { ...layers },
          weight,
          signal: controller.signal,
          lookahead: engines.length + 1,
          sample: (time) => sample(s, time, engines[next++ % engines.length]),
          onProgress: (completed, total) => {
            if (epoch.current !== token) return;
            setProgress(completed / total);
            setLive(`Rendering frame ${completed} of ${total}`);
          },
        }).finally(release);
        if (epoch.current !== token) return;
        saveFile(
          blob,
          `tangent-garden-${studyName(frame.config)}-${mode}.${text.extension}`,
        );
        exportAbort.current = null;
        session.current = null;
        changeStatus("idle");
        setExportNotice(
          `Saved ${text.name} · ${(blob.size / (1024 * 1024)).toFixed(1)} MiB`,
        );
        return;
      }
      const firstView = await sample(s, 0);
      if (epoch.current !== token) return;
      display(s, firstView);
      schedule(s, 0);
    } catch (error) {
      if (epoch.current === token) fail(error, save ? "Export" : "Animation");
    }
  }
  function pause() {
    cancel();
    changeStatus("paused");
  }
  // Scrubbing keeps the slider enabled and its thumb under the pointer; a
  // disabled or lagging range input would drop the drag. At most one frame is
  // calculated at a time, and only the latest requested position is kept.
  function seek(p: number) {
    if (!session.current) return;
    setProgress(p);
    seekTarget.current = p;
    if (scrubbing.current !== epoch.current) void scrub(session.current);
  }
  async function scrub(s: Session) {
    const token = epoch.current;
    scrubbing.current = token;
    try {
      while (seekTarget.current !== null) {
        const p = seekTarget.current;
        seekTarget.current = null;
        const view = await sample(s, p);
        if (token !== epoch.current) return;
        display(s, view);
        if (seekTarget.current !== null) setProgress(seekTarget.current);
        changeStatus(view.complete ? "complete" : "paused");
      }
    } catch (error) {
      if (token === epoch.current) fail(error);
    } finally {
      if (scrubbing.current === token) scrubbing.current = -1;
    }
  }
  return (
    <section className="animation-section">
      <details id="animation-section" {...section}>
        <summary
          className="section-label"
          onClick={(e) => {
            // Keep playback controls reachable until the animation is stopped.
            if (active) e.preventDefault();
          }}
        >
          ANIMATION
        </summary>
        <fieldset
          disabled={running || status === "paused" || disabled}
          onChangeCapture={() => {
            if (status === "complete") stop();
          }}
        >
          <Field
            label="Animate"
            topic="animation modes"
            help={
              mode === "probe" ? (
                "Move the probe from the start of the curve to its end, one sample at a time, with its tangent, normal, osculating circle and readout. Geometry stays fixed."
              ) : mode === "trace" ? (
                "Send light from the source, or in from the edge of the view for parallel light, to the curve and on. Each caustic point appears as its ray reaches it. Light slows to c/n in each medium, so wavefronts stay together."
              ) : mode === "reveal" ? (
                iterated ? (
                  "Count the iterates in order, from none to all of them, in the finished drawing's window and grid."
                ) : (
                  "Reveal the full study from its domain start to its end. The arc-length anchor and final sample spacing stay fixed."
                )
              ) : (
                <>
                  Tracks vary together, linearly. Use <var>a</var> in a curve
                  expression to animate any coefficient, for example{" "}
                  <code>
                    <var>a</var>*cos(t)
                  </code>
                  . Integer counts change in whole steps. Endpoints accept
                  constants.
                </>
              )
            }
          >
            <select
              value={mode}
              onChange={(e) => parameterMode(e.target.value as typeof mode)}
            >
              <option value="reveal">
                {iterated ? "Accumulate the iterates" : "Draw along the curve"}
              </option>
              <option value="parameters">Vary parameters</option>
              {traceable && <option value="trace">Trace rays</option>}
              {probe && (
                <option value="probe">Move the probe along the curve</option>
              )}
            </select>
          </Field>
          {mode === "parameters" && probe && (
            <Field label="Probe" help={curveProbeMotionHelp}>
              <select
                value={probeMotion}
                onChange={(e) => setProbeMotion(e.target.value as ProbeMotion)}
              >
                {curveProbeMotions.map((m) => (
                  <option key={m.value} value={m.value}>
                    {m.label}
                  </option>
                ))}
              </select>
            </Field>
          )}
          {mode === "parameters" && (
            <>
              {tracks.map((track, i) => (
                <div className="animation-track" key={i}>
                  <Field label={`Parameter ${i + 1}`}>
                    <select
                      value={track.target}
                      onChange={(e) =>
                        setTracks(
                          tracks.map((t, j) =>
                            j === i
                              ? defaultTrack(e.target.value as Target)
                              : t,
                          ),
                        )
                      }
                    >
                      {targets
                        .filter(
                          (target) =>
                            target === track.target ||
                            !tracks.some((t) => t.target === target),
                        )
                        .map((target) => (
                          <option key={target} value={target}>
                            {targetLabel(target)}
                          </option>
                        ))}
                    </select>
                  </Field>
                  <div className="pair">
                    {(["from", "to"] as const).map((endpoint) => (
                      <Field
                        label={endpoint === "from" ? "From" : "To"}
                        key={endpoint}
                      >
                        <input
                          aria-label={`Track ${i + 1} ${endpoint}`}
                          value={track[endpoint]}
                          onChange={(e) =>
                            setTracks(
                              tracks.map((t, j) =>
                                j === i
                                  ? { ...t, [endpoint]: e.target.value }
                                  : t,
                              ),
                            )
                          }
                          spellCheck={false}
                        />
                      </Field>
                    ))}
                  </div>
                  <button
                    className="text-button"
                    onClick={() => setTracks(tracks.filter((_, j) => j !== i))}
                    aria-label={`Remove parameter ${i + 1}`}
                  >
                    Remove track
                  </button>
                </div>
              ))}
              <button
                disabled={tracks.length >= targets.length}
                onClick={() => {
                  const next = targets.find(
                    (t) => !tracks.some((track) => track.target === t),
                  );
                  if (next) setTracks([...tracks, defaultTrack(next)]);
                }}
              >
                + Add parameter
              </button>
            </>
          )}
          <Field label="Duration (seconds)">
            <input
              type="number"
              min="0.1"
              max="3600"
              step="any"
              value={Number.isNaN(duration) ? "" : duration}
              onChange={(e) => setDuration(e.target.valueAsNumber)}
            />
          </Field>
          <div className="pair">
            <Field label="Repeat" help={repeatHelp[repeat]}>
              <select
                value={repeat}
                onChange={(e) => setRepeat(e.target.value as Repeat)}
              >
                {repeatChoices
                  .filter((c) => c.value !== "loop" || loops(mode))
                  .map((c) => (
                    <option key={c.value} value={c.value}>
                      {c.label}
                    </option>
                  ))}
              </select>
            </Field>
            <Field label="Pace" help={paceHelp[pace]}>
              <select
                value={pace}
                onChange={(e) => setPace(e.target.value as Pace)}
              >
                {paceChoices.map((c) => (
                  <option key={c.value} value={c.value}>
                    {c.label}
                  </option>
                ))}
              </select>
            </Field>
          </div>
          <Field
            label="Animation camera"
            help={
              <>
                {camera === "current"
                  ? "Keeps your current pan and zoom throughout, including export."
                  : camera === "hold"
                    ? "Frames the final result once and holds that view."
                    : camera === "follow"
                      ? "Keeps the final zoom and recenters on the evolving geometry; growing shapes may leave the frame."
                      : "Recenters and zooms to fit the evolving geometry."}
                {(camera === "fit" || camera === "follow") &&
                  " Isolated points near asymptotes are ignored; use Hold current view to explore distant branches."}
              </>
            }
          >
            <select
              value={camera}
              onChange={(e) => setCamera(e.target.value as CameraMode)}
            >
              <option value="hold">Hold final view</option>
              <option value="current">Hold current view</option>
              {mode !== "trace" && (
                <>
                  <option value="follow">Follow center, fixed zoom</option>
                  <option value="fit">Fit each frame</option>
                </>
              )}
            </select>
          </Field>
          <details
            id="export-settings"
            className="subsection"
            {...exportSection}
          >
            <summary>
              Export settings
              <span className="summary-detail">
                {text.short} · {fps} fps · {exportSize.width} ×{" "}
                {exportSize.height} · quality {quality}
              </span>
            </summary>
            {offered.length > 1 && (
              <Field label="Export format">
                <select
                  value={chosen}
                  onChange={(e) => setFormat(e.target.value as ExportFormat)}
                >
                  {offered.map((f) => (
                    <option key={f} value={f}>
                      {formatText[f].option}
                    </option>
                  ))}
                </select>
              </Field>
            )}
            <FrameRateField format={chosen} fps={fps} onChange={setFPS} />
            <Field
              label="Export resolution"
              value={`${exportSize.width} × ${exportSize.height}`}
              help="More pixels keep finer detail, with larger files and slower export."
            >
              <input
                aria-label="Export resolution"
                aria-valuetext={`${exportSize.width} by ${exportSize.height} pixels`}
                type="range"
                min="0.5"
                max="2"
                step="0.25"
                value={exportScale}
                onChange={(e) => setExportScale(+e.target.value)}
              />
            </Field>
            <Field
              label="Export quality"
              value={`${quality} / 100`}
              help={`${text.short} starts at ${defaultQuality[chosen]}; lower values make smaller files. Near 100, files can grow much larger; size depends on the drawing and browser.`}
            >
              <input
                aria-label="Export quality"
                aria-valuetext={`${quality} out of 100`}
                type="range"
                min="1"
                max="100"
                step="1"
                value={quality}
                onChange={(e) => setQuality(+e.target.value)}
              />
            </Field>
            {chosen === "webp" && cycles(repeat) ? (
              <p className="hint">
                This animation repeats, so the file loops forever.
              </p>
            ) : chosen === "webp" ? (
              <label className="check">
                <input
                  type="checkbox"
                  checked={loop}
                  onChange={(e) => setLoop(e.target.checked)}
                />
                Loop exported animation
              </label>
            ) : (
              <p className="hint">
                MP4 files have no loop setting; video players decide whether to
                loop.
              </p>
            )}
            <button
              className="text-button export-reset"
              disabled={
                exportScale === defaultScale &&
                quality === defaultQuality[chosen]
              }
              onClick={() => {
                if (status === "complete") stop();
                setExportScale(defaultScale);
                setQuality(defaultQuality[chosen]);
              }}
            >
              Reset export settings to {defaultSize.width} ×{" "}
              {defaultSize.height} · quality {defaultQuality[chosen]}
            </button>
            <p className="hint">
              Export renders every frame in your browser with the current theme,
              layers, and camera, which can take longer than playback. Up to
              7,200 frames (2 minutes at 60 fps) or 256 MiB.
            </p>
          </details>
        </fieldset>
        {/* On narrow screens this docks below the drawing while active. */}
        <div
          id="playback"
          className={active ? "playback active" : "playback"}
          role="group"
          aria-label="Playback"
        >
          <div className="animation-buttons">
            {status === "playing" ? (
              <button onClick={pause}>Pause</button>
            ) : status === "paused" ? (
              <button
                onClick={() => {
                  if (!session.current) return;
                  onPlay();
                  schedule(session.current, progress);
                }}
              >
                Resume
              </button>
            ) : (
              <button
                className="export"
                disabled={disabled || running || !frame}
                onClick={() => void start()}
              >
                {status === "complete"
                  ? "Replay"
                  : status === "preparing"
                    ? "Preparing…"
                    : "Play animation"}
              </button>
            )}
            <button disabled={!active} onClick={stop}>
              {status === "exporting"
                ? "Cancel export"
                : status === "complete"
                  ? "Back to study"
                  : "Stop"}
            </button>
          </div>
          {active && (
            <div className="timeline">
              <Field
                label="Animation progress"
                value={`${Math.round(progress * 100)}%`}
              >
                <ProgressSlider
                  progress={progress}
                  disabled={running}
                  onSeek={(p) => void seek(p)}
                />
              </Field>
              <div className="note" role="status" aria-live="off">
                {status === "exporting"
                  ? `Exporting ${text.short}…`
                  : status === "complete"
                    ? "Complete"
                    : status === "paused"
                      ? "Paused"
                      : status === "preparing"
                        ? "Preparing"
                        : `${(progress * duration).toFixed(1)} / ${duration} s`}
              </div>
              <output className="animation-values">{live}</output>
              <p className="note playback-tip">
                {status === "exporting"
                  ? "Cancel export discards the file; your study stays as it was."
                  : status === "complete"
                    ? "Pan and zoom the finished drawing, scrub the timeline, or export this frame as SVG. Back to study restores your study and manual view."
                    : "Pause to scrub or export this frame as SVG. Stop restores your study and manual view."}
              </p>
            </div>
          )}
        </div>
        <button
          className="animation-export"
          disabled={disabled || running || !frame || !exportReady}
          onClick={() => void start(true)}
        >
          Export {text.name} ↗
        </button>
        {exportHint && <p className="hint">{exportHint}</p>}
        {exportNotice && (
          <p className="note" role="status">
            {exportNotice}
          </p>
        )}
        {error && (
          <p className="animation-error" role="alert">
            {error}
          </p>
        )}
      </details>
    </section>
  );
}
