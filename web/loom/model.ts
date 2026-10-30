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
  map: "square";
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
};
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
] as const satisfies readonly {
  title: string;
  note: string;
  kind: LoomSource["kind"];
}[];
export function presetLoom(index: number, config: Config): LoomStudy {
  const study = defaultLoom(config);
  const source = { ...study.source, kind: loomPresets[index].kind };
  return {
    ...study,
    source,
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
