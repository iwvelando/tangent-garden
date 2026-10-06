import type { RefinedPath } from "./refinement";
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
// The curve a construction acts on: the curve itself, or one of its derived
// curves, computed with the configuration's own pole or offset distance.
export type ConstructionInput = "curve" | "evolute" | PoleKind | "offset";
// A study's name in exported file names: a format with no parameter, or the
// construction and, when it is derived, the curve it acts on.
export const studyName = (config: Config) =>
  config.curve.format === "implicit" || config.curve.format === "attractor"
    ? config.curve.format
    : config.input === "curve"
      ? config.kind
      : `${config.kind}-of-${config.input}`;
// An evolute input already needs the curve's second derivative, so it cannot
// feed a construction that needs two more (engine/input.go).
export const inputAllowed = (kind: Kind, input: ConstructionInput) =>
  input !== "evolute" ||
  (kind !== "evolute" && kind !== "catacaustic" && kind !== "diacaustic");
// One rotating vector of a Fourier curve.
export type Term = { frequency: number; radius: number; phase: number };
export const maxTerms = 16;
export const harmonicFormats = ["lissajous", "fourier"] as const;
export const isHarmonic = (format: string) =>
  (harmonicFormats as readonly string[]).includes(format);
// One member of a cyclic pursuit: its position at the domain start and its
// constant speed.
export type Pursuer = { x: number; y: number; speed: number };
export const maxPursuers = 16;
export const maxSeeds = 16;
// Harmonic curves and pursuits define their own shape, without a.
export const ownsShape = (format: string) =>
  isHarmonic(format) || format === "pursuit" || format === "attractor";
// The curated iterated maps.
export type AttractorMap = "clifford" | "dejong" | "henon";
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
      | "fourier"
      | "pursuit"
      | "field"
      | "implicit"
      | "attractor";
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
    // 2–16 pursuers, each running straight at the next (the last at the
    // first) at its own speed, from its position at the domain start; t is
    // time. The chase stops for everyone when any pursuer comes within
    // capture of its target. The first pursuer's path is the curve that
    // constructions use. Used only when format is "pursuit".
    pursuit: { pursuers: Pursuer[]; capture: number };
    // The trajectories of ẋ = x(x, y, t), ẏ = y(x, y, t) from 1–16 seeds at
    // the domain start; t is time, and a binds as in any curve expression.
    // A trajectory ends where it leaves the circle of radius escape about
    // the origin, or where the field stops being finite. The first seed's
    // trajectory is the curve that constructions use. Used only when format
    // is "field".
    field: { x: string; y: string; seeds: Vec[]; escape: number };
    // The level set F(x, y) = level within window, sought on a grid of
    // `cells` near-square cells along the window's longer side (4–1024). f
    // may use a but not t. When enabled, the family adds `count` (2–64)
    // levels evenly spaced from `from` to `to`, both included. Used only when
    // format is "implicit", which has no parameter: its contours are the
    // drawing, and no construction applies.
    implicit: {
      f: string;
      level: number;
      family: { enabled: boolean; from: number; to: number; count: number };
      window: Window;
      cells: number;
    };
    // An iterated map's orbit from start: the first `discard` iterates
    // (0–1,000,000) are dropped and the next `iterates` (0–5,000,000) counted
    // in a grid of `cells` near-square cells (4–1024) along the longer side
    // of the window, or of the iterates' own bounds when fit is set. Hénon's
    // map uses only a and b. Used only when format is "attractor", which has
    // no parameter and no construction.
    attractor: {
      map: AttractorMap;
      a: number;
      b: number;
      c: number;
      d: number;
      start: Vec;
      discard: number;
      iterates: number;
      fit: boolean;
      window: Window;
      cells: number;
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
  // Inversion in the circle of radius `radius` about `center`. Used only by
  // the inversion kind.
  inversion: { center: Vec; radius: number };
  // The curve the construction acts on. Formats with no parameter ignore it.
  input: ConstructionInput;
  samples: number;
  lines: number;
  // Refines the drawn curves between their samples (engine/adaptive.go);
  // absent or false draws the samples alone, as before refinement existed.
  adaptive?: boolean;
};
// Whether a curve format can be evaluated between its samples: not an
// integrated chase or trajectory, nor a level set or iterated map.
export const refinesBetweenSamples = (format: Config["curve"]["format"]) =>
  !["pursuit", "field", "implicit", "attractor"].includes(format);
