// A sheet consumes settled preview geometry. It never owns a numerical
// worker, recomputes a study, or reads the grid's small raster previews.
import type { AtlasCell, AtlasSize } from "./atlas-queue";
import type { ColorScheme } from "./color-schemes";
import { browserLimit, drawable } from "./export-image";
import { loomMetadata } from "./loom/metadata";
import { plotPalette } from "./palette";
import {
  paintSheetNote,
  paintSheetHeader,
  prepareSheetNotes,
  sheetCaptionFont,
  type SheetNote,
  type SheetHeader,
} from "./atlas-sheet-notes";

export type SheetFormat = "webp" | "png";
export type SheetPage = { width: number; height: number };
export function sheetLayout(size: AtlasSize, paired = false) {
  if (size !== 3 && size !== 5)
    throw new Error("Choose a 3 × 3 or 5 × 5 sheet.");
  const width = 2400;
  const cell = {
    width: Math.floor((width - 48 - 12 * (size - 1)) / size),
    height: 0,
  };
  cell.height = Math.round(cell.width * (paired ? 1.52 : 0.76));
  const left = (width - size * cell.width - 12 * (size - 1)) / 2;
  return {
    width,
    height: 48 + size * cell.height + 12 * (size - 1),
    cell,
    tiles: Array.from({ length: size * size }, (_, i) => ({
      x: left + (i % size) * (cell.width + 12),
      y: 24 + Math.floor(i / size) * (cell.height + 12),
    })),
  };
}
export function sheetReady<F>(cells: readonly AtlasCell<F>[], size: AtlasSize) {
  return (
    (size === 3 || size === 5) &&
    cells.length === size * size &&
    cells.every((c) => c.frame || c.error) &&
    cells.some((c) => c.frame)
  );
}
export function sheetWebPAvailable() {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 1;
  try {
    return canvas.toDataURL("image/webp").startsWith("data:image/webp");
  } catch {
    return false;
  } finally {
    canvas.width = canvas.height = 0;
  }
}
export type SheetPainter<F> = {
  draw: (
    frame: F,
    page: SheetPage,
    signal: AbortSignal,
    index: number,
  ) => Promise<Blob>;
  dispose: () => void;
};

// Native still encoders may write the simple VP8/VP8L container. Metadata
// needs an extended VP8X header; the existing metadata writer handles that
// container (including animation) without changing the encoded image data.
// https://developers.google.com/speed/webp/docs/riff_container
async function extendedWebP(blob: Blob, page: SheetPage) {
  const first = new Uint8Array(await blob.slice(0, 30).arrayBuffer());
  const name = new TextDecoder().decode(first.slice(12, 16));
  if (name === "VP8X") return blob;
  if (name !== "VP8 " && name !== "VP8L")
    throw new Error("The browser returned an invalid WebP image.");
  const header = new Uint8Array(30);
  header.set(new TextEncoder().encode("RIFF"));
  new DataView(header.buffer).setUint32(4, blob.size + 18 - 8, true);
  header.set(new TextEncoder().encode("WEBPVP8X"), 8);
  header[16] = 10;
  // The sheet is opaque. Width and height are 24-bit little-endian minus 1.
  for (let k = 0; k < 3; k++) {
    header[24 + k] = ((page.width - 1) >>> (8 * k)) & 255;
    header[27 + k] = ((page.height - 1) >>> (8 * k)) & 255;
  }
  return new Blob([header, blob.slice(12)], { type: "image/webp" });
}

