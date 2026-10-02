// The cutaway plane: a drawing setting, not part of the study. Go computes
// the whole study as always; the cut hides whatever lies where n̂·p > d,
// n̂ = n/|n|, in world coordinates, in the live drawing and every export.
// This module holds the cut's fields, limits, words and geometry, read by
// the panel, the renderer, linework, playback and links alike.
import type { Batch, Pass } from "./scene";
import type { Vec3 } from "./types";

// What the plane cuts: the study's own sheet, every shaded sheet, or every
// sheet and line. The probe is never cut.
export type CutScope = "surface" | "sheets" | "all";
export type Cut = {
  enabled: boolean;
  normal: Vec3;
  offset: number;
  cuts: CutScope;
  edge: boolean;
};
export const defaultCut: Cut = {
  enabled: false,
  normal: { x: 0, y: 0, z: 1 },
  offset: 0,
  cuts: "sheets",
  edge: true,
};
export const maxCutValue = 100000;
export const cutScopes: { value: CutScope; label: string }[] = [
  { value: "surface", label: "The surface" },
  { value: "sheets", label: "Every sheet" },
  { value: "all", label: "Sheets and lines" },
];
// Field names, as errors name them.
export const cutFields = {
  x: "Cut normal x",
  y: "Cut normal y",
  z: "Cut normal z",
  offset: "Cut offset d",
} as const;
export const cutHelp = {
  enabled:
    "Hides everything on the side the normal points to, where n̂·p > d with n̂ = n/|n|. The plane is fixed in space: it stays put while the camera turns and while parameters animate. The study itself is unchanged; the cut only hides part of the drawing, here and in every export.",
  normal: `Any direction that is not zero; only its direction counts. Each component within ±${maxCutValue.toLocaleString("en-US")}.`,
  offset: `The plane's signed distance from the origin along n̂, within ±${maxCutValue.toLocaleString("en-US")}.`,
  cuts: "The surface is the study's own sheet: the patch, mirror or interface, ribbon, tube, or level surface. Every sheet adds the offset, focal or caustic sheets and the receiver. Sheets and lines cuts the base curve and every construction line too. The probe is never cut.",
  edge: "Where the drawn sheets meet the plane, found on their triangles. It follows the mesh, so it is as close to the surface as the mesh is; it is not a refined section curve. An implicit surface's Section curves are traced on F itself.",
};

export type Plane = { normal: Vec3; offset: number };
export type CutError = { field: string; message: string };
export function cutPlane(cut: Cut): Plane | CutError {
  for (const axis of ["x", "y", "z"] as const) {
    const v = cut.normal[axis];
    if (!Number.isFinite(v))
      return { field: cutFields[axis], message: "must be a finite number." };
    if (Math.abs(v) > maxCutValue)
      return {
        field: cutFields[axis],
        message: `must be within ±${maxCutValue}.`,
      };
  }
  if (!Number.isFinite(cut.offset))
    return { field: cutFields.offset, message: "must be a finite number." };
  if (Math.abs(cut.offset) > maxCutValue)
    return {
      field: cutFields.offset,
      message: `must be within ±${maxCutValue}.`,
    };
  const { x, y, z } = cut.normal,
    length = Math.hypot(x, y, z);
  if (!(length > 0))
    return { field: "Cut normal", message: "must not be zero." };
  return {
    normal: { x: x / length, y: y / length, z: z / length },
    offset: cut.offset,
  };
}

// What the renderer and linework need: the plane, what it cuts, and
// whether to draw its edge.
export type CutSpec = { plane: Plane; scope: CutScope; edge: boolean };
// The cut as drawn, with an animation's offset in place of the entered one:
// nothing when it is off, or when it is invalid, with the reason.
export function cutSpec(
  cut: Cut,
  offset?: number,
): { spec: CutSpec | null; error?: CutError } {
  if (!cut.enabled) return { spec: null };
  const plane = cutPlane(cut);
  if ("message" in plane) return { spec: null, error: plane };
  return {
    spec: {
      plane: offset === undefined ? plane : { ...plane, offset },
      scope: cut.cuts,
      edge: cut.edge,
    },
  };
}

export function isCut(
  pass: Pick<Pass, "layer" | "sheet">,
  scope: CutScope,
): boolean {
  if (pass.layer === "probe" || pass.layer === "cut") return false;
  if (scope === "all") return true;
  if (scope === "sheets") return pass.sheet;
  return pass.sheet && pass.layer === "surface";
}

// The edge's ink (see palette.ts).
export const cutInk = 12;

