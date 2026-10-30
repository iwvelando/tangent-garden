import { useEffect, useMemo, useState } from "react";
import { Field } from "./Field";
import { FrameRateField } from "./FrameRateField";
import { useDisclosure } from "./useDisclosure";
import {
  defaultScale,
  exportEncoding,
  largestScale,
  resolutionHelp,
  type ExportSettings,
  type ExportLayout,
} from "./export-quality";
import { canvasFits } from "./export-image";
import {
  defaultQuality,
  detectFormats,
  formatText,
  type ExportFormat,
  type Formats,
} from "./export-formats";
export type MotionExport = {
  format: ExportFormat;
  fps: number;
  settings: ExportSettings;
  loop: boolean;
};
export function useMotionExport(layout?: ExportLayout) {
  const [format, setFormat] = useState<ExportFormat>("mp4"),
    [fps, setFPS] = useState(30),
    [scaleChoice, setScale] = useState(defaultScale),
    [qualities, setQualities] = useState({ ...defaultQuality }),
    [loop, setLoop] = useState(false),
    [formats, setFormats] = useState<Formats | null>(null);
  // Only resolutions this device draws are offered; a larger choice waits.
  const topScale = useMemo(() => largestScale(canvasFits, layout), [layout]),
    scale = Math.min(scaleChoice, topScale),
    resetScale = Math.min(defaultScale, topScale);
  useEffect(() => {
    let live = true;
    setFormats(null);
    void detectFormats(
      { scale, quality: qualities.mp4, layout: layout },
      fps,
    ).then((f) => {
      if (live) setFormats(f);
    });
    return () => {
      live = false;
    };
  }, [scale, qualities.mp4, fps, layout]);
  const offered = (["mp4", "webp"] as const).filter(
    (f) => formats?.[f] !== "no",
  );
  const chosen = offered.includes(format) ? format : (offered[0] ?? "mp4");
  const quality = qualities[chosen],
    text = formatText[chosen];
  const size = exportEncoding({ scale, quality, layout: layout }),
    defaultSize = exportEncoding({
      scale: resetScale,
      quality,
      layout: layout,
    });
  const setQuality = (n: number) =>
    setQualities((q) => ({ ...q, [chosen]: n }));
  return {
    format,
    setFormat,
    fps,
    setFPS,
    scaleChoice,
    setScale,
    qualities,
    loop,
    setLoop,
    formats,
    topScale,
    scale,
    resetScale,
    offered,
    chosen,
    quality,
    text,
    size,
    defaultSize,
    setQuality,
    layout,
  };
}
export function MotionExportSettings({
  state,
  id,
  cyclic = false,
  disclosure,
}: {
  state: ReturnType<typeof useMotionExport>;
  id: string;
  cyclic?: boolean;
  disclosure: ReturnType<typeof useDisclosure>;
}) {
  const {
    format,
    setFormat,
    fps,
    setFPS,
    scaleChoice,
    setScale,
    qualities,
    loop,
    setLoop,
    formats,
    topScale,
    scale,
    resetScale,
    offered,
    chosen,
    quality,
    text,
    size,
    defaultSize,
    setQuality,
    layout,
  } = state;
  return (
    <details id={id} className="subsection" {...disclosure}>
      <summary>
        Export settings
        <span className="summary-detail">
          {text.short} · {fps} fps · {size.width} × {size.height} · quality{" "}
          {quality}
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
        help={resolutionHelp(topScale, layout)}
      >
        <input
          aria-label="Export resolution"
          aria-valuetext={`${size.width} by ${size.height} pixels`}
          type="range"
          min="0.5"
          max={topScale}
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
      {chosen === "webp" && cyclic ? (
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
          MP4 files have no loop setting; video players decide whether to loop.
        </p>
      )}
      <button
        className="text-button export-reset"
        disabled={scale === resetScale && quality === defaultQuality[chosen]}
        onClick={() => {
          setScale(defaultScale);
          setQuality(defaultQuality[chosen]);
        }}
      >
        Reset export settings to {defaultSize.width} × {defaultSize.height} ·
        quality {defaultQuality[chosen]}
      </button>
      <p className="hint">
        Export renders every frame in your browser with the current theme,
        layers and camera, and can take longer than playback. Up to 7,200 frames
        or 256 MiB.
      </p>
    </details>
  );
}
