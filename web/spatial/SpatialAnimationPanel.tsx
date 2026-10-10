import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
  type RefObject,
} from "react";
import { FrameRateField } from "../FrameRateField";
import { ProgressSlider } from "../ProgressSlider";
import type { SpatialAnimation } from "./link";
import { EngineClient, playbackEngineCount } from "../engine-client";
import { play } from "../playback";
import {
  asymptoteHelp,
  cycles,
  paceChoices,
  paceHelp,
  progressAt,
  repeatChoices,
  type Pace,
  type Repeat,
} from "../timing";
import { loopGap, loops, repeatHelp, smoothLoopHelp } from "./loop";
import {
  applyTracks,
  availableTargets,
  integerTargets,
  reveal,
  revealedThrough,
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
import type { Bounds3, Frame, SpatialConfig } from "./types";
import type { Flight } from "./presets";
import {
  probeIndex,
  probeSteps,
  probeTarget,
  probeWhere,
  probeStep,
  probeSample,
  surfaceTerms,
  gridded,
  probeOptions,
  heldProbe,
  probeMotions,
  probeMotionHelp,
  probeBetween,
  parameterAt,
  curveDomain,
  curveStep,
  sampleProbe,
  type CurveProbe,
  type Probe,
  type ProbeMotion,
  type ProbePlace,
} from "./probe";
import {
  drawnLength,
  noLength,
  noShare,
  outsideFrame,
  revealedProbe,
  unreached,
} from "../probe";
import type { ProbeQuery } from "../types";
import type { Layers } from "./renderer";
import { buildScene, scenePasses } from "./scene";
import { movedCut, sweepExtent, sweepOffset, type CutSpec } from "./cut";
import type { Sight } from "./sight";
import { trace, traceTimeline, type Timeline } from "./raytrace";
import {
  defaultScale,
  exportEncoding,
  exportTiming,
  largestScale,
  resolutionHelp,
} from "../export-quality";
import { spatialFits } from "./limits";
import {
  defaultQuality,
  detectFormats,
  formatText,
  type ExportFormat,
  type Formats,
} from "../export-formats";
import { saveFile } from "../export-image";
import { Field, HelpText, HelpToggle, useHelp } from "../Field";
import { tiered, withMore } from "../help";
import { useDisclosure } from "../useDisclosure";
import type { SpatialCamera } from "./link";
import {
  defaultPath,
  keyFromView,
  keyLabel,
  keyTimes,
  legRange,
  maxKeyName,
  maxKeys,
  maxTurns,
  moveKey,
  pathError,
  framedDepths,
  pathHelp,
  pathPivots,
  pathLeg,
  pathStyles,
  removeKey,
  type CameraPath,
  type KeyView,
  type PathPivot,
  type PathStyle,
} from "./path";
import {
  rideChoices,
  rideError,
  rideFields,
  rideHelp,
  ridePath,
  rideRange,
  rideReadout,
  snapRide,
  defaultRide,
  type Ride,
  type RidePath,
} from "./ride";

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
  // Present only while the probe is on, which every animation draws: its
  // setup when playback began, and, with parameters, how it moves as they
  // vary (see heldProbe).
  probe?: Probe;
  motion?: ProbeMotion;
  // The curve probe on the study as it begins, and whether it stands
  // between samples, where Go places it in each frame.
  point?: CurveProbe | null;
  between?: boolean;
  // The entered cut when playback began, drawn by every mode, and the
  // range a peel moves it over.
  cut: CutSpec | null;
  extent?: [number, number];
  // The sight when playback began, for an export.
  sight: Sight;
  // Present only while flying a camera path, alone or while the geometry
  // moves: the path when playback began, and the study's bounds then, which
  // its key views were taken about.
  path?: CameraPath;
  around?: Bounds3;
  // How far each view's framed point stands from the plane through the
  // center, when the path turns about the geometry (see framedDepths).
  depths?: number[];
  // Present only while riding a ray: its polyline, the bounds its lens is
  // framed about, and the trace's total optical path.
  ride?: { path: RidePath; around: Bounds3; total: number };
  camera: CameraMode;
  heldView?: Viewport;
  duration: number;
  // How the duration is spent (see timing.ts): the progress is the time
  // the timeline stands at.
  repeat: Repeat;
  pace: Pace;
  length: number;
  progress: number;
};
type Props = {
  frame: Frame | null;
  client: RefObject<EngineClient | null>;
  length: number;
  revision: string;
  disabled: boolean;
  // The parameter probe while it is on in a study that offers it, else
  // null.
  probe: Probe | null;
  // The entered cut while it is on and valid, else null.
  cut: CutSpec | null;
  // The sight as drawn (see sight.ts).
  sight: Sight;
  dark: boolean;
  layers: Layers;
  getCurrentView: () => Viewport | undefined;
  onView: (view: AnimationView | null) => void;
  onRunning: (running: boolean) => void;
  // Called when playback starts or resumes, so the drawing can be shown.
  onPlay: () => void;
  // The animation setup, kept current for a study link.
  settings?: { current: SpatialAnimation | null };
  // A setup from a study link, applied once per id. The notebook passes it
  // only once the frame belongs to the linked study, so neither its tracks
  // nor a trace mode is judged against the previous study.
  restore?: { id: number; settings: SpatialAnimation } | null;
  // Shows a key view in the drawing as its manual camera, to adjust it.
  onShowView: (view: SpatialCamera) => void;
  // A chosen preset's camera path and duration, or none, applied once per
  // id: a preset brings its own path, or clears the path. The notebook
  // passes it only once the frame belongs to the preset, so a mode or
  // tracks it brings are judged against the preset's own study.
  flight?: {
    id: number;
    flight?: Flight;
  } | null;
};

