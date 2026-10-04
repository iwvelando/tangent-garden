// The parameter probe: one base sample's Frenet frame, osculating circle and
// construction lines, and the base curve's curvature and torsion around it;
// or, on a surface, one point's principal directions, curvatures and
// centres. Every quantity comes from Go (engine3.DiagnosticsResult and
// engine3.SurfaceDiagnostics) or the study's own per-sample arrays; this
// module only selects and draws them.
import type { Batch } from "./scene";
import type {
  DiagnosticsResult,
  SpatialConfig,
  SpatialResult,
  SurfaceDiagnostics,
  Vec3,
} from "./types";

// What the probe describes: the base curve, a surface (a patch, or the
// canal built on the curve), or in a mirror or interface study the light
// leaving it or the mirror itself.
export type ProbeTarget = "curve" | "surface" | "light" | "mirror";
// Whether the probe stands on a grid of rows and columns (a surface, the
// light or the mirror) rather than on the curve's samples.
export const gridded = (t: ProbeTarget) => t !== "curve";
// What a study asks Go for to probe the target (see SpatialOptions).
export const probeOptions = (t: ProbeTarget) =>
  t === "curve"
    ? { diagnostics: true }
    : t === "light"
      ? { lightDiagnostics: true }
      : { surfaceDiagnostics: true };
// The probe's place as fractions, so that it survives edits to the domain
// and sample count: along the base's samples (or a surface's rows, along
// t or u) and, on a surface, across its columns (around θ, or along v).
// The target is what it describes where the study offers both.
export type Probe = {
  enabled: boolean;
  position: number;
  target: ProbeTarget;
  across: number;
};
export const defaultProbe: Probe = {
  enabled: false,
  position: 0.5,
  target: "curve",
  across: 0.5,
};

// Inks beyond the decorative palette (see palette.ts): the point, its
// osculating circle and highlighted construction share one; T, N and B each
// have their own.
export const probeInk = { mark: 8, tangent: 9, normal: 10, binormal: 11 };

// The nearest of the samples 0…n.
export const probeIndex = (position: number, n: number) =>
  Number.isNaN(position)
    ? Math.round(n / 2)
    : Math.min(n, Math.max(0, Math.round(position * n)));

type Segments = (r: SpatialResult, j: number) => Vec3[];
const joined = (...points: (Vec3 | null | undefined)[]): Vec3[] =>
  points.every((p) => p) ? (points as Vec3[]) : [];
// Each supported construction's lines at sample j, as point pairs, and what
// the help calls them. A construction without an entry has no highlight.
const constructions: Partial<
  Record<SpatialConfig["construction"], { name: string; lines: Segments }>
> = {
  developable: {
    name: "its tangent ruling",
    lines: (r, j) => joined(r.minus[j], r.plus[j]),
  },
  involute: {
    name: "each filament's unwinding string",
    lines: (r, j) =>
      (r.involute?.members ?? []).flatMap((m) =>
        joined(r.base[j], m.points[j]),
      ),
  },
  "tangent-foot": {
    name: "its tangent, perpendicular and foot",
    lines: (r, j) => projectionLines(r, j),
  },
  orthotomic: {
    name: "its tangent, perpendicular and reflected pole",
    lines: (r, j) => projectionLines(r, j),
  },
  inversion: {
    name: "its correspondence segment",
    lines: (r, j) => joined(r.inversion?.source[j], r.inversion?.points[j]),
  },
  framed: {
    name: "its cross-line",
    lines: (r, j) => joined(r.minus[j], r.plus[j]),
  },
  ruled: {
    name: "its ruling",
    lines: (r, j) => joined(r.base[j], r.plus[j]),
  },
};
function projectionLines(r: SpatialResult, j: number): Vec3[] {
  const q = r.projection,
    foot = q?.feet[j];
  if (!q || !r.base[j] || !foot || !q.points[j]) return [];
  return [r.base[j]!, foot, q.pole, foot, foot, q.points[j]!];
}
// A pursuit's polygon joins every pursuer at the sample's time, when all
// are known.
function polygonLines(r: SpatialResult, j: number): Vec3[] {
  const ps = (r.pursuit?.paths ?? []).map((path) => path[j]);
  if (ps.length < 2 || ps.some((p) => !p)) return [];
  return ps.flatMap((p, k) => [p!, ps[(k + 1) % ps.length]!]);
}

// The surfaces built on the base, which the probe does not describe.
const surfaces: Partial<Record<SpatialConfig["construction"], string>> = {
  developable: "tangent ribbon",
  framed: "framed ribbon",
  ruled: "ruled surface",
  canal: "canal surface",
};