// Also covers dismissal/reopening or switching notebooks during an encode:
// the previous component can unmount while its browser callback drains.
let activeSheet = false;
export async function atlasSheet<F>(o: {
  cells: readonly AtlasCell<F>[];
  size: AtlasSize;
  paired?: boolean;
  dark: boolean;
  scheme: ColorScheme;
  format: SheetFormat;
  metadata: object;
  notes?: readonly SheetNote[];
  header?: SheetHeader;
  signal: AbortSignal;
  painter: () => SheetPainter<F>;
  progress: (done: number, total: number) => void;
}) {
  o.signal.throwIfAborted();
  if (activeSheet)
    throw new Error(
      "The previous sheet export is still finishing. Try again shortly.",
    );
  if (!sheetReady(o.cells, o.size))
    throw new Error(
      "Wait for a complete atlas with at least one available variant.",
    );
  let layout = sheetLayout(o.size, o.paired);
  const record = {
    ...o.metadata,
    kind: "atlas-contact-sheet",
    quality: "preview",
    size: o.size,
    layout,
    dark: o.dark,
    scheme: o.scheme,
    ...(o.notes && { notes: o.notes }),
    ...(o.header && { header: o.header }),
    cells: o.cells.map((c) => ({
      values: c.values,
      available: !!c.frame,
      ...(!c.frame && { error: c.error }),
    })),
  };
  // Check before allocating an output surface or creating a graphics context.
  if (new TextEncoder().encode(JSON.stringify(record)).length + 128 > 65536)
    throw new Error("The sheet metadata exceeds the 64 KiB limit.");
  activeSheet = true;
  let canvas: HTMLCanvasElement | undefined;
  let painter: SheetPainter<F> | undefined;
  try {
    canvas = document.createElement("canvas");
    canvas.width = canvas.height = 1;
    const context = canvas.getContext("2d", { alpha: false });
    if (!context) throw browserLimit(layout.width, layout.height);
    context.font = sheetCaptionFont;
    if (o.notes && !o.header)
      throw new Error("The teaching sheet needs a shared definition.");
    const captions =
      o.notes &&
      o.header &&
      prepareSheetNotes(
        layout,
        o.notes,
        o.header,
        (s) => context.measureText(s).width,
      );
    if (captions) layout = captions.layout;
    record.layout = layout;
    if (new TextEncoder().encode(JSON.stringify(record)).length + 128 > 65536)
      throw new Error("The sheet metadata exceeds the 64 KiB limit.");
    canvas.width = layout.width;
    canvas.height = layout.height;
    if (!drawable(context, canvas.width, canvas.height))
      throw browserLimit(canvas.width, canvas.height);
    context.fillStyle = plotPalette(o.dark, o.scheme).bg;
    context.fillRect(0, 0, canvas.width, canvas.height);
    if (captions && o.header)
      paintSheetHeader(
        context,
        o.header,
        captions.headerLines,
        o.dark,
        o.scheme,
      );
    painter = o.painter();
    for (const [i, cell] of o.cells.entries()) {
      o.signal.throwIfAborted();
      if (captions && o.notes)
        paintSheetNote(
          context,
          o.notes[i],
          captions.lines[i],
          captions.layout.tiles[i],
          captions.layout,
          o.dark,
          o.scheme,
        );
      if (cell.frame) {
        const blob = await painter.draw(cell.frame, layout.cell, o.signal, i);
        o.signal.throwIfAborted();
        const url = URL.createObjectURL(blob);
        const image = new Image();
        try {
          image.src = url;
          await image.decode();
          o.signal.throwIfAborted();
          if (
            image.naturalWidth !== layout.cell.width ||
            image.naturalHeight !== layout.cell.height
          )
            throw new Error(
              "The sheet renderer returned the wrong cell resolution.",
            );
          const { x, y } = layout.tiles[i];
          context.drawImage(image, x, y);
        } finally {
          image.src = "";
          URL.revokeObjectURL(url);
        }
      }
      o.progress(i + 1, o.cells.length);
      // Allow cancellation and controls between cells, including refused ones.
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
    o.signal.throwIfAborted();
    const output = canvas;
    let blob = await new Promise<Blob>((resolve, reject) =>
      output.toBlob(
        (b) =>
          b ? resolve(b) : reject(new Error("The sheet could not be encoded.")),
        `image/${o.format}`,
        0.95,
      ),
    );
    o.signal.throwIfAborted();
    // A native encoder can fall back to PNG even after a successful probe.
    const format =
      blob.type === "image/webp"
        ? "webp"
        : blob.type === "image/png"
          ? "png"
          : null;
    if (!format)
      throw new Error("The browser returned an unsupported image format.");
    if (format === "webp") blob = await extendedWebP(blob, layout);
    blob = await loomMetadata(blob, format, {
      ...record,
      format,
      compression:
        format === "webp"
          ? { quality: 95, lossless: false }
          : { lossless: true },
    });
    o.signal.throwIfAborted();
    return { blob, format };
  } finally {
    try {
      painter?.dispose();
    } finally {
      if (canvas) canvas.width = canvas.height = 0;
      activeSheet = false;
    }
  }
}

// SVG keeps the ordinary coordinate system but is decoded at the target
// cell size. The compositor rejects wrong-size output rather than upscaling.
export function sheetSvg(markup: string, page: SheetPage) {
  const svg = new DOMParser().parseFromString(
    markup,
    "image/svg+xml",
  ).documentElement;
  if (svg.localName !== "svg" || svg.querySelector("parsererror"))
    throw new Error("The variant could not be drawn as SVG.");
  svg.setAttribute("width", String(page.width));
  svg.setAttribute("height", String(page.height));
  return new Blob([new XMLSerializer().serializeToString(svg)], {
    type: "image/svg+xml",
  });
}
