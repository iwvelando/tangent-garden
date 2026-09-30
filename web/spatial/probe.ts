// The parameter probe: one base sample's Frenet frame, osculating circle and
// construction lines, and the base curve's curvature and torsion around it.
// Every quantity comes from Go (engine3.DiagnosticsResult) or the study's
// own per-sample arrays; this module only selects and draws them.
import type { Batch } from "./scene";
import type {
  DiagnosticsResult,
  SpatialConfig,
  SpatialResult,
  Vec3,
} from "./types";

// The probe's place on the base, as a fraction of its samples, so that it
// survives edits to the domain and sample count.
export type Probe = { enabled: boolean; position: number };
export const defaultProbe: Probe = { enabled: false, position: 0.5 };

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

// Whether a study offers the probe, and what its highlight shows (null when
// only the frame and circle are drawn).
export function probeSupport(c: SpatialConfig): {
  available: boolean;
  highlight: string | null;
} {
  const available =
    c.format !== "surface" && c.format !== "rays" && c.format !== "implicit";
  const names = [
    constructions[c.construction]?.name,
    c.format === "pursuit" ? "the connecting polygon at its time" : undefined,
  ].filter((n): n is string => !!n);
  return {
    available,
    highlight: available && names.length ? names.join(" and ") : null,
  };
}

// The help beside the probe's switch: what it draws and where it does not.
export function probeHelp(c: SpatialConfig) {
  const { highlight } = probeSupport(c);
  return `Describes the curve itself, not the surface or curves built on it. Moves between the curve's samples (more samples give finer steps) and shows the Frenet frame there: tangent T, principal normal N and binormal B, with the osculating circle of radius 1/κ in the plane of T and N${
    highlight ? `, and ${highlight}` : ""
  }. Where the curvature vanishes, N, B, τ and the circle are undefined and not drawn. Not shown during animation playback or in animation exports; still images include it.`;
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

// What the panel says of a straight base, naming the surface built on it.
export function straightNote(c: SpatialConfig) {
  const surface = surfaces[c.construction];
  return `This curve is straight: its curvature is zero everywhere, so it has no normal, binormal, torsion or osculating circle.${
    surface
      ? ` The probe describes the curve the ${surface} is built on, not the surface.`
      : ""
  }`;
}
