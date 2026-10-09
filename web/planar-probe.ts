// The 2D notebook's parameter probe: the base curve's tangent, normal,
// osculating circle and construction lines at one parameter, and its signed
// curvature around it. Every quantity comes from Go (engine.Diagnostics at
// the samples, engine.ProbePoint between them) or the study's own
// per-sample arrays; this module only selects them. The
// notebook-independent parts are in probe.ts.
import { tiered } from "./help";
import { probeIndex } from "./probe";
export { betweenMotionHelp } from "./probe";
import {
  refinesBetweenSamples,
  type Config,
  type ProbePoint,
  type Result,
  type Vec,
} from "./types";

// The probe's place as a fraction of the domain, so that it survives edits
// to the domain and sample count. It snaps to the nearest sample unless it
// stands between samples (between), which links made before it leave out.
export type PlanarProbe = {
  enabled: boolean;
  position: number;
  between?: boolean;
};
export const defaultProbe: PlanarProbe = { enabled: false, position: 0.5 };

// Only a curve with a parameter can be probed: a level set and an iterated
// map have none.
export const probeSupported = (config: Config) =>
  config.curve.format !== "implicit" && config.curve.format !== "attractor";

// Whether the probe stands between samples in this study: asked for, on a
// curve Go evaluates at any parameter (not a chase or trajectory, which
// snap to their samples).
export const probeBetween = (config: Config, probe: PlanarProbe) =>
  !!probe.between && refinesBetweenSamples(config.curve.format);

// The parameter at a fraction of the domain, as Go samples it, so that the
// ends and a symmetric domain's middle are exact.
export const parameterAt = (min: number, max: number, position: number) =>
  Math.min(max, Math.max(min, min * (1 - position) + max * position));

// The sample nearest the probe's position in a result with diagnostics.
export const probeSample = (result: Result, probe: PlanarProbe) =>
  result.diagnostics
    ? probeIndex(probe.position, result.diagnostics.curvature.length - 1)
    : null;

// The probe as drawn: Go's description at its parameter, with its sample
// when it is snapped to one.
export type HeldProbe = ProbePoint & { sample?: number };

// The probe at sample j, from the result's diagnostics and its own
// per-sample points, described as Go describes it between samples.
export function sampleProbe(result: Result, j: number): HeldProbe | null {
  const d = result.diagnostics;
  if (!d) return null;
  const n = d.curvature.length - 1;
  return {
    t: n > 0 ? d.min * (1 - j / n) + d.max * (j / n) : d.min,
    point: result.base[j] ?? null,
    tangent: d.tangent[j] ?? null,
    normal: d.normal[j] ?? null,
    curvature: d.curvature[j] ?? null,
    center: d.center[j] ?? null,
    length: d.length[j] ?? null,
    ...(result.input && { input: result.input[j] ?? null }),
    derived: result.derived[j] ?? null,
    sample: j,
  };
}

// Where a probe stands among a result's samples, in sample steps (not
// rounded): for its mark on the plot of curvature.
export function probeStep(result: Result, at: ProbePoint) {
  const d = result.diagnostics;
  if (!d) return 0;
  const n = d.curvature.length - 1;
  return d.max > d.min ? ((at.t - d.min) / (d.max - d.min)) * n : 0;
}

// The probe's numbers: its parameter, the signed curvature κ (null where
// unknown), the radius of curvature 1/|κ| (null where κ is 0 or unknown),
// the drawn arc length to it, whether it is flat, and whether its center
// is at infinity.
export function probeReadout(at: ProbePoint) {
  const k = at.curvature;
  return {
    t: at.t,
    curvature: k,
    radius: k ? 1 / Math.abs(k) : null,
    length: at.length,
    flat: k === 0,
    infinite: !!k && !at.center,
  };
}

// Whether the base is straight: every known curvature is zero.
export function probeStraight(result: Result) {
  const known = (result.diagnostics?.curvature ?? []).filter((k) => k !== null);
  return known.length > 0 && known.every((k) => k === 0);
}

// What the probe highlights of each construction at its point, named for
// its help and legend, as segments from point to point. The construction's
// own point is the derived curve's; it acts on the input where there is
// one, else on the base.
type Highlight = {
  name: string;
  lines: (at: ProbePoint, c: Config) => [Vec, Vec][];
};
const from = (at: ProbePoint, c: Config) =>
  c.input !== "curve" ? (at.input ?? null) : at.point;
const segment = (a?: Vec | null, b?: Vec | null): [Vec, Vec][] =>
  a && b ? [[a, b]] : [];
const toDerived: Highlight["lines"] = (at, c) =>
  segment(from(at, c), at.derived);
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
    lines: (at, c) => [...toDerived(at, c), ...segment(c.pole, at.derived)],
  },
  contrapedal: {
    name: "its normal's foot and the perpendicular from the pole",
    lines: (at, c) => [...toDerived(at, c), ...segment(c.pole, at.derived)],
  },
  orthotomic: {
    name: "its reflected pole",
    lines: (at, c) => [...toDerived(at, c), ...segment(c.pole, at.derived)],
  },
};
// A construction drawn as a family of paths (an offset stack, a circle
// family) or an envelope has no single point at the sample to highlight.
export function probeHighlight(config: Config, result: Result) {
  if (result.family.length > 0) return null;
  return highlights[config.kind] ?? null;
}

// The probe's help, naming what it highlights in this study, and how it
// is placed: snapped to samples, or between them.
export function probeHelp(
  config: Config,
  result?: Result | null,
  between = false,
) {
  const h = result ? probeHighlight(config, result) : highlights[config.kind];
  const brief = `Describes the base curve at ${between ? "any t of its domain" : "one of its samples"}: its tangent T, normal N and osculating circle${h ? `, with ${h.name}` : ""}.`;
  const source = between
    ? "Values come from the curve's derivatives at the probe's own t, and at a sample are the sample's own. Each move evaluates just that point; the first move after the study changes recomputes the study, which takes longer for many samples."
    : "Values come from the curve's own derivatives at every sample; the probe snaps to samples, so moving it never recomputes.";
  return tiered(
    brief,
    `N is T turned a quarter turn to the left. The osculating circle shares the curve's tangent and curvature, and its center is the center of curvature. The signed curvature κ = (x′y″ − y′x″)/|r′|³ is positive where the curve turns left and negative where it turns right; the radius of curvature is 1/|κ|. The arc length s runs along the drawn curve from its first sample by Simpson's rule, with nothing counted across a gap${between ? ", and carries on from the sample before by the same rule" : ""}. ${source} Where κ is 0 (flat) or the center lies beyond 100 radii of the study, no circle is drawn; where the second derivative is unstable, κ is unknown.`,
  );
}

// Help for standing between samples.
export const betweenHelp = tiered(
  "Lets the probe stand at any t, not only at a sample, describing the curve exactly there.",
  "The highlighted construction is described at that t too. A chase or a trajectory, integrated step by step, snaps to its samples regardless.",
);
