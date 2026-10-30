import { roundedGenerated } from "../atlas";
import { tiered } from "../help";
import type { Config, Vec } from "../types";
import type { PlotCamera } from "../planar-link";
export type LoomSource = {
  kind: "grid" | "concentric" | "rosette" | "curve";
  count: number;
  xCount: number;
  yCount: number;
  xMin: number;
  xMax: number;
  yMin: number;
  yMax: number;
  radius: number;
  input: Config["input"];
  curve: Config["curve"];
};
export type LoomRequest = {
  map: "square" | "mobius" | "joukowski";
  mapParameter?: number;
  exclusionRadius?: number;
  source: LoomSource;
  samples: number;
  tolerance: number;
  selected: number;
  parameter: number;
};
export type LoomFraming = { cx: number; cy: number; scale: number };
export type LoomStudy = LoomRequest & {
  framing?: { source: LoomFraming; image: LoomFraming };
  views: { source: PlotCamera; image: PlotCamera };
  duration: number;
  showExclusion?: boolean;
  motion?: { mode: "map"; from: number; to: number };
};
const rationalTraversal =
  "Traversal advances uniformly in the original source parameter, not arc length. Poles and their excluded source disks have no image. Critical images remain drawable, but do not claim regular conformality. Map motion keeps this point fixed while changing the map.";
// Each map's labels, help, supported parameter and actual pole. Components
// read these instead of branching on map names.
export const maps = {
  square: {
    label: "Squaring",
    formula: "w = z²",
    parameterized: false,
    symbol: "",
    range: [0, 0],
    initial: 0,
    note: "Squaring doubles angles about zero. Zero is drawable but critical.",
    imageLabel: "Squared image plane",
    imageHeading: "Image plane · z²",
    imageNoun: "square",
    traversalHelp:
      "Traversal advances uniformly in the source parameter, not arc length. Rotated circles have center r exp(iα), α = 2πk/N and z(θ) = r exp(iα)(1 + exp(iθ)); θ increases counterclockwise from the outermost point. At θ = π the point is critical, but maps to zero.",
    pole: (_parameter: number): Vec | undefined => undefined,
  },
  mobius: {
    label: "Möbius",
    formula: "w = (z − b)/(1 − bz)",
    parameterized: true,
    symbol: "b",
    range: [-0.9, 0.9],
    initial: 0.5,
    note: "Circles become circles or lines. The pole is 1/b; b = 0 is identity. The inverse uses −b.",
    imageLabel: "Möbius image plane",
    imageHeading: "Image plane · w",
    imageNoun: "image",
    traversalHelp: rationalTraversal,
    // At b = 0 the pole has gone to infinity.
    pole: (b: number): Vec | undefined =>
      b && Number.isFinite(1 / b) ? { x: 1 / b, y: 0 } : undefined,
  },
  joukowski: {
    label: "z + λ/z",
    formula: "w = z + λ/z",
    parameterized: true,
    symbol: "λ",
    range: [0, 1],
    initial: 0.5,
    note: "Zero is a pole when λ > 0; ±√λ are drawable critical points. At λ = 0 the map is identity, including zero.",
    imageLabel: "z + λ/z image plane",
    imageHeading: "Image plane · w",
    imageNoun: "image",
    traversalHelp: rationalTraversal,
    pole: (lambda: number): Vec | undefined =>
      lambda ? { x: 0, y: 0 } : undefined,
  },
} as const;
export const mapHelp = tiered(
  "Squaring doubles angles, Möbius preserves circles, and z + λ/z folds circles into ellipses.",
  "Squaring z² has a critical point at zero. Möbius (z−b)/(1−bz), −0.9≤b≤0.9, sends circles to circles or lines; its pole is 1/b. For z+λ/z, 0≤λ≤1, zero is a pole and ±√λ are critical points. Both parameterized maps become identity at zero. Actual poles exclude source disks; critical images remain drawable without regular conformality.",
);

