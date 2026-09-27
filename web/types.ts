export type Vec = { x: number; y: number };
export type Kind =
  | "evolute"
  | "involute"
  | "catacaustic"
  | "diacaustic"
  | "offset"
  | "rolling"
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
  // A circle of radius `radius` rolling without slipping along the curve on
  // the given side of travel, tracing a point at distance `arm` from its
  // center. At the domain start the arm points at the contact, turned
  // counterclockwise by `phase` radians. Used only by the rolling kind.
  rolling: {
    side: "left" | "right";
    radius: number;
    arm: number;
    phase: number;
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
};

export type OffsetPath = { distance: number; points: (Vec | null)[] };
export type Circle = { sampleIndex: number; center: Vec; radius: number };
// The rolling circle at a representative sample, with its contact point and
// its tracing point: on the base curve for a roulette, on the derived curve
// for the rolling construction.
export type Rolling = Circle & { contact: Vec; point: Vec };
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
  warnings: string[];
  invalid: number;
};
