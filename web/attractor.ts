import type { AttractorMap, AttractorResult } from "./types";

const count = (n: number, one: string, many = `${one}s`) =>
  `${n.toLocaleString("en-US")} ${n === 1 ? one : many}`;

// Each map's curated coefficients, which it starts from when chosen.
export const mapDefaults: Record<
  AttractorMap,
  { a: number; b: number; c: number; d: number }
> = {
  clifford: { a: -1.4, b: 1.6, c: 1, d: 0.7 },
  dejong: { a: 1.4, b: -2.3, c: 2.4, d: -2.1 },
  henon: { a: 1.4, b: 0.3, c: 0, d: 0 },
};
export const mapNames: Record<AttractorMap, string> = {
  clifford: "Clifford",
  dejong: "Peter de Jong",
  henon: "Hénon",
};
export const mapFormulas: Record<AttractorMap, string> = {
  clifford: "x′ = sin(a y) + c cos(a x),  y′ = sin(b x) + d cos(b y)",
  dejong: "x′ = sin(a y) − cos(b x),  y′ = sin(c x) − cos(d y)",
  henon: "x′ = 1 − a x² + y,  y′ = b x",
};

// How many iterates were counted where, and where the orbit stopped.
export function attractorNote(result: AttractorResult, discard: number) {
  const visited = result.counts.reduce((n, c) => n + (c > 0 ? 1 : 0), 0);
  const notes = [
    result.accumulated === 0
      ? "No iterates are accumulated."
      : `${count(result.accumulated, "iterate")}${discard ? `, after ${discard.toLocaleString("en-US")} discarded,` : ""} ${result.accumulated === 1 ? "visits" : "visit"} ${visited.toLocaleString("en-US")} of ${count(result.columns * result.rows, "cell")}; the busiest has ${count(result.max, "visit")}.`,
  ];
  if (result.outside)
    notes.push(
      `${result.outside.toLocaleString("en-US")} of them ${result.outside === 1 ? "lies" : "lie"} outside the window and ${result.outside === 1 ? "is" : "are"} not drawn.`,
    );
  if (result.escape)
    notes.push(
      `The orbit left |x|, |y| ≤ 100,000 at iterate ${result.escape.toLocaleString("en-US")} and stops there.`,
    );
  return notes.join(" ");
}

// One RGBA pixel per cell, top row first, in the given "#rrggbb" colour.
// Opacity is log(1 + visits) / log(1 + the busiest cell's visits), so a
// cell never visited is clear and the busiest is opaque.
export function densityPixels(result: AttractorResult, color: string) {
  const { columns, rows, counts } = result;
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(color.slice(i, i + 2), 16));
  const pixels = new Uint8ClampedArray(columns * rows * 4);
  const top = Math.log1p(result.max);
  for (let j = 0; j < rows; j++)
    for (let i = 0; i < columns; i++) {
      const n = counts[j * columns + i];
      const k = ((rows - 1 - j) * columns + i) * 4;
      pixels[k] = r;
      pixels[k + 1] = g;
      pixels[k + 2] = b;
      pixels[k + 3] = n > 0 ? Math.round((255 * Math.log1p(n)) / top) : 0;
    }
  return pixels;
}

// The density as a PNG data URL, one pixel per cell, embedded in the SVG so
// the drawing and every export carry it. Cached per result and colour.
const images = new WeakMap<AttractorResult, Map<string, string>>();
export function densityImage(result: AttractorResult, color: string) {
  let cached = images.get(result);
  if (!cached) images.set(result, (cached = new Map()));
  let url = cached.get(color);
  if (url === undefined) {
    const canvas = document.createElement("canvas");
    canvas.width = result.columns;
    canvas.height = result.rows;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Canvas drawing is unavailable.");
    context.putImageData(
      new ImageData(densityPixels(result, color), result.columns, result.rows),
      0,
      0,
    );
    url = canvas.toDataURL("image/png");
    cached.set(color, url);
  }
  return url;
}
