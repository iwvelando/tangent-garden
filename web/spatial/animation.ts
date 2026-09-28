import { usesSpatialPole } from "./types";
import { harmonicLabels } from "./harmonic";
import type {
  SpatialConfig,
  SpatialResult,
  Frame,
  Vec3,
  Bounds3,
  SpatialHarmonicResult,
} from "./types";
import type { View } from "./renderer";
export type { Frame };
export type Viewport = View;
export type CameraMode = "hold" | "current" | "follow" | "fit";
// A harmonic term's frequency or one coordinate of its vector A or B,
// numbered from 1 in term order.
export type HarmonicTarget =
  `harmonic${number}${"Frequency" | "Ax" | "Ay" | "Az" | "Bx" | "By" | "Bz"}`;
type NamedTarget =
  | "poleX"
  | "poleY"
  | "poleZ"
  | "centerX"
  | "centerY"
  | "centerZ"
  | "sphere"
  | "a"
  | "min"
  | "max"
  | "radius"
  | "tube"
  | "length"
  | "anchor"
  | "offset"
  | "from"
  | "to"
  | "count"
  | "samples"
  | "lines"
  | "c0x"
  | "c0y"
  | "c0z"
  | "angle"
  | "twist"
  | "width"
  | "distance"
  | "strands"
  | "normalX"
  | "normalY"
  | "normalZ"
  | "rate"
  | "shift"
  | "sphereRadius"
  | "meridians"
  | "escape";
// One coordinate of a vector field's seed, numbered from 1.
export type SeedTarget = `seed${number}${"X" | "Y" | "Z"}`;
export type Target = NamedTarget | HarmonicTarget | SeedTarget;
export type Track = { target: Target; from: string; to: string };
export type NumericTrack = { target: Target; from: number; to: number };
export type AnimationView = {
  frame: Frame;
  final: Frame;
  camera: CameraMode;
  heldView?: View;
  length: number;
  progress: number;
  mode: "reveal" | "parameters" | "orbit";
};
export const targetLabels: Record<NamedTarget, string> = {
  poleX: "Pole x",
  poleY: "Pole y",
  poleZ: "Pole z",
  centerX: "Inversion center x",
  centerY: "Inversion center y",
  centerZ: "Inversion center z",
  sphere: "Inversion radius R",
  a: "Shape parameter a",
  min: "Domain start",
  max: "Domain end",
  radius: "Major radius R",
  tube: "Minor radius r",
  length: "Tangent reach L",
  anchor: "Anchor t₀",
  offset: "String length c",
  from: "Family c from",
  to: "Family c to",
  count: "Involutes",
  samples: "Curve samples",
  lines: "Tangent lines",
  c0x: harmonicLabels.center("x"),
  c0y: harmonicLabels.center("y"),
  c0z: harmonicLabels.center("z"),
  angle: "Angle θ₀",
  twist: "Twist (turns)",
  width: "Half-width w",
  distance: "Offset d",
  strands: "Offset strands",
  normalX: "N₀ x",
  normalY: "N₀ y",
  normalZ: "N₀ z",
  rate: "Rate m",
  shift: "Shift δ",
  sphereRadius: "Tube radius R",
  meridians: "Meridians",
  escape: "Escape radius R",
};
const subscript = (n: number) =>
  String(n).replace(/\d/g, (d) => "₀₁₂₃₄₅₆₇₈₉"[+d]);
export const seedLabel = (n: number, axis: "x" | "y" | "z") =>
  `Seed ${axis}${subscript(n)}`;
const isSeed = (t: Target): t is SeedTarget => t.startsWith("seed");
const seedTarget = (t: Target) => {
  const match = /^seed(\d+)([XYZ])$/.exec(t);
  return match
    ? {
        index: +match[1] - 1,
        axis: match[2].toLowerCase() as "x" | "y" | "z",
      }
    : null;
};
// Framed-construction targets and the FrameConfig field each one moves.
const frameFields = {
  angle: "angle",
  twist: "twist",
  width: "width",
  distance: "offset",
  strands: "strands",
} as const;
const isFrame = (t: Target): t is keyof typeof frameFields => t in frameFields;
const isReference = (t: Target): t is "normalX" | "normalY" | "normalZ" =>
  t === "normalX" || t === "normalY" || t === "normalZ";
