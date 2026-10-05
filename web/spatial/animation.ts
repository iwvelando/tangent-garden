import { projectsInput, unwindsInput, usesSpatialPole } from "./types";
import { harmonicLabels } from "./harmonic";
import { revealRefined } from "../refinement";
import { surfaceShape } from "./surface";
import type {
  RefinedPath,
  SpatialConfig,
  SpatialResult,
  Frame,
  Vec3,
  Bounds3,
  SpatialHarmonicResult,
  SurfaceSheet,
} from "./types";
import type { View } from "./renderer";
import { pathView, type CameraPath } from "./path";
import { rideView, type RidePath } from "./ride";
export type { Frame };
export type Viewport = View;
// Reveal, vary parameters, orbit the camera, trace light from its source to
// the caustics (mirror and interface studies only), or move the parameter
// probe along the curve (while the probe is on), or peel the drawing away
// with the cut plane (while the cut is on), or fly the camera through key
// views (see path.ts).
export type AnimationMode =
  "reveal" | "parameters" | "orbit" | "trace" | "probe" | "cut" | "path";
// The animation camera of every mode but the orbit and the path, which move
// the camera themselves. "path" flies the key views while the geometry
// moves; "ride" rides a ray in perspective while light is traced (see
// ride.ts).
export type CameraMode =
  "hold" | "current" | "follow" | "fit" | "path" | "ride";
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
  | "inputAnchor"
  | "inputOffset"
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
  | "escape"
  | "capture"
  | "surfaceA"
  | "surfaceB"
  | "surfaceC"
  | "uMin"
  | "uMax"
  | "vMin"
  | "vMax"
  | "surfaceOffset"
  | "reach"
  | "uSamples"
  | "vSamples"
  | "curves"
  | "azimuth"
  | "elevation"
  | "sourceX"
  | "sourceY"
  | "sourceZ"
  | "rayLength"
  | "n1"
  | "n2"
  | "receiverAt"
  | "receiverSize"
  | "level"
  | "implicitA"
  | "sectionFrom"
  | "sectionTo"
  | "cells"
  | "sectionCount";
