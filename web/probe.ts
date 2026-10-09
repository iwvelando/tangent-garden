// The parameter probe's notebook-independent parts, shared by the 2D and 3D
// notebooks: where it stands among a curve's samples, how a diagnostic is
// scaled for its plot, and where it stands in each frame while parameters
// vary. Every quantity comes from Go; this module only selects.

import { tiered } from "./help";
import type { SchemaOf } from "./study-link";

// The probe's inks, diagnostic rather than decorative, as [light theme,
// dark theme] RGB pairs from 0 to 1: its point, osculating circle and
// highlighted construction in magenta, and the frame's T, N and B in red,
// green and blue. The 3D shader and the 2D drawing both take them from here.
type RGB = [number, number, number];
export const probeInks = {
  mark: [
    [0.72, 0.1, 0.46],
    [1, 0.47, 0.77],
  ],
  tangent: [
    [0.8, 0.16, 0.12],
    [1, 0.45, 0.38],
  ],
  normal: [
    [0.1, 0.5, 0.18],
    [0.45, 0.9, 0.5],
  ],
  binormal: [
    [0.13, 0.3, 0.82],
    [0.52, 0.68, 1],
  ],
} satisfies Record<string, readonly [RGB, RGB]>;
// An ink as a CSS color in a theme.
export const probeColor = (ink: keyof typeof probeInks, dark: boolean) =>
  `#${probeInks[ink][dark ? 1 : 0]
    .map((c) =>
      Math.round(c * 255)
        .toString(16)
        .padStart(2, "0"),
    )
    .join("")}`;

// The nearest of the samples 0…n.
export const probeIndex = (position: number, n: number) =>
  Number.isNaN(position)
    ? Math.round(n / 2)
    : Math.min(n, Math.max(0, Math.round(position * n)));

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

// While an animation draws the study along its samples, the probe stands
// where the user put it but appears only once the drawing has reached the
// sample it describes (a surface probe's row is drawn with one sample): the
// step to draw, or why it is away. Other animations that keep the study
// fixed draw it throughout.
export const unreached = "The drawing has not reached the probe yet.";
// Help's account of the probe in those animations.
export const fixedAnimationsHelp =
  "Every other animation draws it where you put it, a reveal only once its drawing reaches the point, and still images include it.";
export const revealedProbe = (step: number, sample: number, last: number) =>
  sample <= last ? step : unreached;

// How the probe moves while parameter tracks reshape the study: it stays
// where it was put (at its t on the curve, or its row and column on a
// grid), keeps its share of the curve's drawn length, or moves along the
// curve or grid from start to end as the parameters vary.
export type ProbeMotion = "stays" | "length" | "along";
export const probeMotionValues: ProbeMotion[] = ["stays", "length", "along"];
export const probeMotionSchema: SchemaOf<ProbeMotion> = {
  options: { stays: true, length: true, along: true },
};
export const curveProbeMotions: { value: ProbeMotion; label: string }[] = [
  { value: "stays", label: "Stays at its t" },
  { value: "length", label: "Keeps its share of the length" },
  { value: "along", label: "Moves along the curve" },
];
const probeMotionBrief =
  "Where the probe stands while the parameters vary: at its t, at its share of the curve's length, or moving along it.";
export const curveProbeMotionHelp = tiered(
  probeMotionBrief,
  "Stays at its t: at the sample nearest the t you chose, and absent from a frame whose domain leaves that t out. Keeps its share of the length: at the sample nearest the same fraction of the drawn curve's arc length, with nothing counted across a break. Moves along the curve: from its first sample to its last as the animation plays. It snaps to each frame's own samples; the readout and plot describe that frame, and framing ignores the osculating circle.",
);

// How the probe moves while the parameters vary, between samples.
export const betweenMotionHelp = tiered(
  probeMotionBrief,
  "Stays at its t: at exactly the t you chose, and absent from a frame whose domain leaves that t out. Keeps its share of the length: where the drawn curve's arc length is the same fraction of the whole, with nothing counted across a break. Moves along the curve: from the start of each frame's domain to its end as the animation plays. It stands between samples in every frame; the readout and plot describe that frame, and framing ignores the osculating circle.",
);

// Why a held probe has no point in a frame: its t lies outside the frame's
// domain, it has no share of the length to keep, or the frame has no
// length.
const short6 = (v: number) => Number(v.toPrecision(6));
export const outsideFrame = (t: number, min: number, max: number) =>
  `t = ${short6(t)} lies outside this frame's domain, [${short6(min)}, ${short6(max)}].`;
export const noShare =
  "The probe's point has no share of the length: it is not on a drawn stretch of the curve.";
export const noLength = "This frame's curve has no length.";
// The drawn arc length of a curve, the greatest of its lengths to each
// sample.
export const drawnLength = (lengths: (number | null)[]) =>
  lengths.reduce<number>((m, s) => (s !== null && s > m ? s : m), 0);

// A curve's diagnostics as the probe needs them to hold its place: the
// domain, one entry per sample, and the drawn arc length to each sample.
export type CurveSamples = {
  min: number;
  max: number;
  curvature: unknown[];
  length: (number | null)[];
};

// The sample a curve probe stands at in one frame of a parameter animation
// at progress p, or a sentence saying why it has none there. from is the
// study as playback began, where position chose its sample.
export function heldCurveSample(
  from: CurveSamples,
  position: number,
  motion: ProbeMotion,
  frame: CurveSamples,
  p: number,
): number | string {
  const steps = frame.curvature.length - 1;
  if (motion === "along") return probeIndex(p, steps);
  const n0 = from.curvature.length - 1,
    i0 = probeIndex(position, n0);
  if (motion === "stays") {
    const t = from.min + ((from.max - from.min) * i0) / n0;
    const x = ((t - frame.min) / (frame.max - frame.min)) * steps;
    if (!(x >= -0.5 && x <= steps + 0.5))
      return outsideFrame(t, frame.min, frame.max);
    return Math.min(steps, Math.max(0, Math.round(x)));
  }
  const mine = from.length[i0],
    whole = drawnLength(from.length);
  if (mine === null || !(whole > 0)) return noShare;
  const goal = (mine / whole) * drawnLength(frame.length);
  if (!(drawnLength(frame.length) > 0)) return noLength;
  let best = -1;
  frame.length.forEach((s, i) => {
    if (
      s !== null &&
      (best < 0 || Math.abs(s - goal) < Math.abs(frame.length[best]! - goal))
    )
      best = i;
  });
  return best;
}
