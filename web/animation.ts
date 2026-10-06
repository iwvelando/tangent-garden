import type { HeldProbe } from "./planar-probe";
import { revealRefined } from "./refinement";
import {
  ownsShape,
  usesPole,
  type AttractorResult,
  type Config,
  type Frame,
  type LevelSet,
  type Result,
} from "./types";
import { backAndForthHelp, onceHelp, type Repeat } from "./timing";
export type CameraMode = "hold" | "current" | "follow" | "fit";
// Draw along the curve, vary parameters, or trace light from its source to
// the caustic (catacaustics and diacaustics only).
export type AnimationMode = "reveal" | "parameters" | "trace" | "probe";
export const canTrace = (config: Config) =>
  config.kind === "catacaustic" || config.kind === "diacaustic";
// Only parameter tracks can return to their start; drawing along the curve
// and tracing light start empty and end full, so they offer back and forth
// instead of a loop (see timing.ts).
export const loops = (mode: AnimationMode) => mode === "parameters";
export const repeatHelp: Record<Repeat, string> = {
  once: onceHelp,
  loop: "Plays again and again, its end joining its start, which needs the last frame to match the first. Play compares the drawing at both ends and says what differs. Parameter tracks return when each ends one period after it starts, for example a from 0 to 2*pi in cos(t + a); counts return only to the count they start from. Drawing along the curve and tracing light start and end differently, so they offer Back and forth instead. Exports leave out the last frame, which is the first again, and loop forever.",
  "back-and-forth": backAndForthHelp,
};
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
  | "contourLevel"
  | "windowXMin"
  | "windowXMax"
  | "windowYMin"
  | "windowYMax"
  | "levelsFrom"
  | "levelsTo"
  | "levelsCount"
  | "contourCells"
  | "mapA"
  | "mapB"
  | "mapC"
  | "mapD"
  | "startX"
  | "startY"
  | "discard"
  | "iterates"
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
  // Where the timeline stands, from which the progress follows (timing.ts).
  time?: number;
  mode: AnimationMode;
  // A finished animation releases the camera: its final frame stays, and pan
  // and zoom start from the animation's own framing.
  complete: boolean;
  // The probe in this frame while it is on, at a sample or between
  // samples; probeAway says why a frame that should show it has none (a
  // reveal that has not reached it, or a frame whose domain leaves it out).
  probe?: HeldProbe;
  probeAway?: string;
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
  contourLevel: "Level c",
  windowXMin: "Window x from",
  windowXMax: "Window x to",
  windowYMin: "Window y from",
  windowYMax: "Window y to",
  levelsFrom: "Levels from",
  levelsTo: "Levels to",
  levelsCount: "Level count",
  contourCells: "Grid cells",
  mapA: "Coefficient a",
  mapB: "Coefficient b",
  mapC: "Coefficient c",
  mapD: "Coefficient d",
  startX: "Start x₀",
  startY: "Start y₀",
  discard: "Discarded iterates",
  iterates: "Accumulated iterates",
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
// An implicit curve's or an iterated map's window and grid, whichever the
// curve is.
const gridded = (config: Config) =>
  config.curve.format === "attractor"
    ? config.curve.attractor
    : config.curve.implicit;
