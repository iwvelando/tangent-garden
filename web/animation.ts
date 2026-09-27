import {
  ownsShape,
  usesPole,
  type Config,
  type Frame,
  type Result,
} from "./types";
export type CameraMode = "hold" | "current" | "follow" | "fit";
export type Viewport = { cx: number; cy: number; scale: number; span: number };
// A Fourier term's frequency, radius, or phase, numbered from 1.
export type TermTarget = `term${number}${"Frequency" | "Radius" | "Phase"}`;
// A pursuer's starting x, y, or speed, numbered from 1.
export type PursuerTarget = `pursuer${number}${"X" | "Y" | "Speed"}`;
// A vector field seed's x or y, numbered from 1.
export type SeedTarget = `seed${number}${"X" | "Y"}`;
export type Target = FixedTarget | TermTarget | PursuerTarget | SeedTarget;
type FixedTarget =
  | "a"
  | "min"
  | "max"
  | "sourceX"
  | "sourceY"
  | "poleX"
  | "poleY"
  | "inversionX"
  | "inversionY"
  | "inversionRadius"
  | "sourceRadius"
  | "sourceTheta"
  | "angle"
  | "nIncident"
  | "nTransmitted"
  | "offset"
  | "distance"
  | "stackFrom"
  | "stackTo"
  | "stackCount"
  | "rollFixed"
  | "rollRadius"
  | "rollArm"
  | "rollPhase"
  | "rollingRadius"
  | "rollingArm"
  | "rollingPhase"
  | "rollingPointX"
  | "rollingPointY"
  | "rollingStart"
  | "lissajousA"
  | "lissajousB"
  | "lissajousM"
  | "lissajousN"
  | "lissajousPhase"
  | "pursuitCapture"
  | "fieldEscape"
  | "samples"
  | "lines"
  | "rayLength";
export type Track = { target: Target; from: string; to: string };
export type NumericTrack = { target: Target; from: number; to: number };
export type AnimationView = {
  frame: Frame;
  final: Frame;
  camera: CameraMode;
  heldView?: Viewport;
  length: number;
  progress: number;
  mode: "reveal" | "parameters";
};
const targetLabels: Record<FixedTarget, string> = {
  a: "Shape parameter a",
  min: "Domain start",
  max: "Domain end",
  sourceX: "Source x",
  sourceY: "Source y",
  poleX: "Pole x",
  poleY: "Pole y",
  inversionX: "Inversion center x",
  inversionY: "Inversion center y",
  inversionRadius: "Inversion radius R",
  sourceRadius: "Source radius r",
  sourceTheta: "Source theta θ (radians)",
  angle: "Travel direction (degrees)",
  nIncident: "Incident index n₁",
  nTransmitted: "Transmitted index n₂",
  offset: "String offset c",
  distance: "Offset distance d",
  stackFrom: "First offset distance",
  stackTo: "Last offset distance",
  stackCount: "Number of offsets",
  rollFixed: "Fixed radius R",
  rollRadius: "Rolling radius r",
  rollArm: "Tracing distance d",
  rollPhase: "Phase φ (radians)",
  rollingRadius: "Circle radius ρ",
  rollingArm: "Tracing distance ℓ",
  rollingPhase: "Phase ψ (radians)",
  rollingPointX: "Tracing point x",
  rollingPointY: "Tracing point y",
  rollingStart: "Contact starts at t",
  lissajousA: "Amplitude A",
  lissajousB: "Amplitude B",
  lissajousM: "Frequency m",
  lissajousN: "Frequency n",
  lissajousPhase: "Phase φ (radians)",
  pursuitCapture: "Capture distance ε",
  fieldEscape: "Escape radius R",
  samples: "Numerical samples",
  lines: "Construction lines",
  rayLength: "Ray length",
};
const subscripts = "₀₁₂₃₄₅₆₇₈₉";
// Term numbers as subscripts, as in the term fields' labels: r₁, φ₁₂.
export const subscript = (n: number) =>
  [...String(n)].map((d) => subscripts[+d]).join("");