export function replaceMap(
  s: LoomStudy,
  map: LoomRequest["map"],
  curveSize = 1,
): LoomStudy {
  if (map === s.map) return s;
  const { motion: _motion, ...rest } = s;
  if (!maps[map].parameterized) return { ...rest, map };
  const size =
    s.source.kind === "grid"
      ? Math.max(s.source.xMax - s.source.xMin, s.source.yMax - s.source.yMin) /
        2
      : s.source.kind === "curve"
        ? curveSize
        : s.source.radius;
  return {
    ...rest,
    map,
    mapParameter: maps[map].initial,
    exclusionRadius:
      s.exclusionRadius &&
      Number.isFinite(s.exclusionRadius) &&
      s.exclusionRadius >= 1e-6 &&
      s.exclusionRadius <= 1e6
        ? s.exclusionRadius
        : Math.max(
            1e-6,
            Math.min(
              1e6,
              roundedGenerated(
                0.025 * (Number.isFinite(size) && size > 0 ? size : 1),
                0.025 * Math.abs(size),
              ),
            ),
          ),
    showExclusion: s.showExclusion ?? true,
  };
}

// One absolute-time sampler for direct seek, playback and movie export.
// Point traversal leaves geometry stationary; map motion recomputes it.
export function loomFrame(s: LoomStudy, progress: number): LoomRequest {
  if (!s.motion) return traversal(s, progress);
  const { from, to } = s.motion;
  return {
    ...loomRequest(s),
    mapParameter:
      progress <= 0 ? from : progress >= 1 ? to : from + (to - from) * progress,
  };
}
export function poleExclusion(q: LoomRequest, visible = true) {
  const center =
    visible && q.exclusionRadius && q.mapParameter !== undefined
      ? maps[q.map].pole(q.mapParameter)
      : undefined;
  return center && { center, radius: q.exclusionRadius! };
}
export type LoomMarker = {
  member: number;
  parameter: number;
  source: Vec | null;
  image: Vec | null;
  critical: boolean;
};
export type LoomMember = {
  id: number;
  name: string;
  min: number;
  max: number;
  at: number[];
  source: (Vec | null)[];
  image: (Vec | null)[];
  critical: boolean[];
  intervals: { from: number; to: number; reason: string }[];
};
export type LoomResult = {
  members: LoomMember[];
  marker: LoomMarker;
  points: number;
  evaluations: number;
  numericEntries: number;
  exhausted: boolean;
};
export const sourceChoices = {
  rosette: "Circles opening into a rosette",
  grid: "A square grid, curved",
  concentric: "Concentric circles",
  curve: "Curve from your base study",
} as const;
// The authored families, offered in the 2D examples gallery. Each opens the
// loom over the notebook's study without replacing it; the notebook's curve
// remains the loom's curve source.
export const loomPresets = [
  {
    title: sourceChoices.rosette,
    note: "Circles through the origin square into a rosette of cardioids",
    kind: "rosette",
  },
  {
    title: sourceChoices.grid,
    note: "A grid's lines square into two families of parabolas",
    kind: "grid",
  },
  {
    title: sourceChoices.concentric,
    note: "Each circle squares to a circle, wound around twice",
    kind: "concentric",
  },
  // Opens at b=.65; moving to −.65 takes the pole through the circles,
  // out to infinity at identity and back on the opposite side.
  {
    title: "Circles through infinity",
    note: "A moving Möbius pole opens circles into lines and closes them again",
    kind: "concentric",
    map: "mobius",
    motion: { from: 0.65, to: -0.65 },
  },
  // Opens at λ=.5; each concentric circle becomes an ellipse, flattened
  // to a doubly traced segment when its radius is √λ.
  {
    title: "Circles folded into ellipses",
    note: "The map z + λ/z folds nested circles through critical line segments",
    kind: "concentric",
    map: "joukowski",
    motion: { from: 0.5, to: 1 },
  },
] as const satisfies readonly {
  title: string;
  note: string;
  kind: LoomSource["kind"];
  map?: LoomRequest["map"];
  motion?: { from: number; to: number };
}[];
export function presetLoom(index: number, config: Config): LoomStudy {
  const study = defaultLoom(config);
  const source = { ...study.source, kind: loomPresets[index].kind };
  const definition = loomPresets[index];
  const rational = "map" in definition;
  const mapped = rational ? replaceMap(study, definition.map) : study;
  return {
    ...mapped,
    source: rational ? { ...source, radius: 2.4 } : source,
    ...(rational && {
      selected: 5,
      mapParameter: definition.motion.from,
      exclusionRadius: 0.06,
      motion: { mode: "map" as const, ...definition.motion },
    }),
    ...(rational && {
      framing: {
        source: { cx: 0, cy: 0, scale: 120 },
        image: { cx: 0, cy: 0, scale: 120 },
      },
    }),
    parameter: memberInterval(source, 0)[0],
  };
}
// What a preset draws, without the notebook's curve it carries.
export function presetDefinition(index: number) {
  const { source, ...rest } = presetLoom(index, {
    input: "curve",
    curve: {},
  } as unknown as Config);
  const { input: _input, curve: _curve, ...family } = source;
  return { ...rest, source: family };
}
export const supportedFormats = [
  "parametric",
  "cartesian",
  "polar",
  "roulette",
  "lissajous",
  "fourier",
] as const;
// The loom on the notebook's own curve, which must be supported.
export function curveLoom(config: Config): LoomStudy {
  const study = defaultLoom(config);
  return {
    ...study,
    source: { ...study.source, kind: "curve" },
    parameter: config.curve.min,
  };
}
export function defaultLoom(config: Config): LoomStudy {
  return {
    map: "square",
    source: {
      kind: "rosette",
      count: 12,
      xCount: 13,
      yCount: 13,
      xMin: -2,
      xMax: 2,
      yMin: -2,
      yMax: 2,
      radius: 1,
      input: config.input,
      curve: structuredClone(config.curve),
    },
    samples: 32,
    tolerance: 0.0005,
    selected: 0,
    parameter: 0,
    views: { source: { x: 0, y: 0, zoom: 1 }, image: { x: 0, y: 0, zoom: 1 } },
    duration: 10,
  };
}
export const supportedSource = (s: Pick<LoomSource, "input" | "curve">) =>
  s.input === "curve" &&
  (supportedFormats as readonly string[]).includes(s.curve.format);
