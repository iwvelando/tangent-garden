import { objects, rotationMotions } from "./objects";
export type Vec3 = [number, number, number];
export type Object4 =
  "tesseract" | "ball" | "tube" | "lift" | "bypass" | "weave";
export type Weave = {
  family: "tori" | "fibers";
  alpha: number;
  spread: number;
  alphaFrom: number;
  alphaTo: number;
};
export type Bypass = {
  inner: number;
  outer: number;
  extent: number;
  outside: Vec3;
  height: number;
  position: number;
  obstacle: "embedded" | "radial";
  w1: number;
  w2: number;
};
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
    | "lifted"
    | "shadow"
    | "diagram"
    | "paired";
  lift?: Lift;
  bypass?: Bypass;
  weave?: Weave;
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
  companion?: Result;
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
      | "missing-guide"
      | "route-context"
      | "route-traveled"
      | "collision"
      | "shell"
      | "axes"
      | "fixed-u"
      | "fixed-v"
      | "fiber"
      | "collapsed"
      | "window";
    dashed?: boolean;
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
    kind?: "empty" | "point" | "core-circle" | "solid" | "torus" | "circle";
    radius?: number;
    level: number;
    vertices?: number;
    edges?: number;
    faces?: number;
    dimension: number;
  }[];
  clipped: number;
  radius: number;
  bypass?: {
    state: "clear" | "contact" | "crossing";
    clearance: number;
    current: [number, number, number, number];
    position: number;
    distance: number;
    shadowDistance: number;
    hits: { from: number; to: number }[];
  };
  markers?: {
    id: string;
    role: "moving" | "comparison";
    point: Vec3;
    fourPoint: [number, number, number, number];
    family: number;
  }[];
  weave?: {
    family: Weave["family"];
    sources: number;
    completeCircles: number;
    retainedArcs: number;
    contacts: number;
    absentSources: number;
    collapsed: number;
    window: number;
    projection: string;
  };
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
  comparison?: boolean;
};
export type Motion =
  | "double"
  | "xw"
  | "slice"
  | "drift"
  | "support"
  | "route"
  | "return"
  | "latitude";
// Playback and export use this exact sampler. The base definition is immutable.
export function sample(
  config: Config,
  motion: Motion,
  progress: number,
): Config {
  const q = structuredClone(config),
    p = Math.max(0, Math.min(1, progress));
  if (q.weave && motion === "latitude") {
    q.weave.alpha = q.weave.alphaFrom * (1 - p) + q.weave.alphaTo * p;
  } else if (q.bypass && (motion === "route" || motion === "return")) {
    q.bypass.position = motion === "route" ? p : 1 - p;
  } else if (q.lift && objects[config.object].linkedViews) {
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
// Choices describe the mathematical study, independently of the notebook name.
export function motions(
  config: Config,
): { value: Motion; label: string; help: string }[] {
  if (objects[config.object].motionChoices)
    return objects[config.object].motionChoices!;
  const choices: { value: Motion; label: string; help: string }[] = [
    ...rotationMotions,
    ...(config.mode === "section"
      ? [
          {
            value: "slice" as const,
            label: "Slice passage",
            help: `Move h from −${passageExtent(config).toPrecision(4)} to ${passageExtent(config).toPrecision(4)}, including empty endpoints. ${objects[config.object].passageHelp}`,
          },
        ]
      : []),
  ];
  return choices.filter(
    (choice) => choice.value === "slice" || objects[config.object].rotations,
  );
}
