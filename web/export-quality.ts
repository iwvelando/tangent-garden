import { withMore } from "./help";

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

// The export resolutions offered, from 50% to 200% of the page.
export const exportScales = [0.5, 0.75, 1, 1.25, 1.5, 1.75, 2];
// The largest resolution a device draws an animation's frames at: from the
// smallest up to the first it cannot, since a larger page fits no better.
// The smallest is always offered, so a device that cannot draw it says so
// when exporting.
export function largestScale(
  fits: (size: { width: number; height: number }) => boolean,
  layout?: ExportLayout,
) {
  let top = exportScales[0];
  for (const scale of exportScales.slice(1)) {
    if (!fits(exportEncoding({ scale, quality: 100, layout }))) break;
    top = scale;
  }
  return top;
}
// The resolution's help, with the device's limit when it is below 200%.
export function resolutionHelp(top: number, layout?: ExportLayout) {
  const help =
    "More pixels keep finer detail, with larger files and slower export.";
  if (top >= exportScales.at(-1)!) return help;
  const { width, height } = exportEncoding({
    scale: top,
    quality: 100,
    layout,
  });
  return withMore(
    help,
    `This device draws animations at most ${width} × ${height}.`,
  );
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
