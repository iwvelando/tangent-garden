import { objects } from "./objects";
export type Vec3 = [number, number, number];
export type Object4 = "tesseract" | "ball" | "tube" | "lift";
export type Lift = {
  center: Vec3;
  support: number;
  height: number;
  angle: number;
  from: Vec3;
  to: Vec3;
  radiusFrom: number;
  radiusTo: number;
};
export type Config = {
  object: Object4;
  radius: number;
  tube: number;
  curves: number;
  mode:
    | "perspective"
    | "orthographic"
    | "stereo"
    | "section"
    | "reference"
    | "lifted";
  lift?: Lift;
  angles: [number, number, number, number, number, number];
  distance: number;
  slice: number;
  spread: number;
  count: number;
  grid: number;
  samples: number;
  clip: number;
};
export type Result = {
  paths: {
    points: Vec3[];
    family: number;
    guide: boolean;
    source: string;
    sectionId?: string;
    branch: string;
    role:
      | "base"
      | "guide"
      | "section"
      | "reference"
      | "lifted"
      | "displacement"
      | "missing-guide";
    parameters?: number[];
    fourPoints?: [number, number, number, number][];
  }[];
  object: Object4;
  operation: Config["mode"];
  emittedPoints: number;
  evaluations: number;
  faces: { points: Vec3[]; family: number }[];
  points: Vec3[];
  sections: {
    id: string;
    kind?: "empty" | "point" | "core-circle" | "solid";
    radius?: number;
    level: number;
    vertices?: number;
    edges?: number;
    faces?: number;
    dimension: number;
  }[];
  clipped: number;
  radius: number;
  lift?: {
    thickness: number;
    missingRadius: number;
    sources: number;
    visibleIntervals: number;
    absentSources: number;
    projection: string;
  };
};
export type View = {
  yaw: number;
  pitch: number;
  zoom: number;
  panX: number;
  panY: number;
};
export const initialView: View = {
  yaw: 0.32,
  pitch: 0.35,
  zoom: 1,
  panX: 0,
  panY: 0,
};
export type Layers = {
  edges: boolean;
  guides: boolean;
  faces: boolean;
  selectedSection?: number;
  missingGuide?: boolean;
  connectors?: boolean;
};
export type Motion = "double" | "xw" | "slice" | "drift" | "support";
// Playback and export use this exact sampler. The base definition is immutable.
export function sample(
  config: Config,
  motion: Motion,
  progress: number,
): Config {
  const q = structuredClone(config),
    p = Math.max(0, Math.min(1, progress));
  if (q.lift && objects[config.object].linkedViews) {
    if (motion === "drift")
      q.lift.center = q.lift.from.map(
        (n, i) => n * (1 - p) + q.lift!.to[i] * p,
      ) as Vec3;
    if (motion === "support")
      q.lift.support = q.lift.radiusFrom * (1 - p) + q.lift.radiusTo * p;
  } else if (motion === "slice") {
    const extent = passageExtent(config);
    q.slice = extent * (2 * p - 1);
  } else if (objects[config.object].rotations) {
    q.angles[3] += 2 * Math.PI * p;
    if (motion === "double") q.angles[2] += 2 * Math.PI * p;
  }
  return q;
}

export function passageExtent(config: Config): number {
  const descriptor = objects[config.object];
  return (
    1.025 * descriptor.support(config) +
    (descriptor.familyPassage && config.count > 1 ? config.spread / 2 : 0)
  );
}