// The kind of surface the surface probe describes in a study, as Go names
// it (engine3.SurfaceDiagnostics), or null where it describes none: a
// patch, or the canal, tangent developable, ruled surface or framed ribbon
// (while it has a width) built on a curve. A mirror or interface study
// offers the light and the mirror instead (see raysKind).
export function surfaceKind(c: SpatialConfig): SurfaceKind | null {
  if (c.format === "surface") return "patch";
  if (c.format === "rays" || c.format === "implicit") return null;
  switch (c.construction) {
    case "canal":
    case "developable":
    case "ruled":
      return c.construction;
    case "framed":
      return c.frame.width > 0 ? "framed" : null;
  }
  return null;
}

// Whether a study offers the probe, what it can describe (a surface patch
// only its surface, a curve with a surface built on it either, another
// curve study its curve), and what the curve probe's highlight shows (null
// when only the frame and circle are drawn).
export function probeSupport(c: SpatialConfig): {
  available: boolean;
  highlight: string | null;
  targets: ProbeTarget[];
} {
  const curve =
    c.format !== "surface" && c.format !== "rays" && c.format !== "implicit";
  const targets: ProbeTarget[] =
    c.format === "rays"
      ? ["light", "mirror"]
      : [
          ...(curve ? (["curve"] as const) : []),
          ...(surfaceKind(c) ? (["surface"] as const) : []),
        ];
  const names = [
    constructions[c.construction]?.name,
    c.format === "pursuit" ? "the connecting polygon at its time" : undefined,
  ].filter((n): n is string => !!n);
  return {
    available: targets.length > 0,
    highlight: curve && names.length ? names.join(" and ") : null,
    targets,
  };
}

// What the probe describes in this study: its chosen target where the study
// offers it, otherwise the study's first.
export function probeTarget(c: SpatialConfig, p: Probe): ProbeTarget {
  const { targets } = probeSupport(c);
  return targets.includes(p.target) ? p.target : (targets[0] ?? "curve");
}

// The help beside the probe's switch: what it draws and where it does not.
export function probeHelp(c: SpatialConfig) {
  const { highlight } = probeSupport(c);
  return `Describes the curve itself, not the surface or curves built on it. Moves between the curve's samples (more samples give finer steps) and shows the Frenet frame there: tangent T, principal normal N and binormal B, with the osculating circle of radius 1/κ in the plane of T and N${
    highlight ? `, and ${highlight}` : ""
  }. Where the curvature vanishes, N, B, τ and the circle are undefined and not drawn. Animations and their exports show it when they move it along the curve ("Move the probe along the curve") or vary parameters, where Probe chooses whether it stays at its t, keeps its share of the curve's length, or moves along the curve; other animations leave it out, and still images include it.`;
}

const vertices = (points: Vec3[]) =>
  points.flatMap((p) => [p.x, p.y, p.z, 0, 0, 1, 0]);
const lines = (points: Vec3[], ink: number): Batch => ({
  mode: "lines",
  data: new Float32Array(vertices(points)),
  ink,
});
const along = (p: Vec3, d: Vec3, length: number) => [
  p,
  { x: p.x + d.x * length, y: p.y + d.y * length, z: p.z + d.z * length },
];

// The probe's drawing at sample j: the highlighted construction, the
// osculating circle (from Go's centre, with radius 1/κ, in the plane of T
// and N) and a three-axis mark at the point, all in the probe ink, then
// the frame glyphs, each its own ink. Nothing without diagnostics or a
// sample there.
export function probeBatches(
  result: SpatialResult,
  config: SpatialConfig,
  j: number,
): Batch[] {
  const d = result.diagnostics,
    p = result.base[j];
  if (!d || !p) return [];
  const radius = result.bounds.radius;
  const marked: Vec3[] = [
    ...(constructions[config.construction]?.lines(result, j) ?? []),
    ...(config.format === "pursuit" ? polygonLines(result, j) : []),
  ];
  const T = d.tangent[j],
    N = d.normal[j],
    B = d.binormal[j],
    c = d.center[j],
    k = d.curvature[j];
  if (c && N && T && k) {
    // Starting at the point, c + ρ(−N): φ = 0 is the point itself.
    const rho = 1 / k,
      steps = 128;
    const on = (s: number) => {
      const phi = (2 * Math.PI * s) / steps,
        a = -Math.cos(phi) * rho,
        b = Math.sin(phi) * rho;
      return {
        x: c.x + a * N.x + b * T.x,
        y: c.y + a * N.y + b * T.y,
        z: c.z + a * N.z + b * T.z,
      };
    };
    for (let s = 0; s < steps; s++)
      marked.push(s === 0 ? p : on(s), s === steps - 1 ? p : on(s + 1));
  }
  const arm = radius * 0.02;
  for (const axis of ["x", "y", "z"] as const)
    marked.push(
      { ...p, [axis]: p[axis] - arm },
      { ...p, [axis]: p[axis] + arm },
    );
  const glyph = radius * 0.2;
  const out = [lines(marked, probeInk.mark)];
  if (T) out.push(lines(along(p, T, glyph), probeInk.tangent));
  if (N) out.push(lines(along(p, N, glyph), probeInk.normal));
  if (B) out.push(lines(along(p, B, glyph), probeInk.binormal));
  return out;
}