// One coordinate of a vector field's seed, numbered from 1.
export type SeedTarget = `seed${number}${"X" | "Y" | "Z"}`;
// A pursuer's starting coordinate or speed, numbered from 1.
export type PursuerTarget = `pursuer${number}${"X" | "Y" | "Z" | "Speed"}`;
export type Target = NamedTarget | HarmonicTarget | SeedTarget | PursuerTarget;
export type Track = { target: Target; from: string; to: string };
export type NumericTrack = { target: Target; from: number; to: number };
export type AnimationView = {
  frame: Frame;
  final: Frame;
  camera: CameraMode;
  heldView?: View;
  length: number;
  // The motion's progress, which the frame is drawn at, and the time the
  // timeline stands at (see timing.ts); they differ only when the
  // animation repeats back and forth or eases.
  progress: number;
  time?: number;
  mode: AnimationMode;
  // A finished animation releases the camera, starting from its own.
  complete: boolean;
  // The probe's sample in the frame's diagnostics (a surface's row), and
  // its setup, when the animation draws it: moving it, or varying
  // parameters while it is on.
  probe?: number;
  probeSetup?: import("./probe").Probe;
  // Why a parameter animation that draws the probe has none on this frame
  // (see heldProbe).
  probeAway?: string;
  // The cut as this frame draws it, when the animation moves it.
  cut?: import("./cut").CutSpec;
  // The camera path, when the animation flies it, and the bounds its key
  // views were taken about: the study's own when playback began, whatever
  // bounds each frame has.
  path?: CameraPath;
  around?: Bounds3;
  // A loop's path passes its seam smoothly (see pathView).
  cyclic?: boolean;
  // The ray the camera rides while light is traced, the bounds its lens
  // was framed about, and the timeline's total optical path.
  ride?: { path: RidePath; around: Bounds3; total: number };
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
  inputAnchor: "Input anchor t₀",
  inputOffset: "Input string c",
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
  capture: "Capture distance ε",
  // A surface's shape fields are named by its kind (see targetLabel).
  surfaceA: "Shape a",
  surfaceB: "Shape b",
  surfaceC: "Shape c",
  uMin: "u from",
  uMax: "u to",
  vMin: "v from",
  vMax: "v to",
  surfaceOffset: "Offset d",
  reach: "Normal reach ℓ",
  uSamples: "u samples",
  vSamples: "v samples",
  curves: "Parameter curves",
  azimuth: "Azimuth α (°)",
  elevation: "Elevation β (°)",
  sourceX: "Source x",
  sourceY: "Source y",
  sourceZ: "Source z",
  rayLength: "Ray length ℓ",
  n1: "Index n₁",
  n2: "Index n₂",
  receiverAt: "Plane at c",
  receiverSize: "Window size s",
  level: "Level c",
  implicitA: "Shape parameter a",
  sectionFrom: "First offset d₀",
  sectionTo: "Last offset d₁",
  cells: "Cells",
  sectionCount: "Section planes",
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
export const spatialPursuerLabels = {
  X: (n: number) => `Start x${subscript(n)}`,
  Y: (n: number) => `Start y${subscript(n)}`,
  Z: (n: number) => `Start z${subscript(n)}`,
  Speed: (n: number) => `Speed v${subscript(n)}`,
};
const isPursuer = (t: Target): t is PursuerTarget => t.startsWith("pursuer");
const pursuerTarget = (t: Target) => {
  const match = /^pursuer(\d+)(X|Y|Z|Speed)$/.exec(t);
  return match
    ? {
        index: +match[1] - 1,
        field: match[2] as keyof typeof spatialPursuerLabels,
        key: match[2].toLowerCase() as "x" | "y" | "z" | "speed",
      }
    : null;
};
// Surface targets and the SurfaceConfig field each one moves.
const surfaceFields = {
  surfaceA: "a",
  surfaceB: "b",
  surfaceC: "c",
  uMin: "uMin",
  uMax: "uMax",
  vMin: "vMin",
  vMax: "vMax",
  surfaceOffset: "offset",
  reach: "reach",
  uSamples: "uSamples",
  vSamples: "vSamples",
  curves: "curves",
} as const;
const isSurface = (t: Target): t is keyof typeof surfaceFields =>
  t in surfaceFields;
// Light targets and the RaysConfig field each one moves.
const raysFields = {
  azimuth: "azimuth",
  elevation: "elevation",
  rayLength: "length",
  n1: "n1",
  n2: "n2",
} as const;
const isRays = (t: Target): t is keyof typeof raysFields => t in raysFields;
// Receiver targets and the ReceiverConfig field each one moves.
const receiverFields = { receiverAt: "at", receiverSize: "size" } as const;
const isReceiver = (t: Target): t is keyof typeof receiverFields =>
  t in receiverFields;
// Implicit-surface targets and the ImplicitConfig field each one moves.
const implicitFields = {
  level: "level",
  implicitA: "a",
  cells: "cells",
} as const;
const isImplicit = (t: Target): t is keyof typeof implicitFields =>
  t in implicitFields;
const sectionFields = {
  sectionFrom: "from",
  sectionTo: "to",
  sectionCount: "count",
} as const;
const isSection = (t: Target): t is keyof typeof sectionFields =>
  t in sectionFields;
const isSource = (t: Target): t is "sourceX" | "sourceY" | "sourceZ" =>
  t === "sourceX" || t === "sourceY" || t === "sourceZ";
const sourceAxis = (t: "sourceX" | "sourceY" | "sourceZ") =>
  t.slice(6).toLowerCase() as "x" | "y" | "z";
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
  const pursuer = pursuerTarget(t);
  if (pursuer) return spatialPursuerLabels[pursuer.field](pursuer.index + 1);
  const shape = surfaceShape[c.surface.kind].find(
    (f) => `surface${f.key.toUpperCase()}` === t,
  );
  if (shape) return shape.label;
  return t === "lines" && c.construction === "none"
    ? c.format === "field"
      ? "Field arrows"
      : c.format === "pursuit"
        ? "Connecting polygons"
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
              : t === "lines" &&
                  (c.construction === "tangent-foot" ||
                    c.construction === "orthotomic")
                ? "Projection constructions"
                : targetLabels[t as NamedTarget];
};
export const integerTargets: Target[] = [
  "samples",
  "lines",
  "count",
  "strands",
  "meridians",
  "uSamples",
  "vSamples",
  "curves",
  "cells",
  "sectionCount",
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
  if (c.format === "implicit")
    return [
      "level",
      "implicitA",
      ...(c.implicit.sections.count > 0
        ? (["sectionFrom", "sectionTo"] as const)
        : []),
      "cells",
      "sectionCount",
    ];
  if (c.format === "surface" || c.format === "rays")
    return [
      ...surfaceShape[c.surface.kind].map(
        (f) => `surface${f.key.toUpperCase()}` as Target,
      ),
      ...(c.format === "surface"
        ? (["surfaceOffset", "reach"] as const)
        : ([
            ...(c.rays.interaction === "refract" ? ["n1", "n2"] : []),
            ...(c.rays.light === "point"
              ? ["sourceX", "sourceY", "sourceZ"]
              : ["azimuth", "elevation"]),
            "rayLength",
            ...(c.rays.receiver.plane !== "none"
              ? ["receiverAt", "receiverSize"]
              : []),
          ] as Target[])),
      "uMin",
      "uMax",
      "vMin",
      "vMax",
      "uSamples",
      "vSamples",
      "curves",
    ];
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
                : c.construction === "tangent-foot" ||
                    c.construction === "orthotomic"
                  ? ["poleX", "poleY", "poleZ"]
                  : ["length"];
  // A construction built on a tangent projection moves with its pole, and
  // one built on an involute with that involute's string and anchor.
  if (projectsInput(c)) construction.push("poleX", "poleY", "poleZ");
  if (unwindsInput(c)) construction.push("inputOffset", "inputAnchor");
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
        : c.format === "pursuit"
          ? [
              ...c.pursuit.pursuers.flatMap((_, k) =>
                (["X", "Y", "Z", "Speed"] as const).map(
                  (field) => `pursuer${k + 1}${field}` as const,
                ),
              ),
              "capture",
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
  if (isImplicit(t)) return c.implicit[implicitFields[t]];
  if (isSection(t)) return c.implicit.sections[sectionFields[t]];
  if (isSurface(t)) return c.surface[surfaceFields[t]];
  if (isRays(t)) return c.rays[raysFields[t]];
  if (isReceiver(t)) return c.rays.receiver[receiverFields[t]];
  if (isSource(t)) return c.rays.source[sourceAxis(t)];
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
  if (isPursuer(t)) {
    const pursuer = pursuerTarget(t)!;
    return c.pursuit.pursuers[pursuer.index]?.[pursuer.key] ?? NaN;
  }
  if (t === "capture") return c.pursuit.capture;
  if ((t === "min" || t === "max") && c.format === "pursuit")
    return c.pursuit[t];
  if (isCurve(t)) return c.curve[t];
  if (t === "anchor" || t === "offset") return c.involute[t];
  if (t === "inputAnchor") return c.unwinding.anchor;
  if (t === "inputOffset") return c.unwinding.offset;
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
    if (isImplicit(t.target)) {
      config.implicit[implicitFields[t.target]] = v;
      continue;
    }
    if (isSection(t.target)) {
      config.implicit.sections[sectionFields[t.target]] = v;
      continue;
    }
    if (isSurface(t.target)) {
      config.surface[surfaceFields[t.target]] = v;
      continue;
    }
    if (isRays(t.target)) {
      config.rays[raysFields[t.target]] = v;
      continue;
    }
    if (isReceiver(t.target)) {
      config.rays.receiver[receiverFields[t.target]] = v;
      continue;
    }
    if (isSource(t.target)) {
      config.rays.source[sourceAxis(t.target)] = v;
      continue;
    }
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
    else if (isPursuer(t.target)) {
      const pursuer = pursuerTarget(t.target)!;
      if (config.pursuit.pursuers[pursuer.index])
        config.pursuit.pursuers[pursuer.index][pursuer.key] = v;
    } else if (t.target === "capture") config.pursuit.capture = v;
    else if (
      (t.target === "min" || t.target === "max") &&
      config.format === "pursuit"
    )
      config.pursuit[t.target] = v;
    else if (isCurve(t.target)) config.curve[t.target] = v;
    else if (t.target === "anchor" || t.target === "offset")
      config.involute[t.target] = v;
    else if (t.target === "inputAnchor") config.unwinding.anchor = v;
    else if (t.target === "inputOffset") config.unwinding.offset = v;
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
// A surface frames as Go frames it: its points with the normal lines' ends,
// then the offset and each focal sheet on their own.
export function surfaceBounds(s: NonNullable<SpatialResult["surface"]>) {
  return fitBounds(
    [...s.surface.points.flat(), ...s.lines.map((l) => l.end)],
    ...(s.offset ? [s.offset.points.flat()] : []),
    ...s.focal.map((f) => f.points.flat()),
  );
}
// A ray study frames as Go frames it: its points with the rays and the
// source, then each caustic part on its own, then the receiver's corners.
export function raysBounds(r: NonNullable<SpatialResult["rays"]>) {
  return fitBounds(
    [
      ...r.surface.points.flat(),
      ...r.lines.flatMap((l) => [l.start, l.end, l.back]),
      ...(r.source ? [r.source] : []),
    ],
    ...r.caustics.map((c) => c.points.flat()),
    ...(r.receiver ? [r.receiver.corners] : []),
  );
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
// A surface or mirror reveals column by column in u: every sheet keeps the
// samples up to u_last, the edges and faces between them, and the normal
// lines or rays there.
function revealSheet<S extends SurfaceSheet>(sheet: S, last: number): S {
  return {
    ...sheet,
    points: sheet.points.slice(0, last + 1),
    normals: sheet.normals.slice(0, last + 1),
    alongU: sheet.alongU.slice(0, last),
    alongV: sheet.alongV.slice(0, last + 1),
    faces: sheet.faces.slice(0, last),
  };
}
// An implicit surface reveals upward through its box: the triangles, cut and
// open edges and crosses at or below the rising height, and the parts of
// its sections below it.
function revealImplicit(
  m: NonNullable<SpatialResult["implicit"]>,
  p: number,
): NonNullable<SpatialResult["implicit"]> {
  const top =
    m.box.zMin + Math.max(0, Math.min(1, p)) * (m.box.zMax - m.box.zMin);
  if (top >= m.box.zMax) return m;
  const z = (v: number) => m.positions[3 * v + 2];
  // Keep the groups of `size` indices whose vertices all lie at or below it.
  const below = (indices: Int32Array, size: number) => {
    const out = new Int32Array(indices.length);
    let n = 0;
    for (let k = 0; k < indices.length; k += size) {
      let low = true;
      for (let d = 0; d < size; d++) low &&= z(indices[k + d]) <= top;
      if (low) for (let d = 0; d < size; d++) out[n++] = indices[k + d];
    }
    return out.slice(0, n);
  };
  const triangles = below(m.triangles, 3);
  const pairs = (edges: Int32Array) => below(edges, 2);
  // A path is split where it rises above the height; a closed path that
  // is split is no longer closed.
  const sections = m.sections.map((s) => ({
    ...s,
    paths: s.paths.flatMap((path) => {
      if (path.points.every((q) => q.z <= top)) return [path];
      const runs: { points: Vec3[]; closed: boolean }[] = [];
      let run: Vec3[] = [];
      const start = path.closed ? path.points.findIndex((q) => q.z > top) : 0;
      for (let k = 0; k < path.points.length; k++) {
        const q = path.points[(start + k) % path.points.length];
        if (q.z <= top) run.push(q);
        else if (run.length) {
          runs.push({ points: run, closed: false });
          run = [];
        }
      }
      if (run.length) runs.push({ points: run, closed: false });
      return runs.filter((r) => r.points.length > 1);
    }),
  }));
  return {
    ...m,
    triangles,
    cut: pairs(m.cut),
    open: pairs(m.open),
    marks: m.marks.filter((q) => q.z <= top),
    sections,
  };
}
export function reveal(result: SpatialResult, p: number): SpatialResult {
  if (result.implicit)
    return { ...result, implicit: revealImplicit(result.implicit, p) };
  if (result.surface) {
    const s = result.surface,
      last = Math.floor(
        Math.max(0, Math.min(1, p)) * (s.surface.points.length - 1),
      );
    const surface = {
      ...s,
      surface: revealSheet(s.surface, last),
      offset: s.offset && revealSheet(s.offset, last),
      focal: s.focal.map((f) => revealSheet(f, last)),
      lines: s.lines.filter((l) => l.i <= last),
    };
    return { ...result, surface, bounds: surfaceBounds(surface) };
  }
  if (result.rays) {
    const r = result.rays,
      last = Math.floor(
        Math.max(0, Math.min(1, p)) * (r.surface.points.length - 1),
      );
    // The receiver collects the whole family, so it appears only once
    // every column is revealed.
    const rays = {
      ...r,
      surface: revealSheet(r.surface, last),
      caustics: r.caustics.map((c) => revealSheet(c, last)),
      lines: r.lines.filter((l) => l.i <= last),
      receiver: last === r.surface.points.length - 1 ? r.receiver : null,
    };
    return { ...result, rays, bounds: raysBounds(rays) };
  }
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
  // The base under a derived input is revealed with the curve built on it.
  const composition = result.composition && {
    ...result.composition,
    curve: result.composition.curve.slice(0, last + 1),
    breaks: result.composition.breaks.slice(0, last + 1),
    constructions: result.composition.constructions.filter(
      (c) => c.sampleIndex <= last,
    ),
  };
  const harmonic = result.harmonic && {
    ...result.harmonic,
    positions: result.harmonic.positions.filter((s) => s.sampleIndex <= last),
  };
  // A refined curve shows its points up to the last revealed sample.
  const shown = (path: RefinedPath | undefined) => revealRefined(path, last);
  const adaptive = result.adaptive && {
    base: shown(result.adaptive.base),
    parent: shown(result.adaptive.parent),
    projection: shown(result.adaptive.projection),
    image: shown(result.adaptive.image),
    involute: result.adaptive.involute?.map((path) => shown(path)!),
    strands: result.adaptive.strands?.map((path) => shown(path)!),
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
  // The chase stops for everyone at once: its final positions are marked
  // once the reveal passes the stop.
  const pursuit = result.pursuit && {
    ...result.pursuit,
    paths: result.pursuit.paths.map((p) => p.slice(0, last + 1)),
    polygons: result.pursuit.polygons.filter((g) => g.sampleIndex <= last),
    final: reached(result.pursuit.paths[0]) ? result.pursuit.final : [],
  };
  const generating = [
    ...harmonicFamilies(harmonic),
    ...(field?.paths ?? []),
    ...(pursuit?.paths ?? []),
    ...(composition ? [composition.curve, [composition.pole]] : []),
  ];
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
    composition,
    harmonic,
    field,
    pursuit,
    frame,
    ruled,
    canal,
    adaptive,
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
  // A camera path is the whole camera, about the study's own bounds, at the
  // time of the frame it draws.
  // It flies in the held view's projection: key views have none of their
  // own.
  if (view.path)
    return {
      ...pathView(view.path, view.around!, view.progress, view.cyclic),
      ...(view.heldView?.projection && {
        projection: view.heldView.projection,
      }),
    };
  // So is the ride, at the optical path the frame's light has reached.
  if (view.ride)
    return rideView(
      view.ride.path,
      view.ride.around,
      view.heldView!,
      Math.min(1, Math.max(0, view.progress)) * view.ride.total,
    );
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
