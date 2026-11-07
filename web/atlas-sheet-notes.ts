import type { AtlasAxis } from "./atlas-queue";
import type { sheetLayout } from "./atlas-sheet";
import { plotPalette } from "./palette";
import type { ColorScheme } from "./color-schemes";

export type SheetNote = {
  parameters: string[];
  reason?: string;
};
export type SheetHeader = { title: string; definition: string[] };
export type SheetValue = (
  path: readonly (string | number)[],
  value: number,
) => string;
export const plainSheetValue: SheetValue = (_path, value) => String(value);
export const sheetCaptionFont = "22px system-ui, sans-serif";
export const sheetCaptionLine = 28;
export const maxSheetHeight = 6144;

// Shared definitions distinguish variable axes from fixed settings, without
// modifying source configurations or implying the source value is constant.
export function sheetValueForAxes(axes: readonly AtlasAxis[]): SheetValue {
  const key = (path: readonly (string | number)[]) =>
    JSON.stringify(path.map(String));
  return (path, value) => {
    const index = axes.findIndex((axis) => key(axis.path) === key(path));
    return index < 0
      ? String(value)
      : index === 0
        ? "column value"
        : "row value";
  };
}

// Wrap literal text, including long unbroken expressions. Never evaluate,
// abbreviate, shrink or clip a definition to make it fit.
export function wrapSheetText(
  text: string,
  width: number,
  measure: (s: string) => number,
) {
  const lines: string[] = [];
  let line = "";
  for (const word of text.trim().split(/\s+/)) {
    if (!word) continue;
    const next = line ? `${line} ${word}` : word;
    if (measure(next) <= width) {
      line = next;
      continue;
    }
    if (line) {
      lines.push(line);
      line = "";
    }
    for (const character of Array.from(word)) {
      if (measure(character) > width)
        throw new Error("A definition character does not fit in the sheet.");
      if (line && measure(line + character) > width) {
        lines.push(line);
        line = "";
      }
      line += character;
    }
  }
  if (line) lines.push(line);
  return lines;
}

export function prepareSheetNotes(
  base: ReturnType<typeof sheetLayout>,
  notes: readonly SheetNote[],
  header: SheetHeader,
  measure: (s: string) => number,
) {
  if (notes.length !== base.tiles.length)
    throw new Error("Every sheet cell needs its own parameter values.");
  const lines = notes.map((note) =>
    [
      ...note.parameters,
      ...(note.reason ? [`Unavailable: ${note.reason}`] : []),
    ].flatMap((text) => wrapSheetText(text, base.cell.width - 24, measure)),
  );
  const captionHeight =
    24 + sheetCaptionLine * Math.max(...lines.map((l) => l.length));
  const size = Math.sqrt(notes.length);
  const headerLines = header.definition.flatMap((text) =>
    wrapSheetText(text, base.width - 48, measure),
  );
  const headerHeight = 44 + sheetCaptionLine * headerLines.length + 12;
  const height = base.height + headerHeight + size * captionHeight;
  if (height > maxSheetHeight)
    throw new Error(
      "The definitions are too tall for the 6144-pixel sheet limit. Shorten the expressions or export without definitions and parameters.",
    );
  return {
    layout: {
      ...base,
      height,
      captionHeight,
      headerHeight,
      tiles: base.tiles.map((tile, i) => ({
        ...tile,
        y: tile.y + headerHeight + (Math.floor(i / size) + 1) * captionHeight,
      })),
    },
    lines,
    headerLines,
  };
}

export function paintSheetHeader(
  context: CanvasRenderingContext2D,
  header: SheetHeader,
  lines: string[],
  dark: boolean,
  scheme: ColorScheme,
) {
  context.fillStyle = plotPalette(dark, scheme).base;
  context.textBaseline = "top";
  context.font = "bold 28px system-ui, sans-serif";
  context.fillText(header.title, 24, 24);
  context.font = sheetCaptionFont;
  lines.forEach((line, i) =>
    context.fillText(line, 24, 68 + i * sheetCaptionLine),
  );
}

export function paintSheetNote(
  context: CanvasRenderingContext2D,
  note: SheetNote,
  lines: string[],
  tile: { x: number; y: number },
  layout: ReturnType<typeof prepareSheetNotes>["layout"],
  dark: boolean,
  scheme: ColorScheme,
) {
  const palette = plotPalette(dark, scheme);
  const top = tile.y - layout.captionHeight;
  context.fillStyle = palette.base;
  context.font = sheetCaptionFont;
  context.textBaseline = "top";
  lines.forEach((line, i) =>
    context.fillText(line, tile.x + 12, top + 12 + i * sheetCaptionLine),
  );
  if (note.reason) {
    // A marked empty geometry panel keeps the parameter grid intelligible.
    // Its explanation is above it, never inside a drawing viewport.
    context.strokeStyle = palette.axis;
    context.lineWidth = 2;
    context.strokeRect(
      tile.x + 1,
      tile.y + 1,
      layout.cell.width - 2,
      layout.cell.height - 2,
    );
    context.beginPath();
    context.moveTo(tile.x + 12, tile.y + 12);
    context.lineTo(
      tile.x + layout.cell.width - 12,
      tile.y + layout.cell.height - 12,
    );
    context.moveTo(tile.x + layout.cell.width - 12, tile.y + 12);
    context.lineTo(tile.x + 12, tile.y + layout.cell.height - 12);
    context.stroke();
  }
}