// The numbers at sample j: its parameter, κ, the radius of curvature 1/κ
// (null where κ is 0 or unknown), τ, whether the sample is flat, and
// whether its centre is at infinity.
export function probeReadout(result: SpatialResult, j: number) {
  const d = result.diagnostics;
  if (!d) return null;
  const n = d.curvature.length - 1;
  const k = d.curvature[j] ?? null;
  const flat = k === 0;
  return {
    // As Go samples it, so a symmetric domain's middle is exactly 0.
    t: n > 0 ? d.min * (1 - j / n) + d.max * (j / n) : d.min,
    curvature: k,
    radius: k ? 1 / k : null,
    torsion: d.torsion[j] ?? null,
    flat,
    infinite: !!k && !flat && !d.center[j],
  };
}

// A plot's vertical range and its unbroken runs of [sample, value]. The
// range is the values' own, trimmed by outer Tukey fences (3 IQR) so that
// a few values that blow up (τ near a flat sample) do not flatten the rest;
// those are pinned to the edge they pass and counted. fromZero keeps 0 in
// range (for κ ≥ 0). A series whose range is within resolution (by default
// none) is drawn as constant, so that rounding noise in a value known to be
// fixed, such as the zero curvature along a developable's ruling, does not
// fill the plot; within resolution of 0 it is drawn as zero. constant is
// that value when every known value lies within resolution of the others
// (or all are equal), so nothing is pinned, and null otherwise: a constant
// series is drawn in a padded range, which is not the data's.
export function plotScale(
  values: (number | null)[],
  fromZero: boolean,
  resolution = 0,
) {
  const known = values
    .filter((v): v is number => v !== null)
    .sort((a, b) => a - b);
  let lo = known[0] ?? 0,
    hi = known.at(-1) ?? 1;
  const centre = (lo + hi) / 2;
  const constant =
    known.length && hi - lo <= resolution
      ? Math.abs(centre) <= resolution
        ? 0
        : centre
      : null;
  if (known.length >= 8) {
    const q1 = known[Math.floor(known.length / 4)],
      q3 = known[Math.floor((3 * known.length) / 4)],
      spread = q3 - q1;
    if (spread > 0) {
      lo = known.find((v) => v >= q1 - 3 * spread)!;
      hi = [...known].reverse().find((v) => v <= q3 + 3 * spread)!;
    }
  }
  if (hi - lo <= resolution && hi > lo) {
    const middle = (lo + hi) / 2;
    lo = hi = Math.abs(middle) <= resolution ? 0 : middle;
  }
  if (fromZero) lo = Math.min(lo, 0);
  if (!(hi > lo)) {
    // A constant series: a zero one from 0 up (or around 0), another
    // within a tenth of its value.
    const pad = Math.abs(hi) * 0.1;
    [lo, hi] = pad > 0 ? [lo - pad, hi + pad] : fromZero ? [0, 1] : [-1, 1];
  }
  let pinned = 0;
  const runs: [number, number][][] = [];
  let run: [number, number][] = [];
  values.forEach((v, i) => {
    if (v === null) {
      if (run.length) runs.push(run);
      run = [];
      return;
    }
    if (v > hi || v < lo) pinned++;
    run.push([i, Math.min(hi, Math.max(lo, v))]);
  });
  if (run.length) runs.push(run);
  return { lo, hi, runs, pinned, constant };
}

// Whether the base is straight: every known curvature is zero, so no sample
// has a frame, torsion or osculating circle.
export function probeStraight(d: DiagnosticsResult) {
  const known = d.curvature.filter((k) => k !== null);
  return known.length > 0 && known.every((k) => k === 0);
}

// What the panel says of a straight base, naming the surface built on it
// and, where the probe can describe that surface, how.
export function straightNote(c: SpatialConfig) {
  const surface = surfaces[c.construction];
  return `This curve is straight: its curvature is zero everywhere, so it has no normal, binormal, torsion or osculating circle.${
    surface
      ? ` The probe describes the curve the ${surface} is built on, not the surface.`
      : ""
  }${
    probeSupport(c).targets.includes("surface")
      ? ` Choose to describe the surface to probe the ${surface} itself.`
      : ""
  }`;
}

type SurfaceKind = SurfaceDiagnostics["kind"];

