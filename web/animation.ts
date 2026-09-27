import { usesPole, type Config, type Frame, type Result } from "./types";
export type CameraMode = "hold" | "current" | "follow" | "fit";
export type Viewport = { cx: number; cy: number; scale: number; span: number };
export type Target =
  | "a"
  | "min"
  | "max"
  | "sourceX"
  | "sourceY"
  | "poleX"
  | "poleY"
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
export const targetLabels: Record<Target, string> = {
  a: "Shape parameter a",
  min: "Domain start",
  max: "Domain end",
  sourceX: "Source x",
  sourceY: "Source y",
  poleX: "Pole x",
  poleY: "Pole y",
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
  samples: "Numerical samples",
  lines: "Construction lines",
  rayLength: "Ray length",
};
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
  return targets;
}
export function targetValue(
  config: Config,
  target: Target,
  length: number,
): number {
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
    case "rayLength":
      return length;
    default:
      return config[target];
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
      case "rayLength":
        length = value;
        break;
      default:
        config[track.target] = value;
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
    second: result.second?.slice(0, last + 1),
    moving: result.moving && {
      ...result.moving,
      positions: result.moving.positions.filter((s) => s.sampleIndex <= last),
    },
  };
}
