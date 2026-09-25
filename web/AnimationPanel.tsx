import { useEffect, useRef, useState, type RefObject } from "react";
import { EngineClient, exportEngineCount } from "./engine-client";
import {
  applyTracks,
  availableTargets,
  reveal,
  targetLabels,
  targetValue,
  type AnimationView,
  type CameraMode,
  type NumericTrack,
  type Target,
  type Track,
  type Viewport,
} from "./animation";
import type { Frame } from "./types";
import type { Layers } from "./Plot";
import { defaultScale, exportEncoding, exportTiming } from "./export-quality";
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
  mode: "reveal" | "parameters";
  camera: CameraMode;
  heldView?: Viewport;
  duration: number;
  length: number;
  progress: number;
};
type Props = {
  frame: Frame | null;
  client: RefObject<EngineClient | null>;
  length: number;
  revision: string;
  disabled: boolean;
  dark: boolean;
  layers: Layers;
  getCurrentView: () => Viewport | undefined;
  onView: (view: AnimationView | null) => void;
  onRunning: (running: boolean) => void;
  // Called when playback starts or resumes, so the drawing can be shown.
  onPlay: () => void;
};

export function AnimationPanel({
  frame,
  client,
  length,
  revision,
  disabled,
  dark,
  layers,
  getCurrentView,
  onView,
  onRunning,
  onPlay,
}: Props) {
  const [mode, setMode] = useState<"reveal" | "parameters">("reveal");
  const [camera, setCamera] = useState<CameraMode>("hold");
  const [duration, setDuration] = useState(10);
  const [tracks, setTracks] = useState<Track[]>([]);
  const [status, setStatus] = useState<Status>("idle");
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState("");
  const [live, setLive] = useState("");
  const section = useDisclosure("animation");
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
  // Animated WebP stops at 30 fps; the MP4 choice is kept for switching back.
  const exportFps = chosen === "webp" && fps === 60 ? 30 : fps;
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
    raf = useRef(0),
    session = useRef<Session | null>(null);
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
  const running =
    status === "playing" || status === "preparing" || status === "exporting";
  const active = status !== "idle";
  const changeStatus = (next: Status) => {
    setStatus(next);
    onRunning(
      next === "playing" || next === "preparing" || next === "exporting",
    );
  };
  const cancel = () => {
    epoch.current++;
    seekTarget.current = null;
    cancelAnimationFrame(raf.current);
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
      cancelAnimationFrame(raf.current);
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
          : target === "angle"
            ? from + 360
            : target === "samples"
              ? Math.min(32768, Math.max(64, from * 2))
              : target === "lines"
                ? Math.min(2048, frame?.config.samples ?? 2048, from + 20)
                : target === "rayLength"
                  ? from * 1.5
                  : target === "nIncident" || target === "nTransmitted"
                    ? 1.5
                    : from + 1;
    return { target, from: String(from), to: String(to) };
  }
  function parameterMode(next: "reveal" | "parameters") {
    setMode(next);
    if (next === "parameters" && !tracks.length && targets.length)
      setTracks([defaultTrack(targets[0])]);
  }
  async function sample(
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
    else if (p === 0) current = s.first;
    else if (p === 1) current = s.final;
    else if (s.tracks.every((t) => t.target === "rayLength"))
      current = s.original;
    else current = await engine.compute(values.config);
    return {
      frame: current,
      final: s.final,
      camera: s.camera,
      heldView: s.heldView,
      length: s.mode === "reveal" ? s.length : values.length,
      progress: p,
      mode: s.mode,
    };
  }
  function display(s: Session, view: AnimationView) {
    s.progress = view.progress;
    setProgress(view.progress);
    onView(view);
    if (s.mode === "reveal")
      setLive(
        `t = ${(s.original.config.curve.min + (s.original.config.curve.max - s.original.config.curve.min) * view.progress).toPrecision(6)}`,
      );
    else
      setLive(
        s.tracks
          .map(
            (t) =>
              `${targetLabels[t.target]} = ${targetValue(view.frame.config, t.target, view.length).toPrecision(6)}`,
          )
          .join(" · "),
      );
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
    cancel();
    const token = epoch.current;
    const began = performance.now();
    let last = -Infinity;
    changeStatus("playing");
    const tick = async (now: number) => {
      if (epoch.current !== token) return;
      if (now - last < 1000 / 30) {
        raf.current = requestAnimationFrame(tick);
        return;
      }
      last = now;
      const p = Math.min(1, from + (now - began) / (s.duration * 1000));
      try {
        // At most one calculation is in flight. Slow devices skip intermediate
        // times instead of queuing work or lengthening a 30-second animation.
        const view = await sample(s, p);
        if (epoch.current !== token) return;
        display(s, view);
        if (p === 1) {
          changeStatus("complete");
          return;
        }
        raf.current = requestAnimationFrame(tick);
      } catch (error) {
        if (epoch.current === token) fail(error);
      }
    };
    raf.current = requestAnimationFrame(tick);
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
            (t.target === "samples" || t.target === "lines") &&
            (!Number.isInteger(t.from) || !Number.isInteger(t.to))
          )
            throw new Error("Sample and line endpoints must be whole numbers.");
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
        const results = await Promise.all([
          client.current
            .compute(applyTracks(frame.config, numeric, 0, length).config)
            .catch((reason) => {
              throw new Error(`At animation start: ${reason.message}`);
            }),
          client.current
            .compute(applyTracks(frame.config, numeric, 1, length).config)
            .catch((reason) => {
              throw new Error(`At animation end: ${reason.message}`);
            }),
        ]);
        [first, final] = results;
      }
      if (epoch.current !== token) return;
      const s: Session = {
        original: frame,
        first,
        final,
        tracks: numeric,
        mode,
        camera,
        heldView,
        duration,
        length,
        progress: 0,
      };
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
        const computes =
          mode === "parameters" &&
          !numeric.every((t) => t.target === "rayLength");
        const extras = Array.from(
          { length: computes ? exportEngineCount() - 1 : 0 },
          () => new EngineClient(),
        );
        const release = () => extras.forEach((engine) => engine.dispose());
        controller.signal.addEventListener("abort", release);
        const engines = [client.current, ...extras];
        let next = 0;
        const blob = await exportAnimation({
          format: chosen,
          duration,
          fps: exportFps,
          loop: chosen === "webp" && loop,
          settings: { scale: exportScale, quality },
          dark,
          layers: { ...layers },
          signal: controller.signal,
          lookahead: engines.length + 1,
          sample: (p) => sample(s, p, engines[next++ % engines.length]),
          onProgress: (completed, total) => {
            if (epoch.current !== token) return;
            setProgress(completed / total);
            setLive(`Rendering frame ${completed} of ${total}`);
          },
        }).finally(release);
        if (epoch.current !== token) return;
        saveFile(
          blob,
          `tangent-garden-${frame.config.kind}-${mode}.${text.extension}`,
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
        changeStatus(p === 1 ? "complete" : "paused");
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
              mode === "reveal" ? (
                "Reveal the full study from its domain start to its end. The arc-length anchor and final sample spacing stay fixed."
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
              <option value="reveal">Draw along the curve</option>
              <option value="parameters">Vary parameters</option>
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
                            {targetLabels[target]}
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
              <option value="follow">Follow center, fixed zoom</option>
              <option value="fit">Fit each frame</option>
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
            {chosen === "webp" ? (
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
              Reset export settings to 1000 × 760 · quality{" "}
              {defaultQuality[chosen]}
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
                  ? "Reset view"
                  : "Stop"}
            </button>
          </div>
          {active && (
            <div className="timeline">
              <Field
                label="Animation progress"
                value={`${Math.round(progress * 100)}%`}
              >
                <input
                  aria-label="Animation progress"
                  type="range"
                  min="0"
                  max="1"
                  step=".001"
                  value={progress}
                  disabled={running}
                  onChange={(e) => void seek(+e.target.value)}
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
                    ? "Scrub the timeline or export this frame as SVG. Reset view restores your study and manual view."
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