// What the surface probe says of each kind of surface: its name and
// parameters, its two principal branches, which a patch, a framed ribbon
// and a ruled surface number κ₁ ≥ κ₂ and a canal and a developable name by
// line of curvature, what it draws through the point (beside the point's
// mark), where it has no point, why a curvature can be unknown, and help
// stating the grid and conventions the engine uses. The switch, the normal
// line's legend and each branch's legend name what is drawn: a surface's
// principal curvatures, or the light's wavefront and foci.
type SurfaceTerms = {
  switch: string;
  normal: string;
  legend: string;
  surface: string;
  along: string;
  around: string;
  branches: [string, string];
  sliders: [string, string];
  through: string;
  missing: string;
  unknownBranch: string;
  unknown: string;
  help: string;
};
const rows = "(at most 481, so more samples give finer steps up to that)";
const curvatureWords = {
  switch: "Principal curvatures & centres at a point",
  normal: "Normal",
  legend: "direction, circle & centre",
} as const;
const ruledTerms = {
  ...curvatureWords,
  along: "t",
  around: "u",
  through: "ruling",
  unknownBranch: "both curvatures are",
} as const;
const surfaceTermsByKind: Record<SurfaceKind, SurfaceTerms> = {
  patch: {
    ...curvatureWords,
    surface: "surface",
    along: "u",
    around: "v",
    branches: ["κ₁", "κ₂"],
    sliders: ["Along u", "Along v"],
    through: "",
    missing: "The patch has no point here.",
    unknownBranch: "κ₂ is",
    unknown: "where its derivatives are unstable",
    help: "Moves between the patch's own grid samples (more u and v samples give finer steps). Its principal curvatures are numbered κ₁ ≥ κ₂ with the chosen normal, as the focal sheets are",
  },
  canal: {
    ...curvatureWords,
    surface: "canal surface",
    along: "t",
    around: "θ − θ₀",
    branches: ["κ around the circle", "κ across it"],
    sliders: ["Along t", "Around"],
    through: "contact circle",
    missing: "No surface here: no real contact circle at this t.",
    unknownBranch: "κ across it is",
    unknown: "where its derivatives are unstable",
    help: "Moves between the canal's mesh rings along t (at most 481, so more samples give finer steps up to that) and 24 turns around each contact circle, measured from θ₀ (with any twist) as the meridians are. Around the circle the curvature is −1/R, centred on the sphere's centre on the curve, with the outward normal; across it, the other principal curvature has its own centre",
  },
  developable: {
    ...ruledTerms,
    surface: "tangent ribbon",
    branches: ["κ along the ruling", "κ across it"],
    sliders: ["Along t", "Across the ruling"],
    missing: "No surface here: the curve has no regular point at this t.",
    unknown: "where the curve's third derivative is unstable",
    help: `Moves between the ribbon's rows along t ${rows} and 24 points along each tangent ruling, at u = ±L·k/12 for k = 1…12 from the curve. It leaves out u = 0, the edge of regression, where the ribbon's two sheets meet in a cusp along the curve and it has no normal. The normal is the drawing's: the curve's binormal B where u > 0 and −B where u < 0. Along the ruling the curvature is 0, with its centre at infinity; across it, it is τ/(κ|u|), from the curve's curvature κ and torsion τ, so K = 0 and the ribbon is developable. Where the curve's curvature vanishes the whole ruling is singular`,
  },
  framed: {
    ...ruledTerms,
    surface: "framed ribbon",
    branches: ["κ₁", "κ₂"],
    sliders: ["Along t", "Across the ribbon"],
    missing: "No ribbon here: the frame is undefined at this t.",
    unknown:
      "where the curve's third derivative, or a Frenet frame's τ′, is unstable",
    help: `Moves between the ribbon's rows along t ${rows} and 25 points across each cross-line, from u = −w to w. Curvatures come from how the frame turns, not from the drawn strip. The normal is the drawing's, D × S_t. A ribbon is ruled, so K ≤ 0; an untwisted rotation-minimizing ribbon is developable, with K = 0. Its principal curvatures are numbered κ₁ ≥ κ₂`,
  },
  ruled: {
    ...ruledTerms,
    surface: "ruled surface",
    branches: ["κ₁", "κ₂"],
    sliders: ["Along t", "Along the ruling"],
    missing: "No surface here: the partner is missing at this t.",
    unknown: "where a thread's second derivative is unstable",
    help: `Moves between the surface's rows along t ${rows} and 25 points along each ruling, from the curve (u = 0) to its partner (u = 1). The normal is S_t × S_u, as drawn. A ruled surface has K ≤ 0, with K = 0 exactly where it is developable; where the threads meet the surface pinches and has no normal. Its principal curvatures are numbered κ₁ ≥ κ₂`,
  },
  // The light leaving a mirror or interface, whose name surfaceTerms
  // supplies. Its help is the whole of the switch's help (see
  // surfaceProbeHelp).
  wavefront: {
    switch: "Wavefront, foci & rays at a point",
    normal: "Rays in and out",
    legend: "direction, wavefront circle & focus",
    surface: "mirror",
    along: "u",
    around: "v",
    branches: ["μ₁", "μ₂"],
    sliders: ["Along u", "Along v"],
    through: "",
    missing: "The patch has no point here.",
    unknownBranch: "μ₂ is",
    unknown: "where its derivatives are unstable",
    help: "",
  },
};

