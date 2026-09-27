export type Vec = { x: number; y: number };
export type Kind =
  | "evolute"
  | "involute"
  | "catacaustic"
  | "diacaustic"
  | "offset"
  | "rolling"
  | "envelope"
  | PoleKind;
// Constructions that project an independent geometric pole onto the tangent
// or normal. They share one tab and one pole, never the optical source.
export const poleKinds = ["pedal", "contrapedal", "orthotomic"] as const;
export type PoleKind = (typeof poleKinds)[number];
export const usesPole = (kind: Kind): kind is PoleKind =>
  (poleKinds as readonly Kind[]).includes(kind);
// How the rolling circle moves: inside or outside a fixed circle centered at
// the origin, or along the x-axis on its upper side.
export type Roll = "inside" | "outside" | "line";
export type Config = {
  kind: Kind;
  curve: {
    format: "parametric" | "cartesian" | "polar" | "roulette";
    x: string;
    y: string;
    r: string;
    min: number;
    max: number;
    a: number;
    // A point at distance arm from the center of a circle of radius radius
    // rolling on a circle of radius fixedRadius (ignored on the line). phase
    // turns the arm counterclockwise from the contact direction at t = 0, in
    // radians. Used only when format is "roulette".
    roulette: {
      roll: Roll;
      fixedRadius: number;
      radius: number;
      arm: number;
      phase: number;
    };
  };
  source: {
    kind: "point" | "parallel";
    position: Vec;
    angle: number;
    coordinates?: "cartesian" | "polar";
    radius?: number;
    theta?: number;
  };
  nIncident: number;
  pole: Vec;
  nTransmitted: number;
  // Involute string length c at the domain start.
  offset: number;
  // Signed normal offset d, positive toward the left of travel.
  distance: number;
  // When enabled, count offsets evenly spaced from `from` to `to` replace the
  // single distance.
  stack: { enabled: boolean; from: number; to: number; count: number };
  // Offset circles of the largest distance, centered at representative samples.
  circles: boolean;
  // A shape rolling without slipping along the curve on the given side of
  // travel. Used only by the rolling kind.
  //
  // A circle of radius `radius` traces a point at distance `arm` from its
  // center. At the domain start the arm points at the contact, turned
  // counterclockwise by `phase` radians.
  //
  // A curve is defined in its own frame by x(t), y(t) for t from min to max,
  // and traces `point`, given in that frame. The contact starts at t = start
  // and arc lengths match. On the left it runs forward, with the rolling
  // curve's own left side on the base's left; on the right it runs backward.
  // A closed rolling curve wraps around; an open one stops at its ends.
  rolling: {
    side: "left" | "right";
    shape: "circle" | "curve";
    radius: number;
    arm: number;
    phase: number;
    curve: { x: string; y: string; min: number; max: number; start: number };
    point: Vec;
  };
  // A family of lines, each through the curve's point at t, for the envelope
  // kind: turned to the direction angle `angle` (radians, counterclockwise
  // from +x), or chords to the second endpoint x(t), y(t). Expressions use t
  // and a. Chords are segments unless `extend` draws them as full lines.
  envelope: {
    mode: "angle" | "chord";
    angle: string;
    x: string;
    y: string;
    extend: boolean;
  };
  samples: number;
  lines: number;
};
export type Ray = {
  sampleIndex: number;
  origin: Vec;
  direction: Vec;
  incident: Vec;
  target: Vec | null;
  virtual: boolean;
  tir: boolean;
  // A chord's far endpoint; absent for other lines.
  end?: Vec;
};

export type OffsetPath = { distance: number; points: (Vec | null)[] };
export type Circle = { sampleIndex: number; center: Vec; radius: number };
// The rolling circle at a representative sample, with its contact point and
// its tracing point: on the base curve for a roulette, on the derived curve
// for the rolling construction.
export type Rolling = Circle & { contact: Vec; point: Vec };
// The rigid motion carrying a rolling curve's own frame to the drawing at a
// representative sample: a frame point v lands at origin + rot(angle)v.
export type Placement = {
  sampleIndex: number;
  origin: Vec;
  angle: number;
  contact: Vec;
  point: Vec;
};
// A rolling curve in its own frame, with gaps, and its placements.
export type MovingResult = {
  path: (Vec | null)[];
  closed: boolean;
  positions: Placement[];
};
// A roulette closes after `turns` revolutions of the rolling center with
// `lobes` arches; turns is 0 when it does not close exactly (or on a line).
export type RouletteResult = {
  roll: Roll;
  fixedRadius: number;
  turns: number;
  lobes: number;
  positions: Rolling[];
};

export type Bounds = { min: string; max: string };
export type Frame = { config: Config; result: Result };
export type Result = {
  sourcePosition?: Vec;
  base: (Vec | null)[];
  derived: (Vec | null)[];
  virtual: boolean[];
  rays: Ray[];
  // Offset stack members, indexed like base; empty for other results.
  family: OffsetPath[];
  circles: Circle[];
  // Rolling-circle positions at representative samples; empty for other
  // constructions.
  rolling: Rolling[];
  // Present only for a roulette curve.
  roulette?: RouletteResult;
  // Present only for a rolling curve.
  moving?: MovingResult;
  // The chords' far endpoints, indexed like base; present only for chords.
  second?: (Vec | null)[];
  warnings: string[];
  invalid: number;
};