const referenceAxis = (t: "normalX" | "normalY" | "normalZ") =>
  t.slice(6).toLowerCase() as "x" | "y" | "z";
const harmonicTarget = (t: Target) => {
  const match = /^harmonic(\d+)(Frequency|A|B)([xyz])?$/.exec(t);
  if (!match) return null;
  return {
    index: +match[1] - 1,
    field: (match[2] === "A"
      ? "cosine"
      : match[2] === "B"
        ? "sine"
        : "frequency") as "frequency" | "cosine" | "sine",
    axis: match[3] as "x" | "y" | "z" | undefined,
  };
};
const isHarmonic = (t: Target): t is HarmonicTarget => t.startsWith("harmonic");
const isCenter = (t: Target): t is "c0x" | "c0y" | "c0z" =>
  t === "c0x" || t === "c0y" || t === "c0z";
const centerAxis = (t: "c0x" | "c0y" | "c0z") => t.slice(2) as "x" | "y" | "z";
export const targetLabel = (c: SpatialConfig, t: Target): string => {
  const h = harmonicTarget(t);
  if (h)
    return h.field === "frequency"
      ? harmonicLabels.frequency(h.index + 1)
      : harmonicLabels[h.field](h.index + 1, h.axis!);
  const seed = seedTarget(t);
  if (seed) return seedLabel(seed.index + 1, seed.axis);
  return t === "lines" && c.construction === "none"
    ? c.format === "field"
      ? "Field arrows"
      : "Representative samples"
    : t === "lines" && c.construction === "canal"
      ? "Contact circles"
      : t === "lines" && c.construction === "ruled"
        ? "Rulings"
        : t === "lines" && c.construction === "framed"
          ? "Frames & cross-lines"
          : t === "lines" && c.construction === "involute"
            ? "Unwinding strings"
            : t === "lines" && c.construction === "inversion"
              ? "Correspondences"
              : t === "lines" && usesSpatialPole(c)
                ? "Projection constructions"
                : targetLabels[t as NamedTarget];
};
export const integerTargets: Target[] = [
  "samples",
  "lines",
  "count",
  "strands",
  "meridians",
];
const curveTargets = ["a", "min", "max"] as const;
const involuteTargets = ["anchor", "offset", "from", "to", "count"] as const;
type CurveTarget = (typeof curveTargets)[number];
type InvoluteTarget = (typeof involuteTargets)[number];
const isCurve = (t: Target): t is CurveTarget =>
  (curveTargets as readonly Target[]).includes(t);
const isInvolute = (t: Target): t is InvoluteTarget =>
  (involuteTargets as readonly Target[]).includes(t);
