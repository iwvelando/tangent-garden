import { useEffect, useState } from "react";
import { Field } from "../Field";
import { useDisclosure } from "../useDisclosure";
import {
  defaultScale,
  exportEncoding,
  type ExportSettings,
  type ExportLayout,
} from "../export-quality";
import {
  defaultQuality,
  detectFormats,
  formatText,
  type ExportFormat,
  type Formats,
} from "../export-formats";
import { objects } from "./objects";
import { motions, type Config, type Motion } from "./types";

export type MotionExport = {
  format: ExportFormat;
  fps: number;
  settings: ExportSettings;
  loop: boolean;
};

export function AnimationPanel(p: {
  config: Config;
  layout?: ExportLayout;
  motion: Motion;
  duration: number;
  progress: number;
  preview: boolean;
  playing: boolean;
  exporting: string;
  error: string;
  disabled: boolean;
  onMotion: (motion: Motion) => void;
  onDuration: (n: number) => void;
  onPlay: () => void;
  onPause: () => void;
  onStop: () => void;
  onSeek: (n: number) => void;
  onExport: (options: MotionExport) => void;
}) {
  const section = useDisclosure("shape-animation", true),
    exportSection = useDisclosure("shape-export");
  const [format, setFormat] = useState<ExportFormat>("mp4"),
    [fps, setFPS] = useState(30),
    [scale, setScale] = useState(defaultScale),
    [qualities, setQualities] = useState({ ...defaultQuality }),
    [loop, setLoop] = useState(false),
    [formats, setFormats] = useState<Formats | null>(null);
  useEffect(() => {
    let live = true;
    setFormats(null);
    void detectFormats(
      { scale, quality: qualities.mp4, layout: p.layout },
      fps,
    ).then((f) => {
      if (live) setFormats(f);
    });
    return () => {
      live = false;
    };
  }, [scale, qualities.mp4, fps, p.layout]);
  const offered = (["mp4", "webp"] as const).filter(
    (f) => formats?.[f] !== "no",
  );
  const chosen = offered.includes(format) ? format : (offered[0] ?? "mp4");
  const exportFps = chosen === "webp" && fps === 60 ? 30 : fps;
  const quality = qualities[chosen],
    text = formatText[chosen];
  const size = exportEncoding({ scale, quality, layout: p.layout }),
    defaultSize = exportEncoding({
      scale: defaultScale,
      quality,
      layout: p.layout,
    });
  const setQuality = (n: number) =>
    setQualities((q) => ({ ...q, [chosen]: n }));
  const active = p.preview || !!p.exporting,
    running = p.playing || !!p.exporting;
  const valid =
    Number.isFinite(p.duration) && p.duration >= 0.1 && p.duration <= 3600;
  const choices = motions(p.config);
  return (
    <section className="animation-section">
      <details id="shape-animation-section" {...section}>
        <summary
          className="section-label"
          onClick={(e) => {
            if (active) e.preventDefault();
          }}
        >
          ANIMATION
        </summary>
        <fieldset disabled={running || p.disabled}>
          <Field
            label="Animate"
            topic="animation modes"
            help={choices.find((c) => c.value === p.motion)?.help}
          >
            <select
              value={p.motion}
              onChange={(e) => p.onMotion(e.target.value as Motion)}
            >
              {choices.map((c) => (
                <option key={c.value} value={c.value}>
                  {c.label}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Duration (seconds)">
            <input
              type="number"
              min="0.1"
              max="3600"
              step="any"
              value={Number.isNaN(p.duration) ? "" : p.duration}
              onChange={(e) =>
                p.onDuration(e.target.value === "" ? NaN : +e.target.value)
              }
            />
          </Field>
          <p className="hint">
            {objects[p.config.object].animationFramingHelp?.(p.config) ??
              "Animation holds your current view. Drag, pan, or zoom before playback to choose the framing."}
          </p>
          <details
            id="shape-export-settings"
            className="subsection"
            {...exportSection}
          >
            <summary>
              Export settings
              <span className="summary-detail">
                {text.short} · {exportFps} fps · {size.width} × {size.height} ·
                quality {quality}
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
              value={`${size.width} × ${size.height}`}
              help="More pixels keep finer detail, with larger files and slower export."
            >
              <input
                aria-label="Export resolution"
                aria-valuetext={`${size.width} by ${size.height} pixels`}
                type="range"
                min="0.5"
                max="2"
                step="0.25"
                value={scale}
                onChange={(e) => setScale(+e.target.value)}
              />
            </Field>
            <Field
              label="Export quality"
              value={String(quality)}
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
                scale === defaultScale && quality === defaultQuality[chosen]
              }
              onClick={() => {
                setScale(defaultScale);
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
        <div
          id="shape-playback"
          className={`playback tesseract-playback ${active ? "active" : ""}`}
          role="group"
          aria-label="Playback"
        >
          <div className="animation-buttons">
            <button
              className={
                p.playing || (p.preview && p.progress < 1)
                  ? undefined
                  : "export"
              }
              disabled={p.disabled || !!p.exporting || !valid}
              onClick={p.playing ? p.onPause : p.onPlay}
            >
              {p.playing
                ? "Pause"
                : p.preview
                  ? p.progress >= 1
                    ? "Replay"
                    : "Resume"
                  : "Play animation"}
            </button>
            <button disabled={!active} onClick={p.onStop}>
              {p.exporting
                ? "Cancel export"
                : p.preview && p.progress >= 1
                  ? "Back to study"
                  : "Stop"}
            </button>
          </div>
          {active && (
            <div className="timeline">
              <Field
                label="Animation progress"
                value={`${Math.round(p.progress * 100)}%`}
              >
                <input
                  aria-label="Animation progress"
                  type="range"
                  min="0"
                  max="1"
                  step=".001"
                  value={p.progress}
                  disabled={running}
                  onChange={(e) => p.onSeek(+e.target.value)}
                />
              </Field>
              <div className="note" role="status" aria-live="off">
                {p.exporting
                  ? `Exporting ${text.short}… ${p.exporting}`
                  : p.progress >= 1
                    ? "Complete"
                    : !p.playing
                      ? "Paused"
                      : `${(p.progress * p.duration).toFixed(1)} / ${p.duration} s`}
              </div>
              <p className="note playback-tip">
                {p.exporting
                  ? "Cancel export discards the file; your study stays as it was."
                  : p.progress >= 1
                    ? "Orbit the finished drawing, scrub the timeline, or save this frame as an image. Back to study restores your study."
                    : "Pause to scrub or save this frame as an image. Stop restores your study and manual view."}
              </p>
            </div>
          )}
        </div>
        <button
          className="animation-export"
          disabled={
            p.disabled ||
            running ||
            !valid ||
            formats?.[chosen] !== "yes" ||
            Math.ceil(p.duration * exportFps) > 7200
          }
          onClick={() =>
            p.onExport({
              format: chosen,
              fps: exportFps,
              settings: {
                scale,
                quality,
                ...(p.layout ? { layout: p.layout } : {}),
              },
              loop,
            })
          }
        >
          Export {text.name} ↗
        </button>
        {formats?.[chosen] === "size" && (
          <p className="hint">
            This browser needs a lower resolution or frame rate to export MP4.
          </p>
        )}
        {formats && !offered.length && (
          <p className="hint">
            This browser cannot encode animation. Still-image exports are
            available.
          </p>
        )}
        {Math.ceil(p.duration * exportFps) > 7200 && (
          <p className="hint">
            Export is limited to 7,200 frames. Shorten the duration or choose a
            lower frame rate.
          </p>
        )}
        {!valid && (
          <p className="animation-error" role="alert">
            Duration must be between 0.1 and 3600 seconds.
          </p>
        )}
        {p.error && (
          <p className="animation-error" role="alert">
            {p.error}
          </p>
        )}
      </details>
    </section>
  );
}
