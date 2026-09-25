export type ExportSettings = { scale: number; quality: number };

// Animated WebP is limited to 15 and 30; 60 fps is offered for MP4 only.
export const frameRates = [15, 30, 60];

// 2000 × 1520. At 1000 × 760 construction lines are about one pixel wide, and
// H.264 and lossy WebP store colour at half resolution, so thin lines lose
// their colour and soften; at twice the size they stay crisp.
export const defaultScale = 2;

export function exportEncoding({ scale, quality }: ExportSettings) {
  if (!Number.isFinite(scale) || scale < 0.5 || scale > 2)
    throw new Error("Export resolution must be between 50% and 200%.");
  if (!Number.isInteger(quality) || quality < 1 || quality > 100)
    throw new Error("Export quality must be a whole number from 1 to 100.");
  return {
    width: Math.round(1000 * scale),
    height: Math.round(760 * scale),
    scale,
    compression: quality / 100,
  };
}

// Frame progress and millisecond delays shared by every export format. The
// delays sum exactly to the requested duration and include both endpoints.
export function exportTiming(seconds: number, fps: number) {
  if (!Number.isFinite(seconds) || seconds < 0.1 || seconds > 3600)
    throw new Error("Duration must be between 0.1 and 3600 seconds.");
  if (!frameRates.includes(fps))
    throw new Error("Choose 15, 30, or 60 frames per second.");
  const count = Math.max(2, Math.ceil(seconds * fps));
  if (count > 7200)
    throw new Error(
      "Export is limited to 7,200 frames. Shorten the duration or choose a lower frame rate.",
    );
  const milliseconds = Math.round(seconds * 1000);
  return Array.from({ length: count }, (_, i) => ({
    progress: i / (count - 1),
    duration:
      Math.round(((i + 1) * milliseconds) / count) -
      Math.round((i * milliseconds) / count),
  }));
}