// The mirror or interface a ray study lights.
const medium = (c: SpatialConfig) =>
  c.rays.interaction === "refract" ? "interface" : "mirror";

// The surface probe's words for what it describes in the study: its
// surface, or in a mirror or interface study the light leaving it or the
// mirror itself, named as such.
export function surfaceTerms(
  c: SpatialConfig,
  target: ProbeTarget,
): SurfaceTerms {
  if (c.format === "rays")
    return {
      ...surfaceTermsByKind[target === "light" ? "wavefront" : "patch"],
      surface: medium(c),
    };
  return surfaceTermsByKind[surfaceKind(c) ?? "patch"];
}

// What the Describe menu calls each target, and its help.
export function targetName(c: SpatialConfig, t: ProbeTarget) {
  return t === "curve"
    ? "The curve"
    : t === "light"
      ? "The light"
      : t === "mirror"
        ? `The ${medium(c)}`
        : "The surface";
}
export function describeHelp(c: SpatialConfig) {
  return c.format === "rays"
    ? `The light: the incident and outgoing rays, and the outgoing wavefront's principal directions, curvatures and foci, which lie on the caustics. The ${medium(c)}: its own principal directions, curvatures and centres. Both stand at the same sample.`
    : `The curve: its Frenet frame, curvature and torsion. The surface: the ${surfaceTerms(c, "surface").surface}'s principal directions, curvatures and centres. Both stand at the same place along t.`;
}

// The probe's legend: what it can describe in the study.
export function probeLegend(c: SpatialConfig, target: ProbeTarget) {
  const { targets } = probeSupport(c);
  if (c.format === "rays") return `Probe the light or ${medium(c)}`;
  if (targets.length > 1) return "Probe the curve or surface";
  return target === "surface" ? "Probe the surface" : "Probe the curve";
}

// The help beside the probe's switch for a surface, the light or a
// mirror.
export function surfaceProbeHelp(c: SpatialConfig, target: ProbeTarget) {
  const t = surfaceTerms(c, target);
  if (target === "light") {
    const m = t.surface;
    return `Describes the light leaving the ${m} at a point: its incident ray, its outgoing ray, and the outgoing wavefront there, which is perpendicular to the ray. Moves between the ${m}'s own grid samples (more u and v samples give finer steps), the samples its caustics are found at. The wavefront's principal curvatures are numbered μ₁ ≥ μ₂, each with its direction across the ray, and each focuses the light at X + R/μ, on the caustic of the same number: a real focus ahead of the ${m} where μ > 0, a virtual one behind it where μ < 0, on the ray's extension. The readout gives each focus's signed distance 1/μ along the ray, negative for a virtual focus, and the astigmatic interval between the two. Each branch's circle of radius 1/|μ| through the point, centred on its focus, is the wavefront's normal section. Where μ₁ = μ₂ the point is stigmatic: both foci coincide and no direction is drawn. A focus beyond 100 study radii is at infinity, as on the caustics, and its circle is not drawn. θ is the angle of incidence from the ${m}'s normal${
      c.rays.interaction === "refract"
        ? ", and θ′ the angle of transmission"
        : ""
    }. The source itself, unlit points (where the light grazes the ${m} or arrives behind it)${
      c.rays.interaction === "refract"
        ? " and points beyond the critical angle, where the light is totally reflected and nothing is transmitted,"
        : ""
    } have no outgoing wavefront. Animations and their exports show it when they move it ("Move the probe along the ${m}") or vary parameters; other animations leave it out, and still images include it.`;
  }
  return `Describes the ${t.surface} at a point: its normal, its two principal directions, and their normal-section circles of radius 1/|κ| through the point, centred on the focal points (the centres of curvature) on the normal line. ${t.help}. Curvatures use A = −dn, so a sphere with its outward normal has κ = −1/R. Where a centre lies beyond 100 study radii it is at infinity and its circle is not drawn; at an umbilic every direction is principal and none is drawn; where the surface is singular there is no normal. Animations and their exports show it when they move it ("Move the probe along the ${t.surface}") or vary parameters; other animations leave it out, and still images include it.`;
}

