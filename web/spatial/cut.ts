// The cutaway plane: a drawing setting, not part of the study. Go computes
// the whole study as always; the cut hides whatever lies where n̂·p > d,
// n̂ = n/|n|, in world coordinates, in the live drawing and every export.
// Further planes make a notch or a box: hidden beyond every plane, the cut
// removes where all their far sides meet; hidden beyond any, it keeps where
// all their near sides meet. This module holds the cut's fields, limits,
// words and geometry, read by the panel, the renderer, linework, playback
// and links alike.
import { tiered } from "../help";
import type { Batch, Pass } from "./scene";
import type { Vec3 } from "./types";
// What the plane cuts: the study's own sheet, every shaded sheet, or every
// sheet and line. The probe is never cut.
export type CutScope = "surface" | "sheets" | "all";
// With more than one plane: hidden beyond every plane, or beyond any.
export type CutBeyond = "every" | "any";
export type CutPlaneInput = { normal: Vec3; offset: number };
// The first plane is the cut's own normal and offset; others are optional,
// so cuts and links made before them are unchanged.
export type Cut = {
  enabled: boolean;
  normal: Vec3;
  offset: number;
  cuts: CutScope;
  edge: boolean;
  others?: CutPlaneInput[];
  beyond?: CutBeyond;
};
// Six planes bound a box.
export const maxCutPlanes = 6;
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
export const cutBeyonds: { value: CutBeyond; label: string }[] = [
  { value: "every", label: "Beyond every plane" },
  { value: "any", label: "Beyond any plane" },
];
// Field names, as errors name them: the first plane's, and plane k's
// (counting the first as 1).
export const cutFields = {
  x: "Cut normal x",
  y: "Cut normal y",
  z: "Cut normal z",
  offset: "Cut offset d",
} as const;
export const otherCutFields = (k: number) => ({
  normal: `Cut plane ${k} normal`,
  x: `Cut plane ${k} normal x`,
  y: `Cut plane ${k} normal y`,
  z: `Cut plane ${k} normal z`,
  offset: `Cut plane ${k} offset d`,
});
export const cutHelp = {
  enabled: tiered(
    "Hides everything on the side the plane's normal points to, here and in every export.",
    "That is where n̂·p > d, with n̂ = n/|n|. The plane is fixed in space: it stays put while the camera turns and while parameters animate. The study itself is unchanged; the cut only hides part of the drawing.",
  ),
  normal: `Any nonzero direction, each component within ±${maxCutValue.toLocaleString("en-US")}.`,
  offset: `The plane's signed distance from the origin along n̂, within ±${maxCutValue.toLocaleString("en-US")}.`,
  cuts: tiered(
    "The surface alone, every sheet, or sheets and lines. Never the probe.",
    "The surface is the study's own sheet: the patch, mirror or interface, ribbon, tube, or level surface. Every sheet adds the offset, focal or caustic sheets and the receiver. Sheets and lines also cuts the curve and construction lines.",
  ),
  edge: tiered(
    "Draws where the sheets meet the plane; with several planes, where they meet the boundary of what is hidden.",
    "It is found on the sheets' triangles, so it is as close to the surface as the mesh is, not a refined section curve. An implicit surface's Section curves are traced on F itself.",
  ),
  add: `Up to ${maxCutPlanes} planes in all; six bound a box. A new plane is through the center, facing along the first axis no plane faces yet.`,
  beyond: tiered(
    "Every plane cuts a notch; any plane keeps what lies inside all.",
    "Beyond every plane, two planes cut a wedge and three a corner. Beyond any plane, two keep a slab and six a box.",
  ),
};

// The planes as entered, the first first, and a cut with them replaced:
// the first becomes the cut's own normal and offset, and a cut left with one
// plane has no others and no choice of side, as before there were any.
export const cutPlaneInputs = (cut: Cut): CutPlaneInput[] => [
  { normal: cut.normal, offset: cut.offset },
  ...(cut.others ?? []),
];
export function withCutPlanes(cut: Cut, planes: CutPlaneInput[]): Cut {
  const [first, ...others] = planes;
  return {
    enabled: cut.enabled,
    normal: first.normal,
    offset: first.offset,
    cuts: cut.cuts,
    edge: cut.edge,
    ...(others.length && { others, beyond: cut.beyond ?? "every" }),
  };
}
// A new plane through the given center, facing along the first of the six
// axis directions (+x, +y, +z, then −x, −y, −z) no plane faces yet; the
// cut unchanged when it has as many planes as it may.
export function addCutPlane(cut: Cut, center: Vec3): Cut {
  const planes = cutPlaneInputs(cut);
  if (planes.length >= maxCutPlanes) return cut;
  const faces = (p: CutPlaneInput, axis: Vec3) => {
    const { x, y, z } = p.normal,
      l = Math.hypot(x, y, z);
    return (
      l > 0 &&
      Math.abs(x / l - axis.x) +
        Math.abs(y / l - axis.y) +
        Math.abs(z / l - axis.z) <
        1e-9
    );
  };
  const axis = [
    { x: 1, y: 0, z: 0 },
    { x: 0, y: 1, z: 0 },
    { x: 0, y: 0, z: 1 },
    { x: -1, y: 0, z: 0 },
    { x: 0, y: -1, z: 0 },
    { x: 0, y: 0, z: -1 },
  ].find((a) => !planes.some((p) => faces(p, a)))!;
  return withCutPlanes(cut, [
    ...planes,
    {
      normal: axis,
      offset: axis.x * center.x + axis.y * center.y + axis.z * center.z + 0,
    },
  ]);
}

