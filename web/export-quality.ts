export type ExportSettings = { scale: number; quality: number };

export const defaultExportSettings: ExportSettings = { scale: 1, quality: 95 };

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