export function SpatialAnimationPanel({
  frame,
  client,
  length,
  revision,
  disabled,
  probe,
  cut,
  sight,
  dark,
  layers,
  getCurrentView,
  onView,
  onRunning,
  onPlay,
  settings,
  restore,
  onShowView,
  flight,
}: Props) {
  const [mode, setMode] = useState<AnimationMode>("reveal");
  const probing = probe !== null;
  // What a probe animation moves along: the curve, or a surface.
  const target = frame && probe ? probeTarget(frame.config, probe) : "curve";
  const traceable = frame?.config.format === "rays";
  // Light is traced only in a mirror or interface study; another falls back
  // to revealing.
  useEffect(() => {
    if (!traceable && mode === "trace") setMode("reveal");
  }, [traceable, mode]);
  // The probe moves only while it is on; another study falls back to
  // revealing.
  useEffect(() => {
    if (!probing && mode === "probe") setMode("reveal");
  }, [probing, mode]);
  // The cut peels only while it is on and valid.
  const cutting = cut !== null;
  useEffect(() => {
    if (!cutting && mode === "cut") setMode("reveal");
  }, [cutting, mode]);
  const [camera, setCamera] = useState<CameraMode>("hold");
  const [duration, setDuration] = useState(10);
  const [repeat, setRepeat] = useState<Repeat>("once");
  const [pace, setPace] = useState<Pace>("steady");
  // Only motion that can return to its start loops; another keeps
  // repeating, back and forth.
  useEffect(() => {
    if (!loops(mode) && repeat === "loop") setRepeat("back-and-forth");
  }, [mode, repeat]);
  const [tracks, setTracks] = useState<Track[]>([]);
  // How the probe moves while parameters vary; a grid has no length, so
  // keeping its share falls back to staying.
  const [probeMotion, setProbeMotion] = useState<ProbeMotion>("stays");
  const motions = frame && probing ? probeMotions(frame.config, target) : [];
  useEffect(() => {
    if (motions.length && !motions.some((m) => m.value === probeMotion))
      setProbeMotion("stays");
  }, [motions.map((m) => m.value).join(","), probeMotion]);
  const [path, setPath] = useState<CameraPath>(defaultPath);
  const [ride, setRide] = useState<Ride>(defaultRide);
  // Only traced light has a ray to ride; another mode holds the final view.
  const rides = mode === "trace" && camera === "ride";
  useEffect(() => {
    if (mode !== "trace" && camera === "ride") setCamera("hold");
  }, [mode, camera]);
  // The path mode flies the key views with the geometry fixed; the path
  // camera flies them while it moves. The orbit turns the camera itself.
  const flies = mode === "path" || (camera === "path" && mode !== "orbit");
  const keysHelp = useHelp();
  const [status, setStatus] = useState<Status>("idle");
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState("");
  const [live, setLive] = useState("");
  const section = useDisclosure("spatial-animation", true);
  const exportSection = useDisclosure("spatial-export");
  const [fps, setFPS] = useState(30);
  const [loop, setLoop] = useState(false);
  const [scaleChoice, setExportScale] = useState(defaultScale);
  // Only resolutions this device draws are offered; a larger choice waits.
  const topScale = useMemo(() => {
    const fits = spatialFits(sight.sheets === "through");
    return largestScale((size) => fits(size, false));
  }, [sight.sheets]);
  const exportScale = Math.min(scaleChoice, topScale);
  const resetScale = Math.min(defaultScale, topScale);
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
  const defaultSize = exportEncoding({ scale: resetScale, quality });
  const exportReady = formats?.[chosen] === "yes";
  const exportHint = !formats
    ? ""
    : offered.length === 0
      ? "This browser can't save animations. You can still save single frames as PNG."
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
      probeMotion,
      path,
      ride,
      repeat,
      pace,
    };
  // After the retention and trace fallbacks above, which then see the
  // linked study's own frame.
  const restored = useRef(-1);
  useEffect(() => {
    if (!restore || restore.id === restored.current) return;
    restored.current = restore.id;
    setMode(restore.settings.mode);
    setCamera(restore.settings.camera);
    setDuration(restore.settings.duration);
    setTracks(restore.settings.tracks);
    setProbeMotion(restore.settings.probeMotion);
    setPath(restore.settings.path);
    setRide(restore.settings.ride);
    setRepeat(restore.settings.repeat);
    setPace(restore.settings.pace);
  }, [restore]);
  const flown = useRef(-1);
  useEffect(() => {
    if (!flight || flight.id === flown.current) return;
    flown.current = flight.id;
    const brought = flight.flight;
    setPath(brought ? structuredClone(brought.path) : defaultPath);
    // A preset brings its own repeat and pace, or the defaults.
    setRepeat(brought?.repeat ?? "once");
    setPace(brought?.pace ?? "steady");
    if (brought?.animate) {
      // The path flies, or the ray is ridden, while the geometry moves.
      setMode(brought.animate.mode);
      setCamera(brought.ride ? "ride" : (brought.camera ?? "path"));
      if (brought.ride) setRide(structuredClone(brought.ride));
      if (brought.animate.tracks)
        setTracks(structuredClone(brought.animate.tracks));
      setProbeMotion(brought.animate.probe ?? "stays");
      setDuration(brought.duration);
    } else if (brought) {
      setMode("path");
      setDuration(brought.duration);
    } else {
      setMode((m) => (m === "path" ? "reveal" : m));
      setCamera((c) => (c === "path" || c === "ride" ? "hold" : c));
    }
  }, [flight]);
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
  // Turning the probe off ends an animation that draws it.
  useEffect(() => {
    if (!probing && session.current?.probe) stop();
  }, [probing]);
  // So does turning the cut off, or leaving it invalid, during a peel.
  useEffect(() => {
    if (!cutting && session.current?.mode === "cut") stop();
  }, [cutting]);
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
    const from = frame ? targetValue(frame.config, target, length) : 1;
    const to =
      target === "samples"
        ? Math.min(2400, from * 2)
        : target === "lines"
          ? Math.min(240, from + 20)
          : target === "count"
            ? Math.min(24, from + 4)
            : target === "uSamples" || target === "vSamples"
              ? Math.max(12, Math.round(from / 2))
              : target === "curves"
                ? Math.min(48, from + 4)
                : target === "azimuth"
                  ? from + 45
                  : target === "tube"
                    ? from * 0.75
                    : from + 1;
    return { target, from: String(from), to: String(to) };
  }
  function parameterMode(next: AnimationMode) {
    setMode(next);
    // Traced light enters a fixed view; a moving camera would chase it.
    if (next === "trace" && (camera === "follow" || camera === "fit"))
      setCamera("hold");
    // The orbit turns the camera itself.
    if (next === "orbit" && camera === "path") setCamera("hold");
    if (next === "parameters" && !tracks.length && targets.length)
      setTracks([defaultTrack(targets[0])]);
  }
  // The frame at a time on the timeline: the motion at its progress then.
  async function sample(
    s: Session,
    time: number,
    engine = client.current!,
  ): Promise<AnimationView> {
    const view = await frameAt(s, progressAt(time, s.repeat, s.pace), engine);
    return {
      ...view,
      time,
      complete: s.repeat === "once" && time === 1,
    };
  }
  // The frame at a progress of the motion.
  async function frameAt(
    s: Session,
    p: number,
    engine = client.current!,
  ): Promise<AnimationView> {
    const values = applyTracks(s.original.config, s.tracks, p, s.length);
    let current: Frame;
    let held: ProbePlace | string | null | undefined;
    if (s.mode === "parameters" && s.between) {
      // Between samples, each frame's probe is placed by Go with the frame
      // itself, the ends included.
      const query = heldQuery(s, values.config, p);
      current = await engine.computeSpatial(values.config, {
        diagnostics: true,
        ...(typeof query !== "string" && { probe: query }),
      });
      held =
        typeof query === "string"
          ? query
          : "share" in query &&
              !(drawnLength(current.result.diagnostics!.length) > 0)
            ? noLength
            : current.result.probe!;
    } else if (s.mode === "reveal")
      current = {
        config: s.original.config,
        result: reveal(s.original.result, p),
      };
    else if (
      s.mode === "orbit" ||
      s.mode === "probe" ||
      s.mode === "cut" ||
      s.mode === "path"
    )
      current = s.original;
    else if (s.mode === "trace")
      current = {
        config: s.original.config,
        result: trace(s.original.result, s.timeline!, p),
      };
    else if (p === 0) current = s.first;
    else if (p === 1) current = s.final;
    else
      current = await engine.computeSpatial(
        values.config,
        s.probe ? probeOptions(probeTarget(s.original.config, s.probe)) : {},
      );
    // The probe moves along the fixed study from the start of the curve
    // (or a surface's first row) to its end, exactly: one sample at a time,
    // or through every t between them. While parameters vary it stands on
    // each frame's own diagnostics, or is absent from it with a reason.
    // Animations that keep the study fixed hold it where the user put it,
    // once a reveal has drawn it.
    if (held === undefined)
      held =
        s.mode === "probe" && s.between
          ? await engine.spatialProbe(s.original.config, {
              t: parameterAt(
                s.original.result.diagnostics!.min,
                s.original.result.diagnostics!.max,
                p,
              ),
            })
          : s.mode === "probe"
            ? probeIndex(
                p,
                probeSteps(
                  s.original.result,
                  probeTarget(s.original.config, s.probe!),
                )!,
              )
            : s.mode === "parameters" && s.probe
              ? heldProbe(
                  s.original.result,
                  s.probe,
                  probeTarget(s.original.config, s.probe),
                  s.motion!,
                  current.result,
                  p,
                )
              : s.probe
                ? fixedProbe(s, p)
                : null;
    // The curve probe at a sample is described as between samples.
    if (
      typeof held === "number" &&
      probeTarget(s.original.config, s.probe!) === "curve"
    )
      held = sampleProbe(current.result, held);
    return {
      frame: current,
      final: s.final,
      camera: s.camera,
      heldView: s.heldView,
      length: s.mode === "parameters" ? values.length : s.length,
      progress: p,
      mode: s.mode,
      complete: p === 1,
      ...(s.path && {
        path: s.path,
        around: s.around,
        cyclic: s.repeat === "loop",
        ...(s.depths && { depths: s.depths }),
      }),
      ...(s.ride && { ride: s.ride }),
      ...(held !== null &&
        (typeof held === "string"
          ? { probeAway: held, probeSetup: s.probe }
          : { probe: held, probeSetup: s.probe })),
      // The farthest extent at the start and the nearest at the end, exactly.
      ...(s.mode === "cut" && {
        cut: movedCut(s.cut!, sweepOffset(p, s.extent!)),
      }),
    };
  }
  // The probe in an animation that keeps the study fixed: where the user
  // put it, once a reveal has drawn the sample (or a surface's row) it
  // describes; between samples, once it has drawn the sample after it.
  function fixedProbe(s: Session, p: number): ProbePlace | string | null {
    if (s.between) {
      const at = s.point;
      if (!at) return null;
      return s.mode === "reveal" &&
        Math.ceil(curveStep(s.original.result, at)) >
          revealedThrough(s.original.result, p)
        ? unreached
        : at;
    }
    const target = probeTarget(s.original.config, s.probe!),
      step = probeStep(s.original.result, target, s.probe!);
    return s.mode === "reveal"
      ? revealedProbe(
          step,
          probeSample(s.original.result, target, step),
          revealedThrough(s.original.result, p),
        )
      : step;
  }
  // Where Go is to place a probe between samples in a frame whose study is
  // config, at progress p: at its own t, the same share of the drawn
  // length, or along the domain; or why it has no place there.
  function heldQuery(
    s: Session,
    config: SpatialConfig,
    p: number,
  ): ProbeQuery | string {
    const [min, max] = curveDomain(config);
    if (s.motion === "along") return { t: parameterAt(min, max, p) };
    const at = s.point;
    if (!at) return "This frame has no curve for the probe to describe.";
    if (s.motion === "stays")
      return at.t >= min && at.t <= max
        ? { t: at.t }
        : outsideFrame(at.t, min, max);
    const whole = drawnLength(s.original.result.diagnostics!.length);
    return at.length === null || !(whole > 0)
      ? noShare
      : { share: Math.min(1, at.length / whole) };
  }
  function display(s: Session, view: AnimationView) {
    s.progress = view.time!;
    setProgress(view.time!);
    onView(view);
    const leg = s.path ? pathLeg(s.path, view.progress) : "";
    // A path flown while the geometry moves names its leg after the
    // geometry's readout, and a ride its ray and stage.
    const riding = s.ride
      ? rideReadout(
          s.ride.path,
          s.original.result,
          s.original.config,
          view.progress * s.ride.total,
        )
      : "";
    setLive(
      s.mode === "path"
        ? leg
        : [readout(s, view), leg, riding].filter(Boolean).join(" · "),
    );
  }
  function readout(s: Session, view: AnimationView) {
    if (s.mode === "reveal" && s.original.config.format === "implicit") {
      // A level surface reveals upward through its box.
      const { zMin, zMax } = s.original.config.implicit.box;
      return `z = ${(zMin + (zMax - zMin) * view.progress).toPrecision(6)}`;
    }
    if (
      s.mode === "reveal" &&
      (s.original.config.format === "surface" ||
        s.original.config.format === "rays")
    ) {
      // A surface or mirror reveals along u.
      const { uMin, uMax } = s.original.config.surface;
      return `u = ${(uMin + (uMax - uMin) * view.progress).toPrecision(6)}`;
    }
    if (s.mode === "reveal")
      return `t = ${(s.original.config.curve.min + (s.original.config.curve.max - s.original.config.curve.min) * view.progress).toPrecision(6)}`;
    if (s.mode === "trace")
      return `Optical path τ = ${(view.progress * s.timeline!.total).toPrecision(4)} · ${view.frame.result
        .rays!.caustics.reduce(
          (n, c) => n + c.points.flat().filter((q) => q).length,
          0,
        )
        .toLocaleString("en-US")} caustic points reached`;
    if (s.mode === "orbit")
      return `Camera rotation · ${Math.round(view.progress * 360)}°`;
    if (s.mode === "cut")
      return `Cut at d = ${view.cut!.plane.offset.toPrecision(6)}`;
    if (s.mode === "probe")
      return `Probe at ${probeWhere(view.frame.result, view.frame.config, s.probe!, view.probe!)}`;
    // A probe that moves as the parameters vary says where it stands.
    const probed =
      s.probe && s.motion !== "stays" && view.probe !== undefined
        ? [
            `Probe at ${probeWhere(view.frame.result, view.frame.config, s.probe, view.probe)}`,
          ]
        : [];
    return [
      ...s.tracks.map(
        (t) =>
          `${targetLabel(view.frame.config, t.target)} = ${targetValue(view.frame.config, t.target, view.length).toPrecision(6)}`,
      ),
      ...probed,
    ].join(" · ");
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
    if (s.mode === "parameters" && !helper.current && playbackEngineCount() > 1)
      helper.current = new EngineClient();
    const engines =
      s.mode === "parameters" && helper.current
        ? [client.current!, helper.current]
        : [client.current!];
    // Each engine holds at most one calculation. Slow devices skip
    // intermediate times instead of queuing work or lengthening a 30-second
    // animation.
    playing.current = play({
      from,
      duration: s.duration * 1000,
      repeat: cycles(s.repeat),
      lanes: engines.map((engine) => (p: number) => sample(s, p, engine)),
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
    const heldView = getCurrentView();
    try {
      if (!Number.isFinite(duration) || duration < 0.1 || duration > 3600)
        throw new Error("Duration must be between 0.1 and 3600 seconds.");
      if (!heldView) throw new Error("The current view is not ready yet.");
      if (save) exportTiming(duration, fps);
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
              "Sample, line, and involute count endpoints must be whole numbers.",
            );
        }
      }
      if (flies) {
        const problem = pathError(path);
        if (problem) throw new Error(`${problem.field} ${problem.message}`);
      }
      const ray = rides ? snapRide(frame.result, ride) : null;
      if (ray) {
        const problem = rideError(frame.result, ray);
        if (problem) throw new Error(`${problem.field} ${problem.message}`);
      }
      if (epoch.current !== token) return;
      // The probe moves over the study's own diagnostics, fetched here only
      // if the study was drawn without them; while parameters vary, it
      // stays at what it describes there, and while the study is fixed, at
      // the user's point.
      const drawsProbe = probing;
      let original = frame;
      if (drawsProbe && probeSteps(frame.result, target) === null) {
        original = await client.current.computeSpatial(
          frame.config,
          probeOptions(target),
        );
        if (epoch.current !== token) return;
      }
      // A peel runs over what the cut reaches in the drawing as it stands.
      let extent: [number, number] | undefined;
      if (mode === "cut") {
        if (!cut) throw new Error("Turn the cut on to peel with it.");
        extent =
          sweepExtent(
            scenePasses(buildScene(frame.result), layers),
            cut.plane,
            cut.scope,
            cut.others,
            cut.beyond,
          ) ?? undefined;
        if (!extent)
          throw new Error(
            "The cut reaches nothing drawn. Show a sheet, or let the cut reach lines too.",
          );
      }
      // A probe between samples stands at its own t, which Go places on the
      // study as it begins.
      const between = drawsProbe && probeBetween(frame.config, probe!);
      const point = !drawsProbe
        ? undefined
        : between
          ? await client.current.spatialProbe(original.config, {
              t: parameterAt(
                original.result.diagnostics!.min,
                original.result.diagnostics!.max,
                probe!.position,
              ),
            })
          : target === "curve"
            ? sampleProbe(
                original.result,
                probeIndex(probe!.position, original.result.base.length - 1),
              )
            : undefined;
      if (epoch.current !== token) return;
      let first = original,
        final = original;
      if (mode === "parameters") {
        // Playback's helper engine prepares the end while the app's engine
        // prepares the start.
        if (!save && playbackEngineCount() > 1)
          helper.current = new EngineClient();
        const results = await Promise.all([
          client.current
            .computeSpatial(
              applyTracks(frame.config, numeric, 0, length).config,
              drawsProbe ? probeOptions(target) : {},
            )
            .catch((reason) => {
              throw new Error(`At animation start: ${reason.message}`);
            }),
          (helper.current ?? client.current)
            .computeSpatial(
              applyTracks(frame.config, numeric, 1, length).config,
              drawsProbe ? probeOptions(target) : {},
            )
            .catch((reason) => {
              throw new Error(`At animation end: ${reason.message}`);
            }),
        ]);
        [first, final] = results;
      }
      if (epoch.current !== token) return;
      // Light enters the sphere the animation camera frames.
      const timeline =
        mode === "trace"
          ? traceTimeline(
              frame.result,
              frame.config,
              camera === "current" && heldView
                ? { center: heldView.center, radius: heldView.radius }
                : frame.result.bounds,
            )
          : undefined;
      // The ride's lens is framed about the study's own bounds, which the
      // light enters.
      const rode =
        ray && timeline
          ? ridePath(frame.result, timeline, ray, frame.result.bounds)
          : null;
      if (ray && !rode) throw new Error("This ray cannot be ridden.");
      const s: Session = {
        original,
        timeline,
        ...(rode && {
          ride: {
            path: rode,
            around: frame.result.bounds,
            total: timeline!.total,
          },
        }),
        first,
        final,
        tracks: numeric,
        mode,
        ...(drawsProbe && { probe: probe!, between, point }),
        ...(mode === "parameters" && probing && { motion: probeMotion }),
        cut,
        extent,
        sight,
        ...(flies && {
          path: structuredClone(path),
          around: frame.result.bounds,
          // The geometry the views frame, as drawn now, through the held
          // view's projection, which the path flies in.
          ...(path.pivot === "geometry" && {
            depths: framedDepths(
              path,
              scenePasses(buildScene(frame.result), layers),
              frame.result.bounds,
              {
                projection: heldView.projection,
                lensAngle: heldView.lensAngle,
              },
              cut,
            ),
          }),
        }),
        camera,
        heldView,
        duration,
        repeat,
        pace,
        length,
        progress: 0,
      };
      // A loop plays only when its last frame is its first.
      if (repeat === "loop") {
        const [a, b] = await Promise.all([frameAt(s, 0), frameAt(s, 1)]);
        if (epoch.current !== token) return;
        const gap = loopGap(a, b, layers);
        if (gap) throw new Error(gap);
      }
      session.current = s;
      if (save) {
        const controller = new AbortController();
        exportAbort.current = controller;
        changeStatus("exporting");
        setProgress(0);
        onView(null);
        const { exportAnimation } = await import("./export");
        if (epoch.current !== token) return;
        // Spatial meshes are larger than planar paths. Keep one numerical
        // frame and one GPU upload in flight, including during export.
        const engine = client.current;
        const blob = await exportAnimation({
          format: chosen,
          duration,
          fps: fps,
          // A repeating animation loops forever.
          loop: chosen === "webp" && (loop || cycles(s.repeat)),
          cyclic: cycles(s.repeat),
          settings: { scale: exportScale, quality },
          dark,
          layers: { ...layers },
          cut: s.cut,
          sight: s.sight,
          signal: controller.signal,
          sample: (p) => sample(s, p, engine),
          onProgress: (completed, total) => {
            if (epoch.current !== token) return;
            setProgress(completed / total);
            setLive(`Rendering frame ${completed} of ${total}`);
          },
        });
        if (epoch.current !== token) return;
        saveFile(blob, `tangent-garden-spatial-${mode}.${text.extension}`);
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
        changeStatus(s.repeat === "once" && p === 1 ? "complete" : "paused");
      }
    } catch (error) {
      if (token === epoch.current) fail(error);
    } finally {
      if (scrubbing.current === token) scrubbing.current = -1;
    }
  }
  // The drawing's view as a key view about the study's bounds.
  const drawn = (): KeyView | null => {
    const view = getCurrentView();
    return frame && view ? keyFromView(view, frame.result.bounds, "") : null;
  };
  // Focus follows a moved view to its new place, onto the same way's button
  // while it can move further, else the other's.
  const viewsBox = useRef<HTMLDivElement>(null);
  // The way is kept with the move, since Safari leaves a pressed button
  // unfocused.
  const moved = useRef<{ to: number; way: "up" | "down" } | null>(null);
  useLayoutEffect(() => {
    if (!moved.current) return;
    const { to: k, way } = moved.current;
    moved.current = null;
    const box = viewsBox.current;
    for (const w of way === "down" ? ["down", "up"] : ["up", "down"]) {
      const b = box?.querySelector<HTMLButtonElement>(
        `button[aria-label="Move view ${k + 1} ${w}"]`,
      );
      if (b && !b.disabled) return b.focus();
    }
  }, [path]);
  const changeKey = (k: number, change: (key: KeyView) => KeyView) =>
    setPath((p) => ({
      ...p,
      keys: p.keys.map((key, j) => (j === k ? change(key) : key)),
    }));
  const degrees = (x: number) => {
    const d = Math.round((((x * 180) / Math.PI) % 360) + 360) % 360;
    return d > 180 ? d - 360 : d;
  };
  // How far through the flight each view is reached, while every leg's time
  // is valid.
  const reached =
    path.keys.length >= 2 &&
    path.keys.every(
      (key, k) =>
        k === 0 ||
        ((key.leg ?? 1) >= legRange[0] && (key.leg ?? 1) <= legRange[1]),
    )
      ? keyTimes(path)
      : null;
  const percent = (x: number) => `${Math.round(x * 100)}%`;
  const pathEditor = (
    <>
      <Field
        label="Path"
        help={
          path.style === "smooth"
            ? repeat === "loop"
              ? withMore(pathHelp.smooth, smoothLoopHelp)
              : pathHelp.smooth
            : pathHelp.steady
        }
      >
        <select
          value={path.style}
          onChange={(e) => {
            const style = e.target.value as PathStyle;
            setPath((p) => ({ ...p, style }));
          }}
        >
          {pathStyles.map((s) => (
            <option key={s.value} value={s.value}>
              {s.label}
            </option>
          ))}
        </select>
      </Field>
      <Field
        label="Turn about"
        help={path.pivot === "geometry" ? pathHelp.geometry : pathHelp.plane}
      >
        <select
          value={path.pivot ?? "plane"}
          onChange={(e) => {
            const pivot = e.target.value as PathPivot;
            // The plane is the default, which links leave out.
            setPath(({ pivot: _, ...p }) =>
              pivot === "geometry" ? { ...p, pivot } : p,
            );
          }}
        >
          {pathPivots.map((s) => (
            <option key={s.value} value={s.value}>
              {s.label}
            </option>
          ))}
        </select>
      </Field>
      <div
        className="field path-views"
        role="group"
        aria-label="Key views"
        ref={viewsBox}
      >
        <div className="field-label">
          <span>Key views</span>
          <HelpToggle topic="key views" help={keysHelp} />
        </div>
        <HelpText help={keysHelp}>{pathHelp.keys}</HelpText>
        {path.keys.map((key, k) => {
          const name = (
            <Field label="Name">
              <ViewName
                aria-label={`View ${k + 1} name`}
                placeholder={`View ${k + 1}`}
                value={key.name}
                onChange={(name) => changeKey(k, (old) => ({ ...old, name }))}
              />
            </Field>
          );
          return (
            <div className="animation-track path-view" key={k}>
              {name}
              {k > 0 && (
                <div className="pair">
                  <Field
                    label="Turns"
                    help={k === 1 ? pathHelp.turns : undefined}
                    topic={`view ${k + 1} turns`}
                  >
                    <input
                      aria-label={`View ${k + 1} turns`}
                      type="number"
                      min={-maxTurns}
                      max={maxTurns}
                      step="1"
                      value={Number.isNaN(key.turns) ? "" : key.turns}
                      onChange={(e) => {
                        const turns = e.target.valueAsNumber;
                        changeKey(k, (old) => ({ ...old, turns }));
                      }}
                    />
                  </Field>
                  <Field
                    label="Leg time"
                    help={k === 1 ? pathHelp.leg : undefined}
                    topic={`view ${k + 1} leg time`}
                  >
                    <input
                      aria-label={`View ${k + 1} leg time`}
                      type="number"
                      min={legRange[0]}
                      max={legRange[1]}
                      step="0.1"
                      value={Number.isNaN(key.leg) ? "" : (key.leg ?? 1)}
                      onChange={(e) => {
                        const leg = e.target.valueAsNumber;
                        changeKey(k, (old) => ({ ...old, leg }));
                      }}
                    />
                  </Field>
                </div>
              )}
              <p className="hint">
                yaw {degrees(key.yaw)}°, pitch {degrees(key.pitch)}°, zoom{" "}
                {key.zoom.toFixed(2)}×
                {key.panX !== 0 || key.panY !== 0 ? ", panned" : ""}
                {reached && ` · reached ${percent(reached[k])} of the way`}
              </p>
              <div className="path-view-buttons">
                {(["up", "down"] as const).map((way) => {
                  const to = way === "up" ? k - 1 : k + 1;
                  return (
                    <button
                      key={way}
                      className="text-button"
                      aria-label={`Move view ${k + 1} ${way}`}
                      disabled={to < 0 || to >= path.keys.length}
                      onClick={() => {
                        setPath((p) => moveKey(p, k, to));
                        moved.current = { to, way };
                      }}
                    >
                      {way === "up" ? "Move up" : "Move down"}
                    </button>
                  );
                })}
                <button
                  className="text-button"
                  aria-label={`Show view ${k + 1}`}
                  onClick={() => {
                    if (status === "complete") stop();
                    onShowView({
                      yaw: key.yaw,
                      pitch: key.pitch,
                      zoom: key.zoom,
                      panX: key.panX,
                      panY: key.panY,
                    });
                  }}
                >
                  Show
                </button>
                <button
                  className="text-button"
                  aria-label={`Set view ${k + 1} to the drawing's view`}
                  onClick={() => {
                    const view = drawn();
                    if (view)
                      changeKey(k, (old) => ({
                        ...view,
                        name: old.name,
                        turns: old.turns,
                        ...(old.leg !== undefined && { leg: old.leg }),
                      }));
                  }}
                >
                  Set to drawing
                </button>
                <button
                  className="text-button"
                  aria-label={`Remove view ${k + 1}`}
                  onClick={() => setPath((p) => removeKey(p, k))}
                >
                  Remove
                </button>
              </div>
            </div>
          );
        })}
        <button
          disabled={path.keys.length >= maxKeys}
          onClick={() => {
            const view = drawn();
            if (view)
              setPath((p) =>
                p.keys.length >= maxKeys
                  ? p
                  : { ...p, keys: [...p.keys, view] },
              );
          }}
        >
          + Add the drawing's view
        </button>
        {repeat === "loop" && (
          <button
            disabled={path.keys.length < 2 || path.keys.length >= maxKeys}
            onClick={() =>
              setPath((p) =>
                p.keys.length < 2 || p.keys.length >= maxKeys
                  ? p
                  : { ...p, keys: [...p.keys, { ...p.keys[0], turns: 0 }] },
              )
            }
          >
            + Return to view 1
          </button>
        )}
      </div>
    </>
  );
  // The ride's crossing as drawn: the nearest to the one chosen.
  const choices = frame ? rideChoices(frame.result, frame.config) : null;
  const snapped = frame ? snapRide(frame.result, ride) : ride;
  const parameter = (x: number) => String(+x.toPrecision(4));
  const rideEditor = choices && (
    <>
      <div className="pair">
        {(["u", "v"] as const).map((axis) => (
          <Field
            key={axis}
            label={rideFields[axis]}
            help={axis === "u" ? rideHelp.ray : undefined}
            topic={`ray at ${axis}`}
          >
            <select
              value={axis === "u" ? snapped.i : snapped.j}
              onChange={(e) => {
                const k = +e.target.value;
                setRide((r) =>
                  axis === "u" ? { ...r, i: k } : { ...r, j: k },
                );
              }}
            >
              {choices[axis].map((c) => (
                <option key={c.index} value={c.index}>
                  {axis} = {parameter(c.value)}
                </option>
              ))}
            </select>
          </Field>
        ))}
      </div>
      <div className="pair">
        {(["follow", "turn"] as const).map((key) => (
          <Field
            key={key}
            label={`${rideFields[key]} (radii)`}
            help={rideHelp[key]}
            topic={rideFields[key].toLowerCase()}
          >
            <input
              aria-label={rideFields[key]}
              type="number"
              min={rideRange[0]}
              max={rideRange[1]}
              step="any"
              value={Number.isNaN(ride[key]) ? "" : ride[key]}
              onChange={(e) => {
                const value = e.target.valueAsNumber;
                setRide((r) => ({ ...r, [key]: value }));
              }}
            />
          </Field>
        ))}
      </div>
    </>
  );
  return (
    <section className="animation-section">
      <details id="spatial-animation-section" {...section}>
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
              mode === "path"
                ? pathHelp.mode
                : mode === "cut"
                  ? tiered(
                      "Sweep the cut plane along its normal, peeling the drawing away until all it cuts is hidden. Geometry stays fixed.",
                      "The plane moves from the farthest point it reaches to the nearest, peeling from the side the normal points to; flip the normal to peel from the other side. Other planes move with the first, by as much, so a notch or a box keeps its shape while it grows or shrinks.",
                    )
                  : mode === "probe"
                    ? gridded(target) && frame
                      ? tiered(
                          `Move the probe along the ${surfaceTerms(frame.config, target).surface}. Geometry stays fixed.`,
                          `It runs from its first ${surfaceTerms(frame.config, target).along} to its last, row by row at its ${surfaceTerms(frame.config, target).around}, with its principal directions and circles.`,
                        )
                      : probe && frame && probeBetween(frame.config, probe)
                        ? tiered(
                            "Move the probe through every t of the curve. Geometry stays fixed.",
                            "It carries its frame, osculating circle and readout from the start of the curve to its end.",
                          )
                        : tiered(
                            "Move the probe along the curve, sample by sample. Geometry stays fixed.",
                            "It carries its frame, osculating circle and readout from the start of the curve to its end.",
                          )
                    : mode === "trace"
                      ? tiered(
                          "Send light from the source to the surface and on; each caustic point appears as its ray reaches it.",
                          "Parallel light comes in from past the edge of the view. Light slows to c/n in each medium, so wavefronts stay together.",
                        )
                      : mode === "orbit"
                        ? "Turn the camera once around the study, from your current orientation. Geometry stays fixed."
                        : mode === "reveal"
                          ? frame?.config.format === "implicit"
                            ? "Reveal the level surface upward through its box, with the parts of its sections below, preserving the final mesh."
                            : "Reveal the sampled space curve and its tangent ribbon, preserving the final sample grid and every gap."
                          : tiered<ReactNode>(
                              "Tracks vary together, linearly. Endpoints accept constants.",
                              <>
                                Use <var>a</var> in a curve expression to
                                animate any coefficient, for example{" "}
                                <code>
                                  <var>a</var>*cos(t)
                                </code>
                                . Integer counts change in whole steps.
                              </>,
                            )
            }
          >
            <select
              value={mode}
              onChange={(e) => parameterMode(e.target.value as typeof mode)}
            >
              <option value="reveal">
                {frame?.config.format === "implicit"
                  ? "Rise through the box"
                  : "Draw along the curve"}
              </option>
              <option value="parameters">Vary parameters</option>
              <option value="orbit">Orbit the study</option>
              {traceable && <option value="trace">Trace rays</option>}
              {probing && (
                <option value="probe">
                  {gridded(target) && frame
                    ? `Move the probe along the ${surfaceTerms(frame.config, target).surface}`
                    : "Move the probe along the curve"}
                </option>
              )}
              {cutting && <option value="cut">Peel away with the cut</option>}
              <option value="path">Fly through key views</option>
            </select>
          </Field>
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
                            {frame ? targetLabel(frame.config, target) : target}
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
              {motions.length > 0 && frame && (
                <Field
                  label="Probe"
                  help={probeMotionHelp(
                    frame.config,
                    target,
                    !!probe && probeBetween(frame.config, probe),
                  )}
                >
                  <select
                    value={probeMotion}
                    onChange={(e) =>
                      setProbeMotion(e.target.value as ProbeMotion)
                    }
                  >
                    {motions.map((m) => (
                      <option key={m.value} value={m.value}>
                        {m.label}
                      </option>
                    ))}
                  </select>
                </Field>
              )}
            </>
          )}
          {mode === "path" && pathEditor}
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
          {mode !== "path" && (
            <Field
              label="Animation camera"
              help={
                camera === "path"
                  ? pathHelp.camera
                  : camera === "ride"
                    ? rideHelp.camera
                    : camera === "current"
                      ? "Keeps your current orbit, pan, and zoom throughout, including export."
                      : camera === "hold"
                        ? "Frames the final result once and holds that view."
                        : tiered(
                            camera === "follow"
                              ? "Keeps the final zoom and recenters on the evolving geometry; growing shapes may leave the frame."
                              : "Recenters and zooms to fit the evolving geometry.",
                            asymptoteHelp,
                          )
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
                {mode !== "orbit" && (
                  <option value="path">Fly through key views</option>
                )}
                {mode === "trace" && (
                  <option value="ride">Ride a ray · perspective</option>
                )}
              </select>
            </Field>
          )}
          {mode !== "path" && flies && pathEditor}
          {rides && rideEditor}
          <details
            id="spatial-export-settings"
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
              help={resolutionHelp(topScale)}
            >
              <input
                aria-label="Export resolution"
                aria-valuetext={`${exportSize.width} by ${exportSize.height} pixels`}
                type="range"
                min="0.5"
                max={topScale}
                step="0.25"
                value={exportScale}
                onChange={(e) => setExportScale(+e.target.value)}
              />
            </Field>
            <Field
              label="Export quality"
              value={`${quality} / 100`}
              help={`${text.short} starts at ${defaultQuality[chosen]}. Lower values make smaller files; near 100, files can grow much larger.`}
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
                exportScale === resetScale && quality === defaultQuality[chosen]
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
              layers, probe and camera, and can take longer than playback. Up to
              7,200 frames or 256 MiB.
            </p>
          </details>
        </fieldset>
        {/* On narrow screens this docks below the drawing while active. */}
        <div
          id="spatial-playback"
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
                    ? "Orbit the finished drawing, scrub the timeline, or save this frame as an image. Back to study restores your study and manual view."
                    : "Pause to scrub or save this frame as an image. Stop restores your study and manual view."}
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