export type Plane = { normal: Vec3; offset: number };
export type CutError = { field: string; message: string };
export const cutPlane = (cut: Cut): Plane | CutError =>
  checkedPlane(cut, { ...cutFields, normal: "Cut normal" });
function checkedPlane(
  input: CutPlaneInput,
  fields: Record<"x" | "y" | "z" | "offset" | "normal", string>,
): Plane | CutError {
  for (const axis of ["x", "y", "z"] as const) {
    const v = input.normal[axis];
    if (!Number.isFinite(v))
      return { field: fields[axis], message: "must be a finite number." };
    if (Math.abs(v) > maxCutValue)
      return {
        field: fields[axis],
        message: `must be within ±${maxCutValue}.`,
      };
  }
  if (!Number.isFinite(input.offset))
    return { field: fields.offset, message: "must be a finite number." };
  if (Math.abs(input.offset) > maxCutValue)
    return {
      field: fields.offset,
      message: `must be within ±${maxCutValue}.`,
    };
  const { x, y, z } = input.normal,
    length = Math.hypot(x, y, z);
  if (!(length > 0))
    return { field: fields.normal, message: "must not be zero." };
  return {
    normal: { x: x / length, y: y / length, z: z / length },
    offset: input.offset,
  };
}
// The other planes, checked and named, or the first refusal.
export function otherPlanes(cut: Cut): Plane[] | CutError {
  const others = cut.others ?? [];
  if (others.length + 1 > maxCutPlanes)
    return {
      field: "Cut planes",
      message: `must be at most ${maxCutPlanes}.`,
    };
  const out: Plane[] = [];
  for (const [i, input] of others.entries()) {
    const p = checkedPlane(input, otherCutFields(i + 2));
    if ("message" in p) return p;
    out.push(p);
  }
  return out;
}

