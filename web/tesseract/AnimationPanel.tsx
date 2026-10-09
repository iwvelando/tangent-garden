import { useEffect, useState } from "react";
import { FrameRateField } from "../FrameRateField";
import { ProgressSlider } from "../ProgressSlider";
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
import { objects, repeatHelp } from "./objects";
import { motions, type Config, type Motion } from "./types";
import {
  cycles,
  paceChoices,
  paceHelp,
  repeatChoices,
  type Pace,
  type Repeat,
} from "../timing";

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
  repeat: Repeat;
  pace: Pace;
  // The time on the timeline, and whether a single pass has finished.
  progress: number;
  complete: boolean;
  preview: boolean;
  playing: boolean;
  exporting: string;
  error: string;
  disabled: boolean;
  onMotion: (motion: Motion) => void;
  onDuration: (n: number) => void;
  onRepeat: (r: Repeat) => void;
  onPace: (p: Pace) => void;
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
  const choices = motions(p.config),
    loopable = !!choices.find((c) => c.value === p.motion)?.loops;
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
          <div className="pair">
            <Field label="Repeat" help={repeatHelp[p.repeat]}>
              <select
                value={p.repeat}
                onChange={(e) => p.onRepeat(e.target.value as Repeat)}
              >
                {repeatChoices
                  .filter((c) => c.value !== "loop" || loopable)
                  .map((c) => (
                    <option key={c.value} value={c.value}>
                      {c.label}
                    </option>
                  ))}
              </select>
            </Field>
            <Field label="Pace" help={paceHelp[p.pace]}>
              <select
                value={p.pace}
                onChange={(e) => p.onPace(e.target.value as Pace)}
              >
                {paceChoices.map((c) => (
                  <option key={c.value} value={c.value}>
                    {c.label}
                  </option>
                ))}
              </select>
            </Field>
          </div>
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
                {text.short} · {fps} fps · {size.width} × {size.height} ·
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
            <FrameRateField format={chosen} fps={fps} onChange={setFPS} />
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
            {chosen === "webp" && cycles(p.repeat) ? (
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
              layers and camera, and can take longer than playback. Up to 7,200
              frames or 256 MiB.
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
                p.playing || (p.preview && !p.complete) ? undefined : "export"
              }
              disabled={p.disabled || !!p.exporting || !valid}
              onClick={p.playing ? p.onPause : p.onPlay}
            >
              {p.playing
                ? "Pause"
                : p.preview
                  ? p.complete
                    ? "Replay"
                    : "Resume"
                  : "Play animation"}
            </button>
            <button disabled={!active} onClick={p.onStop}>
              {p.exporting
                ? "Cancel export"
                : p.preview && p.complete
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
                <ProgressSlider
                  progress={p.progress}
                  disabled={running}
                  onSeek={p.onSeek}
                />
              </Field>
              <div className="note" role="status" aria-live="off">
                {p.exporting
                  ? `Exporting ${text.short}… ${p.exporting}`
                  : p.complete
                    ? "Complete"
                    : !p.playing
                      ? "Paused"
                      : `${(p.progress * p.duration).toFixed(1)} / ${p.duration} s`}
              </div>
              <p className="note playback-tip">
                {p.exporting
                  ? "Cancel export discards the file; your study stays as it was."
                  : p.complete
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
            Math.ceil(p.duration * fps) > 7200
          }
          onClick={() =>
            p.onExport({
              format: chosen,
              fps: fps,
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
        {Math.ceil(p.duration * fps) > 7200 && (
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
