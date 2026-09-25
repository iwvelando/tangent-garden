import { useEffect, useRef, useState, type RefObject } from "react";
import { EngineClient } from "./engine-client";
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
import { exportTiming } from "./animated-webp";
import { exportQualities, type ExportQuality } from "./export-quality";

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
}: Props) {
  const [mode, setMode] = useState<"reveal" | "parameters">("reveal");
  const [camera, setCamera] = useState<CameraMode>("hold");
  const [duration, setDuration] = useState(10);
  const [tracks, setTracks] = useState<Track[]>([]);
  const [status, setStatus] = useState<Status>("idle");
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState("");
  const [live, setLive] = useState("");
  const [fps, setFPS] = useState(30);
  const [loop, setLoop] = useState(false);
  const [quality, setQuality] = useState<ExportQuality>("standard");
  const [exportNotice, setExportNotice] = useState("");
  const exportAbort = useRef<AbortController | null>(null);
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
  async function sample(s: Session, p: number): Promise<AnimationView> {
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
    else current = await client.current!.compute(values.config);
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
  function fail(reason: unknown) {
    cancel();
    session.current = null;
    onView(null);
    changeStatus("idle");
    setError(
      `Animation stopped: ${reason instanceof Error ? reason.message : String(reason)}`,
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
        const blob = await exportAnimation({
          duration,
          fps,
          loop,
          quality,
          dark,
          layers: { ...layers },
          signal: controller.signal,
          sample: (p) => sample(s, p),
          onProgress: (completed, total) => {
            if (epoch.current !== token) return;
            setProgress(completed / total);
            setLive(`Rendering frame ${completed} of ${total}`);
          },
        });
        if (epoch.current !== token) return;
        const url = URL.createObjectURL(blob);
        const link = document.createElement("a");
        link.href = url;
        link.download = `tangent-garden-${frame.config.kind}-${mode}.webp`;
        link.click();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
        exportAbort.current = null;
        session.current = null;
        changeStatus("idle");
        setExportNotice(
          `Saved animated WebP · ${(blob.size / (1024 * 1024)).toFixed(1)} MiB`,
        );
        return;
      }
      const firstView = await sample(s, 0);
      if (epoch.current !== token) return;
      display(s, firstView);
      schedule(s, 0);
    } catch (error) {
      if (epoch.current === token) fail(error);
    }
  }
  function pause() {
    cancel();
    changeStatus("paused");
  }
  async function seek(p: number) {
    const s = session.current;
    if (!s) return;
    cancel();
    const token = epoch.current;
    changeStatus("preparing");
    try {
      const view = await sample(s, p);
      if (token !== epoch.current) return;
      display(s, view);
      changeStatus(p === 1 ? "complete" : "paused");
    } catch (error) {
      if (token === epoch.current) fail(error);
    }
  }
  return (
    <section className="animation-section">
      <details open>
        <summary className="section-label">ANIMATION</summary>
        <fieldset
          disabled={running || status === "paused" || disabled}
          onChangeCapture={() => {
            if (status === "complete") stop();
          }}
        >
          <label className="field">
            <span>Animate</span>
            <select
              value={mode}
              onChange={(e) => parameterMode(e.target.value as typeof mode)}
            >
              <option value="reveal">Draw along the curve</option>
              <option value="parameters">Vary parameters</option>
            </select>
          </label>
          {mode === "reveal" ? (
            <p className="hint">
              Reveal the full study from its domain start to its end. The
              arc-length anchor and final sample spacing stay fixed.
            </p>
          ) : (
            <>
              {tracks.map((track, i) => (
                <div className="animation-track" key={i}>
                  <label className="field">
                    <span>Parameter {i + 1}</span>
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
                  </label>
                  <div className="pair">
                    {(["from", "to"] as const).map((endpoint) => (
                      <label className="field" key={endpoint}>
                        <span>{endpoint === "from" ? "From" : "To"}</span>
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
                      </label>
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
              <p className="hint">
                Tracks vary together, linearly. Use <var>a</var> in a curve
                expression to animate any coefficient, for example{" "}
                <code>
                  <var>a</var>*cos(t)
                </code>
                . Integer counts change in whole steps. Endpoints accept
                constants.
              </p>
            </>
          )}
          <label className="field">
            <span>Duration (seconds)</span>
            <input
              type="number"
              min="0.1"
              max="3600"
              step="any"
              value={Number.isNaN(duration) ? "" : duration}
              onChange={(e) => setDuration(e.target.valueAsNumber)}
            />
          </label>
          <label className="field">
            <span>Animation camera</span>
            <select
              value={camera}
              onChange={(e) => setCamera(e.target.value as CameraMode)}
            >
              <option value="hold">Hold final view</option>
              <option value="current">Hold current view</option>
              <option value="follow">Follow center, fixed zoom</option>
              <option value="fit">Fit each frame</option>
            </select>
          </label>
          <p className="hint">
            {camera === "current"
              ? "Keep your current pan and zoom for the entire animation, including export."
              : camera === "hold"
                ? "Frame the final result once and hold that view."
                : camera === "follow"
                  ? "Keep the final zoom level and recenter on the evolving geometry."
                  : "Recenter and adjust zoom to fit the evolving geometry."}{" "}
            {camera !== "current" && "Start with a clean view. "}Stop restores
            your manual pan and zoom.
          </p>
          {(camera === "fit" || camera === "follow") && (
            <p className="hint">
              Both curves contribute to framing. Isolated extreme points near
              asymptotes are excluded to keep the view useful; use Hold current
              view to explore distant branches. Follow center keeps the final
              view’s zoom, so a parameter animation that grows beyond that size
              may leave the frame.
            </p>
          )}
          <label className="field">
            <span>Export frame rate</span>
            <select value={fps} onChange={(e) => setFPS(+e.target.value)}>
              <option value={30}>30 fps · smoother motion</option>
              <option value={15}>15 fps · smaller file</option>
            </select>
          </label>
          <label className="field">
            <span>Export quality</span>
            <select
              value={quality}
              onChange={(e) => setQuality(e.target.value as ExportQuality)}
            >
              {Object.entries(exportQualities).map(([value, option]) => (
                <option key={value} value={value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
          <p className="hint">
            Fine renders at twice the resolution with maximum encoding quality
            for sharper lines. Expect larger files and slower export.
          </p>
          <label className="check">
            <input
              type="checkbox"
              checked={loop}
              onChange={(e) => setLoop(e.target.checked)}
            />
            Loop exported animation
          </label>
        </fieldset>
        <div className="animation-buttons">
          {status === "playing" ? (
            <button onClick={pause}>Pause</button>
          ) : status === "paused" ? (
            <button
              onClick={() =>
                session.current && schedule(session.current, progress)
              }
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
        <button
          className="animation-export"
          disabled={disabled || running || !frame}
          onClick={() => void start(true)}
        >
          Export animated WebP ↗
        </button>
        <p className="hint">
          Save the full animation at the selected quality, with the current
          theme, layers, and animation camera. Rendering every frame may take
          longer than playback. Up to 7,200 frames or 256 MiB; no upload
          required.
        </p>
        {exportNotice && (
          <p className="hint" role="status">
            {exportNotice}
          </p>
        )}
        {active && (
          <div className="timeline">
            <label className="field">
              <span>
                Animation progress <b>{Math.round(progress * 100)}%</b>
              </span>
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
            </label>
            <div className="hint" role="status" aria-live="off">
              {status === "exporting"
                ? "Exporting WebP…"
                : status === "complete"
                  ? "Complete"
                  : status === "paused"
                    ? "Paused"
                    : status === "preparing"
                      ? "Preparing"
                      : `${(progress * duration).toFixed(1)} / ${duration} s`}
            </div>
            <output className="animation-values">{live}</output>
            <p className="hint">
              {status === "exporting"
                ? "Rendering the entire animation. Cancel export discards the file; your original study stays available."
                : status === "complete"
                  ? "Complete. Scrub the timeline, export this frame as SVG, or edit the settings for another run. Reset view restores the original study."
                  : "Pause to scrub or export the current frame as SVG. Stop restores the original study. Playback frame rate depends on your device and resolution."}
            </p>
          </div>
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
