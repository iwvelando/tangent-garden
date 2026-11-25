// Descriptor-owned 4D atlas vocabulary. No renderer or object registry is
// imported here, so each object's descriptor can publish its own catalog.
import { roundedRange, type AtlasAxis, type AtlasRanges } from "../atlas-queue";
import { defaultNearby, pathOf, spherePaths } from "./sphere-paths";
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
  track: "xw",
};
const alpha: AtlasAxis = {
  key: "alpha",
  label: "Central latitude α",
  symbol: "α",
  path: ["weave", "alpha"],
  track: "weave.alpha",
};
const projected = (c: Config) => c.mode !== "section";
export const rotationPair: TesseractAtlasPair = {
  id: "rotation",
  label: "4D rotations xw / yw",
  axes: [
    xw,
    {
      key: "yw",
      label: "yw angle",
      symbol: "yw",
      path: ["angles", 4],
      track: "yw",
    },
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
      track: "clip",
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
      track: "distance",
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
      track: "weave.amplitude",
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
  if (c.mode === "paired") {
    // At least the flower's 128 base segments, or the path's own.
    const segments = Math.max(128, spherePaths[pathOf(c)].segments(c));
    // A neighborhood draws its own fibers, the path's sample markers and
    // its stretch of the base curve (engine4 neighborhoodPoints).
    const k =
      c.weave!.sampling === "neighborhood"
        ? (c.weave!.nearby ?? defaultNearby)
        : 0;
    const fibers = k || n;
    // A carried point's trail of one turn and gap along its fiber, each
    // with a window crossing per interval, and two markers (engine4
    // transportPoints); the polygon's pieces include its corners.
    const transport = c.weave!.transport
      ? 2 * (spherePaths[pathOf(c)].transportPieces(c) + 2) +
        2 * (Math.floor(s / 2) + 2) +
        2
      : 0;
    return (
      transport +
      (fibers + 1) * (s + 2) +
      7 * (s + 1) +
      fibers +
      1 +
      Math.max(0, segments - s) +
      8 +
      (k ? n + segments + 2 : 0)
    );
  }
  return (
    c.count * (c.weave!.family === "tori" ? 2 * n : n) * (s + 2) + 3 * (s + 1)
  );
}
// The origin circle's bound (engine4/root.go rootPoints), for degree d: N
// intervals divide the d circuits, so a circuit or trace piece of length 2π
// holds at most N/d + 4 points, and each view draws d circuits, a trace of
// at most N/d + 6 points in two pieces, and three markers. Refinement near
// the branch point splits each interval into at most p = ⌈1/|1 − k|⌉
// parts, since |z| ≥ r|1 − k|, so a piece meeting N/d + 2 intervals holds
// at most (N/d + 2)p + 2 points: counting N + 2d intervals covers that. A
// circle that misses 0 adds the other d − 1 sheets' loops, one circuit
// each in two views. At d = 2 this is the square root's bound. The engine
// counts the exact total before evaluating.
export const rootAtlasPoints = (c: Config) => {
  // A noncircular path is refined by its own curvature,
  // counted only by the engine: reserve the whole budget.
  if (c.root?.path) return 65536;
  const k = c.root?.offset ?? 0;
  const d = c.root?.degree ?? 2;
  const parts = Math.max(1, Math.ceil(1 / Math.abs(1 - k)));
  const n = parts === 1 ? c.samples : (c.samples + 2 * d) * parts;
  return (
    3 * (n + 4 * d + n / d + 9) + 10 + (k > 1 ? 2 * (d - 1) * (n / d + 4) : 0)
  );
};