// What the renderer and linework need: the plane, what it cuts, and
// whether to draw its edge; with other planes, those and which side of them
// is hidden, both absent for a single plane.
export type CutSpec = {
  plane: Plane;
  scope: CutScope;
  edge: boolean;
  others?: Plane[];
  beyond?: CutBeyond;
};
// The cut as drawn, with an animation's offset in place of the entered one,
// which moves every other plane by as much: nothing when it is off, or
// when it is invalid, with the reason.
export function cutSpec(
  cut: Cut,
  offset?: number,
): { spec: CutSpec | null; error?: CutError } {
  if (!cut.enabled) return { spec: null };
  const plane = cutPlane(cut);
  if ("message" in plane) return { spec: null, error: plane };
  const others = otherPlanes(cut);
  if ("message" in others) return { spec: null, error: others };
  const spec: CutSpec = {
    plane,
    ...(others.length && { others, beyond: cut.beyond ?? "every" }),
    scope: cut.cuts,
    edge: cut.edge,
  };
  return { spec: offset === undefined ? spec : movedCut(spec, offset) };
}
// A spec with its first plane at the offset an animation gives it and every
// other plane moved by as much, so a notch or a box keeps its shape.
export function movedCut(spec: CutSpec, offset: number): CutSpec {
  const shift = offset - spec.plane.offset;
  return {
    ...spec,
    plane: { ...spec.plane, offset },
    ...(spec.others && {
      others: spec.others.map((p) => ({ ...p, offset: p.offset + shift })),
    }),
  };
}
// Every plane of a spec, the first first.
export const specPlanes = (spec: CutSpec): Plane[] => [
  spec.plane,
  ...(spec.others ?? []),
];
// Whether a point is hidden, from its n̂ᵢ·p − dᵢ for every plane: beyond
// every plane, or beyond any. Points on a plane are on its kept side.
export const hiddenBy = (sides: ArrayLike<number>, beyond: CutBeyond) => {
  if (beyond === "any") {
    for (let i = 0; i < sides.length; i++) if (sides[i] > 0) return true;
    return false;
  }
  for (let i = 0; i < sides.length; i++) if (!(sides[i] > 0)) return false;
  return sides.length > 0;
};

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
//
// With other planes, the edge is where the sheets meet the boundary of what
// is hidden: each plane's own edge, clipped to where every other plane is
// beyond (hidden beyond every plane) or kept (beyond any). Pieces of two
// planes meet where both clip, to rounding.
export function cutEdges(
  passes: Pass[],
  plane: Plane,
  scope: CutScope,
  others: Plane[] = [],
  beyond: CutBeyond = "every",
): Batch | null {
  if (!others.length) return planeEdges(passes, plane, scope);
  const planes = [plane, ...others];
  // Kept where f ≥ 0: on or beyond another plane, or on or before it.
  const sign = beyond === "every" ? 1 : -1;
  const out: number[] = [];
  for (const [i, own] of planes.entries()) {
    const data = planeEdges(passes, own, scope)?.data;
    if (!data) continue;
    for (let k = 0; k + 13 < data.length; k += 14) {
      let t0 = 0,
        t1 = 1;
      for (const [j, { normal: n, offset }] of planes.entries()) {
        if (j === i) continue;
        const f = (q: number) =>
          sign *
          (n.x * data[q] + n.y * data[q + 1] + n.z * data[q + 2] - offset);
        const fa = f(k),
          fb = f(k + 7);
        if (fa >= 0 && fb >= 0) continue;
        if (!(fa >= 0 || fb >= 0)) {
          t1 = -1;
          break;
        }
        const t = fa / (fa - fb);
        if (fa < 0) t0 = Math.max(t0, t);
        else t1 = Math.min(t1, t);
      }
      if (!(t0 < t1)) continue;
      const end = (t: number) =>
        [0, 1, 2].map((c) =>
          t === 0
            ? data[k + c]
            : t === 1
              ? data[k + 7 + c]
              : data[k + c] + (data[k + 7 + c] - data[k + c]) * t,
        );
      const a = end(t0),
        b = end(t1);
      if (a[0] === b[0] && a[1] === b[1] && a[2] === b[2]) continue;
      out.push(a[0], a[1], a[2], 0, 0, 1, 0, b[0], b[1], b[2], 0, 0, 1, 0);
    }
  }
  return out.length
    ? { mode: "lines", data: new Float32Array(out), ink: cutInk }
    : null;
}
function planeEdges(
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
//
// With other planes the peel moves them all with the first, so it is the
// range of the first plane's offset d + g(p), where g is the least of
// n̂ᵢ·p − dᵢ over the planes (hidden beyond every plane) or the greatest
// (beyond any): a point is hidden exactly where g(p) exceeds the shift.
export function sweepExtent(
  passes: Pass[],
  plane: Plane,
  scope: CutScope,
  others: Plane[] = [],
  beyond: CutBeyond = "every",
): [number, number] | null {
  const n = plane.normal,
    planes = [plane, ...others],
    every = beyond === "every";
  const several = (data: Float32Array, i: number) => {
    let g = every ? Infinity : -Infinity;
    for (const { normal: m, offset } of planes) {
      const s = m.x * data[i] + m.y * data[i + 1] + m.z * data[i + 2] - offset;
      g = every ? Math.min(g, s) : Math.max(g, s);
    }
    return plane.offset + g;
  };
  let hi = -Infinity,
    lo = Infinity;
  for (const pass of passes) {
    if (!isCut(pass, scope)) continue;
    const data = pass.batch.data;
    for (let i = 0; i + 2 < data.length; i += 7) {
      const v = others.length
        ? several(data, i)
        : n.x * data[i] + n.y * data[i + 1] + n.z * data[i + 2];
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

// The cut as an export's metadata records it, naming other planes only
// when there are some.
export function cutRecord(spec: CutSpec) {
  const several = !!spec.others?.length;
  return {
    normal: spec.plane.normal,
    offset: spec.plane.offset,
    ...(several && { others: spec.others, beyond: spec.beyond }),
    cuts: spec.scope,
    edge: spec.edge,
    statement: `Hidden ${
      several
        ? spec.beyond === "any"
          ? "beyond any plane, where n̂ᵢ·p > dᵢ for some plane i"
          : "beyond every plane, where n̂ᵢ·p > dᵢ for each plane i"
        : "where n̂·p > d"
    }, on ${
      spec.scope === "surface"
        ? "the study's own surface"
        : spec.scope === "sheets"
          ? "every shaded sheet"
          : "every sheet and line"
    }. The study is unchanged.${
      spec.edge
        ? several
          ? " The cut edge is where the drawn triangles meet the boundary of what is hidden, not a refined section curve."
          : " The cut edge is where the drawn triangles meet the plane, not a refined section curve."
        : ""
    }`,
  };
}
