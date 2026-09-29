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
// A frame (T, U, V) along the curve: rotation-minimizing (parallel transport)
// or the Frenet frame as a diagnostic. N₀ (`reference`), projected onto the
// normal plane where each unbroken stretch begins, sets U there. The offset
// direction is D = cos θ U + sin θ V with θ = angle + 2π·twist·s/L (radians,
// twist in turns over the drawn length). The ribbon is r + uD for |u| ≤
// width; `strands` (0–12) offset curves r + offset·D turn by 2πk/strands.
// Mirrors engine3.FrameRequest.
export type FrameKind = "rotation-minimizing" | "frenet";
export type FrameClosure = "seam" | "distribute";
export type FrameConfig = {
  kind: FrameKind;
  reference: Vec3;
  angle: number;
  twist: number;
  offset: number;
  width: number;
  strands: number;
  closure: FrameClosure;
};
export const maxFrameStrands = 12;
// Straight rulings join a(t) to its partner at φ(t) = rate·t + shift, S(t, u)
// = (1 − u) a(t) + u b(φ(t)). A "chord" partner is the curve itself (wrapping
// on a closed curve, stopping outside an open domain); a "thread" partner is
// b(t) = (x, y, z), written in t, evaluated wherever φ sends it. Mirrors
// engine3.RuledRequest.
export type RuledPartner = "chord" | "thread";
export type RuledConfig = {
  partner: RuledPartner;
  thread: { x: string; y: string; z: string };
  rate: number;
  shift: number;
};
// The envelope of spheres centred on the curve with radius R(t) =
// radius·ρ(t), `profile` being ρ written in t (1 gives a tube). The angle
// around each contact circle is carried by the rotation-minimizing frame of
// `frame` (N₀, θ₀, twist and closure only); `meridians` (0–12) curves
// θ = θ₀ + 2πk/meridians are drawn on it. Mirrors engine3.CanalRequest.
export type CanalConfig = {
  radius: number;
  profile: string;
  meridians: number;
};
export const maxMeridians = 12;
// The system r′ = V(x, y, z, t), with (x, y, z) the expressions for dx/dt,
// dy/dt and dz/dt in x, y, z, t and a. Each seed starts a trajectory at t =
// min that runs to max, unless it first leaves the sphere of radius `escape`
// about the origin or meets a nonfinite field. The first seed's trajectory
// is the base curve for every construction. Mirrors engine3.FieldRequest.
export type FieldConfig = {
  x: string;
  y: string;
  z: string;
  seeds: Vec3[];
  escape: number;
  min: number;
  max: number;
  a: number;
};
export const maxSpatialSeeds = 12;
// A pursuer starts at (x, y, z) at t = min and runs straight at the next,
// the last at the first, at its own constant speed.
export type SpatialPursuer = Vec3 & { speed: number };
// A spatial cyclic pursuit from t = min to max. The chase stops for everyone
// the first time any pursuer comes within `capture` of its own target. The
// first pursuer's path is the base curve. Mirrors engine3.PursuitRequest.
export type SpatialPursuitConfig = {
  pursuers: SpatialPursuer[];
  capture: number;
  min: number;
  max: number;
};
export const maxSpatialPursuers = 16;
// An analytic patch X(u, v) on a uSamples × vSamples grid of cells. a, b
// and c are an ellipsoid's semi-axes; a torus's major radius R and minor
// radius r; an elliptic cylinder's semi-axes; the curvatures k₁ and k₂ of
// the paraboloid z = (k₁x² + k₂y²)/2 at its vertex; or the height k of the
// monkey saddle z = k(x³ − 3xy²). The normal is X_u × X_v normalized, or its
// opposite when `reverse` is set; the shape operator is −dn, so κ > 0 where
// the surface bends towards n. The offset is X + offset·n (none at 0), and
// each normal line runs from X to X + reach·n. Mirrors engine3.SurfaceRequest.
export type SurfaceKind =
  "ellipsoid" | "torus" | "cylinder" | "paraboloid" | "monkey";