// The implicit curve's fields, with the window's paths in the configuration.
const windowTargets = {
  windowXMin: "xMin",
  windowXMax: "xMax",
  windowYMin: "yMin",
  windowYMax: "yMax",
} as const;
const levelsTargets = {
  levelsFrom: "from",
  levelsTo: "to",
  levelsCount: "count",
} as const;
const mapTargets = { mapA: "a", mapB: "b", mapC: "c", mapD: "d" } as const;
const startTargets = { startX: "x", startY: "y" } as const;
export function availableTargets(config: Config): Target[] {
  // A level set has no parameter, so no domain, samples, or construction:
  // only F's a and the number of normals carry over.
  if (config.curve.format === "implicit")
    return [
      "contourLevel",
      ...(Object.keys(windowTargets) as Target[]),
      ...(config.curve.implicit.family.enabled
        ? (Object.keys(levelsTargets) as Target[])
        : []),
      "contourCells",
      "a",
      "lines",
    ];
  // An iterated map's own coefficients, start, and counts; a window when it
  // is given rather than fitted.
  if (config.curve.format === "attractor") {
    const map = config.curve.attractor;
    return [
      "mapA",
      "mapB",
      ...((map.map === "henon" ? [] : ["mapC", "mapD"]) as Target[]),
      "startX",
      "startY",
      "discard",
      "iterates",
      ...((map.fit ? [] : Object.keys(windowTargets)) as Target[]),
      "contourCells",
      "lines",
    ];
  }
  const targets: Target[] = ["a", "min", "max", "samples", "lines"];
  if (config.kind === "involute") targets.push("offset");
  if (config.kind === "offset")
    targets.unshift(
      ...(config.stack.enabled
        ? (["stackFrom", "stackTo", "stackCount"] as Target[])
        : (["distance"] as Target[])),
    );
  if (usesPole(config.kind)) targets.unshift("poleX", "poleY");
  if (config.kind === "inversion")
    targets.unshift("inversionX", "inversionY", "inversionRadius");
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
  // A derived input's own parameters follow the construction's, unless the
  // construction already has them.
  const input = config.input;
  const inputTargets = (
    usesPole(input) && !usesPole(config.kind)
      ? ["poleX", "poleY"]
      : input === "offset" && !targets.includes("distance")
        ? ["distance"]
        : []
  ) as Target[];
  targets.splice(targets.indexOf("a"), 0, ...inputTargets);
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
    case "contourLevel":
      return config.curve.implicit.level;
    case "windowXMin":
    case "windowXMax":
    case "windowYMin":
    case "windowYMax":
      return gridded(config).window[windowTargets[target]];
    case "levelsFrom":
    case "levelsTo":
    case "levelsCount":
      return config.curve.implicit.family[levelsTargets[target]];
    case "contourCells":
      return gridded(config).cells;
    case "mapA":
    case "mapB":
    case "mapC":
    case "mapD":
      return config.curve.attractor[mapTargets[target]];
    case "startX":
    case "startY":
      return config.curve.attractor.start[startTargets[target]];
    case "discard":
    case "iterates":
      return config.curve.attractor[target];
    case "rayLength":
      return length;
    default:
      return config[target as "offset"];
  }
}
// Counts are whole numbers throughout playback and at both endpoints.
export const integerTargets: Target[] = [
  "samples",
  "lines",
  "stackCount",
  "levelsCount",
  "contourCells",
  "discard",
  "iterates",
];
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
      case "contourLevel":
        config.curve.implicit.level = value;
        break;
      case "windowXMin":
      case "windowXMax":
      case "windowYMin":
      case "windowYMax":
        gridded(config).window[windowTargets[track.target]] = value;
        break;
      case "levelsFrom":
      case "levelsTo":
      case "levelsCount":
        config.curve.implicit.family[levelsTargets[track.target]] = value;
        break;
      case "contourCells":
        gridded(config).cells = value;
        break;
      case "mapA":
      case "mapB":
      case "mapC":
      case "mapD":
        config.curve.attractor[mapTargets[track.target]] = value;
        break;
      case "startX":
      case "startY":
        config.curve.attractor.start[startTargets[track.target]] = value;
        break;
      case "discard":
      case "iterates":
        config.curve.attractor[track.target] = value;
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
// An iterated map is revealed by accumulating a prefix of its iterates,
// rounded to a whole number, in the final drawing's window: the grid stays
// put, and no cell ever holds more than it does at the end.
export function revealConfig(
  config: Config,
  final: AttractorResult,
  progress: number,
): Config {
  const next = structuredClone(config);
  const p = Math.max(0, Math.min(1, progress));
  next.curve.attractor.iterates = Math.round(
    p * config.curve.attractor.iterates,
  );
  next.curve.attractor.fit = false;
  next.curve.attractor.window = { ...final.window };
  return next;
}
// The last sample a reveal at progress p draws.
export const revealedThrough = (result: Result, p: number) =>
  Math.floor(Math.max(0, Math.min(1, p)) * (result.base.length - 1));
// Reveal existing numerical samples, so neither the arc-length anchor nor the
// differentiation stencil changes while the string is being unwound.
export function reveal(result: Result, progress: number): Result {
  const p = Math.max(0, Math.min(1, progress));
  const last = revealedThrough(result, p);
  // Contours have no samples: each is drawn along by the same fraction of
  // its points, and a loop stays open until it is complete.
  const along = (set: LevelSet) => ({
    ...set,
    contours: set.contours.map((c) =>
      p < 1
        ? {
            points: c.points.slice(0, Math.ceil(p * c.points.length)),
            closed: false,
          }
        : c,
    ),
  });
  const contours = result.contours;
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
    input: result.input?.slice(0, last + 1),
    // A refined curve shows its points up to the last revealed sample.
    adaptive: result.adaptive && {
      base: revealRefined(result.adaptive.base, last),
      input: revealRefined(result.adaptive.input, last),
      derived: revealRefined(result.adaptive.derived, last),
      family: result.adaptive.family?.map((path) => revealRefined(path, last)!),
    },
    moving: result.moving && {
      ...result.moving,
      positions: result.moving.positions.filter((s) => s.sampleIndex <= last),
    },
    contours: contours && {
      ...contours,
      curve: along(contours.curve),
      family: contours.family.map(along),
      normals: contours.normals.slice(
        0,
        Math.floor(p * contours.normals.length),
      ),
    },
  };
}
