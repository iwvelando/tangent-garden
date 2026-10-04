// The 2D notebook's parameter probe: one base sample's tangent, normal,
// osculating circle and construction lines, and the base curve's signed
// curvature around it. Every quantity comes from Go (engine.Diagnostics) or
// the study's own per-sample arrays; this module only selects them. The
// notebook-independent parts are in probe.ts.
import { probeIndex } from "./probe";
import type { Config, Result, Vec } from "./types";

// The probe's place as a fraction of the base's samples, so that it
// survives edits to the domain and sample count.
export type PlanarProbe = { enabled: boolean; position: number };
export const defaultProbe: PlanarProbe = { enabled: false, position: 0.5 };

// Only a curve with a parameter can be probed: a level set and an iterated
// map have none.
export const probeSupported = (config: Config) =>
  config.curve.format !== "implicit" && config.curve.format !== "attractor";

// The sample nearest the probe's position in a result with diagnostics.
export const probeSample = (result: Result, probe: PlanarProbe) =>
  result.diagnostics
    ? probeIndex(probe.position, result.diagnostics.curvature.length - 1)
    : null;

// The numbers at sample j: its parameter, the signed curvature κ (null
// where unknown), the radius of curvature 1/|κ| (null where κ is 0 or
// unknown), the drawn arc length to it, whether the sample is flat, and
// whether its center is at infinity.
export function probeReadout(result: Result, j: number) {
  const d = result.diagnostics;
  if (!d) return null;
  const n = d.curvature.length - 1;
  const k = d.curvature[j] ?? null;
  const flat = k === 0;
  return {
    // As Go samples it, so a symmetric domain's middle is exactly 0.
    t: n > 0 ? d.min * (1 - j / n) + d.max * (j / n) : d.min,
    curvature: k,
    radius: k ? 1 / Math.abs(k) : null,
    length: d.length[j] ?? null,
    flat,
    infinite: !!k && !d.center[j],
  };
}

// Whether the base is straight: every known curvature is zero.
export function probeStraight(result: Result) {
  const known = (result.diagnostics?.curvature ?? []).filter((k) => k !== null);
  return known.length > 0 && known.every((k) => k === 0);
}

// What the probe highlights of each construction at its sample, named for
// its help and legend, as segments from point to point. The construction's
// own point at the sample is the derived curve's; it acts on the input
// where there is one, else on the base.
type Highlight = {
  name: string;
  lines: (r: Result, j: number, c: Config) => [Vec, Vec][];
};
const from = (r: Result, j: number) => (r.input ? r.input[j] : r.base[j]);
const segment = (a?: Vec | null, b?: Vec | null): [Vec, Vec][] =>
  a && b ? [[a, b]] : [];
const toDerived: Highlight["lines"] = (r, j) =>
  segment(from(r, j), r.derived[j]);
const highlights: Partial<Record<Config["kind"], Highlight>> = {
  evolute: { name: "its normal to the center", lines: toDerived },
  involute: { name: "its unwound string", lines: toDerived },
  offset: { name: "its normal to the offset", lines: toDerived },
  catacaustic: { name: "its reflected ray", lines: toDerived },
  diacaustic: { name: "its refracted ray", lines: toDerived },
  inversion: { name: "its correspondence segment", lines: toDerived },
  rolling: { name: "its arm to the traced point", lines: toDerived },
  pedal: {
    name: "its tangent's foot and the perpendicular from the pole",
    lines: (r, j, c) => [
      ...toDerived(r, j, c),
      ...segment(c.pole, r.derived[j]),
    ],
  },
  contrapedal: {
    name: "its normal's foot and the perpendicular from the pole",
    lines: (r, j, c) => [
      ...toDerived(r, j, c),
      ...segment(c.pole, r.derived[j]),
    ],
  },
  orthotomic: {
    name: "its reflected pole",
    lines: (r, j, c) => [
      ...toDerived(r, j, c),
      ...segment(c.pole, r.derived[j]),
    ],
  },
};
// A construction drawn as a family of paths (an offset stack, a circle
// family) or an envelope has no single point at the sample to highlight.
export function probeHighlight(config: Config, result: Result) {
  if (result.family.length > 0) return null;
  return highlights[config.kind] ?? null;
}

// The probe's help, naming what it highlights in this study.
export function probeHelp(config: Config, result?: Result | null) {
  const h = result ? probeHighlight(config, result) : highlights[config.kind];
  return `Describe the base curve at one of its samples: its unit tangent T and normal N (T turned a quarter turn to the left), its osculating circle, which shares its tangent and curvature there, and the circle's center, the center of curvature${h ? `, with ${h.name}` : ""}. The signed curvature κ = (x′y″ − y′x″)/|r′|³ is positive where the curve turns left and negative where it turns right; the radius of curvature is 1/|κ|. The arc length s is measured along the drawn curve from its first sample by Simpson's rule, with nothing counted across a gap. Go computes them from the curve's own derivatives at every sample; the probe snaps to samples, so moving it never recomputes. Where κ is 0 (flat) or the center lies beyond 100 radii of the study, no circle is drawn; where the second derivative is unstable, κ is unknown.`;
}
