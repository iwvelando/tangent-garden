import type { Config, Frame, Result } from "./types";
export type CameraMode = "hold" | "current" | "follow" | "fit";
export type Viewport = { cx: number; cy: number; scale: number; span: number };
export type Target =
  | "a"
  | "min"
  | "max"
  | "sourceX"
  | "sourceY"
  | "sourceRadius"
  | "sourceTheta"
  | "angle"
  | "nIncident"
  | "nTransmitted"
  | "offset"
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
  sourceRadius: "Source radius r",
  sourceTheta: "Source theta θ (radians)",
  angle: "Travel direction (degrees)",
  nIncident: "Incident index n₁",
  nTransmitted: "Transmitted index n₂",
  offset: "String offset c",
  samples: "Numerical samples",
  lines: "Construction lines",
  rayLength: "Ray length",
};
export function availableTargets(config: Config): Target[] {
  const targets: Target[] = ["a", "min", "max", "samples", "lines"];
  if (config.kind === "involute") targets.push("offset");
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
    case "sourceRadius":
      return config.source.radius ?? 0;
    case "sourceTheta":
      return config.source.theta ?? 0;
    case "angle":
      return config.source.angle;
    case "rayLength":
      return length;
    default:
      return config[target];
  }
}
export function applyTracks(
  base: Config,
  tracks: NumericTrack[],
  progress: number,
  length: number,
) {
  const config = structuredClone(base);
  for (const track of tracks) {
    let value = track.from + (track.to - track.from) * progress;
    if (track.target === "samples" || track.target === "lines")
      value = Math.round(value);
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
      case "sourceRadius":
        config.source.radius = value;
        break;
      case "sourceTheta":
        config.source.theta = value;
        break;
      case "angle":
        config.source.angle = value;
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
  };
}