export function memberInterval(s: LoomSource, id: number): [number, number] {
  return s.kind === "curve"
    ? [s.curve.min, s.curve.max]
    : s.kind === "grid"
      ? id < s.xCount
        ? [s.yMin, s.yMax]
        : [s.xMin, s.xMax]
      : [0, 2 * Math.PI];
}
export const memberCount = (s: LoomSource) =>
  s.kind === "curve" ? 1 : s.kind === "grid" ? s.xCount + s.yCount : s.count;
export function loomRequest(s: LoomStudy): LoomRequest {
  return {
    map: s.map,
    ...(s.mapParameter !== undefined && { mapParameter: s.mapParameter }),
    ...(s.exclusionRadius !== undefined && {
      exclusionRadius: s.exclusionRadius,
    }),
    source: s.source,
    samples: s.samples,
    tolerance: s.tolerance,
    selected: s.selected,
    parameter: s.parameter,
  };
}
// Uniform absolute source parameter, independent of sampling density or speed.
export function traversal(s: LoomStudy, progress: number): LoomRequest {
  const [a, b] = memberInterval(s.source, s.selected);
  return {
    ...loomRequest(s),
    parameter: progress <= 0 ? a : progress >= 1 ? b : a + (b - a) * progress,
  };
}

// An explicit family replacement starts invalid family fields from valid
// defaults; valid edits and the frozen ordinary definition stay intact.
export function replaceSource(
  s: LoomSource,
  kind: LoomSource["kind"],
): LoomSource {
  const out = { ...s, kind };
  for (const k of ["xMin", "yMin"] as const)
    if (!Number.isFinite(out[k])) out[k] = -2;
  for (const k of ["xMax", "yMax"] as const)
    if (!Number.isFinite(out[k])) out[k] = 2;
  if (!Number.isFinite(out.radius) || out.radius <= 0 || out.radius > 1e6)
    out.radius = 1;
  for (const [k, fallback] of [
    ["count", 12],
    ["xCount", 13],
    ["yCount", 13],
  ] as const)
    if (!Number.isInteger(out[k]) || out[k] < 1 || out[k] > 32)
      out[k] = fallback;
  if (kind === "grid")
    for (const [a, b] of [
      ["xMin", "xMax"],
      ["yMin", "yMax"],
    ] as const)
      if (
        Math.abs(out[a]) > 1e6 ||
        Math.abs(out[b]) > 1e6 ||
        out[b] - out[a] < 1e-6 ||
        out[b] - out[a] > 1e5
      ) {
        out[a] = -2;
        out[b] = 2;
      }
  return out;
}
