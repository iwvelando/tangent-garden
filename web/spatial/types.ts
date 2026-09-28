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
export type SpatialConfig = {
  format: "torus" | "parametric";
  // `length` is the tangent reach, used only by the developable.
  construction:
    "developable" | "involute" | "tangent-foot" | "orthotomic" | "inversion";
  pole: Vec3;
  inversion: InversionConfig;
  involute: InvoluteConfig;
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
export const usesSpatialPole = (c: SpatialConfig) =>
  c.construction === "tangent-foot" ||
  c.construction === "orthotomic" ||
  (c.construction === "inversion" && c.inversion.input !== "base");
