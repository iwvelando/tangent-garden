export type ExportLayout = "columns" | "rows";
export type ExportSettings = {
  scale: number;
  quality: number;
  layout?: ExportLayout;
};
// Optional paired compositions preserve each panel's 1000 × 760 coordinate scale.
export function exportBaseSize(layout?: ExportLayout) {
  if (layout === "columns") return { width: 2000, height: 760 };
  if (layout === "rows") return { width: 1000, height: 1520 };
  if (layout !== undefined)
    throw new Error("Choose a columns or rows export layout.");
  return { width: 1000, height: 760 };
}

// Every format offers all three; a 60 fps WebP is about twice the size.
export const frameRates = [15, 30, 60];

// 2000 × 1520. At 1000 × 760 construction lines are about one pixel wide, and
// H.264 and lossy WebP store colour at half resolution, so thin lines lose
// their colour and soften; at twice the size they stay crisp.
export const defaultScale = 2;

export function exportEncoding({ scale, quality, layout }: ExportSettings) {
  if (!Number.isFinite(scale) || scale < 0.5 || scale > 2)
    throw new Error("Export resolution must be between 50% and 200%.");
  if (!Number.isInteger(quality) || quality < 1 || quality > 100)
    throw new Error("Export quality must be a whole number from 1 to 100.");
  const size = exportBaseSize(layout);
  return {
    width: Math.round(size.width * scale),
    height: Math.round(size.height * scale),
    scale,
    compression: quality / 100,
  };
}

// Frame times and millisecond delays shared by every export format. The
// delays sum exactly to the requested duration. Frames include both
// endpoints, unless the animation cycles (see timing.ts): then they are
// equally spaced over one period and the end, which is the start again, is
// left out, so a looping file shows no frame twice at its seam.
export function exportTiming(seconds: number, fps: number, cyclic = false) {
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
    progress: cyclic ? i / count : i / (count - 1),
    duration:
      Math.round(((i + 1) * milliseconds) / count) -
      Math.round((i * milliseconds) / count),
  }));
}
