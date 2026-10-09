// The parameter probe: the curve's Frenet frame, osculating circle and
// construction lines at one parameter, at a sample or between samples, and
// its curvature and torsion around it; or, on a surface, one point's
// principal directions, curvatures and centres. Every quantity comes from
// Go (engine3.DiagnosticsResult and engine3.ProbePoint for the curve,
// engine3.SurfaceDiagnostics for a surface) or the study's own per-sample
// arrays; this module only selects and draws them.
import { tiered } from "../help";
import { harmonicChain, harmonicEllipses, type Batch } from "./scene";
import {
  betweenMotionHelp,
  curveProbeMotionHelp,
  curveProbeMotions,
  heldCurveSample,
  probeIndex,
  type ProbeMotion,
} from "../probe";
export {
  plotScale,
  probeIndex,
  probeMotionValues,
  type ProbeMotion,
} from "../probe";
import type {
  DiagnosticsResult,
  HarmonicPosition,
  SpatialConfig,
  SpatialProbePoint,
  SpatialResult,
  SurfaceDiagnostics,
  Vec3,
} from "./types";

// What the probe describes: the base curve, a surface (a patch, or the
// canal built on the curve), a patch's offset or either of its focal
// sheets, or in a mirror or interface study the light leaving it or the
// mirror itself.
export type ProbeTarget =
  "curve" | "surface" | "offset" | "focal1" | "focal2" | "light" | "mirror";
// The focal sheet a target names, 1 or 2, or null.
const focalSheet = (t: ProbeTarget): 1 | 2 | null =>
  t === "focal1" ? 1 : t === "focal2" ? 2 : null;
// Whether the probe stands on a grid of rows and columns (a surface, the
// light or the mirror) rather than on the curve's samples.
export const gridded = (t: ProbeTarget) => t !== "curve";
// What a study asks Go for to probe the target (see SpatialOptions).
export const probeOptions = (t: ProbeTarget) =>
  t === "curve"
    ? { diagnostics: true }
    : t === "light"
      ? { lightDiagnostics: true }
      : t === "offset"
        ? { offsetDiagnostics: true }
        : focalSheet(t)
          ? { focalDiagnostics: focalSheet(t)! }
          : { surfaceDiagnostics: true };
// The probe's place as fractions, so that it survives edits to the domain
// and sample count: along the base's samples (or a surface's rows, along
// t or u) and, on a surface, across its columns (around θ, or along v).
// The target is what it describes where the study offers both. The curve
// probe snaps to the nearest sample unless it stands between samples
// (between), which links made before it leave out.
export type Probe = {
  enabled: boolean;
  position: number;
  target: ProbeTarget;
  across: number;
  between?: boolean;
};
export const defaultProbe: Probe = {
  enabled: false,
  position: 0.5,
  target: "curve",
  across: 0.5,
};

// Whether a study's curve is evaluated at any parameter, so that the probe
// can stand between its samples: a torus knot, harmonic or custom curve,
// not a trajectory or pursuit, which Go integrates step by step.
export const evaluatedAnywhere = (c: SpatialConfig) =>
  c.format === "torus" || c.format === "harmonic" || c.format === "parametric";

// Whether the probe stands between samples in this study: asked for, on
// the curve, on a curve Go evaluates at any parameter.
export const probeBetween = (c: SpatialConfig, p: Probe) =>
  !!p.between && probeTarget(c, p) === "curve" && evaluatedAnywhere(c);

// The parameter at a fraction of the domain [min, max], as Go samples it,
// so that the ends and a symmetric domain's middle are exact.
export const parameterAt = (min: number, max: number, position: number) =>
  Math.min(max, Math.max(min, min * (1 - position) + max * position));

// A curve study's domain, as Go samples it: a torus knot's full turn, or
// the harmonic or custom curve's own.
export function curveDomain(c: SpatialConfig): [number, number] {
  return c.format === "torus"
    ? [0, 2 * Math.PI]
    : c.format === "harmonic"
      ? [c.harmonic.min, c.harmonic.max]
      : [c.curve.min, c.curve.max];
}