// A view's name wraps onto as many lines as it needs, so a long one stays
// whole in a narrow sidebar. It is still one line of text: Enter and pasted
// line breaks add none.
function ViewName({
  value,
  onChange,
  ...rest
}: {
  value: string;
  onChange: (name: string) => void;
  "aria-label": string;
  placeholder: string;
  // From the Field around it.
  id?: string;
  "aria-describedby"?: string;
  "aria-invalid"?: boolean;
}) {
  const box = useRef<HTMLTextAreaElement>(null);
  const fit = () => {
    const e = box.current;
    if (!e) return;
    e.style.height = "auto";
    e.style.height = `${e.scrollHeight + e.offsetHeight - e.clientHeight}px`;
  };
  useLayoutEffect(fit, [value]);
  // A narrower sidebar wraps it onto more lines.
  useEffect(() => {
    const parent = box.current?.parentElement;
    if (!parent) return;
    let width = parent.clientWidth;
    const watch = new ResizeObserver(() => {
      if (parent.clientWidth === width) return;
      width = parent.clientWidth;
      fit();
    });
    watch.observe(parent);
    return () => watch.disconnect();
  }, []);
  return (
    <textarea
      {...rest}
      ref={box}
      className="view-name"
      rows={1}
      maxLength={maxKeyName}
      value={value}
      onKeyDown={(e) => {
        if (e.key === "Enter") e.preventDefault();
      }}
      onChange={(e) => onChange(e.target.value.replace(/[\r\n]+/g, " "))}
      spellCheck={false}
    />
  );
}
