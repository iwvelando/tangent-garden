export type Vec = { x: number; y: number };
export type Kind =
  | "evolute"
  | "involute"
  | "catacaustic"
  | "diacaustic"
  | "offset"
  | "rolling"
  | "envelope"
  | "inversion"
  | PoleKind;
// Constructions that project an independent geometric pole onto the tangent
// or normal. They share one tab and one pole, never the optical source.
export const poleKinds = ["pedal", "contrapedal", "orthotomic"] as const;
export type PoleKind = (typeof poleKinds)[number];
export const usesPole = (kind: string): kind is PoleKind =>
  (poleKinds as readonly string[]).includes(kind);
// The curve an inversion inverts: the curve itself, or one of its derived
// curves, computed with the configuration's own pole or offset distance.
export type InversionSource = "curve" | "evolute" | PoleKind | "offset";
// One rotating vector of a Fourier curve.
export type Term = { frequency: number; radius: number; phase: number };
export const maxTerms = 16;
export const harmonicFormats = ["lissajous", "fourier"] as const;
export const isHarmonic = (format: string) =>
  (harmonicFormats as readonly string[]).includes(format);
// How the rolling circle moves: inside or outside a fixed circle centered at
// the origin, or along the x-axis on its upper side.
export type Roll = "inside" | "outside" | "line";
export type Config = {
  kind: Kind;
  curve: {
    format:
      | "parametric"
      | "cartesian"
      | "polar"
      | "roulette"
      | "lissajous"
      | "fourier";
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
    // x = A sin(mt + φ), y = B sin(nt), with amplitudes A, B ≥ 0 and phase φ
    // in radians. Used only when format is "lissajous".
    lissajous: {
      amplitudeX: number;
      amplitudeY: number;
      frequencyX: number;
      frequencyY: number;
      phase: number;
    };
    // z(t) = Σ radius·exp(i(frequency·t + phase)), 1–16 rotating vectors
    // chained in this order from the origin; positive frequencies turn
    // counterclockwise. Used only when format is "fourier".
    terms: Term[];
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
  // A family of lines or circles for the envelope kind. Lines pass through
  // the curve's point at t, turned to the direction angle `angle` (radians,
  // counterclockwise from +x), or are chords to the second endpoint x(t),
  // y(t); chords are segments unless `extend` draws them as full lines.
  // Circles are centered on the curve's point with radius `radius`.
  // Expressions use t and a.
  envelope: {
    mode: "angle" | "chord" | "circle";
    angle: string;
    x: string;
    y: string;
    extend: boolean;
    radius: string;
  };
  // Inversion in the circle of radius `radius` about `center`, applied to the
  // curve named by `of`. Used only by the inversion kind.
  inversion: { center: Vec; radius: number; of: InversionSource };
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

// An offset stack member at its distance, or a circle envelope's branch to
// the left or right of travel.
export type OffsetPath = {
  distance: number;
  points: (Vec | null)[];
  branch?: "left" | "right";
};
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

// The circle of inversion and, for a derived curve, that curve indexed like
// base. The image is open before each sample index in breaks, where it runs
// off to infinity between two finite samples.
export type InversionResult = {
  center: Vec;
  radius: number;
  source?: (Vec | null)[];
  breaks: number[];
};

// A harmonic curve's rotating geometry at a representative sample: the
// centers of a Fourier curve's circles, chained from the origin, or the
// points turning on a Lissajous figure's x and y guides.
export type Epicycles = { sampleIndex: number; joints: Vec[]; point: Vec };
// Period is the smallest t-span after which the curve repeats, 0 when it
// never does exactly (or is a single point, when constant). whole marks
// whole-number frequencies. guides are a Lissajous figure's fixed circles;
// radii are a Fourier curve's term radii, in the order of joints.
export type HarmonicResult = {
  period: number;
  whole: boolean;
  constant: boolean;
  guides: Circle[];
  radii: number[];
  positions: Epicycles[];
};

export type Bounds = { min: string; max: string };
export type Frame = { config: Config; result: Result };
export type Result = {
  sourcePosition?: Vec;
  base: (Vec | null)[];
  derived: (Vec | null)[];
  virtual: boolean[];
  rays: Ray[];
  // Offset stack members or circle envelope branches, indexed like base;
  // empty for other results.
  family: OffsetPath[];
  circles: Circle[];
  // Rolling-circle positions at representative samples; empty for other
  // constructions.
  rolling: Rolling[];
  // Present only for a roulette curve.
  roulette?: RouletteResult;
  // Present only for a Lissajous or Fourier curve.
  harmonic?: HarmonicResult;
  // Present only for a rolling curve.
  moving?: MovingResult;
  // The chords' far endpoints, indexed like base; present only for chords.
  second?: (Vec | null)[];
  // Present only for an inversion.
  inversion?: InversionResult;
  warnings: string[];
  invalid: number;
};
