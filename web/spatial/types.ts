export type Vec3 = { x: number; y: number; z: number };
export type Bounds3 = { center: Vec3; radius: number };
// Arc length s is measured from the anchor t₀ (a parameter value inside the
// domain). A member with signed string length c is I = r + (c − s)T. When
// the family is enabled, `count` (2–24) lengths evenly spaced from `from` to
// `to` replace `offset`. Mirrors engine3.InvoluteRequest.
export type InvoluteConfig = {
  anchor: number;
  offset: number;
  family: { enabled: boolean; from: number; to: number; count: number };
};
// Sphere inversion J(p) = O + R²(p − O)/|p − O|² of the base curve or of one
// of its tangent projections from the pole. Mirrors engine3.InversionRequest.
export type InversionInput = "base" | "tangent-foot" | "orthotomic";
export type InversionConfig = {
  center: Vec3;
  radius: number;
  input: InversionInput;
};
// One generating vector A cos(ωt) + B sin(ωt) of a spatial harmonic curve
// r(t) = c₀ + Σ[A_k cos(ω_k t) + B_k sin(ω_k t)]. Mirrors engine3.HarmonicTerm.
export type HarmonicTerm = { frequency: number; cosine: Vec3; sine: Vec3 };
// The domain is input: the curve is closed only when it spans whole periods.
// Mirrors engine3.HarmonicCurve; at most 8 terms.
export type HarmonicCurve = {
  center: Vec3;
  terms: HarmonicTerm[];
  min: number;
  max: number;
};
export const maxHarmonicTerms = 8;
export type SpatialConfig = {
  format: "torus" | "parametric" | "harmonic";
  // `length` is the tangent reach, used only by the developable.
  construction:
    "developable" | "involute" | "tangent-foot" | "orthotomic" | "inversion";
  pole: Vec3;
  inversion: InversionConfig;
  involute: InvoluteConfig;
  harmonic: HarmonicCurve;
  curve: {
    x: string;
    y: string;
    z: string;
    min: number;
    max: number;
    a: number;
  };
  radius: number;
  tube: number;
  length: number;
  p: number;
  q: number;
  samples: number;
  lines: number;
};
export type SpatialResult = {
  base: (Vec3 | null)[];
  minus: (Vec3 | null)[];
  plus: (Vec3 | null)[];
  breaks: boolean[];
  mesh: { position: Vec3; normal: Vec3; phase: number; sampleIndex: number }[];
  rulings: { from: Vec3; to: Vec3; sampleIndex: number }[];
  bounds: Bounds3;
  radius: number;
  omitted: number;
  invalid: number;
  // Present only for the involute construction, whose minus, plus, mesh,
  // and rulings are empty. Member points are indexed like base; null is
  // invalid or unreached from the anchor.
  involute?: InvoluteResult;
  projection?: ProjectionResult;
  inversion?: InversionResult;
  // Present for a harmonic curve under any construction.
  harmonic?: SpatialHarmonicResult;
};
export type InvoluteResult = {
  members: { offset: number; points: (Vec3 | null)[]; collapsed: boolean }[];
  strings: { from: Vec3; to: Vec3; sampleIndex: number }[];
  unreached: number;
};
export type Frame = { config: SpatialConfig; result: SpatialResult };

// Mirrors engine3.ProjectionResult; paths share base indices and breaks.
export type ProjectionResult = {
  pole: Vec3;
  points: (Vec3 | null)[];
  feet: (Vec3 | null)[];
  constructions: {
    sampleIndex: number;
    contact: Vec3;
    foot: Vec3;
    image: Vec3;
  }[];
  collapsed: boolean;
  invalid: number;
};

// Mirrors engine3.InversionResult. Points share base indices, but `breaks`
// replaces the base's: it adds intervals whose source passes through the
// center, where the image leaves through infinity.
export type InversionResult = {
  center: Vec3;
  radius: number;
  input: InversionInput;
  // Present for a derived (projection) input.
  pole?: Vec3;
  source: (Vec3 | null)[];
  points: (Vec3 | null)[];
  breaks: boolean[];
  correspondences: { sampleIndex: number; source: Vec3; image: Vec3 }[];
  collapsed: boolean;
  invalid: number;
  crossings: number;
};
// Mirrors engine3.HarmonicResult. Terms keep their input order, even when
// zero. Joints[k] is where term k's vector starts at a representative
// sample; period is 0 when the curve never repeats.
export type SpatialHarmonicResult = {
  center: Vec3;
  terms: HarmonicTerm[];
  period: number;
  whole: boolean;
  closed: boolean;
  positions: { sampleIndex: number; joints: Vec3[]; point: Vec3 }[];
};
export const usesSpatialPole = (c: SpatialConfig) =>
  c.construction === "tangent-foot" ||
  c.construction === "orthotomic" ||
  (c.construction === "inversion" && c.inversion.input !== "base");