// The grid sample at a probe's fractions: the nearest row, and the nearest
// column, which wraps around a canal's contact circle.
export function surfaceProbeAt(
  d: SurfaceDiagnostics,
  position: number,
  across: number,
) {
  const columns = d.v.length;
  return {
    row: probeIndex(position, d.u.length - 1),
    column: d.periodic
      ? probeIndex(across, columns) % columns
      : probeIndex(across, columns - 1),
  };
}

// Surface probe inks: each principal branch takes its focal sheet's ink,
// rust (5) for the first and slate (6) for the second; the point, and a
// canal's contact circle, the probe's mark; the normal line the probe's
// normal ink.
export const surfaceInk = [5, 6] as const;

const plus = (p: Vec3, d: Vec3, s: number) => ({
  x: p.x + d.x * s,
  y: p.y + d.y * s,
  z: p.z + d.z * s,
});

// The surface probe's drawing at grid sample (row, column): a mark at the
// point (with a canal's contact circle, or a ruled surface's ruling,
// through it), the normal line through
// the point and both finite focal points, and for each branch its direction
// glyph, a cross at its focal point and its normal-section circle in the
// plane of n and its direction. Nothing where the surface has no point.
// The light's wavefront is drawn the same way about its normal, the
// outgoing ray, which runs at least the study's ray length ℓ and back to a
// virtual focus; the incident ray, from the source or ℓ back, joins it in
// the same ink, as does a totally reflected ray.
export function surfaceProbeBatches(
  result: SpatialResult,
  row: number,
  column: number,
): Batch[] {
  const d = result.surfaceDiagnostics,
    p = d?.points[row]?.[column];
  if (!d || !p) return [];
  const radius = result.bounds.radius,
    arm = radius * 0.02,
    glyph = radius * 0.2;
  const cross = (q: Vec3) =>
    (["x", "y", "z"] as const).flatMap((axis) => [
      { ...q, [axis]: q[axis] - arm },
      { ...q, [axis]: q[axis] + arm },
    ]);
  const marked: Vec3[] = cross(p);
  if (d.kind === "canal") {
    const ring = d.points[row];
    ring.forEach((q, k) => {
      const next = ring[(k + 1) % ring.length];
      if (q && next) marked.push(q, next);
    });
  } else if (d.kind !== "patch") {
    // The ruling is straight: one segment between its ends on the grid.
    const known = d.points[row].filter((q): q is Vec3 => !!q);
    if (known.length > 1) marked.push(known[0], known.at(-1)!);
  }
  const out = [lines(marked, probeInk.mark)];
  const light = d.light,
    n = d.normals[row][column];
  if (light) {
    const rays: Vec3[] = [],
      length = light.length,
      incident = light.incident[row][column],
      outgoing = light.outgoing[row][column];
    if (incident)
      rays.push(result.rays?.source ?? plus(p, incident, -length), p);
    if (outgoing && !n) rays.push(p, plus(p, outgoing, length));
    if (rays.length) out.push(lines(rays, probeInk.normal));
  }
  if (!n) return out;
  // The normal line spans the point, its glyph and both finite centres;
  // the outgoing ray also spans ℓ.
  const reach = [0, glyph, ...(light ? [light.length] : [])];
  for (const b of [0, 1] as const) {
    const k = d.curvature[b][row][column];
    if (k && d.focal[b][row][column]) reach.push(1 / k);
  }
  out.push(
    lines(
      [plus(p, n, Math.min(...reach)), plus(p, n, Math.max(...reach))],
      probeInk.normal,
    ),
  );
  for (const b of [0, 1] as const) {
    const e = d.direction[b][row][column],
      f = d.focal[b][row][column],
      k = d.curvature[b][row][column];
    const branch: Vec3[] = [];
    if (e) branch.push(p, plus(p, e, glyph));
    if (f) branch.push(...cross(f));
    if (e && f && k) {
      // Starting at the point: f + (p − f) cos φ + e ρ sin φ.
      const rho = 1 / Math.abs(k),
        steps = 128,
        back = { x: p.x - f.x, y: p.y - f.y, z: p.z - f.z };
      const on = (s: number) => {
        const phi = (2 * Math.PI * s) / steps;
        return plus(plus(f, back, Math.cos(phi)), e, rho * Math.sin(phi));
      };
      for (let s = 0; s < steps; s++)
        branch.push(s === 0 ? p : on(s), s === steps - 1 ? p : on(s + 1));
    }
    if (branch.length) out.push(lines(branch, surfaceInk[b]));
  }
  return out;
}