// Animating the anchor or c recomputes the whole arc length in Go for every
// frame, so a track never reuses a prefix measured from another anchor.
export const availableTargets = (c: SpatialConfig): Target[] => {
  const construction: Target[] =
    c.construction === "none"
      ? []
      : c.construction === "canal"
        ? [
            "sphereRadius",
            "angle",
            "twist",
            "meridians",
            "normalX",
            "normalY",
            "normalZ",
          ]
        : c.construction === "ruled"
          ? ["shift", "rate"]
          : c.construction === "framed"
            ? [
                "angle",
                "twist",
                "width",
                "distance",
                "strands",
                // N₀ only starts the transported frame; Frenet ignores it.
                ...(c.frame.kind === "rotation-minimizing"
                  ? (["normalX", "normalY", "normalZ"] as const)
                  : []),
              ]
            : c.construction === "involute"
              ? c.involute.family.enabled
                ? ["from", "to", "count", "anchor"]
                : ["offset", "anchor"]
              : c.construction === "inversion"
                ? [
                    "centerX",
                    "centerY",
                    "centerZ",
                    "sphere",
                    ...(usesSpatialPole(c)
                      ? (["poleX", "poleY", "poleZ"] as const)
                      : []),
                  ]
                : usesSpatialPole(c)
                  ? ["poleX", "poleY", "poleZ"]
                  : ["length"];
  const curve: Target[] =
    c.format === "parametric"
      ? ["a", "min", "max"]
      : c.format === "field"
        ? [
            "a",
            ...c.field.seeds.flatMap((_, k) =>
              (["X", "Y", "Z"] as const).map(
                (axis) => `seed${k + 1}${axis}` as const,
              ),
            ),
            "escape",
            "min",
            "max",
          ]
        : c.format === "harmonic"
          ? [
              "c0x",
              "c0y",
              "c0z",
              ...c.harmonic.terms.flatMap((_, k) =>
                (
                  ["Frequency", "Ax", "Ay", "Az", "Bx", "By", "Bz"] as const
                ).map((field) => `harmonic${k + 1}${field}` as const),
              ),
              "min",
              "max",
            ]
          : ["radius", "tube"];
  return c.format === "parametric" || c.format === "field"
    ? [curve[0], ...construction, ...curve.slice(1), "samples", "lines"]
    : [...construction, ...curve, "samples", "lines"];
};
export function targetValue(c: SpatialConfig, t: Target, _length = 0): number {
  if (t === "poleX") return c.pole.x;
  if (t === "poleY") return c.pole.y;
  if (t === "poleZ") return c.pole.z;
  if (t === "centerX") return c.inversion.center.x;
  if (t === "centerY") return c.inversion.center.y;
  if (t === "centerZ") return c.inversion.center.z;
  if (t === "sphere") return c.inversion.radius;
  if (isCenter(t)) return c.harmonic.center[centerAxis(t)];
  if (t === "rate" || t === "shift") return c.ruled[t];
  if (t === "sphereRadius") return c.canal.radius;
  if (t === "meridians") return c.canal.meridians;
  if (isFrame(t)) return c.frame[frameFields[t]];
  if (isReference(t)) return c.frame.reference[referenceAxis(t)];
  if (isHarmonic(t)) {
    const h = harmonicTarget(t)!,
      term = c.harmonic.terms[h.index];
    if (!term) return NaN;
    return h.field === "frequency" ? term.frequency : term[h.field][h.axis!];
  }
  if ((t === "min" || t === "max") && c.format === "harmonic")
    return c.harmonic[t];
  if (isSeed(t)) {
    const seed = seedTarget(t)!;
    return c.field.seeds[seed.index]?.[seed.axis] ?? NaN;
  }
  if (t === "escape") return c.field.escape;
  if (isCurve(t) && c.format === "field") return c.field[t];
  if (isCurve(t)) return c.curve[t];
  if (t === "anchor" || t === "offset") return c.involute[t];
  if (isInvolute(t)) return c.involute.family[t];
  return c[t];
}
export function applyTracks(
  base: SpatialConfig,
  tracks: NumericTrack[],
  p: number,
  _length = 0,
) {
  const config = structuredClone(base);
  p = Math.max(0, Math.min(1, p));
  for (const t of tracks) {
    let v = t.from * (1 - p) + t.to * p;
    if (integerTargets.includes(t.target)) v = Math.round(v);
    if (t.target === "poleX") config.pole.x = v;
    else if (t.target === "poleY") config.pole.y = v;
    else if (t.target === "poleZ") config.pole.z = v;
    else if (t.target === "centerX") config.inversion.center.x = v;
    else if (t.target === "centerY") config.inversion.center.y = v;
    else if (t.target === "centerZ") config.inversion.center.z = v;
    else if (t.target === "sphere") config.inversion.radius = v;
    else if (isCenter(t.target))
      config.harmonic.center[centerAxis(t.target)] = v;
    else if (t.target === "rate" || t.target === "shift")
      config.ruled[t.target] = v;
    else if (t.target === "sphereRadius") config.canal.radius = v;
    else if (t.target === "meridians") config.canal.meridians = v;
    else if (isFrame(t.target)) config.frame[frameFields[t.target]] = v;
    else if (isReference(t.target))
      config.frame.reference[referenceAxis(t.target)] = v;
    else if (isHarmonic(t.target)) {
      const h = harmonicTarget(t.target)!,
        term = config.harmonic.terms[h.index];
      if (!term) continue;
      if (h.field === "frequency") term.frequency = v;
      else term[h.field][h.axis!] = v;
    } else if (
      (t.target === "min" || t.target === "max") &&
      config.format === "harmonic"
    )
      config.harmonic[t.target] = v;
    else if (isSeed(t.target)) {
      const seed = seedTarget(t.target)!;
      if (config.field.seeds[seed.index])
        config.field.seeds[seed.index][seed.axis] = v;
    } else if (t.target === "escape") config.field.escape = v;
    else if (isCurve(t.target) && config.format === "field")
      config.field[t.target] = v;
    else if (isCurve(t.target)) config.curve[t.target] = v;
    else if (t.target === "anchor" || t.target === "offset")
      config.involute[t.target] = v;
    else if (isInvolute(t.target)) config.involute.family[t.target] = v;
    else config[t.target] = v;
  }
  return { config, length: config.length };
}
// Camera fitting only; no curve evaluation. Fit families independently so a
// short base never hides a distant derived edge. Same outer Tukey rule as Go.
export function fitBounds(...families: (Vec3 | null)[][]): Bounds3 {
  const lo = [Infinity, Infinity, Infinity],
    hi = [-Infinity, -Infinity, -Infinity];
  for (const family of families) {
    const points = family.filter((p): p is Vec3 => p !== null);
    if (!points.length) continue;
    (["x", "y", "z"] as const).forEach((key, i) => {
      const vs = points.map((p) => p[key]).sort((a, b) => a - b);
      let a = vs[0],
        b = vs.at(-1)!;
      if (vs.length >= 8) {
        const q1 = vs[Math.floor(vs.length / 4)],
          q3 = vs[Math.floor((3 * vs.length) / 4)],
          spread = q3 - q1;
        if (spread > 1e-12) {
          a = vs.find((v) => v >= q1 - 3 * spread)!;
          b = [...vs].reverse().find((v) => v <= q3 + 3 * spread)!;
        }
      }
      lo[i] = Math.min(lo[i], a);
      hi[i] = Math.max(hi[i], b);
    });
  }
  if (!Number.isFinite(lo[0]))
    return { center: { x: 0, y: 0, z: 0 }, radius: 1 };
  const center = {
    x: (lo[0] + hi[0]) / 2,
    y: (lo[1] + hi[1]) / 2,
    z: (lo[2] + hi[2]) / 2,
  };
  let radius = 1e-4;
  for (const family of families)
    for (const p of family)
      if (
        p &&
        p.x >= lo[0] &&
        p.x <= hi[0] &&
        p.y >= lo[1] &&
        p.y <= hi[1] &&
        p.z >= lo[2] &&
        p.z <= hi[2]
      )
        radius = Math.max(
          radius,
          Math.hypot(p.x - center.x, p.y - center.y, p.z - center.z),
        );
  return { center, radius };
}
// A harmonic curve's joints and ellipse axis extents, one pair of families
// per term, as Go frames them.
export function harmonicFamilies(h: SpatialHarmonicResult | undefined) {
  if (!h) return [];
  return h.terms.flatMap((term, k) => {
    const reach = (["x", "y", "z"] as const).map((axis) =>
      Math.hypot(term.cosine[axis], term.sine[axis]),
    );
    const joints = h.positions.map((s) => s.joints[k]);
    const extents = joints.flatMap((j) =>
      (["x", "y", "z"] as const).flatMap((axis, i) => [
        { ...j, [axis]: j[axis] - reach[i] },
        { ...j, [axis]: j[axis] + reach[i] },
      ]),
    );
    return [joints, extents];
  });
}
export function reveal(result: SpatialResult, p: number): SpatialResult {
  const last = Math.floor(
    Math.max(0, Math.min(1, p)) * (result.base.length - 1),
  );
  const base = result.base.slice(0, last + 1),
    minus = result.minus.slice(0, last + 1),
    plus = result.plus.slice(0, last + 1);
  // The involute keeps its anchor and final integration grid: reveal only
  // truncates the already-measured filaments, never re-measures a prefix.
  const involute = result.involute && {
    ...result.involute,
    members: result.involute.members.map((m) => ({
      ...m,
      points: m.points.slice(0, last + 1),
    })),
    strings: result.involute.strings.filter((r) => r.sampleIndex <= last),
  };
  const projection = result.projection && {
    ...result.projection,
    points: result.projection.points.slice(0, last + 1),
    feet: result.projection.feet.slice(0, last + 1),
    constructions: result.projection.constructions.filter(
      (c) => c.sampleIndex <= last,
    ),
  };
  const inversion = result.inversion && {
    ...result.inversion,
    source: result.inversion.source.slice(0, last + 1),
    points: result.inversion.points.slice(0, last + 1),
    breaks: result.inversion.breaks.slice(0, last + 1),
    correspondences: result.inversion.correspondences.filter(
      (c) => c.sampleIndex <= last,
    ),
  };
  const harmonic = result.harmonic && {
    ...result.harmonic,
    positions: result.harmonic.positions.filter((s) => s.sampleIndex <= last),
  };
  // The seam compares the last sample with the first, so it appears only
  // once the whole curve is shown.
  const frame = result.frame && {
    ...result.frame,
    frames: result.frame.frames.filter((g) => g.sampleIndex <= last),
    strands: result.frame.strands.map((s) => s.slice(0, last + 1)),
    breaks: result.frame.breaks.slice(0, last + 1),
    seam: last === result.base.length - 1 ? result.frame.seam : undefined,
  };
  const ruled = result.ruled && {
    ...result.ruled,
    breaks: result.ruled.breaks.slice(0, last + 1),
  };
  const canal = result.canal && {
    ...result.canal,
    circles: result.canal.circles.filter((g) => g.sampleIndex <= last),
    meridians: result.canal.meridians.map((m) => m.slice(0, last + 1)),
    breaks: result.canal.breaks.slice(0, last + 1),
  };
  // Every trajectory is revealed to the same time. An early stop falls
  // after a path's last known sample, so it is marked only once the reveal
  // passes the next.
  const reached = (path: (Vec3 | null)[]) => {
    let known = path.length - 1;
    while (known >= 0 && !path[known]) known--;
    return last >= Math.min(known + 1, path.length - 1);
  };
  const field = result.field && {
    ...result.field,
    paths: result.field.paths.map((p) => p.slice(0, last + 1)),
    arrows: result.field.arrows.filter((a) => a.sampleIndex <= last),
    ends: result.field.ends.map((e, k) =>
      reached(result.field!.paths[k]) ? e : { ...e, point: null },
    ),
  };
  const generating = [...harmonicFamilies(harmonic), ...(field?.paths ?? [])];
  return {
    ...result,
    base,
    minus,
    plus,
    breaks: result.breaks.slice(0, last + 1),
    mesh: result.mesh.filter((v) => v.sampleIndex <= last),
    rulings: result.rulings.filter((r) => r.sampleIndex <= last),
    involute,
    projection,
    inversion,
    harmonic,
    field,
    frame,
    ruled,
    canal,
    bounds: inversion
      ? fitBounds(
          base,
          inversion.source,
          inversion.points,
          [inversion.center],
          ...generating,
        )
      : projection
        ? fitBounds(
            base,
            projection.points,
            projection.feet,
            [projection.pole],
            ...generating,
          )
        : involute
          ? fitBounds(
              base,
              ...involute.members.map((m) => m.points),
              ...generating,
            )
          : fitBounds(
              base,
              minus,
              plus,
              ...(frame?.strands ?? []),
              ...(canal?.meridians ?? []),
              (canal?.circles ?? []).flatMap((g) => g.points),
              ...generating,
            ),
  };
}
export function animationCamera(view: AnimationView): View {
  const held = view.heldView!;
  const bounds =
    view.camera === "current"
      ? held
      : view.camera === "hold"
        ? view.final.result.bounds
        : view.camera === "follow"
          ? {
              center: view.frame.result.bounds.center,
              radius: view.final.result.bounds.radius,
            }
          : view.frame.result.bounds;
  return {
    ...held,
    ...bounds,
    zoom: view.camera === "current" ? held.zoom : 1,
    panX: view.camera === "current" ? held.panX : 0,
    panY: view.camera === "current" ? held.panY : 0,
    yaw: held.yaw + (view.mode === "orbit" ? view.progress * 2 * Math.PI : 0),
  };
}