// Where the triangles of the cut sheets cross the plane, as line pairs, or
// null when they do not. Corners where n̂·p = d count as kept, as in the
// drawing, which hides only n̂·p > d. Each crossing is interpolated from
// its edge's two corners taken in coordinate order, so the two triangles
// sharing an edge give the same point exactly, and pieces join. A triangle
// with a nonfinite corner, or one lying in the plane, leaves no edge.
export function cutEdges(
  passes: Pass[],
  plane: Plane,
  scope: CutScope,
): Batch | null {
  const { normal: n, offset: d } = plane;
  const out: number[] = [];
  const corner = [0, 0, 0],
    side = [0, 0, 0];
  for (const pass of passes) {
    if (!pass.sheet || !isCut(pass, scope)) continue;
    const { data, indices } = pass.batch;
    const count = indices ? indices.length : data.length / 7;
    const vertex = (c: number) => (indices ? indices[c] : c);
    const crossing = (a: number, b: number) => {
      // Coordinate order, so both triangles on an edge agree.
      const pa = 7 * a,
        pb = 7 * b;
      if (
        data[pa] > data[pb] ||
        (data[pa] === data[pb] &&
          (data[pa + 1] > data[pb + 1] ||
            (data[pa + 1] === data[pb + 1] && data[pa + 2] > data[pb + 2])))
      )
        [a, b] = [b, a];
      const ca = distance(a),
        cb = distance(b),
        t = ca / (ca - cb);
      const p = 7 * a,
        q = 7 * b;
      return [0, 1, 2].map(
        (k) => data[p + k] + (data[q + k] - data[p + k]) * t,
      );
    };
    const distance = (v: number) =>
      n.x * data[7 * v] + n.y * data[7 * v + 1] + n.z * data[7 * v + 2] - d;
    for (let c = 0; c + 2 < count; c += 3) {
      let finite = true,
        removed = 0;
      for (let j = 0; j < 3; j++) {
        corner[j] = vertex(c + j);
        const value = distance(corner[j]);
        if (!Number.isFinite(value)) finite = false;
        side[j] = value > 0 ? 1 : 0;
        removed += side[j];
      }
      if (!finite || removed === 0 || removed === 3) continue;
      const ends: number[][] = [];
      for (const [i, j] of [
        [0, 1],
        [1, 2],
        [2, 0],
      ])
        if (side[i] !== side[j]) ends.push(crossing(corner[i], corner[j]));
      const [a, b] = ends;
      if (a[0] === b[0] && a[1] === b[1] && a[2] === b[2]) continue;
      out.push(a[0], a[1], a[2], 0, 0, 1, 0, b[0], b[1], b[2], 0, 0, 1, 0);
    }
  }
  return out.length
    ? { mode: "lines", data: new Float32Array(out), ink: cutInk }
    : null;
}

// The range of n̂·p over the cut passes' points, farthest first: the peel
// starts where nothing is hidden and ends where everything is. Null when
// the cut reaches nothing drawn.
export function sweepExtent(
  passes: Pass[],
  plane: Plane,
  scope: CutScope,
): [number, number] | null {
  const n = plane.normal;
  let hi = -Infinity,
    lo = Infinity;
  for (const pass of passes) {
    if (!isCut(pass, scope)) continue;
    const data = pass.batch.data;
    for (let i = 0; i + 2 < data.length; i += 7) {
      const v = n.x * data[i] + n.y * data[i + 1] + n.z * data[i + 2];
      if (!Number.isFinite(v)) continue;
      if (v > hi) hi = v;
      if (v < lo) lo = v;
    }
  }
  return hi >= lo ? [hi, lo] : null;
}
// The peel's offset at progress p, exactly its ends at 0 and 1.
export const sweepOffset = (p: number, [hi, lo]: [number, number]) =>
  p <= 0 ? hi : p >= 1 ? lo : hi + (lo - hi) * p;

// The cut as an export's metadata records it.
export function cutRecord(spec: CutSpec) {
  return {
    normal: spec.plane.normal,
    offset: spec.plane.offset,
    cuts: spec.scope,
    edge: spec.edge,
    statement: `Hidden where n̂·p > d, on ${
      spec.scope === "surface"
        ? "the study's own surface"
        : spec.scope === "sheets"
          ? "every shaded sheet"
          : "every sheet and line"
    }. The study is unchanged.${
      spec.edge
        ? " The cut edge is where the drawn triangles meet the plane, not a refined section curve."
        : ""
    }`,
  };
}