// The numbers at grid sample (row, column): its parameters, each branch's
// curvature (0 where it is lost in rounding beside the other), radius 1/κ (null where κ is 0 or unknown) and whether its
// centre is at infinity, the Gaussian and mean curvatures, and whether the
// surface is missing, singular or umbilic there.
export function surfaceProbeReadout(
  result: SpatialResult,
  row: number,
  column: number,
) {
  const d = result.surfaceDiagnostics;
  if (!d) return null;
  const point = d.points[row]?.[column] ?? null,
    normal = d.normals[row]?.[column] ?? null;
  const raw = [0, 1].map((b) => d.curvature[b][row]?.[column] ?? null);
  // A curvature within 10⁻¹² of the other is rounding, as along a
  // developable's ruling, where it is exactly 0: shown as 0.
  const larger = Math.max(...raw.map((k) => Math.abs(k ?? 0)));
  const curvature = raw.map((k) =>
    k !== null && Math.abs(k) <= 1e-12 * larger ? 0 : k,
  );
  const [k1, k2] = curvature;
  const known = k1 !== null && k2 !== null;
  return {
    u: d.u[row],
    v: d.v[column],
    missing: !point,
    singular: !!point && !normal,
    umbilic: known && !d.direction[0][row][column],
    curvature,
    radius: curvature.map((k) => (k ? 1 / k : null)),
    infinite: curvature.map((k, b) => k !== null && !d.focal[b][row][column]),
    gauss: known ? k1 * k2 : null,
    mean: known ? (k1 + k2) / 2 : null,
  };
}

// The light's numbers at grid sample (row, column): its state (see
// engine3.LightDiagnostics), each branch's μ and signed distance 1/μ along
// the outgoing ray to its focus (null where μ is 0; infinite where the
// focus is at infinity; virtual where it lies behind the surface), whether
// the point is stigmatic, the astigmatic interval |1/μ₁ − 1/μ₂| between
// the foci (0 where stigmatic, null where a focus is at infinity), the
// angle of incidence θ from the surface's normal and, refracting, the
// angle of transmission θ′, in degrees. Null without the light's
// diagnostics.
export function lightProbeReadout(
  result: SpatialResult,
  row: number,
  column: number,
) {
  const d = result.surfaceDiagnostics,
    light = d?.light;
  if (!d || !light) return null;
  const state = lightStates[light.state[row]?.[column] ?? 4],
    incident = light.incident[row]?.[column],
    normal = light.surface[row]?.[column],
    ray = d.normals[row]?.[column] ?? null;
  const mu = [0, 1].map((b) => d.curvature[b][row]?.[column] ?? null);
  const infinite = mu.map((m, b) => m !== null && !d.focal[b][row][column]);
  const distance = mu.map((m) => (m ? 1 / m : null));
  const stigmatic = ray !== null && !d.direction[0][row][column];
  const degrees = (cos: number) =>
    (Math.acos(Math.min(1, Math.max(-1, cos))) * 180) / Math.PI;
  return {
    u: d.u[row],
    v: d.v[column],
    state,
    curvature: mu,
    distance,
    infinite,
    virtual: mu.map((m, b) => m !== null && m < 0 && !infinite[b]),
    stigmatic,
    interval: stigmatic
      ? 0
      : infinite.some(Boolean) || distance.some((x) => x === null)
        ? null
        : Math.abs(distance[0]! - distance[1]!),
    theta:
      incident && normal && state !== "unlit"
        ? degrees(-dot(incident, normal))
        : null,
    // Light that continues through the interface leaves against its normal.
    thetaPrime:
      ray && normal && dot(ray, normal) < 0 ? degrees(-dot(ray, normal)) : null,
  };
}
// engine3's light states, in order.
const lightStates = ["traced", "unlit", "total", "source", "singular"] as const;
const dot = (a: Vec3, b: Vec3) => a.x * b.x + a.y * b.y + a.z * b.z;

// The steps the probe moves through in a result: the base's samples or the
// grid's rows. Null without the diagnostics the target needs: the light's
// for the light, a surface's for a surface or mirror.
export function probeSteps(result: SpatialResult, target: ProbeTarget) {
  const d = result.surfaceDiagnostics;
  if (gridded(target))
    return d && (target === "light") === (d.kind === "wavefront")
      ? d.u.length - 1
      : null;
  return result.diagnostics ? result.diagnostics.curvature.length - 1 : null;
}

