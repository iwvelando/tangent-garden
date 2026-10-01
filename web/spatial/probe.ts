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

// What the probe describes: the base curve, or a surface (a patch, or the
// canal built on the curve).
export type ProbeTarget = "curve" | "surface";
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

// Whether a study offers the probe, what it can describe (a surface patch
// only its surface, a canal its curve or its surface, another curve study
// its curve), and what the curve probe's highlight shows (null when only
// the frame and circle are drawn).
export function probeSupport(c: SpatialConfig): {
  available: boolean;
  highlight: string | null;
  targets: ProbeTarget[];
} {
  const curve =
    c.format !== "surface" && c.format !== "rays" && c.format !== "implicit";
  const targets: ProbeTarget[] = [
    ...(curve ? (["curve"] as const) : []),
    ...(c.format === "surface" || (curve && c.construction === "canal")
      ? (["surface"] as const)
      : []),
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
  }. Where the curvature vanishes, N, B, τ and the circle are undefined and not drawn. Animations and their exports show it only when they move it along the curve ("Move the probe along the curve"); still images include it.`;
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
// range (for κ ≥ 0).
export function plotScale(values: (number | null)[], fromZero: boolean) {
  const known = values
    .filter((v): v is number => v !== null)
    .sort((a, b) => a - b);
  let lo = known[0] ?? 0,
    hi = known.at(-1) ?? 1;
  if (known.length >= 8) {
    const q1 = known[Math.floor(known.length / 4)],
      q3 = known[Math.floor((3 * known.length) / 4)],
      spread = q3 - q1;
    if (spread > 0) {
      lo = known.find((v) => v >= q1 - 3 * spread)!;
      hi = [...known].reverse().find((v) => v <= q3 + 3 * spread)!;
    }
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
  return { lo, hi, runs, pinned };
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

// The surface probe's words for each kind of surface: its parameters, and
// its two principal branches, which a patch numbers κ₁ ≥ κ₂ (as its focal
// sheets) and a canal names by line of curvature.
export function surfaceTerms(c: SpatialConfig) {
  return c.format === "surface"
    ? {
        surface: "surface",
        along: "u",
        around: "v",
        branches: ["κ₁", "κ₂"],
        lines: ["first principal direction", "second principal direction"],
        sliders: ["Along u", "Along v"],
        missing: "The patch has no point here.",
        help: "Moves between the patch's own grid samples (more u and v samples give finer steps). Its principal curvatures are numbered κ₁ ≥ κ₂ with the chosen normal, as the focal sheets are",
      }
    : {
        surface: "canal surface",
        along: "t",
        around: "θ − θ₀",
        branches: ["κ around the circle", "κ across it"],
        lines: ["contact circle", "across the contact circle"],
        sliders: ["Along t", "Around"],
        missing: "No surface here: no real contact circle at this t.",
        help: "Moves between the canal's mesh rings along t (at most 481, so more samples give finer steps up to that) and 24 turns around each contact circle, measured from θ₀ (with any twist) as the meridians are. Around the circle the curvature is −1/R, centred on the sphere's centre on the curve, with the outward normal; across it, the other principal curvature has its own centre",
      };
}

// The help beside the probe's switch for a surface.
export function surfaceProbeHelp(c: SpatialConfig) {
  const t = surfaceTerms(c);
  return `Describes the ${t.surface} at a point: its normal, its two principal directions, and their normal-section circles of radius 1/|κ| through the point, centred on the focal points (the centres of curvature) on the normal line. ${t.help}. Curvatures use A = −dn, so a sphere with its outward normal has κ = −1/R. Where a centre lies beyond 100 study radii it is at infinity and its circle is not drawn; at an umbilic every direction is principal and none is drawn; where the surface is singular there is no normal. Animations and their exports show it only when they move it ("Move the probe along the ${t.surface}"); still images include it.`;
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
// point (with a canal's contact circle through it), the normal line through
// the point and both finite focal points, and for each branch its direction
// glyph, a cross at its focal point and its normal-section circle in the
// plane of n and its direction. Nothing where the surface has no point.
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
  }
  const out = [lines(marked, probeInk.mark)];
  const n = d.normals[row][column];
  if (!n) return out;
  // The normal line spans the point, its glyph and both finite centres.
  const reach = [0, glyph];
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
// curvature, radius 1/κ (null where κ is 0 or unknown) and whether its
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
  const curvature = [0, 1].map((b) => d.curvature[b][row]?.[column] ?? null);
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

// The steps the probe moves through in a result: the base's samples or the
// surface's rows. Null without the diagnostics it needs.
export function probeSteps(result: SpatialResult, target: ProbeTarget) {
  if (target === "surface")
    return result.surfaceDiagnostics
      ? result.surfaceDiagnostics.u.length - 1
      : null;
  return result.diagnostics ? result.diagnostics.curvature.length - 1 : null;
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
  return { target: "surface", row: i, column, u: d.u[i], v: d.v[column] };
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
    t = surfaceTerms(config);
  return `${t.along} = ${short(r.u)}, ${t.around} = ${short(r.v)}`;
}
