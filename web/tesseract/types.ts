import { readout as formatNumber } from "../number-format";
import { tiered, type Help } from "../help";
import type { LineWeight } from "../line-weight";
import type { PolygonVertex } from "../sphere-polygon";
import {
  objects,
  phraseMotion,
  rotationMotions,
  type MotionChoice,
} from "./objects";
export type Vec3 = [number, number, number];
export type Object4 =
  | "tesseract"
  | "ball"
  | "tube"
  | "lift"
  | "bypass"
  | "weave"
  | "cell24"
  | "cell16"
  | "root";
// The root journey (engine4/root.go): the circle z = r e^{iφ}(k + e^{it})
// and its continuously followed n-th root w, wⁿ = z, for 0 ≤ t ≤ 2πn.
// k = 0 is the origin circle; n = 2, the square root, w = ±√r e^{it/2}.
export type Root = {
  radius: number;
  // The center c = k r e^{iφ}: offset k in radii, direction φ in radians.
  // Absent in older links, which open the origin circle.
  offset?: number;
  direction?: number;
  // The degree n, a whole number from 2 to 6; absent in older links, and
  // for the square root, which is 2.
  degree?: number;
  // w(0) = σ ω^b ⁿ√z(0), ω = e^{2πi/n}: the sign σ, and the turn b, absent
  // (0) at n = 2, where the sign alone names the sheet (rootSheet in
  // ./objects.ts).
  sheet: "plus" | "minus";
  branch?: number;
  // Radians: where the trace motion begins and ends.
  from: number;
  to: number;
  // Progress from `from` to `to`, which only the sampler below sets.
  trace?: number;
  // A noncircular source path (#413 research, ./research.ts), placed as
  // the circle is: z = r e^{iφ}(k + s(t)). Absent for the circle. A ripple
  // s = e^{it} + a e^{imt}; a Fourier loop s = Σ ρ e^{i(f t + ψ)}.
  path?: "ripple" | "fourier";
  ripple?: number;
  frequency?: number;
  terms?: RootTerm[];
};
// One term ρ e^{i(f t + ψ)} of a Fourier source path, as Draw a loop
// writes it.
export type RootTerm = { frequency: number; radius: number; phase: number };
// A dual pair, the 24-cell (cell24) or the tesseract and its 16-cell
// (cell16): the selected primal cell (counted from 0), which is also the
// ID of its center, a vertex of the dual, and how much to draw.
export type DualPair = {
  selected: number;
  view: "cell" | "crystal";
  // Transient presentation set only by the crystal passage; links accept 0.
  emphasis?: number;
};
export type Cell24 = DualPair;
export type Weave = {
  family: "tori" | "fibers";
  alpha: number;
  spread: number;
  alphaFrom: number;
  alphaTo: number;
  // Base sphere and fibers only. The selected base sample, counted from 0
  // (absent is 0), and the traced point's offset from it in turns, which
  // only the sampler below sets.
  selected?: number;
  trace?: number;
  path?: "latitude" | "flower" | "great-circle" | "lissajous" | "polygon";
  amplitude?: number;
  petals?: number;
  // A great circle's tilt β (absent is 0) and a spherical Lissajous
  // curve's whole frequencies m₁ and m₂ (sphere-paths.ts gives their
  // absent defaults).
  tilt?: number;
  azimuthal?: number;
  polar?: number;
  // A geodesic polygon's vertices, read only while it is the path.
  vertices?: PolygonVertex[];
  // Fiber sampling: the whole path (absent) or a neighborhood of the
  // moving point, width w of the path's period with nearby fibers. Both
  // are read only under the neighborhood and kept under the whole path.
  sampling?: "path" | "neighborhood";
  width?: number;
  nearby?: number;
  // Carry a marked point along the moving fiber (absent: off), starting
  // phase radians from the north chart's representative (absent: 0). The
  // phase is read only while the point is carried, and kept otherwise.
  transport?: boolean;
  phase?: number;
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
    | "paired"
    // The base sphere pane of the weave's paired views; never a study's mode.
    | "base";
  lift?: Lift;
  bypass?: Bypass;
  weave?: Weave;
  cell24?: DualPair;
  cell16?: DualPair;
  root?: Root;
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
      | "window"
      | "moving"
      | "base-curve"
      | "globe"
      // A neighborhood's fibers and its stretch of the base path.
      | "near"
      | "neighborhood"
      // A carried marked point's trail, the horizontal lift over the last
      // turn, and the gap along the moving fiber between the trail's ends.
      | "lift"
      | "holonomy"
      // The 24-cell's roles (./polytope.ts).
      | "primal"
      | "dual"
      | "cell"
      | "diagonal"
      | "spoke"
      // The root journey's circuits, trace and principal cut.
      | "circuit"
      | "trace"
      | "cut";
    dashed?: boolean;
    parameters?: number[];
    fourPoints?: [number, number, number, number][];
  }[];
  object: Object4;
  operation: Config["mode"];
  emittedPoints: number;
  evaluations: number;
  faces: {
    points: Vec3[];
    family: number;
    guide?: boolean;
    source?: string;
    sectionId?: string;
  }[];
  points: Vec3[];
  sections: {
    id: string;
    kind?:
      | "empty"
      | "point"
      | "core-circle"
      | "solid"
      | "torus"
      | "circle"
      | "flower"
      | "great-circle"
      | "lissajous"
      | "polygon"
      | "primal"
      | "dual";
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
    role:
      | "moving"
      | "comparison"
      | "sample"
      | "near"
      | "center"
      | "vertex"
      | "start"
      | "current"
      | "branch-point"
      // A carried marked point, and where it started.
      | "marked"
      | "marked-start";
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
    // Base sphere and fibers: the samples, selection and moving point.
    correspondence?: {
      fibers: number;
      selected: number;
      // The sample the moving point is on, or −1 between samples.
      movingSample: number;
      parameter: number;
      base: Vec3;
      chart: "north" | "south";
      coincident: boolean;
      path?: Exclude<Weave["path"], "latitude">;
      // The exact closing parameter of a great circle or Lissajous curve;
      // the latitude and flower close at 2π.
      period?: number;
      // A geodesic polygon's side count, and the side holding the moving
      // point, counted from 0; a vertex begins its departing side.
      side?: number;
      sides?: number;
      aliases?: number[];
      // Only under neighborhood sampling (engine4/neighborhood.go).
      neighborhood?: {
        width: number;
        fibers: number;
        // The stretch's ends c ∓ wT/2, unwrapped.
        from: number;
        to: number;
        parameters: number[];
        aliases?: number[];
      };
      // Only while a marked point is carried (engine4/phase.go). Start and
      // point are unrotated points of S³; one turn of the path turns the
      // point by the holonomy, in (−π, π].
      transport?: {
        holonomy: number;
        start: [number, number, number, number];
        point: [number, number, number, number];
        inside: boolean;
        startInside: boolean;
      };
    };
  };
  // A dual pair, the 24-cell and its polar (engine4/cell24.go) or the
  // tesseract and its 16-cell (engine4/cell16.go). Paths and markers are
  // drawn from these arrays (./polytope.ts).
  polytope?: {
    sections?: PairSection[];
    view: DualPair["view"];
    selected: number;
    primal: PairPolytope;
    dual: PairPolytope;
    cellVertices: number[];
    cellEdges: number[];
    neighbors: number[];
    neighborEdges: number[];
    // The face each neighbor's cell shares with the selected one: a
    // triangle of the 24-cell, a square of the tesseract.
    sharedFaces: number[][];
    shadowEdges: [number, number];
  };
  root?: {
    parameter: number;
    // 1 to n: c while 2π(c − 1) ≤ t mod 2πn < 2πc.
    circuit: number;
    z: [number, number];
    w: [number, number];
    principal: 1 | -1;
    // For n ≥ 3, the degree and w's index m, w = ω^m ⁿ√z with the
    // principal root (absent for 0); both absent for the square root.
    degree?: number;
    index?: number;
    residual: number;
    normBound: number;
    // |(z, w)| at the moving point.
    norm: number;
    intervals: number;
    // Intervals after refinement near the branch point.
    refined: number;
    // The center offset k in radii, 0 for the origin circle.
    offset: number;
    // Winding of z about 0 over one circuit, and min |z| = r|1 − k|. A
    // noncircular path may wind any whole number of times; its closest is
    // a sampled upper bound.
    winding: number;
    closest: number;
    // A noncircular path only: its name, the circuits until w is home,
    // n/gcd(n, W), the certified lower bound on min |z|, and the drawing's
    // tolerance.
    path?: "ripple" | "fourier";
    period?: number;
    closestBound?: number;
    tolerance?: number;
    center: number;
    projection: string;
    diagram: string;
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
// Finite cell incidence; coordinates are lifted, not JSON number structs.
export type PairSection = {
  id: string;
  object: "primal" | "dual";
  level: number;
  dimension: number;
  points: Vec3[];
  fourPoints: [number, number, number, number][];
  origins: [number, number][];
  vertexCells: number[][];
  edges: [number, number][];
  facets: { vertices: number[]; cells: number[] }[];
};
export type PairPolytope = {
  circumradius: number;
  edgeLength: number;
  source: [number, number, number, number][];
  rotated: [number, number, number, number][];
  points: Vec3[];
  edges: [number, number][];
  faces: number;
  cells: number;
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
  // How wide lines are drawn (../line-weight.ts); regular when absent, as
  // in links made before line weights.
  weight?: LineWeight;
};
export type Motion =
  | "double"
  | "xw"
  | "slice"
  | "drift"
  | "support"
  | "route"
  | "return"
  | "latitude"
  | "trace"
  | "crystal"
  // A phrase the user arranges (./phrase.ts), offered by the descriptor.
  | "phrase";
// A continuous value a 4D phrase can move (./phrase.ts): a rotation angle,
// a view setting, or one of an object's own parameters.
export type TesseractTarget =
  | "xy"
  | "xz"
  | "yz"
  | "xw"
  | "yw"
  | "zw"
  | "distance"
  | "clip"
  | "slice"
  | "spread"
  | "weave.alpha"
  | "weave.spread"
  | "weave.amplitude"
  | "weave.tilt"
  | "weave.width"
  | "weave.trace"
  | "root.t"
  | "root.radius";
// Playback and export use this exact sampler. The base definition is immutable.
export function sample(
  config: Config,
  motion: Motion,
  progress: number,
): Config {
  const q = structuredClone(config),
    p = Math.max(0, Math.min(1, progress));
  // A phrase samples its own compiled timeline (./phrase.ts).
  if (motion === "phrase") return q;
  if (q.root && motion === "trace") {
    q.root.trace = p;
  } else if (q.weave && motion === "trace") {
    q.weave.trace = p;
  } else if (q.weave && motion === "latitude") {
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
  } else if (motion === "slice" || motion === "crystal") {
    const extent = passageExtent(config);
    q.slice = extent * (2 * p - 1);
    const key = objects[config.object].parameterKey;
    const pair = key === "cell24" || key === "cell16" ? q[key] : undefined;
    if (motion === "crystal" && pair)
      pair.emphasis = (1 - Math.cos(2 * Math.PI * p)) / 2;
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
// A slice passage's help: its extent, then the object's own detail.
function passageHelp(config: Config): Help<string> {
  const extent = formatNumber(passageExtent(config)),
    brief = `Move h from −${extent} to ${extent}, empty at both ends.`,
    more = objects[config.object].passageHelp;
  return more ? tiered(brief, more) : brief;
}
// Choices describe the mathematical study, independently of the notebook name.
export function motions(config: Config): MotionChoice[] {
  const phrase = objects[config.object].phrase?.(config).length
    ? [phraseMotion]
    : [];
  const own = objects[config.object].motionChoices;
  if (own)
    return [...(typeof own === "function" ? own(config) : own), ...phrase];
  const choices: MotionChoice[] = [
    ...rotationMotions,
    ...(config.mode === "section" && objects[config.object].sectionMotion
      ? [objects[config.object].sectionMotion!]
      : []),
    ...(config.mode === "section"
      ? [
          {
            value: "slice" as const,
            label: "Slice passage",
            help: passageHelp(config),
            loops: true,
          },
        ]
      : []),
  ];
  return [
    ...choices.filter(
      (choice) => choice.value === "slice" || objects[config.object].rotations,
    ),
    ...phrase,
  ];
}
