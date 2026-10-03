import { useEffect, useRef, useState, type RefObject } from "react";
import { ProgressSlider } from "../ProgressSlider";
import type { SpatialAnimation } from "./link";
import { EngineClient, playbackEngineCount } from "../engine-client";
import { play } from "../playback";
import { cycles, progressAt, type Pace, type Repeat } from "../timing";
import {
  loopGap,
  loops,
  paceChoices,
  paceHelp,
  repeatChoices,
  repeatHelp,
  smoothLoopHelp,
} from "./loop";
import {
  applyTracks,
  availableTargets,
  integerTargets,
  reveal,
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
import type { Bounds3, Frame } from "./types";
import type { Flight } from "./presets";
import {
  probeIndex,
  probeSteps,
  probeTarget,
  probeWhere,
  surfaceTerms,
  gridded,
  probeOptions,
  type Probe,
} from "./probe";
import type { Layers } from "./renderer";
import { buildScene, scenePasses } from "./scene";
import { sweepExtent, sweepOffset, type CutSpec } from "./cut";
import type { Sight } from "./sight";
import { trace, traceTimeline, type Timeline } from "./raytrace";
import { defaultScale, exportEncoding, exportTiming } from "../export-quality";
import {
  defaultQuality,
  detectFormats,
  formatText,
  type ExportFormat,
  type Formats,
} from "../export-formats";
import { saveFile } from "../export-image";
import { Field, HelpText, HelpToggle, useHelp } from "../Field";
import { useDisclosure } from "../useDisclosure";
import type { SpatialCamera } from "./link";
import {
  defaultPath,
  keyFromView,
  keyLabel,
  maxKeyName,
  maxKeys,
  maxTurns,
  pathError,
  pathHelp,
  pathLeg,
  pathStyles,
  type CameraPath,
  type KeyView,
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
  // Present only while moving the probe: its setup when playback began.
  probe?: Probe;
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
  // Animated WebP stops at 30 fps; the MP4 choice is kept for switching back.
  const exportFps = chosen === "webp" && fps === 60 ? 30 : fps;
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
  // Turning the probe off ends an animation that moves it.
  useEffect(() => {
    if (!probing && session.current?.mode === "probe") stop();
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
    if (s.mode === "reveal")
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
    else current = await engine.computeSpatial(values.config);
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
      }),
      ...(s.ride && { ride: s.ride }),
      // Sample (or row) 0 at the start and the last at the end, exactly.
      ...(s.mode === "probe" && {
        probe: probeIndex(
          p,
          probeSteps(
            s.original.result,
            probeTarget(s.original.config, s.probe!),
          )!,
        ),
        probeSetup: s.probe,
      }),
      // The farthest extent at the start and the nearest at the end, exactly.
      ...(s.mode === "cut" && {
        cut: {
          ...s.cut!,
          plane: { ...s.cut!.plane, offset: sweepOffset(p, s.extent!) },
        },
      }),
    };
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
    return s.tracks
      .map(
        (t) =>
          `${targetLabel(view.frame.config, t.target)} = ${targetValue(view.frame.config, t.target, view.length).toPrecision(6)}`,
      )
      .join(" · ");
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
      if (save) exportTiming(duration, exportFps);
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
      // if the study was drawn without them.
      let original = frame;
      if (mode === "probe" && probeSteps(frame.result, target) === null) {
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
          ) ?? undefined;
        if (!extent)
          throw new Error(
            "The cut reaches nothing drawn. Show a sheet, or let the cut reach lines too.",
          );
      }
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
            )
            .catch((reason) => {
              throw new Error(`At animation start: ${reason.message}`);
            }),
          (helper.current ?? client.current)
            .computeSpatial(
              applyTracks(frame.config, numeric, 1, length).config,
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
        ...(mode === "probe" && { probe: probe! }),
        cut,
        extent,
        sight,
        ...(flies && {
          path: structuredClone(path),
          around: frame.result.bounds,
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
          fps: exportFps,
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
  const changeKey = (k: number, change: (key: KeyView) => KeyView) =>
    setPath((p) => ({
      ...p,
      keys: p.keys.map((key, j) => (j === k ? change(key) : key)),
    }));
  const degrees = (x: number) => {
    const d = Math.round((((x * 180) / Math.PI) % 360) + 360) % 360;
    return d > 180 ? d - 360 : d;
  };
  const pathEditor = (
    <>
      <Field
        label="Path"
        help={
          path.style === "smooth"
            ? repeat === "loop"
              ? `${pathHelp.smooth} ${smoothLoopHelp}`
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
      <div className="field path-views" role="group" aria-label="Key views">
        <div className="field-label">
          <span>Key views</span>
          <HelpToggle topic="key views" help={keysHelp} />
        </div>
        <HelpText help={keysHelp}>{pathHelp.keys}</HelpText>
        {path.keys.map((key, k) => {
          const name = (
            <Field label="Name">
              <input
                aria-label={`View ${k + 1} name`}
                placeholder={`View ${k + 1}`}
                maxLength={maxKeyName}
                value={key.name}
                onChange={(e) => {
                  const name = e.target.value;
                  changeKey(k, (old) => ({ ...old, name }));
                }}
                spellCheck={false}
              />
            </Field>
          );
          return (
            <div className="animation-track path-view" key={k}>
              {k === 0 ? (
                name
              ) : (
                <div className="pair">
                  {name}
                  <Field
                    label="Turns"
                    help={pathHelp.turns}
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
                </div>
              )}
              <p className="hint">
                yaw {degrees(key.yaw)}°, pitch {degrees(key.pitch)}°, zoom{" "}
                {key.zoom.toFixed(2)}×
                {key.panX !== 0 || key.panY !== 0 ? ", panned" : ""}
              </p>
              <div className="path-view-buttons">
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
                      }));
                  }}
                >
                  Set to drawing
                </button>
                <button
                  className="text-button"
                  aria-label={`Remove view ${k + 1}`}
                  onClick={() =>
                    setPath((p) => {
                      const keys = p.keys.filter((_, j) => j !== k);
                      // The new first view has no leg before it.
                      if (keys[0]) keys[0] = { ...keys[0], turns: 0 };
                      return { ...p, keys };
                    })
                  }
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
            help={rideHelp.ray}
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
              mode === "path" ? (
                `${pathHelp.mode} ${pathHelp.framing}`
              ) : mode === "cut" ? (
                "Move the cut plane along its normal from the farthest point it reaches to the nearest, so the drawing peels away from the side the normal points to until all it cuts is hidden. Flip the normal to peel from the other side. Geometry stays fixed."
              ) : mode === "probe" ? (
                gridded(target) && frame ? (
                  `Move the probe along the ${surfaceTerms(frame.config, target).surface} from its first ${surfaceTerms(frame.config, target).along} to its last, one row at a time at its ${surfaceTerms(frame.config, target).around}, with its principal directions, circles and readout. Geometry stays fixed.`
                ) : (
                  "Move the probe from the start of the curve to its end, one sample at a time, with its frame, osculating circle and readout. Geometry stays fixed."
                )
              ) : mode === "trace" ? (
                "Send light from the source, or in from past the edge of the view for parallel light, to the surface and on. Each caustic point appears as its ray reaches it. Light slows to c/n in each medium, so wavefronts stay together."
              ) : mode === "orbit" ? (
                "Turn the camera once around the study, from your current orientation. Geometry stays fixed."
              ) : mode === "reveal" ? (
                frame?.config.format === "implicit" ? (
                  "Reveal the level surface upward through its box, with the parts of its sections below, preserving the final mesh."
                ) : (
                  "Reveal the sampled space curve and its tangent ribbon, preserving the final sample grid and every gap."
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
                <>
                  {camera === "path"
                    ? `${pathHelp.camera} ${pathHelp.framing}`
                    : camera === "ride"
                      ? rideHelp.camera
                      : camera === "current"
                        ? "Keeps your current orbit, pan, and zoom throughout, including export."
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
                {text.short} · {exportFps} fps · {exportSize.width} ×{" "}
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
            <Field label="Export frame rate">
              <select
                value={exportFps}
                onChange={(e) => setFPS(+e.target.value)}
              >
                {chosen === "mp4" && (
                  <option value={60}>60 fps · smoothest motion</option>
                )}
                <option value={30}>30 fps · smoother motion</option>
                <option value={15}>15 fps · smaller file</option>
              </select>
            </Field>
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
