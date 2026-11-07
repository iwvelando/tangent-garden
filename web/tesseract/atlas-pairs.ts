// Descriptor-owned 4D atlas vocabulary. No renderer or object registry is
// imported here, so each object's descriptor can publish its own catalog.
import { roundedRange, type AtlasAxis, type AtlasRanges } from "../atlas-queue";
import type { Config } from "./types";
export type TesseractPairId =
  "flower" | "latitude" | "rotation" | "window" | "eye";
export type TesseractAtlasPair = {
  id: TesseractPairId;
  label: string;
  axes: readonly [AtlasAxis, AtlasAxis];
  supports: (c: Config) => boolean;
  ranges: (c: Config) => AtlasRanges;
};
const around = (v: number, d = 0.5): [number, number] =>
  roundedRange(v - d, v + d, Math.max(Math.abs(v), d));
const within = (
  v: number,
  d: number,
  lo: number,
  hi: number,
): [number, number] =>
  roundedRange(
    Math.max(lo, v - d),
    Math.min(hi, v + d),
    Math.max(Math.abs(v), d),
  );
const xw: AtlasAxis = {
  key: "xw",
  label: "xw angle",
  symbol: "xw",
  path: ["angles", 3],
};
const alpha: AtlasAxis = {
  key: "alpha",
  label: "Central latitude α",
  symbol: "α",
  path: ["weave", "alpha"],
};
const projected = (c: Config) => c.mode !== "section";
export const rotationPair: TesseractAtlasPair = {
  id: "rotation",
  label: "4D rotations xw / yw",
  axes: [
    xw,
    { key: "yw", label: "yw angle", symbol: "yw", path: ["angles", 4] },
  ],
  supports: projected,
  ranges: (c) => ({ xw: around(c.angles[3]), yw: around(c.angles[4]) }),
};
export const windowPair: TesseractAtlasPair = {
  id: "window",
  label: "Rotation xw / projection window",
  axes: [
    xw,
    {
      key: "clip",
      label: "Projection window radius",
      symbol: "C",
      path: ["clip"],
    },
  ],
  supports: (c) => c.mode === "stereo" || c.mode === "paired",
  ranges: (c) => ({ xw: around(c.angles[3]), clip: within(c.clip, 1, 2, 12) }),
};
export const eyePair: TesseractAtlasPair = {
  id: "eye",
  label: "Rotation xw / 4D eye distance",
  axes: [
    xw,
    {
      key: "distance",
      label: "4D eye distance",
      symbol: "d",
      path: ["distance"],
    },
  ],
  supports: (c) => c.mode === "perspective",
  ranges: (c) => ({
    xw: around(c.angles[3]),
    distance: within(c.distance, 1, 2.05, 20),
  }),
};
export const flowerPair: TesseractAtlasPair = {
  id: "flower",
  label: "Flower latitude α / amplitude A",
  axes: [
    alpha,
    {
      key: "amplitude",
      label: "Flower amplitude A",
      symbol: "A",
      path: ["weave", "amplitude"],
    },
  ],
  // Missing optional amplitude means zero in older links. It must exist in
  // the snapshot before the shared queue reads its source coordinate.
  supports: (c) => c.mode === "paired" && c.weave?.path === "flower",
  ranges: (c) => ({
    alpha: within(c.weave!.alpha, 0.15, 0, Math.PI / 2),
    amplitude: within(c.weave!.amplitude ?? 0, 0.1, 0, Math.PI / 4),
  }),
};
export const latitudePair: TesseractAtlasPair = {
  id: "latitude",
  label: "Latitude α / rotation xw",
  axes: [alpha, xw],
  supports: (c) =>
    c.mode === "paired" && (c.weave?.path ?? "latitude") === "latitude",
  ranges: (c) => ({
    alpha: within(c.weave!.alpha, 0.2, 0, Math.PI / 2),
    xw: around(c.angles[3]),
  }),
};
// Conservative returned-point reservations, including companions, guides
// and markers. They bound the existing Go builders, not execution time.
export function cubeAtlasPoints(c: Config): number {
  return (
    (32 + 48 * c.grid) * (c.mode === "stereo" ? 2 * (c.samples + 2) : 2) +
    48 * 4
  );
}
export function weaveAtlasPoints(c: Config): number {
  const n = c.curves,
    s = c.samples;
  if (c.mode === "paired")
    return (n + 1) * (s + 2) + 7 * (s + 1) + n + 1 + Math.max(0, 128 - s) + 8;
  return (
    c.count * (c.weave!.family === "tori" ? 2 * n : n) * (s + 2) + 3 * (s + 1)
  );
}
export const rootAtlasPoints = (c: Config) =>
  3 * ((3 * c.samples) / 2 + 17) + 10;