export type SurfaceConfig = {
  kind: SurfaceKind;
  a: number;
  b: number;
  c: number;
  uMin: number;
  uMax: number;
  vMin: number;
  vMax: number;
  uSamples: number;
  vSamples: number;
  curves: number;
  reverse: boolean;
  offset: number;
  reach: number;
};
export const maxSurfaceCells = 14400;
export const maxSurfaceCurves = 48;
// The light on a surface, for one reflection ("reflect", a mirror) or one
// refraction ("refract", an interface from index n1 on the normal's side
// into n2 beyond, η = n1/n2; n1 and n2 are read only then). Parallel light
// travels along (cos β cos α, cos β sin α, sin β), azimuth α and elevation
// β in degrees; a point source sits at `source`. The surface's normal
// declares the side the light arrives from: a sample is lit only where the
// light arrives against n. Each representative ray is drawn `length` along
// its outgoing direction and as far back behind the surface; parallel light
// arrives from `length` away. Mirrors engine3.RaysRequest.
export type RaysLight = "parallel" | "point";
export type RaysInteraction = "reflect" | "refract";
// A receiver on the plane `plane` = at, with a square window of side `size`
// centred on (c1, c2) in the plane's cyclic coordinates ((y, z) on x = at,
// (z, x) on y = at, (x, y) on z = at), divided into bins × bins bins; the
// other fields are read only when the plane is not "none". Mirrors
// engine3.ReceiverRequest.
export type ReceiverPlane = "none" | "x" | "y" | "z";
export type ReceiverConfig = {
  plane: ReceiverPlane;
  at: number;
  c1: number;
  c2: number;
  size: number;
  bins: number;
};
export const minReceiverBins = 8;
export const maxReceiverBins = 240;
export type RaysConfig = {
  interaction: RaysInteraction;
  n1: number;
  n2: number;
  light: RaysLight;
  azimuth: number;
  elevation: number;
  source: Vec3;
  length: number;
  receiver: ReceiverConfig;
};
// The level set F(x, y, z) = level of an expression in x, y, z and a (not
// t), within the box, on a grid of `cells` cells along the box's longest
// side and as many along the others as keeps them nearest to cubes. Its
// sections are `count` planes n̂·p = d with n̂ the normal made a unit vector
// and d evenly from `from` to `to`, both included (one plane stands at
// `from`; none at 0); the normal and offsets are read only then. Mirrors
// engine3.ImplicitRequest.
export type ImplicitBox = {
  xMin: number;
  xMax: number;
  yMin: number;
  yMax: number;
  zMin: number;
  zMax: number;
};
export type ImplicitConfig = {
  f: string;
  a: number;
  level: number;
  box: ImplicitBox;
  cells: number;
  sections: { normal: Vec3; from: number; to: number; count: number };
};
export const minImplicitCells = 4;
export const maxImplicitCells = 128;
export const maxImplicitGrid = 262144;
export const maxSections = 24;
export type SpatialConfig = {
  format:
    | "torus"
    | "parametric"
    | "harmonic"
    | "field"
    | "pursuit"
    | "surface"
    | "rays"
    | "implicit";
  // `length` is the tangent reach, used only by the developable.
  construction:
    | "developable"
    | "involute"
    | "tangent-foot"
    | "orthotomic"
    | "inversion"
    | "framed"
    | "ruled"
    | "canal"
    | "none";
  pole: Vec3;
  inversion: InversionConfig;
  involute: InvoluteConfig;
  harmonic: HarmonicCurve;
  frame: FrameConfig;
  ruled: RuledConfig;
  canal: CanalConfig;
  field: FieldConfig;
  pursuit: SpatialPursuitConfig;
  // Read only when the format is "surface", which ignores every curve and
  // construction field, or "rays", which reads the patch as a mirror but
  // not its offset or normal reach.
  surface: SurfaceConfig;
  // Read only when the format is "rays".
  rays: RaysConfig;
  // Read only when the format is "implicit", which ignores every other
  // field.
  implicit: ImplicitConfig;
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
  // Present for a vector field under any construction.
  field?: SpatialFieldResult;
  // Present for a pursuit under any construction.
  pursuit?: SpatialPursuitResult;
  // Present only for a surface study, whose curve fields are all empty.
  surface?: SurfaceResult;
  // Present only for a ray study, whose curve fields are all empty.
  rays?: RaysResult;
  // Present only for an implicit surface, whose curve fields are all empty.
  implicit?: ImplicitResult;
  // Present only for the framed construction; its ribbon fills mesh, minus,
  // plus, and rulings, joined across frame.breaks rather than breaks.
  frame?: FrameResult;
  // Present only for the ruled construction: the partner fills plus (minus
  // is empty), and mesh and rulings are joined across ruled.breaks.
  ruled?: RuledResult;
  // Present only for the canal construction, with `frame` for the frame that
  // carries its angle. Its surface fills mesh; minus, plus and rulings are
  // empty, and meridians are joined across canal.breaks.
  canal?: CanalResult;
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
// Mirrors engine3.FrameResult. Strands share base indices; `breaks` adds the
// Frenet normal's reversals to the base's. Normal is U and binormal is V for
// either frame. Holonomy (radians) is the transported U's return angle on an
// unbroken closed loop; correction is the twist distributed to cancel it.
export type FrameGlyph = {
  sampleIndex: number;
  point: Vec3;
  tangent: Vec3;
  normal: Vec3;
  binormal: Vec3;
};
export type FrameResult = {
  kind: FrameKind;
  frames: FrameGlyph[];
  strands: (Vec3 | null)[][];
  breaks: boolean[];
  length: number;
  pieces: number;
  undefined: number;
  flips: number;
  fallbacks: number;
  closed: boolean;
  holonomy: number;
  correction: number;
  // Where a closed loop's offset direction fails to return.
  seam?: { point: Vec3; start: Vec3; end: Vec3; angle: number };
};
// Mirrors engine3.RuledResult. Breaks add the partner's gaps and jumps to the
// base's. Gap is the distance between the partner's ends on a closed curve
// whose surface does not close. Deviation is the largest scale-free
// det(a′, d, d′) over regular samples; developable within 10⁻⁶.
export type RuledResult = {
  partner: RuledPartner;
  breaks: boolean[];
  closed: boolean;
  gap: number;
  outside: number;
  coincident: number;
  singular: number;
  developable: boolean;
  deviation: number;
};
// Mirrors engine3.CanalResult. Breaks add every interval with a sample or
// midpoint without a real contact circle to the base's. A circle that is not
// real (|R′| > v) keeps its sphere's centre and radius, with no points.
// Between counts intervals whose midpoint alone has no real circle.
// Steepest is the largest |R′|/v; gap is the distance between the first and
// last contact circles of a closed curve whose surface does not close.
export type CanalCircle = {
  sampleIndex: number;
  real: boolean;
  sphere: number;
  center: Vec3;
  radius: number;
  points: Vec3[];
};
export type CanalResult = {
  circles: CanalCircle[];
  meridians: (Vec3 | null)[][];
  breaks: boolean[];
  constant: boolean;
  closed: boolean;
  gap: number;
  steepest: number;
  undefined: number;
  imaginary: number;
  between: number;
  collapsed: number;
  folded: number;
};
// Why a trajectory stopped: at the end of the interval, leaving the escape
// sphere (at the start, with no point, for a seed outside it), where the
// field is not finite or changes too fast to follow, or out of steps.
export type TrajectoryReason = "end" | "escape" | "singular" | "exhausted";
// Mirrors engine3.FieldResult. Paths are indexed like base, so one index is
// one time on every path; the first is the base. Arrows are the field at the
// representative samples; resting marks seeds where an autonomous field's
// speed is below 10⁻⁹.
export type SpatialFieldResult = {
  paths: (Vec3 | null)[][];
  arrows: { sampleIndex: number; seed: number; point: Vec3; velocity: Vec3 }[];
  ends: {
    time: number;
    reason: TrajectoryReason;
    point: Vec3 | null;
    steps: number;
  }[];
  resting: boolean[];
  timed: boolean;
};
// Mirrors engine3.PursuitResult. Paths are indexed like base, the first
// being the base; polygons join every pursuer, in chase order, at the
// representative samples. The chase is known from min to end: max, the
// capture (pursuer and target from 0), or where the step budget ran out.
// Final is every pursuer's position at end.
export type SpatialPursuitResult = {
  paths: (Vec3 | null)[][];
  polygons: { sampleIndex: number; points: Vec3[] }[];
  capture: { time: number; pursuer: number; target: number } | null;
  exhausted: boolean;
  end: number;
  final: Vec3[];
};
// Mirrors engine3.SurfaceSheet: points[i][j] at u_i, v_j (null where
// undefined), normals likewise (null where the sheet has none, shaded by its
// faces). alongU[i][j] joins (i, j) to (i + 1, j), alongV[i][j] joins (i, j)
// to (i, j + 1), and faces[i][j] is the cell from (i, j) to (i + 1, j + 1).
export type SurfaceSheet = {
  points: (Vec3 | null)[][];
  normals: (Vec3 | null)[][];
  alongU: boolean[][];
  alongV: boolean[][];
  faces: boolean[][];
};
// A focal branch X + n/κᵢ, κ₁ ≥ κ₂, by what it actually spans. Clipped
// samples have a normal but a focal point beyond 100 surface radii.
export type FocalShape = "surface" | "curve" | "point" | "none";
export type FocalSheet = SurfaceSheet & { shape: FocalShape; clipped: number };
// Mirrors engine3.SurfaceResult. uCurves are the v indices of the curves
// along which u runs, vCurves the u indices of those along which v runs;
// normal lines stand where they cross.
export type SurfaceResult = {
  surface: SurfaceSheet;
  offset: SurfaceSheet | null;
  focal: FocalSheet[];
  lines: { i: number; j: number; point: Vec3; end: Vec3 }[];
  uCurves: number[];
  vCurves: number[];
  singular: number;
  umbilics: number;
  folded: number;
};
// Mirrors engine3.CausticSheet: the real (μ > 0, ahead of the surface) or
// virtual (μ < 0, behind it) part of caustic branch 1 or 2, the points X +
// R/μ for the outgoing wavefront's principal curvatures μ₁ ≥ μ₂.
export type CausticSheet = SurfaceSheet & {
  branch: 1 | 2;
  virtual: boolean;
  shape: FocalShape;
};
// Mirrors engine3.Receiver: the irradiance the outgoing rays deliver to
// each bin of the window, irradiance[a][b] with a along the plane's first
// coordinate, and where all the emitted flux went. Parallel light has unit
// irradiance across its beam (fluxes are areas of beam, irradiances
// multiples of the beam's); a point source has unit intensity (fluxes are
// solid angles, irradiances per unit area). Each cell's flux is spread
// evenly over its corners' crossings, and each bin averages it, with no
// Fresnel losses and no occlusion. Corners run (lo, lo), (hi, lo), (hi,
// hi), (lo, hi).
export type ReceiverResult = {
  plane: Exclude<ReceiverPlane, "none">;
  corners: [Vec3, Vec3, Vec3, Vec3];
  size: number;
  irradiance: number[][];
  peak: number;
  emitted: number;
  received: number;
  outside: number;
  away: number;
  total: number;
  edge: number;
};
// Mirrors engine3.RaysResult: the surface, the caustic parts (branch 1 real
// and virtual, then branch 2), and representative rays where the parameter
// curves cross, each incident from start to point, reflected or
// transmitted to end, and extended virtually back to back; `virtual` says
// whether either of its caustic points lies behind the surface, and
// `total` that the light is beyond the critical angle, its end along the
// totally reflected ray. clipped[k] counts traced samples whose branch
// k + 1 point is beyond 100 surface radii, treated as at infinity; total
// counts samples beyond the critical angle.
export type RaysResult = {
  surface: SurfaceSheet;
  caustics: CausticSheet[];
  lines: {
    i: number;
    j: number;
    start: Vec3;
    point: Vec3;
    end: Vec3;
    back: Vec3;
    virtual: boolean;
    total: boolean;
  }[];
  uCurves: number[];
  vCurves: number[];
  source: Vec3 | null;
  singular: number;
  unlit: number;
  atSource: number;
  stigmatic: number;
  total: number;
  clipped: number[];
  receiver: ReceiverResult | null;
};
// Mirrors engine3.ImplicitResult: an indexed mesh with three coordinates per
// vertex in positions and normals (a normal is ∇F/|∇F|, toward larger F, or
// zero where ∇F vanishes or is not finite) and three vertex indices per
// triangle, counterclockwise seen from larger F. Cut and open are pairs of
// vertex indices: boundary edges on the box's faces, and beside cells left
// out. Marks are where F changes sign without crossing the level, up to
// 4,096 of them; discontinuities counts them all.
export type ImplicitPath = { points: Vec3[]; closed: boolean };
export type ImplicitSection = {
  offset: number;
  polygon: Vec3[];
  paths: ImplicitPath[];
  skipped: boolean;
};
export type ImplicitResult = {
  box: ImplicitBox;
  grid: [number, number, number];
  positions: number[];
  normals: number[];
  triangles: number[];
  cut: number[];
  open: number[];
  components: { triangles: number; euler: number; closed: boolean }[];
  sections: ImplicitSection[];
  marks: Vec3[];
  nonfinite: number;
  discontinuities: number;
  ambiguous: number;
  singular: number;
  sectionDiscontinuities: number;
  sectionsSkipped: number;
  truncated: boolean;
};