export const termLabels = {
  Frequency: (n: number) => `Frequency k${subscript(n)}`,
  Radius: (n: number) => `Radius r${subscript(n)}`,
  Phase: (n: number) => `Phase φ${subscript(n)}`,
};
function termTarget(target: Target) {
  const match = /^term(\d+)(Frequency|Radius|Phase)$/.exec(target);
  return match
    ? {
        index: +match[1] - 1,
        field: match[2] as keyof typeof termLabels,
        key: match[2].toLowerCase() as "frequency" | "radius" | "phase",
      }
    : null;
}
export const pursuerLabels = {
  X: (n: number) => `Start x${subscript(n)}`,
  Y: (n: number) => `Start y${subscript(n)}`,
  Speed: (n: number) => `Speed v${subscript(n)}`,
};
function pursuerTarget(target: Target) {
  const match = /^pursuer(\d+)(X|Y|Speed)$/.exec(target);
  return match
    ? {
        index: +match[1] - 1,
        field: match[2] as keyof typeof pursuerLabels,
        key: match[2].toLowerCase() as "x" | "y" | "speed",
      }
    : null;
}
export const seedLabels = {
  X: (n: number) => `Seed x${subscript(n)}`,
  Y: (n: number) => `Seed y${subscript(n)}`,
};
function seedTarget(target: Target) {
  const match = /^seed(\d+)(X|Y)$/.exec(target);
  return match
    ? {
        index: +match[1] - 1,
        field: match[2] as keyof typeof seedLabels,
        key: match[2].toLowerCase() as "x" | "y",
      }
    : null;
}
export function targetLabel(target: Target) {
  const term = termTarget(target);
  const pursuer = pursuerTarget(target);
  const seed = seedTarget(target);
  return term
    ? termLabels[term.field](term.index + 1)
    : pursuer
      ? pursuerLabels[pursuer.field](pursuer.index + 1)
      : seed
        ? seedLabels[seed.field](seed.index + 1)
        : targetLabels[target as FixedTarget];
}
export function availableTargets(config: Config): Target[] {
  const targets: Target[] = ["a", "min", "max", "samples", "lines"];
  if (config.kind === "involute") targets.push("offset");
  if (config.kind === "offset")
    targets.unshift(
      ...(config.stack.enabled
        ? (["stackFrom", "stackTo", "stackCount"] as Target[])
        : (["distance"] as Target[])),
    );
  if (usesPole(config.kind)) targets.unshift("poleX", "poleY");
  if (config.kind === "inversion") {
    // The inverted curve's own parameters follow the circle's.
    const of = config.inversion.of;
    targets.unshift(
      "inversionX",
      "inversionY",
      "inversionRadius",
      ...((usesPole(of)
        ? ["poleX", "poleY"]
        : of === "offset"
          ? ["distance"]
          : []) as Target[]),
    );
  }
  if (config.kind === "rolling")
    targets.unshift(
      ...((config.rolling.shape === "curve"
        ? ["rollingPointX", "rollingPointY", "rollingStart"]
        : ["rollingArm", "rollingPhase", "rollingRadius"]) as Target[]),
    );
  if (config.kind === "catacaustic" || config.kind === "diacaustic") {
    targets.unshift(
      ...(config.source.kind === "point"
        ? ((config.source.coordinates === "polar"
            ? ["sourceTheta", "sourceRadius"]
            : ["sourceX", "sourceY"]) as Target[])
        : (["angle"] as Target[])),
    );
    targets.push("rayLength");
  }
  if (config.kind === "diacaustic") targets.push("nIncident", "nTransmitted");
  // A roulette's shape comes from its rolling geometry, not from a.
  if (config.curve.format === "roulette") {
    targets.splice(targets.indexOf("a"), 1);
    targets.unshift(
      "rollArm",
      "rollPhase",
      "rollRadius",
      ...(config.curve.roulette.roll === "line"
        ? []
        : (["rollFixed"] as Target[])),
    );
  }
  // Harmonic curves and pursuits define their own shape, without a.
  if (ownsShape(config.curve.format)) targets.splice(targets.indexOf("a"), 1);
  if (config.curve.format === "lissajous")
    targets.unshift(
      "lissajousPhase",
      "lissajousM",
      "lissajousN",
      "lissajousA",
      "lissajousB",
    );
  if (config.curve.format === "fourier")
    targets.unshift(
      ...config.curve.terms.flatMap((_, k) =>
        (["Phase", "Radius", "Frequency"] as const).map(
          (field) => `term${k + 1}${field}` as const,
        ),
      ),
    );
  if (config.curve.format === "pursuit")
    targets.unshift(
      ...config.curve.pursuit.pursuers.flatMap((_, k) =>
        (["Speed", "X", "Y"] as const).map(
          (field) => `pursuer${k + 1}${field}` as const,
        ),
      ),
      "pursuitCapture",
    );
  // A field keeps a, which its expressions may use.
  if (config.curve.format === "field")
    targets.unshift(
      ...config.curve.field.seeds.flatMap((_, k) =>
        (["X", "Y"] as const).map((field) => `seed${k + 1}${field}` as const),
      ),
      "fieldEscape",
    );
  return targets;
}
export function targetValue(
  config: Config,
  target: Target,
  length: number,
): number {
  const term = termTarget(target);
  if (term) return config.curve.terms[term.index]?.[term.key] ?? NaN;
  const pursuer = pursuerTarget(target);
  if (pursuer)
    return config.curve.pursuit.pursuers[pursuer.index]?.[pursuer.key] ?? NaN;
  const seed = seedTarget(target);
  if (seed) return config.curve.field.seeds[seed.index]?.[seed.key] ?? NaN;
  switch (target) {
    case "a":
    case "min":
    case "max":
      return config.curve[target];
    case "sourceX":
      return config.source.position.x;
    case "sourceY":
      return config.source.position.y;
    case "poleX":
      return config.pole.x;
    case "poleY":
      return config.pole.y;
    case "inversionX":
      return config.inversion.center.x;
    case "inversionY":
      return config.inversion.center.y;
    case "inversionRadius":
      return config.inversion.radius;
    case "sourceRadius":
      return config.source.radius ?? 0;
    case "sourceTheta":
      return config.source.theta ?? 0;
    case "angle":
      return config.source.angle;
    case "stackFrom":
      return config.stack.from;
    case "stackTo":
      return config.stack.to;
    case "stackCount":
      return config.stack.count;
    case "rollFixed":
      return config.curve.roulette.fixedRadius;
    case "rollRadius":
      return config.curve.roulette.radius;
    case "rollArm":
      return config.curve.roulette.arm;
    case "rollPhase":
      return config.curve.roulette.phase;
    case "rollingRadius":
      return config.rolling.radius;
    case "rollingArm":
      return config.rolling.arm;
    case "rollingPhase":
      return config.rolling.phase;
    case "rollingPointX":
      return config.rolling.point.x;
    case "rollingPointY":
      return config.rolling.point.y;
    case "rollingStart":
      return config.rolling.curve.start;
    case "lissajousA":
      return config.curve.lissajous.amplitudeX;
    case "lissajousB":
      return config.curve.lissajous.amplitudeY;
    case "lissajousM":
      return config.curve.lissajous.frequencyX;
    case "lissajousN":
      return config.curve.lissajous.frequencyY;
    case "lissajousPhase":
      return config.curve.lissajous.phase;
    case "pursuitCapture":
      return config.curve.pursuit.capture;
    case "fieldEscape":
      return config.curve.field.escape;
    case "rayLength":
      return length;
    default:
      return config[target as "offset"];
  }
}
// Counts are whole numbers throughout playback and at both endpoints.
export const integerTargets: Target[] = ["samples", "lines", "stackCount"];
export function applyTracks(
  base: Config,
  tracks: NumericTrack[],
  progress: number,
  length: number,
) {
  const config = structuredClone(base);
  for (const track of tracks) {
    // This form returns each endpoint exactly, unlike from + (to - from) * p.
    let value = track.from * (1 - progress) + track.to * progress;
    if (integerTargets.includes(track.target)) value = Math.round(value);
    const term = termTarget(track.target);
    if (term) {
      if (config.curve.terms[term.index])
        config.curve.terms[term.index][term.key] = value;
      continue;
    }
    const pursuer = pursuerTarget(track.target);
    if (pursuer) {
      if (config.curve.pursuit.pursuers[pursuer.index])
        config.curve.pursuit.pursuers[pursuer.index][pursuer.key] = value;
      continue;
    }
    const seed = seedTarget(track.target);
    if (seed) {
      if (config.curve.field.seeds[seed.index])
        config.curve.field.seeds[seed.index][seed.key] = value;
      continue;
    }
    switch (track.target) {
      case "a":
      case "min":
      case "max":
        config.curve[track.target] = value;
        break;
      case "sourceX":
        config.source.position.x = value;
        break;
      case "sourceY":
        config.source.position.y = value;
        break;
      case "poleX":
        config.pole.x = value;
        break;
      case "poleY":
        config.pole.y = value;
        break;
      case "inversionX":
        config.inversion.center.x = value;
        break;
      case "inversionY":
        config.inversion.center.y = value;
        break;
      case "inversionRadius":
        config.inversion.radius = value;
        break;
      case "sourceRadius":
        config.source.radius = value;
        break;
      case "sourceTheta":
        config.source.theta = value;
        break;
      case "angle":
        config.source.angle = value;
        break;
      case "stackFrom":
        config.stack.from = value;
        break;
      case "stackTo":
        config.stack.to = value;
        break;
      case "stackCount":
        config.stack.count = value;
        break;
      case "rollFixed":
        config.curve.roulette.fixedRadius = value;
        break;
      case "rollRadius":
        config.curve.roulette.radius = value;
        break;
      case "rollArm":
        config.curve.roulette.arm = value;
        break;
      case "rollPhase":
        config.curve.roulette.phase = value;
        break;
      case "rollingRadius":
        config.rolling.radius = value;
        break;
      case "rollingArm":
        config.rolling.arm = value;
        break;
      case "rollingPhase":
        config.rolling.phase = value;
        break;
      case "rollingPointX":
        config.rolling.point.x = value;
        break;
      case "rollingPointY":
        config.rolling.point.y = value;
        break;
      case "rollingStart":
        config.rolling.curve.start = value;
        break;
      case "lissajousA":
        config.curve.lissajous.amplitudeX = value;
        break;
      case "lissajousB":
        config.curve.lissajous.amplitudeY = value;
        break;
      case "lissajousM":
        config.curve.lissajous.frequencyX = value;
        break;
      case "lissajousN":
        config.curve.lissajous.frequencyY = value;
        break;
      case "lissajousPhase":
        config.curve.lissajous.phase = value;
        break;
      case "pursuitCapture":
        config.curve.pursuit.capture = value;
        break;
      case "fieldEscape":
        config.curve.field.escape = value;
        break;
      case "rayLength":
        length = value;
        break;
      default:
        config[track.target as "offset"] = value;
    }
  }
  return { config, length };
}
// Reveal existing numerical samples, so neither the arc-length anchor nor the
// differentiation stencil changes while the string is being unwound.
export function reveal(result: Result, progress: number): Result {
  const last = Math.floor(
    Math.max(0, Math.min(1, progress)) * (result.base.length - 1),
  );
  return {
    ...result,
    base: result.base.slice(0, last + 1),
    derived: result.derived.slice(0, last + 1),
    virtual: result.virtual.slice(0, last + 1),
    rays: result.rays.filter((ray) => ray.sampleIndex <= last),
    family: result.family.map((path) => ({
      ...path,
      points: path.points.slice(0, last + 1),
    })),
    circles: result.circles.filter((c) => c.sampleIndex <= last),
    rolling: result.rolling.filter((s) => s.sampleIndex <= last),
    roulette: result.roulette && {
      ...result.roulette,
      positions: result.roulette.positions.filter((s) => s.sampleIndex <= last),
    },
    harmonic: result.harmonic && {
      ...result.harmonic,
      positions: result.harmonic.positions.filter((s) => s.sampleIndex <= last),
    },
    pursuit: result.pursuit && {
      ...result.pursuit,
      paths: result.pursuit.paths.map((path) => path.slice(0, last + 1)),
      polygons: result.pursuit.polygons.filter((p) => p.sampleIndex <= last),
    },
    // Every trajectory shares the base's sample times, so a revealed prefix
    // is the same span of time on each.
    field: result.field && {
      ...result.field,
      paths: result.field.paths.map((path) => path.slice(0, last + 1)),
      arrows: result.field.arrows.filter((a) => a.sampleIndex <= last),
    },
    second: result.second?.slice(0, last + 1),
    // The circle stays; breaks beyond the revealed samples are harmless.
    inversion: result.inversion && {
      ...result.inversion,
      source: result.inversion.source?.slice(0, last + 1),
    },
    moving: result.moving && {
      ...result.moving,
      positions: result.moving.positions.filter((s) => s.sampleIndex <= last),
    },
  };
}