// The curve probe as drawn: Go's description at its parameter, with its
// sample when it is snapped to one.
export type CurveProbe = SpatialProbePoint & { sample?: number };
// Where the probe stands in a frame: the curve probe, or a surface's row.
export type ProbePlace = CurveProbe | number;

// The curve probe at sample j, from the result's diagnostics and its own
// per-sample arrays, described as Go describes it between samples.
export function sampleProbe(r: SpatialResult, j: number): CurveProbe | null {
  const d = r.diagnostics;
  if (!d) return null;
  const n = d.curvature.length - 1;
  const own = (p?: Vec3 | null) => p ?? undefined;
  return {
    // As Go samples it, so a symmetric domain's middle is exactly 0.
    t: n > 0 ? d.min * (1 - j / n) + d.max * (j / n) : d.min,
    point: r.base[j] ?? null,
    tangent: d.tangent[j] ?? null,
    normal: d.normal[j] ?? null,
    binormal: d.binormal[j] ?? null,
    center: d.center[j] ?? null,
    curvature: d.curvature[j] ?? null,
    torsion: d.torsion[j] ?? null,
    length: d.length[j] ?? null,
    minus: own(r.minus[j]),
    plus: own(r.plus[j]),
    foot: own(r.projection?.feet[j]),
    source: own(r.inversion?.source[j]),
    image: own(r.projection?.points[j] ?? r.inversion?.points[j]),
    ...(r.involute && {
      members: r.involute.members.map((m) => m.points[j] ?? null),
    }),
    ...(r.harmonic?.chains && { chain: r.harmonic.chains[j] }),
    sample: j,
  };
}

// Where a curve probe stands among a result's samples, in sample steps
// (not rounded): for its mark on the plots of κ and τ.
export function curveStep(r: SpatialResult, at: SpatialProbePoint) {
  const d = r.diagnostics;
  if (!d) return 0;
  const n = d.curvature.length - 1;
  return d.max > d.min ? ((at.t - d.min) / (d.max - d.min)) * n : 0;
}

// Inks beyond the decorative palette (see palette.ts): the point, its
// osculating circle and highlighted construction share one; T, N and B each
// have their own.
export const probeInk = { mark: 8, tangent: 9, normal: 10, binormal: 11 };

// The lines the probe highlights at its point, as point pairs, from the
// construction's points there and, where a format needs them, the result's
// own samples.
type Segments = (at: CurveProbe, r: SpatialResult) => Vec3[];
const joined = (...points: (Vec3 | null | undefined)[]): Vec3[] =>
  points.every((p) => p) ? (points as Vec3[]) : [];
// Each supported construction's lines, as point pairs, and what the help
// calls them. A construction without an entry has no highlight.
const constructions: Partial<
  Record<SpatialConfig["construction"], { name: string; lines: Segments }>
> = {
  developable: {
    name: "its tangent ruling",
    lines: (at) => joined(at.minus, at.plus),
  },
  involute: {
    name: "each filament's unwinding string",
    lines: (at) => (at.members ?? []).flatMap((m) => joined(at.point, m)),
  },
  "tangent-foot": {
    name: "its tangent, perpendicular and foot",
    lines: projectionLines,
  },
  orthotomic: {
    name: "its tangent, perpendicular and reflected pole",
    lines: projectionLines,
  },
  inversion: {
    name: "its correspondence segment",
    lines: (at) => joined(at.source, at.image),
  },
  framed: {
    name: "its cross-line",
    lines: (at) => joined(at.minus, at.plus),
  },
  ruled: {
    name: "its ruling",
    lines: (at) => joined(at.point, at.plus),
  },
};
function projectionLines(at: CurveProbe, r: SpatialResult): Vec3[] {
  const pole = r.projection?.pole;
  if (!pole || !at.point || !at.foot || !at.image) return [];
  return [at.point, at.foot, pole, at.foot, at.foot, at.image];
}
// A pursuit's polygon joins every pursuer at the sample's time, when all
// are known. A pursuit's probe always stands on a sample.
function polygonLines(at: CurveProbe, r: SpatialResult): Vec3[] {
  const j = at.sample;
  if (j === undefined) return [];
  const ps = (r.pursuit?.paths ?? []).map((path) => path[j]);
  if (ps.length < 2 || ps.some((p) => !p)) return [];
  return ps.flatMap((p, k) => [p!, ps[(k + 1) % ps.length]!]);
}