// Mirrors engine.Diagnostics: the base curve at every sample, for the
// probe. curvature is signed, positive where the curve turns left; normal
// is the tangent turned a quarter turn left; center is the center of
// curvature, null where flat, unknown or beyond 100 study radii; length is
// the drawn arc length from the first sample.
export type Diagnostics = {
  min: number;
  max: number;
  curvature: (number | null)[];
  tangent: (Vec | null)[];
  normal: (Vec | null)[];
  center: (Vec | null)[];
  length: (number | null)[];
  flat: number;
  unknown: number;
  clipped: number;
};
// Mirrors engine.ProbeQuery: the probe at the parameter t, or where the
// drawn arc length is share of the whole.
export type ProbeQuery = { t: number } | { share: number };
// Mirrors engine.ProbePoint: the base curve described at the parameter t as
// Diagnostics does at a sample, each null where the base is not drawn
// there, with the construction's derived input (when it acts on one) and
// its point, where it is defined pointwise.
export type ProbePoint = {
  t: number;
  point: Vec | null;
  tangent: Vec | null;
  normal: Vec | null;
  curvature: number | null;
  center: Vec | null;
  length: number | null;
  input?: Vec | null;
  derived: Vec | null;
};
// Mirrors engine.AdaptiveResult: the refined base curve, derived input, and
// derived curve (pedal-type, evolute, offset, caustic or inverted), each
// absent when
// it is not refined, and an offset stack's members in family order.
export type AdaptiveResult = {
  base?: RefinedPath<Vec>;
  input?: RefinedPath<Vec>;
  derived?: RefinedPath<Vec>;
  family?: RefinedPath<Vec>[];
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
  // Only while rays are traced, never from Go: the incident ray drawn from
  // `from` to `to`, and the outgoing ray to `out` with its virtual extension
  // back to `back`, once it has left the curve.
  traced?: { from: Vec; to: Vec; out: Vec | null; back: Vec | null };
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

// The circle of inversion. The image is open before each sample index in
// breaks, where it runs off to infinity between two finite samples.
export type InversionResult = {
  center: Vec;
  radius: number;
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

// The pursuers' positions, in chase order, at a representative sample.
export type Polygon = { sampleIndex: number; points: Vec[] };
// Every pursuer's path, indexed like base. The chase is known from the domain
// start to end: the domain end, the capture, or, when exhausted, where the
// integration step budget ran out. Pursuer indices count from 0.
export type PursuitResult = {
  paths: (Vec | null)[][];
  polygons: Polygon[];
  capture: { time: number; pursuer: number; target: number } | null;
  exhausted: boolean;
  end: number;
};

// Why a trajectory stopped: the domain end, leaving the escape circle (at
// the domain start for a seed outside it), a field that is not finite or a
// collapsing step, or the integration step budget.
export type TrajectoryEnd = {
  time: number;
  reason: "end" | "escape" | "singular" | "exhausted";
};
// The field's value at a trajectory's position at a representative sample.
export type Arrow = {
  sampleIndex: number;
  seed: number;
  point: Vec;
  velocity: Vec;
};
// Every trajectory, indexed like base; samples after its end are gaps. Seed
// indices count from 0. A field whose expressions do not read t (timed is
// false) has one direction field: the field's value on a square lattice of
// the given spacing spanning the trajectories, without points where it is
// zero or not finite.
export type FieldResult = {
  paths: (Vec | null)[][];
  arrows: Arrow[];
  ends: TrajectoryEnd[];
  timed: boolean;
  grid: { spacing: number; points: { point: Vec; velocity: Vec }[] };
};

// The rectangle an implicit curve is sought in.
export type Window = { xMin: number; xMax: number; yMin: number; yMax: number };
// One connected piece of a level set, running with larger F on its left. An
// open contour ends at the window's edge or beside cells where F is not
// finite or not continuous.
export type Contour = { points: Vec[]; closed: boolean };
export type LevelSet = { level: number; contours: Contour[] };
// F's gradient at a point of the curve.
export type Normal = { point: Vec; gradient: Vec };
// The curve's level set on a grid of columns × rows cells, the family's
// level sets, and the gradient at points spaced evenly by arc length along
// the curve. discontinuities are where F changes sign along a grid edge
// without reaching the level (a pole or a jump), one per edge; nonfinite
// counts grid points where F is not a finite number. Neither is drawn
// through.
export type ContourResult = {
  window: Window;
  columns: number;
  rows: number;
  curve: LevelSet;
  family: LevelSet[];
  normals: Normal[];
  discontinuities: Vec[];
  nonfinite: number;
};

// How often the accumulated iterates visit each cell of the window: counts
// are row-major from (xMin, yMin), rows upward. outside counts accumulated
// iterates beyond the window; escape is the number of the iterate that left
// |x|, |y| ≤ 100000, ending the orbit, or 0. orbit is the start and the
// first iterates, discarded or not.
export type AttractorResult = {
  window: Window;
  columns: number;
  rows: number;
  counts: number[];
  max: number;
  accumulated: number;
  outside: number;
  escape: number;
  orbit: Vec[];
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
  // Present only for a cyclic pursuit.
  pursuit?: PursuitResult;
  // Present only for a vector field's trajectories.
  field?: FieldResult;
  // Present only for an implicit curve, whose base and derived paths are
  // empty.
  contours?: ContourResult;
  // Present only for an iterated map, whose base and derived paths are
  // empty.
  attractor?: AttractorResult;
  // Present only for a rolling curve.
  moving?: MovingResult;
  // The chords' far endpoints, indexed like base; present only for chords.
  second?: (Vec | null)[];
  // Present only for an inversion.
  inversion?: InversionResult;
  // The derived curve the construction acts on, indexed like base; present
  // only when the input is not the curve itself.
  input?: (Vec | null)[];
  // Present only when refinement was asked for a curve it can refine.
  adaptive?: AdaptiveResult;
  // Present only when the probe asked, for a curve with a parameter.
  diagnostics?: Diagnostics;
  // Present only when the probe asked for one parameter.
  probe?: ProbePoint;
  warnings: string[];
  invalid: number;
};