// How the probe moves while parameter tracks reshape the study: it stays
// where it was put (at its t on the curve, or its row and column on a
// grid), keeps its share of the curve's drawn length, or moves along the
// curve or grid from start to end as the parameters vary.
export type ProbeMotion = "stays" | "length" | "along";
export const probeMotionValues: ProbeMotion[] = ["stays", "length", "along"];
export function probeMotions(
  c: SpatialConfig,
  target: ProbeTarget,
): { value: ProbeMotion; label: string }[] {
  if (gridded(target))
    return [
      { value: "stays", label: "Stays at its row and column" },
      {
        value: "along",
        label: `Moves along the ${surfaceTerms(c, target).surface}`,
      },
    ];
  return [
    { value: "stays", label: "Stays at its t" },
    { value: "length", label: "Keeps its share of the length" },
    { value: "along", label: "Moves along the curve" },
  ];
}
export function probeMotionHelp(c: SpatialConfig, target: ProbeTarget) {
  if (gridded(target)) {
    const t = surfaceTerms(c, target);
    return `Where the probe stands in each frame while the parameters vary. Stays: at the same share of the ${t.surface}'s rows and columns as the point you chose. Moves along: from its first ${t.along} to its last as the animation plays, at the column you chose. It snaps to each frame's own grid; the readout and plot describe that frame.`;
  }
  return "Where the probe stands in each frame while the parameters vary. Stays at its t: at the sample nearest the t you chose, and absent from a frame whose domain leaves that t out. Keeps its share of the length: at the sample nearest the same fraction of the drawn curve's arc length, measured by Go on each frame's samples, with nothing counted across a break. Moves along the curve: from its first sample to its last as the animation plays. It snaps to each frame's own samples; the readout and plot describe that frame, and framing ignores the osculating circle.";
}

// The step the probe stands at in one frame of a parameter animation at
// progress p, or a sentence saying why it has none there. start is the
// study as playback began, with the diagnostics the target needs; the
// probe's chosen sample there is what it stays at.
export function heldProbe(
  start: SpatialResult,
  probe: Probe,
  target: ProbeTarget,
  motion: ProbeMotion,
  frame: SpatialResult,
  p: number,
): number | string {
  const steps = probeSteps(frame, target);
  if (steps === null)
    return "This frame has nothing for the probe to describe.";
  if (motion === "along") return probeIndex(p, steps);
  if (gridded(target))
    return surfaceProbeAt(
      frame.surfaceDiagnostics!,
      probe.position,
      probe.across,
    ).row;
  const from = start.diagnostics!,
    d = frame.diagnostics!,
    n0 = from.curvature.length - 1,
    i0 = probeIndex(probe.position, n0);
  const short = (v: number) => Number(v.toPrecision(6));
  if (motion === "stays") {
    const t = from.min + ((from.max - from.min) * i0) / n0;
    const x = ((t - d.min) / (d.max - d.min)) * steps;
    if (!(x >= -0.5 && x <= steps + 0.5))
      return `t = ${short(t)} lies outside this frame's domain, [${short(d.min)}, ${short(d.max)}].`;
    return Math.min(steps, Math.max(0, Math.round(x)));
  }
  const total = (lengths: (number | null)[]) =>
    lengths.reduce<number>((m, s) => (s !== null && s > m ? s : m), 0);
  const mine = from.length[i0],
    whole = total(from.length);
  if (mine === null || !(whole > 0))
    return "The probe's point has no share of the length: it is not on a drawn stretch of the curve.";
  const goal = (mine / whole) * total(d.length);
  if (!(total(d.length) > 0)) return "This frame's curve has no length.";
  let best = -1;
  d.length.forEach((s, i) => {
    if (
      s !== null &&
      (best < 0 || Math.abs(s - goal) < Math.abs(d.length[best]! - goal))
    )
      best = i;
  });
  return best;
}

// The probe's drawing at step i: the curve probe at sample i, or the surface
// probe at row i in the column the probe stands in.
export function probeDrawing(
  result: SpatialResult,
  config: SpatialConfig,
  probe: Probe,
  i: number,
): Batch[] {
  if (probeTarget(config, probe) === "curve")
    return probeBatches(result, config, i);
  const d = result.surfaceDiagnostics;
  if (!d) return [];
  return surfaceProbeBatches(
    result,
    i,
    surfaceProbeAt(d, 0, probe.across).column,
  );
}

// What an export records of the probe at step i: the curve probe's sample
// and t, or the surface probe's grid sample and its parameters.
export function probeRecord(
  result: SpatialResult,
  config: SpatialConfig,
  probe: Probe,
  i: number,
) {
  if (probeTarget(config, probe) === "curve")
    return { index: i, t: probeReadout(result, i)!.t };
  const d = result.surfaceDiagnostics!,
    { column } = surfaceProbeAt(d, 0, probe.across);
  return {
    target: probeTarget(config, probe),
    row: i,
    column,
    u: d.u[i],
    v: d.v[column],
  };
}

// Where the probe stands, by its parameter values, for a live summary.
export function probeWhere(
  result: SpatialResult,
  config: SpatialConfig,
  probe: Probe,
  i: number,
) {
  const short = (v: number) => Number(v.toPrecision(6));
  if (probeTarget(config, probe) === "curve")
    return `t = ${short(probeReadout(result, i)!.t)}`;
  const r = probeRecord(result, config, probe, i) as { u: number; v: number },
    t = surfaceTerms(config, probeTarget(config, probe));
  return `${t.along} = ${short(r.u)}, ${t.around} = ${short(r.v)}`;
}