// A harmonic curve's chain of generating vectors at the probe's time, each
// turning around its ellipse, under any construction. It needs the chains
// Go returns with the probe's diagnostics, or the chain at the probe's t.
function chainLines(at: CurveProbe, r: SpatialResult): Vec3[] {
  const h = r.harmonic,
    s: HarmonicPosition | undefined = at.chain;
  return h && s ? [...harmonicChain(s), ...harmonicEllipses(h.terms, s)] : [];
}
// A field's timeline: every trajectory's point at the sample's time, joined
// in seed order, open, and broken where a trajectory has ended. A field's
// probe always stands on a sample.
function timelineLines(at: CurveProbe, r: SpatialResult): Vec3[] {
  const j = at.sample;
  if (j === undefined) return [];
  const ps = (r.field?.paths ?? []).map((path) => path[j]);
  return ps.flatMap((p, k) => (k > 0 && p && ps[k - 1] ? [ps[k - 1]!, p] : []));
}
// What each curve format highlights at the probe's time beside its
// construction's lines, and whether a study of it has anything to join.
const formats: Partial<
  Record<
    SpatialConfig["format"],
    { name: string; lines: Segments; offered: (c: SpatialConfig) => boolean }
  >
> = {
  pursuit: {
    name: "the connecting polygon at its time",
    lines: polygonLines,
    offered: () => true,
  },
  harmonic: {
    name: "the chain of turning vectors that sums to the point, each turning around its ellipse",
    lines: chainLines,
    offered: () => true,
  },
  field: {
    name: "the timeline joining every trajectory at its time, in seed order",
    lines: timelineLines,
    offered: (c) => c.field.seeds.length > 1,
  },
};

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
// its surface, its offset while it has one, and its focal sheets; a curve
// with a surface built on it either; another curve study its curve), and
// what the curve
// probe's highlight shows (null when only the frame and circle are drawn).
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
          ...(c.format === "surface" && c.surface.offset !== 0
            ? (["offset"] as const)
            : []),
          ...(c.format === "surface" ? (["focal1", "focal2"] as const) : []),
        ];
  const format = formats[c.format];
  const names = [
    constructions[c.construction]?.name,
    format?.offered(c) ? format.name : undefined,
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

// The help beside the probe's switch: what it draws and where it does not,
// and how it is placed: snapped to samples, or between them.
export function probeHelp(c: SpatialConfig, between = false) {
  const { highlight } = probeSupport(c);
  return tiered(
    "Describes the curve itself, not the surface on it: its Frenet frame and osculating circle.",
    `${highlight ? `It also shows ${highlight}. ` : ""}${
      between
        ? "It stands at any t of the domain, evaluated exactly there; the first move after the study changes recomputes the study."
        : "It moves between the curve's samples."
    } Where the curvature vanishes, N, B, τ and the circle are undefined and not drawn.`,
  );
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

// Help for standing between samples.
export const betweenHelp = tiered(
  "Lets the probe stand at any t, not only at a sample, describing the curve exactly there.",
  "The highlighted construction is described at that t too. A trajectory or a pursuit, integrated step by step, snaps to its samples regardless.",
);

// The curve probe's drawing at its point: the highlighted construction, the
// osculating circle (from Go's centre, with radius 1/κ, in the plane of T
// and N) and a three-axis mark at the point, all in the probe ink, then
// the frame glyphs, each its own ink. Nothing where the curve has no point.
export function probeBatches(
  result: SpatialResult,
  config: SpatialConfig,
  at: CurveProbe,
): Batch[] {
  const p = at.point;
  if (!p) return [];
  const radius = result.bounds.radius;
  const marked: Vec3[] = [
    ...(constructions[config.construction]?.lines(at, result) ?? []),
    ...(formats[config.format]?.lines(at, result) ?? []),
  ];
  const T = at.tangent,
    N = at.normal,
    B = at.binormal,
    c = at.center,
    k = at.curvature;
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

// The curve probe's numbers: its parameter, κ, the radius of curvature 1/κ
// (null where κ is 0 or unknown), τ, whether it is flat there, and whether
// its centre is at infinity.
export function probeReadout(at: SpatialProbePoint) {
  const k = at.curvature;
  const flat = k === 0;
  return {
    t: at.t,
    curvature: k,
    radius: k ? 1 / k : null,
    torsion: at.torsion,
    flat,
    infinite: !!k && !flat && !at.center,
  };
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
// principal curvatures, or the light's wavefront and foci. singular, where
// given, replaces the status at a singular point.
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
  singular?: string;
  help: string;
};
const rows = "(at most 481)";
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
    help: "It moves between the patch's grid samples. Curvatures are numbered κ₁ ≥ κ₂ with the chosen normal.",
  },
  offset: {
    ...curvatureWords,
    surface: "offset surface",
    along: "u",
    around: "v",
    branches: ["κ₁", "κ₂"],
    sliders: ["Along u", "Along v"],
    through: "",
    missing: "The patch has no normal here, so the offset has no point.",
    unknownBranch: "κ₂ is",
    unknown: "where its derivatives are unstable",
    help: "Its curvatures are κᵢ/(1 − dκᵢ), so its centers lie on the patch's focal sheet of the same number. Where 1 − dκᵢ = 0 it has a cuspidal edge; beyond a focal sheet it has folded inside out.",
  },
  // A patch's focal sheet, named by its number (see surfaceTerms).
  focal: {
    ...curvatureWords,
    surface: "focal sheet",
    along: "u",
    around: "v",
    branches: ["κ₁", "κ₂"],
    sliders: ["Along u", "Along v"],
    through: "the patch's normal line",
    missing:
      "No point here: the patch's center lies at infinity, or the patch has no normal.",
    unknownBranch: "both curvatures are",
    unknown: "where its derivatives overflow",
    singular: "Singular here: no tangent plane, as on a cuspidal edge.",
    help: "Its normal is the patch's principal direction eᵢ, oriented continuously along u; its curvatures need third derivatives. A ridge gives a cuspidal edge, an umbilic joins the sheets, and where κᵢ = 0 it is at infinity and has no point.",
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
    help: `It moves between the mesh rings along t ${rows} and 24 turns around each contact circle, from θ₀. Around the circle the curvature is −1/R, centered on the curve; across it, the other has its own center.`,
  },
  developable: {
    ...ruledTerms,
    surface: "tangent ribbon",
    branches: ["κ along the ruling", "κ across it"],
    sliders: ["Along t", "Across the ruling"],
    missing: "No surface here: the curve has no regular point at this t.",
    unknown: "where the curve's third derivative is unstable",
    help: `It moves between rows along t ${rows} and 24 points per ruling, u = ±L·k/12, skipping the edge of regression u = 0. The normal is ±B, the binormal. Along the ruling κ = 0; across it, τ/(κ|u|).`,
  },
  framed: {
    ...ruledTerms,
    surface: "framed ribbon",
    branches: ["κ₁", "κ₂"],
    sliders: ["Along t", "Across the ribbon"],
    missing: "No ribbon here: the frame is undefined at this t.",
    unknown:
      "where the curve's third derivative, or a Frenet frame's τ′, is unstable",
    help: `It moves between rows along t ${rows} and 25 points across each cross-line, u = −w to w. The normal is D × S_t. Ruled, it has K ≤ 0, and K = 0 untwisted and rotation-minimizing.`,
  },
  ruled: {
    ...ruledTerms,
    surface: "ruled surface",
    branches: ["κ₁", "κ₂"],
    sliders: ["Along t", "Along the ruling"],
    missing: "No surface here: the partner is missing at this t.",
    unknown: "where a thread's second derivative is unstable",
    help: `It moves between rows along t ${rows} and 25 points along each ruling, from the curve (u = 0) to its partner (u = 1). The normal is S_t × S_u, and K ≤ 0.`,
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
  if (target === "offset") return surfaceTermsByKind.offset;
  const sheet = focalSheet(target);
  if (sheet)
    return {
      ...surfaceTermsByKind.focal,
      surface: `${sheet === 1 ? "first" : "second"} focal sheet`,
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
        : t === "offset"
          ? "The offset"
          : focalSheet(t)
            ? `Focal sheet ${focalSheet(t)}`
            : "The surface";
}
export function describeHelp(c: SpatialConfig) {
  if (c.format === "surface")
    return tiered(
      `What the probe describes: the surface, ${c.surface.offset !== 0 ? "its offset, " : ""}or a focal sheet, all at the same sample.`,
      `The surface: the patch's principal directions, curvatures and centers.${
        c.surface.offset !== 0
          ? " The offset: the same at the offset's point on the same normal, whose centers are the patch's own."
          : ""
      } Focal sheet 1 or 2: the same at the patch's center of κ₁ or κ₂, on the sheet of those centers, whose normal is the patch's principal direction.`,
    );
  return c.format === "rays"
    ? tiered(
        `What the probe describes: the light leaving the ${medium(c)}, or the ${medium(c)} itself, at the same sample.`,
        `The light: the incident and outgoing rays, and the outgoing wavefront's principal directions, curvatures and foci, which lie on the caustics. The ${medium(c)}: its own principal directions, curvatures and centers.`,
      )
    : tiered(
        "What the probe describes: the curve or the surface, at the same place along t.",
        `The curve: its Frenet frame, curvature and torsion. The surface: the ${surfaceTerms(c, "surface").surface}'s principal directions, curvatures and centers.`,
      );
}

// The probe's legend: what it can describe in the study.
export function probeLegend(c: SpatialConfig, target: ProbeTarget) {
  const { targets } = probeSupport(c);
  if (c.format === "rays") return `Probe the light or ${medium(c)}`;
  if (targets.includes("offset"))
    return "Probe the surface, its offset or its focal sheets";
  if (targets.includes("focal1"))
    return "Probe the surface or its focal sheets";
  if (targets.length > 1) return "Probe the curve or surface";
  return target === "surface" ? "Probe the surface" : "Probe the curve";
}

// The help beside the probe's switch for a surface, the light or a
// mirror.
export function surfaceProbeHelp(c: SpatialConfig, target: ProbeTarget) {
  const t = surfaceTerms(c, target);
  if (target === "light") {
    const m = t.surface;
    return tiered(
      `Describes the light leaving the ${m} at a point: its rays, and the outgoing wavefront's foci.`,
      `The wavefront's curvatures μ₁ ≥ μ₂ focus the light at X + R/μ on the caustics: a real focus ahead of the ${m} where μ > 0. Distances read negative for a virtual focus. Foci beyond 100 study radii are at infinity. θ is the angle of incidence${
        c.rays.interaction === "refract"
          ? ", θ′ the angle of transmission; beyond the critical angle nothing is transmitted"
          : ""
      }.`,
    );
  }
  return tiered(
    `Describes the ${t.surface} at a point: its normal, principal directions and curvatures (A = −dn), with circles.`,
    `${t.help} A sphere with outward normal has κ = −1/R; centers beyond 100 study radii are not drawn.`,
  );
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
  const n = d.normals[row][column];
  const marked: Vec3[] = cross(p);
  // An offset's patch point, d behind it along the shared normal.
  const foot = d.kind === "offset" && n ? -(d.distance ?? 0) : null;
  if (n && foot !== null) marked.push(...cross(plus(p, n, foot)));
  // A focal sheet's patch point, joined to it by the patch's normal line,
  // which touches the sheet there.
  const source = d.kind === "focal" ? d.feet?.[row]?.[column] : null;
  if (source) marked.push(...cross(source), source, p);
  if (d.kind === "canal") {
    const ring = d.points[row];
    ring.forEach((q, k) => {
      const next = ring[(k + 1) % ring.length];
      if (q && next) marked.push(q, next);
    });
  } else if (d.kind !== "patch" && d.kind !== "offset" && d.kind !== "focal") {
    // The ruling is straight: one segment between its ends on the grid.
    const known = d.points[row].filter((q): q is Vec3 => !!q);
    if (known.length > 1) marked.push(known[0], known.at(-1)!);
  }
  const out = [lines(marked, probeInk.mark)];
  const light = d.light;
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
  // the outgoing ray also spans ℓ, and an offset's line its patch point.
  const reach = [
    0,
    glyph,
    ...(light ? [light.length] : []),
    ...(foot !== null ? [foot] : []),
  ];
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
// surface is missing, singular or umbilic there, or, an offset, folded.
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
    folded: !!d.folds?.[row]?.[column],
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
// for the light, the offset's for an offset, that focal sheet's for a
// focal sheet, a surface's for a surface or mirror.
export function probeSteps(result: SpatialResult, target: ProbeTarget) {
  const d = result.surfaceDiagnostics;
  if (gridded(target))
    return d &&
      (target === "light") === (d.kind === "wavefront") &&
      (target === "offset") === (d.kind === "offset") &&
      focalSheet(target) === (d.kind === "focal" ? d.sheet : null)
      ? d.u.length - 1
      : null;
  return result.diagnostics ? result.diagnostics.curvature.length - 1 : null;
}

// The step the probe stands at in a result with its diagnostics: the curve
// sample, or a surface's row (its column follows probe.across).
export function probeStep(
  result: SpatialResult,
  target: ProbeTarget,
  probe: Probe,
) {
  return gridded(target)
    ? surfaceProbeAt(result.surfaceDiagnostics!, probe.position, probe.across)
        .row
    : probeIndex(probe.position, result.base.length - 1);
}

// The base sample (or a surface's row) a reveal draws the probe's step with.
export function probeSample(
  result: SpatialResult,
  target: ProbeTarget,
  step: number,
) {
  return gridded(target) ? result.surfaceDiagnostics!.along[step] : step;
}

// How the probe moves while parameter tracks reshape the study (see
// ../probe.ts); a grid has no length to keep a share of.
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
  return curveProbeMotions;
}
export function probeMotionHelp(
  c: SpatialConfig,
  target: ProbeTarget,
  between = false,
) {
  if (between) return betweenMotionHelp;
  if (gridded(target)) {
    const t = surfaceTerms(c, target);
    return tiered(
      "Where the probe stands while the parameters vary.",
      `Stays: at the same share of the ${t.surface}'s rows and columns as the point you chose. Moves along: from its first ${t.along} to its last as the animation plays, at the column you chose. It snaps to each frame's own grid; the readout and plot describe that frame.`,
    );
  }
  return curveProbeMotionHelp;
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
  return heldCurveSample(
    start.diagnostics!,
    probe.position,
    motion,
    frame.diagnostics!,
    p,
  );
}

// The curve probe at a place: as given, or at a sample.
const curveAt = (result: SpatialResult, i: ProbePlace) =>
  typeof i === "number" ? sampleProbe(result, i) : i;

// The probe's drawing at its place: the curve probe at its point (or at
// sample i), or the surface probe at row i in the column the probe stands
// in.
export function probeDrawing(
  result: SpatialResult,
  config: SpatialConfig,
  probe: Probe,
  i: ProbePlace,
): Batch[] {
  if (probeTarget(config, probe) === "curve") {
    const at = curveAt(result, i);
    return at ? probeBatches(result, config, at) : [];
  }
  const d = result.surfaceDiagnostics;
  if (!d || typeof i !== "number") return [];
  return surfaceProbeBatches(
    result,
    i,
    surfaceProbeAt(d, 0, probe.across).column,
  );
}

// What an export records of the probe at its place: the curve probe's t,
// with its sample when it stands on one, or the surface probe's grid sample
// and its parameters.
export function probeRecord(
  result: SpatialResult,
  config: SpatialConfig,
  probe: Probe,
  i: ProbePlace,
) {
  if (probeTarget(config, probe) === "curve") {
    const at = curveAt(result, i)!;
    return at.sample !== undefined
      ? { index: at.sample, t: at.t }
      : { t: at.t };
  }
  if (typeof i !== "number")
    throw new Error("A surface probe stands on a row.");
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
  i: ProbePlace,
) {
  const short = (v: number) => Number(v.toPrecision(6));
  if (probeTarget(config, probe) === "curve")
    return `t = ${short(curveAt(result, i)!.t)}`;
  const r = probeRecord(result, config, probe, i) as { u: number; v: number },
    t = surfaceTerms(config, probeTarget(config, probe));
  return `${t.along} = ${short(r.u)}, ${t.around} = ${short(r.v)}`;
}
