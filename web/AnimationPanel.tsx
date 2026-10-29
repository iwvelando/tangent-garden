import { atlasSharedFrame } from "./atlas-framing";
import {
  defaultFamilyAnimation,
  familyMotionHelp,
  familyMotionMembers,
  sampleFamily,
  type FamilyAnimation,
  type FamilyComposition,
  type PreparedFamily,
} from "./family-motion";
import type { ColorScheme } from "./color-schemes";
import { AnimationValues } from "./AnimationValues";
import { useEffect, useMemo, useRef, useState, type RefObject } from "react";
import { FrameRateField } from "./FrameRateField";
import { ProgressSlider } from "./ProgressSlider";
import type { PlanarAnimation } from "./planar-link";
import {
  EngineClient,
  EngineError,
  exportEngineCount,
  playbackEngineCount,
} from "./engine-client";
import { play } from "./playback";
import type { LineWeight } from "./line-weight";
import {
  curveProbeMotionHelp,
  curveProbeMotions,
  drawnLength,
  heldCurveSample,
  noLength,
  noShare,
  outsideFrame,
  probeIndex,
  type ProbeMotion,
  unreached,
} from "./probe";
import {
  betweenMotionHelp,
  parameterAt,
  probeBetween,
  probeReadout,
  probeStep,
  sampleProbe,
  type HeldProbe,
  type PlanarProbe,
} from "./planar-probe";
import {
  applyTracks,
  availableTargets,
  canTrace,
  integerTargets,
  loops,
  repeatHelp,
  reveal,
  revealConfig,
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
import {
  studyName,
  type Config,
  type Frame,
  type ProbeQuery,
  type ViewRect,
} from "./types";
import { fitFrame, viewRect, type Layers } from "./Plot";
import {
  arrivalAt,
  tauAt,
  trace,
  traceTimeline,
  type Timeline,
} from "./raytrace";
import {
  defaultScale,
  exportEncoding,
  exportTiming,
  largestScale,
  resolutionHelp,
} from "./export-quality";
import { canvasFits } from "./export-image";
import {
  asymptoteHelp,
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
import { Field, CheckSetting } from "./Field";
import { KeyViews, KeyViewEasing } from "./KeyViews";
import {
  easedPath,
  pathLeg,
  pathStyles,
  withEase,
  type PathStyle,
} from "./key-views";
import {
  asFirst,
  defaultPlanarPath,
  flightPieces,
  pieceAt,
  type Piece,
  describeKey,
  keyCamera,
  keyFromViewport,
  planarPathError,
  planarPathHelp,
  planarPathView,
  type Fit,
  type PlanarPath,
} from "./planar-path";
import { plainZoom, viewZoom } from "./refinement";
import type { PlotCamera } from "./planar-link";
import { tiered } from "./help";
import { useDisclosure } from "./useDisclosure";
import {
  compilePhrase,
  defaultPhrase,
  phraseAt,
  phraseError,
  phraseTargets,
  createPhraseSampler,
  type CompiledPhrase,
  type Phrase,
} from "./phrase";
import {
  PhraseEditor,
  phraseHelp,
  phraseProblemField,
  phrasePaceHelp,
} from "./PhraseEditor";

type Status =
  "idle" | "preparing" | "playing" | "paused" | "complete" | "exporting";
type Session = {
  phraseLabelInDrawing?: boolean;
  phrase?: CompiledPhrase;
  phraseSample?: ReturnType<typeof createPhraseSampler>;
  family?: PreparedFamily;
  owner?: string;
  original: Frame;
  first: Frame;
  final: Frame;
  tracks: NumericTrack[];
  mode: AnimationMode;
  // Present only while tracing rays.
  timeline?: Timeline;
  camera: CameraMode;
  heldView?: Viewport;
  // The view a study refined to its view is refined to, held with the
  // current view: every calculated frame is refined to it too.
  focus?: ViewRect;
  // Present only while flying a camera path: the path when playback began,
  // the study's fitted framing its views are taken about, whether each
  // frame is refined to its own view, and the study refined to no view,
  // which frames at the fitted zoom or wider draw.
  path?: PlanarPath;
  fit?: Fit;
  refine?: boolean;
  plain?: Frame;
  // The flight's pieces (planar-path.ts), each refined once when first
  // needed and kept for the session, playback and export alike.
  pieces?: Piece[];
  refined?: Map<number, Promise<Frame>>;
  duration: number;
  repeat: Repeat;
  pace: Pace;
  length: number;
  stop: boolean;
  // Where the timeline stands (timing.ts), from which the progress follows.
  progress: number;
  // The probe while it is on, which every animation draws, and how it
  // moves while the parameters vary.
  probe?: PlanarProbe;
  motion?: ProbeMotion;
  // The probe on the study as it begins, and whether it stands between
  // samples, where Go places it in each frame.
  point?: HeldProbe | null;
  between?: boolean;
};
// Whether the session's frames between its ends are calculated by an engine:
// parameter tracks other than the ray length, an iterated map's reveal, and
// a probe moved between samples. Every other frame is cut from the
// prepared study.
const calculates = (
  s: Pick<
    Session,
    "mode" | "tracks" | "original" | "between" | "refine" | "family"
  >,
) =>
  !s.family &&
  (s.mode === "phrase" ||
    (s.mode === "parameters" &&
      !s.tracks.every((t) => t.target === "rayLength")) ||
    (s.mode === "reveal" && !!s.original.result.attractor) ||
    (s.mode === "probe" && !!s.between) ||
    (s.mode === "path" && !!s.refine));
// Whether the session's frames come without calculating, so playback may
// aim for 60 a second: every mode but those calculate lists, and a flight,
// whose pieces are calculated once each, not every frame.
export const redraws = (
  s: Pick<
    Session,
    "mode" | "tracks" | "original" | "between" | "refine" | "family"
  >,
) => !calculates(s) || s.mode === "path";
type Props = {
  // Same controls and lifecycle, with a separately saved family setup.
  family?: FamilyComposition & {
    onAnimation: (patch: Partial<FamilyAnimation>) => void;
  };
  // Preserve the ordinary setup while its notebook shows a family.
  suspended?: boolean;
  // A journey offers only deliberate playback of its preset setup.
  preview?: boolean;
  frame: Frame | null;
  client: RefObject<EngineClient | null>;
  length: number;
  // Whether rays stop at their caustic points.
  stopAtCaustic: boolean;
  revision: string;
  disabled: boolean;
  dark: boolean;
  scheme?: ColorScheme;
  layers: Layers;
  weight: LineWeight;
  // The probe, when it is on (planar-probe.ts).
  probe: PlanarProbe | null;
  getCurrentView: () => Viewport | undefined;
  // What the study is refined to (see Plot's onFocus), or null.
  getFocus: () => ViewRect | null;
  // Whether the study is refined to its view, which lets a camera path zoom
  // to viewZoom and refines each frame to its own view.
  refineView: boolean;
  // Shows a key view: sets the drawing's manual camera.
  onShowCamera: (camera: PlotCamera) => void;
  onView: (view: AnimationView | null) => void;
  onRunning: (running: boolean) => void;
  // Called once playback shows its first frame, or resumes, so the drawing
  // can be shown; never for a start that is refused.
  onReveal: () => void;
  // The animation setup, kept current for a study link.
  settings?: { current: PlanarAnimation | null };
  onSettingsReady?: (ready: boolean) => void;
  // A setup from a study link, applied once per id. The notebook passes it
  // only once the frame belongs to the linked study, so neither its tracks
  // nor a trace mode is judged against the previous study.
  restore?: { id: number; settings: PlanarAnimation } | null;
};

export function AnimationPanel({
  family,
  suspended = false,
  preview = false,
  frame,
  client,
  length,
  stopAtCaustic,
  revision,
  disabled,
  dark,
  scheme = "default",
  layers,
  weight,
  probe,
  getCurrentView,
  getFocus,
  refineView,
  onShowCamera,
  onView,
  onRunning,
  onReveal,
  settings,
  onSettingsReady,
  restore,
}: Props) {
  const [ordinaryMode, setMode] = useState<AnimationMode>("reveal");
  const mode = family ? "reveal" : ordinaryMode;
  const [ordinaryCamera, setOrdinaryCamera] = useState<CameraMode>("hold");
  const [ordinaryDuration, setOrdinaryDuration] = useState(10);
  const [ordinaryRepeat, setOrdinaryRepeat] = useState<Repeat>("once");
  const [ordinaryPace, setOrdinaryPace] = useState<Pace>("steady");
  const familySetup = family
    ? (family.settings.animation ?? {
        ...defaultFamilyAnimation,
        width: Math.min(3, family.settings.count),
      })
    : undefined;
  const camera = familySetup?.camera ?? ordinaryCamera;
  const simpleDuration = familySetup?.duration ?? ordinaryDuration;
  const repeat = familySetup?.repeat ?? ordinaryRepeat;
  const pace = familySetup?.pace ?? ordinaryPace;
  const setCamera = (value: CameraMode) =>
    family
      ? (value === "hold" || value === "current") &&
        family.onAnimation({ camera: value })
      : setOrdinaryCamera(value);
  const setDuration = (value: number) =>
    family
      ? family.onAnimation({ duration: value })
      : setOrdinaryDuration(value);
  const setRepeat = (value: Repeat) =>
    family
      ? value !== "loop" && family.onAnimation({ repeat: value })
      : setOrdinaryRepeat(value);
  const setPace = (value: Pace) =>
    family ? family.onAnimation({ pace: value }) : setOrdinaryPace(value);
  const [tracks, setTracks] = useState<Track[]>([]);
  const [phrase, setPhrase] = useState<Phrase | undefined>();
  const [phraseLabelInDrawing, setPhraseLabelInDrawing] = useState(false);
  const phraseDraft =
    phrase ?? (frame ? defaultPhrase(frame.config, length) : undefined);
  const duration =
    mode === "phrase" && phraseDraft
      ? phraseDraft.phases.reduce((sum, p) => sum + p.duration, 0)
      : simpleDuration;
  const phraseSignature = JSON.stringify([phraseDraft, frame?.config, length]);
  const [resolvedPhrase, setResolvedPhrase] = useState<{
    signature: string;
    compiled?: CompiledPhrase;
    error?: string;
  }>({ signature: "" });
  // A changed duration, pace or layer cannot fix an endpoint Go refused.
  // Retain that refusal until its numerical input or study actually changes.
  const [numericalRefusal, setNumericalRefusal] = useState<{
    config: string;
    target: Target;
    phase: number;
    key: string;
    message: string;
  } | null>(null);
  const knownRefusal =
    numericalRefusal &&
    numericalRefusal.config === JSON.stringify(frame?.config) &&
    numericalRefusal.target === phraseDraft?.target &&
    numericalRefusal.key === phraseDraft?.phases[numericalRefusal.phase]?.key
      ? numericalRefusal.message
      : undefined;
  const phraseReady =
    mode !== "phrase" ||
    (!knownRefusal &&
      resolvedPhrase.signature === phraseSignature &&
      !!resolvedPhrase.compiled);
  const phraseProblem =
    mode === "phrase"
      ? (knownRefusal ??
        (resolvedPhrase.signature === phraseSignature
          ? resolvedPhrase.error
          : undefined))
      : undefined;
  useEffect(() => {
    if (mode !== "phrase" || !frame || !phraseDraft || !client.current) return;
    let current = true;
    const error = phraseError(frame.config, phraseDraft);
    if (error) {
      setResolvedPhrase({ signature: phraseSignature, error });
      return;
    }
    const keys = phraseDraft.phases.flatMap((p, i) =>
      p.key === undefined ? [] : [{ text: p.key, index: i }],
    );
    void Promise.all(
      keys.map(async (key) => {
        try {
          return (await client.current!.scalars([key.text]))[0];
        } catch (error) {
          throw new Error(
            `Phase ${key.index + 1} key: ${error instanceof Error ? error.message : error}`,
          );
        }
      }),
    )
      .then((values) => {
        if (current)
          setResolvedPhrase({
            signature: phraseSignature,
            compiled: compilePhrase(
              frame.config,
              layers,
              length,
              phraseDraft,
              values,
            ),
          });
      })
      .catch((error) => {
        if (current)
          setResolvedPhrase({
            signature: phraseSignature,
            error: error.message,
          });
      });
    return () => {
      current = false;
    };
  }, [mode, phraseSignature, layers]);
  useEffect(() => {
    onSettingsReady?.(phraseReady);
  }, [phraseReady, onSettingsReady]);
  const [probeMotion, setProbeMotion] = useState<ProbeMotion>("stays");
  const [path, setPath] = useState<PlanarPath>(defaultPlanarPath);
  const [status, setStatus] = useState<Status>("idle");
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState("");
  const [live, setLive] = useState("");
  const section = useDisclosure("animation", true);
  const exportSection = useDisclosure("export");
  const [fps, setFPS] = useState(30);
  const [loop, setLoop] = useState(false);
  const [scaleChoice, setExportScale] = useState(defaultScale);
  // Only resolutions this device draws are offered; a larger choice waits.
  const topScale = useMemo(() => largestScale(canvasFits), []);
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
  const lastView = useRef<AnimationView | null>(null);
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
  if (settings && !family)
    settings.current = {
      mode,
      camera,
      duration,
      tracks,
      repeat,
      pace,
      probeMotion,
      // A link records a path only where there is one.
      ...(path.keys.length > 0 && { path }),
      ...(phraseDraft && mode === "phrase" && { phrase: phraseDraft }),
      ...(mode === "phrase" &&
        phraseLabelInDrawing && { phraseLabelInDrawing: true }),
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
    setPath(restore.settings.path ?? defaultPlanarPath);
    setPhrase(restore.settings.phrase);
    setPhraseLabelInDrawing(restore.settings.phraseLabelInDrawing ?? false);
    setNumericalRefusal(null);
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
    lastView.current = null;
    onView(null);
    changeStatus("idle");
    setProgress(0);
    setLive("");
    setError("");
    setExportNotice("");
  };
  function changePhraseCaption(inDrawing: boolean) {
    setPhraseLabelInDrawing(inDrawing);
    if (status === "preparing" || status === "exporting") {
      stop();
      return;
    }
    const s = session.current;
    if (!s?.phrase) return;
    s.phraseLabelInDrawing = inDrawing;
    const shown = lastView.current;
    if (shown?.phrase) {
      const view = { ...shown, phrase: { ...shown.phrase, inDrawing } };
      lastView.current = view;
      onView(view);
    }
  }
  useEffect(() => {
    stop();
  }, [revision]);
  // A phrase compiles its layer events from the entry study. Editing those
  // layers starts a new study presentation rather than showing stale events.
  useEffect(() => {
    if (session.current?.phrase) stop();
  }, [layers]);
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
    if (next === "phrase") {
      if (!phrase && frame) setPhrase(defaultPhrase(frame.config, length));
      if (camera !== "current") setCamera("hold");
      setPace("ease");
    }
  }
  // The frame at a time on the timeline, drawn at the progress the repeat
  // and pace give it (timing.ts).
  async function sample(
    s: Session,
    time: number,
    engine = client.current!,
  ): Promise<AnimationView> {
    if (s.family)
      return sampleFamily(
        s.family,
        s.original,
        time,
        s.length,
        s.stop,
        s.owner!,
      );
    return {
      ...(await frameAt(
        s,
        progressAt(time, s.repeat, s.phrase ? "steady" : s.pace),
        engine,
      )),
      time,
      complete: s.repeat === "once" && time === 1,
    };
  }
  async function frameAt(
    s: Session,
    p: number,
    engine = client.current!,
  ): Promise<AnimationView> {
    if (s.phrase) {
      const view = await s.phraseSample!(p * s.phrase.duration, engine);
      return s.phraseLabelInDrawing
        ? { ...view, phrase: { ...view.phrase!, inDrawing: true } }
        : view;
    }
    const values = applyTracks(s.original.config, s.tracks, p, s.length);
    let current: Frame;
    let held: HeldProbe | number | string | null | undefined;
    // A camera path's view at p, which a study refined to its view is
    // refined to once it zooms in, as the manual camera's is.
    const flown =
      s.mode === "path"
        ? planarPathView(s.path!, s.fit!, p, s.repeat === "loop")
        : undefined;
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
    else if (flown)
      current =
        s.refine && flown.scale > s.fit!.scale
          ? await piece(s, pieceAt(s.pieces!, p), engine)
          : s.plain!;
    else if (
      s.mode === "parameters" &&
      s.between &&
      s.probe &&
      !fixedParameters(s)
    ) {
      // Between samples, each frame's probe is placed by Go with the frame
      // itself, the ends included.
      const query = heldQuery(s, values.config, p);
      current = await engine.compute(values.config, undefined, {
        diagnostics: true,
        ...(typeof query !== "string" && { probe: query }),
        ...(s.focus && { view: s.focus }),
      });
      held =
        typeof query === "string"
          ? query
          : "share" in query &&
              !(drawnLength(current.result.diagnostics!.length) > 0)
            ? noLength
            : current.result.probe!;
    } else if (p === 0) current = s.first;
    else if (p === 1) current = s.final;
    else if (fixedParameters(s)) current = s.original;
    else
      current = await engine.compute(values.config, undefined, {
        diagnostics: !!s.probe,
        ...(s.focus && { view: s.focus }),
      });
    // The probe moves along the fixed study, from the start of the domain
    // to its end, exactly: one sample at a time, or between them. While the
    // parameters vary it stands on each frame's own diagnostics, or is
    // absent from it with a reason. Otherwise the study is fixed and the
    // probe stays where it was put.
    if (held === undefined)
      held =
        s.mode === "probe" && s.between
          ? await engine.probe(s.original.config, {
              t: parameterAt(
                s.original.config.curve.min,
                s.original.config.curve.max,
                p,
              ),
            })
          : s.mode === "probe"
            ? probeIndex(p, s.original.result.diagnostics!.curvature.length - 1)
            : s.mode === "parameters" && s.probe && s.between
              ? await heldOnFixed(s, values.config, p, engine)
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
                : s.probe
                  ? fixedProbe(s, p)
                  : null;
    if (typeof held === "number")
      held = sampleProbe(current.result, held) ?? undefined;
    return {
      frame: current,
      final: s.final,
      ...(flown
        ? { camera: "current" as const, heldView: flown }
        : { camera: s.camera, heldView: s.heldView }),
      length: s.mode === "parameters" ? values.length : s.length,
      stop: s.stop,
      progress: p,
      mode: s.mode,
      complete: p === 1,
      ...(held && typeof held === "object" && { probe: held }),
      ...(typeof held === "string" && { probeAway: held }),
    };
  }
  // A flight's piece k, refined once to its area: started when first
  // needed, with the pieces either side, so the next is ready when the
  // flight reaches it, whichever way it is going.
  function piece(s: Session, k: number, engine: EngineClient) {
    const start = (j: number) => {
      if (j < 0 || j >= s.pieces!.length || s.refined!.has(j)) return;
      const refined = engine.compute(s.original.config, undefined, {
        diagnostics: !!s.probe,
        view: s.pieces![j].view,
      });
      s.refined!.set(j, refined);
      // A failed piece is tried again when a frame next needs it.
      refined.catch(() => s.refined!.delete(j));
    };
    start(k);
    const needed = s.refined!.get(k)!;
    start(k + 1);
    start(k - 1);
    return needed;
  }
  // Ray-length tracks keep the study fixed.
  const fixedParameters = (s: Session) =>
    s.tracks.every((t) => t.target === "rayLength");
  // Where Go is to place a probe between samples in a frame whose study is
  // config, at progress p: at its own t, the same share of the drawn
  // length, or along the domain; or why it has no place there.
  function heldQuery(
    s: Session,
    config: Config,
    p: number,
  ): ProbeQuery | string {
    const { min, max } = config.curve;
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
  // A probe between samples held over a study that the parameters leave
  // fixed.
  async function heldOnFixed(
    s: Session,
    config: Config,
    p: number,
    engine: EngineClient,
  ) {
    const query = heldQuery(s, config, p);
    return typeof query === "string"
      ? query
      : engine.probe(s.original.config, query);
  }
  // The probe in an animation that keeps the study fixed: where the user
  // put it, once a reveal has drawn it. A probe on a sample is drawn from
  // the frame's own samples, so traced light reaches its construction as it
  // reaches the sample's; between samples, light reaches its construction
  // when it reaches the samples on either side, at the arrival interpolated
  // between them.
  function fixedProbe(
    s: Session,
    p: number,
  ): HeldProbe | number | string | null {
    const at = s.point;
    if (!at) return null;
    const step = at.sample ?? probeStep(s.original.result, at);
    if (s.mode === "reveal" && step > revealedThrough(s.original.result, p))
      return unreached;
    if (at.sample !== undefined) return at.sample;
    if (s.mode === "trace" && !arrived(s.timeline!, step, p))
      return { ...at, derived: null };
    return at;
  }
  function arrived(timeline: Timeline, step: number, p: number) {
    const arrival = arrivalAt(timeline, step);
    return Number.isFinite(arrival) && arrival <= tauAt(timeline, p);
  }
  function display(s: Session, view: AnimationView) {
    s.progress = view.time ?? view.progress;
    setProgress(s.progress);
    lastView.current = view;
    onView(view);
    if (view.family)
      setLive(
        `${familyMotionMembers(view.family.members, view.family.motion!).length} / ${view.family.members.length} members · selected ${view.family.settings.selected + 1}`,
      );
    else if (view.phrase)
      setLive(
        `${view.phrase.phase} · ${targetLabel(s.phrase!.target)} = ${targetValue(view.frame.config, s.phrase!.target, view.length).toPrecision(6)}`,
      );
    else if (s.mode === "reveal" && view.frame.result.attractor)
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
    else if (s.mode === "path") setLive(pathLeg(s.path!, view.progress));
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
    return view.probe
      ? `Probe at t = ${Number(probeReadout(view.probe).t.toPrecision(6))}`
      : "";
  }
  function fail(reason: unknown, what = "Animation") {
    cancel();
    session.current = null;
    lastView.current = null;
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
      redraw: redraws(s),
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
    cancel();
    const token = epoch.current;
    setError("");
    setExportNotice("");
    changeStatus("preparing");
    // A camera path is the camera itself.
    const holds = mode !== "path" && camera === "current";
    const heldView = holds ? getCurrentView() : undefined;
    // Frames held at the current view are refined to it, as the study is.
    const focus = (holds && getFocus()) || undefined;
    const view = focus && { view: focus };
    try {
      if (
        mode !== "phrase" &&
        (!Number.isFinite(duration) || duration < 0.1 || duration > 3600)
      )
        throw new Error("Duration must be between 0.1 and 3600 seconds.");
      if (holds && !heldView)
        throw new Error("The current view is not ready yet.");
      if (save)
        exportTiming(
          mode === "phrase" ? resolvedPhrase.compiled!.duration : duration,
          fps,
        );
      if (family && familySetup) {
        if (
          !Number.isInteger(familySetup.width) ||
          familySetup.width < 1 ||
          familySetup.width > family.settings.count
        )
          throw new Error(
            "Window members must be a whole number within the family.",
          );
        const fitted = atlasSharedFrame(family.members);
        if (!fitted) throw new Error("No family members are available.");
        const s: Session = {
          original: frame,
          first: frame,
          final: frame,
          tracks: [],
          mode: "reveal",
          camera,
          duration,
          repeat,
          pace,
          length,
          stop: stopAtCaustic,
          progress: 0,
          owner: revision,
          family: {
            settings: structuredClone(family.settings),
            members: family.members,
            setup: { ...familySetup },
            view: heldView ?? fitted,
          },
        };
        await launch(s, save, token);
        return;
      }
      if (mode === "phrase") {
        if (!phraseReady || !resolvedPhrase.compiled)
          throw new Error(
            phraseProblem ?? "Phrase keys are still being evaluated.",
          );
        const compiled = compilePhrase(
          frame.config,
          layers,
          length,
          phraseDraft!,
          resolvedPhrase.compiled.phases
            .filter((_, i) => phraseDraft!.phases[i].key !== undefined)
            .map((p) => p.to.value),
        );
        // Validate each explicit key through the engine, without retaining a
        // movie or even a geometry collection proportional to the phase count.
        for (const [i, phase] of compiled.phases.entries()) {
          if (
            compiled.target === "rayLength" ||
            phase.from.value === phase.to.value ||
            phase.to.value ===
              targetValue(frame.config, compiled.target, length)
          )
            continue;
          try {
            await client.current.compute(
              phraseAt(compiled, phase.end).config,
              undefined,
              { ...(view ?? {}), diagnostics: !!probe },
            );
          } catch (reason) {
            if (epoch.current !== token) return;
            if (!(reason instanceof EngineError)) throw reason;
            cancel();
            session.current = null;
            onView(null);
            changeStatus("idle");
            setProgress(0);
            setError("");
            setNumericalRefusal({
              config: JSON.stringify(frame.config),
              target: compiled.target,
              phase: i,
              key: phraseDraft!.phases[i].key!,
              message: `Phase ${i + 1} key: ${reason.message}`,
            });
            return;
          }
          if (epoch.current !== token) return;
        }
        const s: Session = {
          original: frame,
          first: frame,
          final: frame,
          tracks: [],
          mode,
          phrase: compiled,
          phraseLabelInDrawing,
          phraseSample: createPhraseSampler({
            phrase: compiled,
            original: frame,
            view: heldView ?? fitFrame(frame.result, frame.config),
            stop: stopAtCaustic,
            focus,
            probe: probe ?? undefined,
          }),
          camera: "current",
          heldView: heldView ?? fitFrame(frame.result, frame.config),
          focus,
          duration: compiled.duration,
          repeat,
          pace: "steady",
          length,
          stop: stopAtCaustic,
          progress: 0,
          probe: probe ?? undefined,
        };
        await launch(s, save, token);
        return;
      }
      // The probe moves along the curve, is held while the parameters
      // vary, or stays at its sample of the fixed study, on the diagnostics
      // of the study as it begins.
      const drawsProbe = !!probe;
      const between = drawsProbe && probeBetween(frame.config, probe!);
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
          calculates({ mode, tracks: numeric, original: frame, between }) &&
          playbackEngineCount() > 1
        )
          helper.current = new EngineClient();
        const results = await Promise.all([
          client.current
            .compute(
              applyTracks(frame.config, numeric, 0, length).config,
              undefined,
              { diagnostics: drawsProbe, ...view },
            )
            .catch((reason) => {
              throw new Error(`At animation start: ${reason.message}`);
            }),
          (helper.current ?? client.current)
            .compute(
              applyTracks(frame.config, numeric, 1, length).config,
              undefined,
              { diagnostics: drawsProbe, ...view },
            )
            .catch((reason) => {
              throw new Error(`At animation end: ${reason.message}`);
            }),
        ]);
        [first, final] = results;
      }
      if (epoch.current !== token) return;
      // A camera path flies about the study's fitted framing, its frames
      // refined each to its own view, or drawn from the study refined to
      // none.
      let flight: Pick<
        Session,
        "path" | "fit" | "refine" | "plain" | "pieces" | "refined"
      > = {};
      if (mode === "path") {
        const refused = planarPathError(
          path,
          refineView ? viewZoom : plainZoom,
        );
        if (refused) throw new Error(`${refused.field} ${refused.message}`);
        const fit = fitFrame(frame.result, frame.config);
        flight = {
          path: structuredClone(path),
          fit,
          refine: refineView,
          pieces: refineView
            ? flightPieces(path, fit, repeat === "loop", viewRect)
            : [],
          refined: new Map(),
          plain:
            refineView && getFocus()
              ? await client.current.compute(frame.config, undefined, {
                  diagnostics: drawsProbe,
                })
              : frame,
        };
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
              stopAtCaustic,
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
        focus,
        ...flight,
        duration,
        repeat,
        pace,
        length,
        stop: stopAtCaustic,
        progress: 0,
        probe: drawsProbe ? probe! : undefined,
        motion: probeMotion,
        between,
        point: !drawsProbe
          ? undefined
          : between
            ? await client.current.probe(frame.config, {
                t: parameterAt(
                  frame.config.curve.min,
                  frame.config.curve.max,
                  probe!.position,
                ),
              })
            : sampleProbe(
                frame.result,
                probeIndex(
                  probe!.position,
                  frame.result.diagnostics!.curvature.length - 1,
                ),
              ),
      };
      await launch(s, save, token);
    } catch (error) {
      if (epoch.current === token) fail(error, save ? "Export" : "Animation");
    }
  }
  async function launch(s: Session, save: boolean, token: number) {
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
      const engines = [client.current!, ...extras];
      let next = 0;
      const blob = await exportAnimation({
        format: chosen,
        duration: s.duration,
        fps: fps,
        loop: chosen === "webp" && (loop || cycles(repeat)),
        cyclic: cycles(repeat),
        settings: { scale: exportScale, quality },
        dark,
        scheme,
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
        `tangent-garden-${studyName(s.original.config)}-${s.family ? "family-" + s.family.setup.mode : s.mode}.${text.extension}`,
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
    onReveal();
    schedule(s, 0);
  }
  // A click can reach Pause after playback ended, before Replay is drawn
  // in its place; the animation stays complete.
  function pause() {
    if (!playing.current) return;
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
  if (suspended) return null;
  return (
    <section className="animation-section">
      <details
        id={preview ? undefined : "animation-section"}
        {...(preview ? { open: true } : section)}
      >
        <summary
          hidden={preview}
          className="section-label"
          onClick={(e) => {
            // Keep playback controls reachable until the animation is stopped.
            if (active) e.preventDefault();
          }}
        >
          ANIMATION
        </summary>
        <fieldset
          hidden={preview}
          disabled={
            mode === "phrase"
              ? disabled
              : running || status === "paused" || disabled
          }
          onChangeCapture={(event) => {
            if (
              (event.target as HTMLElement).closest(
                "[data-phrase-presentation]",
              )
            )
              return;
            if (mode === "phrase") setError("");
            if (status === "complete" || (mode === "phrase" && active)) stop();
          }}
        >
          <Field
            label="Animate"
            topic="animation modes"
            help={
              familySetup
                ? familyMotionHelp[familySetup.mode]
                : mode === "phrase"
                  ? phraseHelp
                  : mode === "path"
                    ? planarPathHelp.mode
                    : mode === "probe"
                      ? probe && frame && probeBetween(frame.config, probe)
                        ? "Move the probe from start to end through every t. The geometry stays fixed."
                        : "Move the probe from start to end, sample by sample. The geometry stays fixed."
                      : mode === "trace"
                        ? tiered(
                            "Send light from the source; each caustic point appears as its ray reaches it.",
                            "Parallel light comes in from the edge of the view. Light slows to c/n in each medium, so wavefronts stay together.",
                          )
                        : mode === "reveal"
                          ? iterated
                            ? "Count the iterates in order, in the finished drawing's window and grid."
                            : tiered(
                                "Draw the study from its domain start to its end.",
                                "Each frame keeps the finished drawing's sample spacing and arc-length anchor.",
                              )
                          : tiered(
                              <>
                                Tracks vary together, linearly. Use <var>a</var>{" "}
                                in a curve expression to animate any
                                coefficient.
                              </>,
                              <>
                                For example,{" "}
                                <code>
                                  <var>a</var>*cos(t)
                                </code>
                                . Counts change in whole steps. Endpoints accept
                                constants such as pi.
                              </>,
                            )
            }
          >
            <select
              value={familySetup?.mode ?? mode}
              onChange={(e) =>
                family
                  ? family.onAnimation({
                      mode: e.target.value as FamilyAnimation["mode"],
                    })
                  : parameterMode(e.target.value as typeof mode)
              }
            >
              {family ? (
                <>
                  <option value="reveal">Reveal member by member</option>
                  <option value="window">Moving band</option>
                </>
              ) : (
                <>
                  <option value="reveal">
                    {iterated
                      ? "Accumulate the iterates"
                      : "Draw along the curve"}
                  </option>
                  <option value="parameters">Vary parameters</option>
                  {!!frame && phraseTargets(frame.config).length > 0 && (
                    <option value="phrase">Play a phrase</option>
                  )}
                  {traceable && <option value="trace">Trace rays</option>}
                  {probe && (
                    <option value="probe">
                      Move the probe along the curve
                    </option>
                  )}
                  <option value="path">Fly through key views</option>
                </>
              )}
            </select>
          </Field>
          {mode === "phrase" && (
            <div data-phrase-presentation="true">
              <CheckSetting
                label="Stage label in drawing"
                topic="stage label in drawing"
                checked={phraseLabelInDrawing}
                onChange={changePhraseCaption}
                help={tiered(
                  "Move the stage and parameter caption into the drawing.",
                  "Included in SVG, PNG and motion exports. Off by default; otherwise the caption sits below the viewport on desktop and mobile. Changing placement keeps playback and paused frames intact, and cancels an export already in progress.",
                )}
              />
            </div>
          )}
          {mode === "phrase" && phraseDraft && frame && (
            <PhraseEditor
              phrase={phraseDraft}
              problem={phraseProblem}
              targets={phraseTargets(frame.config)}
              onChange={(next) =>
                setPhrase((previous) => {
                  const before = previous ?? phraseDraft!;
                  if (next.target === before.target || !frame) return next;
                  const value = String(
                    targetValue(frame.config, next.target, length),
                  );
                  return {
                    ...next,
                    phases: next.phases.map((p) =>
                      p.key === undefined ? p : { ...p, key: value },
                    ),
                  };
                })
              }
            />
          )}
          {family && familySetup?.mode === "window" && (
            <Field label="Window members" help={familyMotionHelp.width}>
              <input
                type="number"
                min="1"
                max={family.settings.count}
                step="1"
                value={Number.isNaN(familySetup.width) ? "" : familySetup.width}
                onChange={(e) =>
                  family.onAnimation({ width: e.target.valueAsNumber })
                }
              />
            </Field>
          )}
          {mode === "path" && (
            <>
              <Field
                label="Path"
                help={
                  path.ease
                    ? easedPath(
                        path.style === "smooth"
                          ? planarPathHelp.smooth
                          : planarPathHelp.steady,
                        path.easingFactor,
                      )
                    : path.style === "smooth"
                      ? planarPathHelp.smooth
                      : planarPathHelp.steady
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
              <KeyViewEasing
                checked={path.ease ?? false}
                onChange={(ease) => setPath((p) => withEase(p, ease))}
                factor={path.easingFactor}
                onFactorChange={(easingFactor) =>
                  setPath((p) => ({ ...p, easingFactor }))
                }
              />
              <KeyViews
                keys={path.keys}
                onChange={(change) =>
                  setPath((p) => ({ ...p, keys: change(p.keys) }))
                }
                asFirst={asFirst}
                describe={describeKey}
                drawn={() => {
                  const view = getCurrentView();
                  return frame && view
                    ? keyFromViewport(
                        view,
                        fitFrame(frame.result, frame.config),
                      )
                    : null;
                }}
                onShow={(key) => {
                  if (!frame) return;
                  if (status === "complete") stop();
                  onShowCamera(
                    keyCamera(key, fitFrame(frame.result, frame.config)),
                  );
                }}
                help={planarPathHelp.keys}
                loop={repeat === "loop"}
              />
            </>
          )}
          {mode === "parameters" && probe && (
            <Field
              label="Probe"
              help={
                frame && probeBetween(frame.config, probe)
                  ? betweenMotionHelp
                  : curveProbeMotionHelp
              }
            >
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
          {mode !== "phrase" && (
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
          )}
          <div className="pair">
            <Field label="Repeat" help={repeatHelp[repeat]}>
              <select
                value={repeat}
                onChange={(e) => setRepeat(e.target.value as Repeat)}
              >
                {repeatChoices
                  .filter((c) => c.value !== "loop" || (!family && loops(mode)))
                  .map((c) => (
                    <option key={c.value} value={c.value}>
                      {c.label}
                    </option>
                  ))}
              </select>
            </Field>
            <Field
              label="Pace"
              help={mode === "phrase" ? phrasePaceHelp : paceHelp[pace]}
            >
              <select
                value={pace}
                onChange={(e) => {
                  const pace = e.target.value as Pace;
                  setPace(pace);
                  if (mode === "phrase" && phraseDraft)
                    setPhrase({
                      ...phraseDraft,
                      phases: phraseDraft.phases.map((p) => ({ ...p, pace })),
                    });
                }}
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
                camera === "current"
                  ? "Keeps your current pan and zoom throughout, including export."
                  : camera === "hold"
                    ? family
                      ? "Frames the complete family once and holds that view."
                      : mode === "phrase"
                        ? "Frames the entry study once and holds that view."
                        : "Frames the final result once and holds that view."
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
                <option value="hold">
                  {mode === "phrase" ? "Hold entry view" : "Hold final view"}
                </option>
                <option value="current">Hold current view</option>
                {!family && mode !== "trace" && mode !== "phrase" && (
                  <>
                    <option value="follow">Follow center, fixed zoom</option>
                    <option value="fit">Fit each frame</option>
                  </>
                )}
              </select>
            </Field>
          )}
          <details
            id={preview ? undefined : "export-settings"}
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
          id={preview ? undefined : "playback"}
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
                  onReveal();
                  schedule(session.current, progress);
                }}
              >
                Resume
              </button>
            ) : (
              <button
                className="export"
                disabled={disabled || running || !frame || !phraseReady}
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
          {(active || preview) && (
            <div className="timeline">
              <Field
                label="Animation progress"
                value={`${Math.round(progress * 100)}%`}
              >
                <ProgressSlider
                  progress={progress}
                  disabled={running || !active || (preview && disabled)}
                  onSeek={(p) => void seek(p)}
                />
              </Field>
              <div className="note" role="status" aria-live="off">
                {preview && status === "idle"
                  ? "Ready to play"
                  : status === "exporting"
                    ? `Exporting ${text.short}…`
                    : status === "complete"
                      ? "Complete"
                      : status === "paused"
                        ? "Paused"
                        : status === "preparing"
                          ? "Preparing"
                          : `${(progress * duration).toFixed(1)} / ${duration} s`}
              </div>
              {!preview && (mode !== "phrase" || status === "exporting") && (
                <AnimationValues text={live} />
              )}
              <p className="note playback-tip" hidden={preview}>
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
          hidden={preview}
          className="animation-export"
          disabled={
            disabled || running || !frame || !exportReady || !phraseReady
          }
          onClick={() => void start(true)}
        >
          Export {text.name} ↗
        </button>
        {!preview && exportHint && <p className="hint">{exportHint}</p>}
        {!preview && exportNotice && (
          <p className="note" role="status">
            {exportNotice}
          </p>
        )}
        {(error || (phraseProblem && !phraseProblemField(phraseProblem))) && (
          <p className="animation-error" role="alert">
            {phraseProblem || error}
          </p>
        )}
      </details>
    </section>
  );
}
