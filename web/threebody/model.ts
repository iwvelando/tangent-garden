// Three bodies: the planar Newtonian problem of three point masses, G = 1,
// integrated in Go (engine/threebody; see docs/mathematics.md#three-bodies)
// into one finite, immutable history sampled at fixed physical times.
// Types mirror engine/threebody's request, corpus and Prepared reply.
import { tiered } from "../help";
import { count as formatCount, readout } from "../number-format";
import type { LineWeight } from "../line-weight";
import type { PlotCamera } from "../planar-link";
import type { Vec } from "../types";
import {
  threeBodyConfigurations,
  type ThreeBodyName,
  type ThreeBodyTwin,
} from "./configurations";
export type { ThreeBodyTwin } from "./configurations";

export type ThreeBodyBody = { mass: number; position: Vec; velocity: Vec };
export type ThreeBodyBodies = [ThreeBodyBody, ThreeBodyBody, ThreeBodyBody];
export type ThreeBodyRequest = {
  bodies: ThreeBodyBody[];
  duration: number;
  samples: number;
};
// One reference configuration (engine/threebody.Case), in the study's
// units. Its periodicity, stability and observed evidence are separate
// statements.
export type ThreeBodyCase = {
  name: ThreeBodyName;
  title: string;
  source: string;
  bodies: ThreeBodyBodies;
  length: number;
  timeFactor: number;
  period: number;
  publishedPeriod: number;
  duration: number;
  periodicity: string;
  stability: string;
  observed: string;
};
export type ThreeBodyTerminal = {
  reason:
    "end" | "encounter" | "unresolved" | "exhausted" | "drift" | "nonfinite";
  check: string;
  time: number;
  pair: [number, number];
  separation: number;
};
export type ThreeBodyPrepared = {
  times: number[];
  available: number;
  paths: { positions: Vec[]; velocities: Vec[] }[];
  stepErrors: number[];
  final: { time: number; positions: Vec[]; velocities: Vec[] };
  terminal: ThreeBodyTerminal;
  accepted: number;
  rejected: number;
  attempts: number;
  diagnostics: {
    energy: number;
    energyError: number;
    momentumError: number;
    angularError: number;
    centerError: number;
    closest: number;
    closestTime: number;
    stepError: number;
    tolerance: number;
    floor: number;
    retainedBytes: number;
  };
};

// A history and its twin, prepared together on the same sampling plan
// (engine/threebody.Pair): the twin's starting state as integrated and
// their comparison over the samples both have.
export type ThreeBodyComparison = {
  common: number;
  end: number;
  // The farthest any body is from its own twin at each shared sample, and
  // the same for velocities.
  separation: number[];
  speedSeparation: number[];
  largest: number;
  largestTime: number;
  crossings: { threshold: number; reached: boolean; time: number }[];
  retainedBytes: number;
};
export type ThreeBodyPair = {
  reference: ThreeBodyPrepared;
  twin: ThreeBodyPrepared;
  bodies: ThreeBodyBodies;
  comparison: ThreeBodyComparison;
};

export type Trail = "whole" | "window";
export type ThreeBodyFraming = "whole" | "close";
// The study: the configuration it starts from, its initial state once
// edited (absent, the configuration's own) and its duration once edited
// (absent, the configuration's), then playback and presentation. Nothing
// here is ever recentered or renormalized.
export type ThreeBodyStudy = {
  configuration: ThreeBodyName;
  bodies?: ThreeBodyBodies;
  duration?: number;
  // Physical time units per second of playback and of the movie.
  speed: number;
  trail: Trail;
  // A moving trail's length in time units.
  window: number;
  // The whole history drawn faintly behind the trails.
  ghost: boolean;
  triangle: boolean;
  framing: ThreeBodyFraming;
  view: PlotCamera;
  weight: LineWeight;
  // The twin compared with the history, when comparing.
  twin?: ThreeBodyTwin;
};

// The engine's admission limits and stopping policy (engine/threebody).
export const threeBodyLimits = {
  minMass: 0.001,
  massTotal: 1,
  // The engine accepts a total within this of 1.
  massSlack: 1e-12,
  coordinate: 10,
  speed: 20,
  start: 0.01,
  duration: 100,
  samples: 20000,
  floor: 1e-4,
  attempts: 200000,
  rejections: 32,
  drift: 1e-6,
  tolerance: 1e-12,
  // The study's own playback speeds and trail lengths.
  // The largest twin perturbation, in length or velocity units.
  twin: 0.1,
  speeds: [0.01, 100] as [number, number],
  windows: [0.01, 100] as [number, number],
} as const;
// Every history is sampled at the most samples the engine allows, evenly
// in physical time, so motion stays smooth at any speed and duration.
export const threeBodySamples = threeBodyLimits.samples;

export const threeBodyPage = { width: 1000, height: 760 };
export const threeBodyZoom: [number, number] = [0.1, 100];

// A configuration's study: its own playback and presentation defaults
// (configurations.ts), the drawing unpanned at regular weight.
export function configurationStudy(name: ThreeBodyName): ThreeBodyStudy {
  return {
    configuration: name,
    ...structuredClone(threeBodyConfigurations[name].defaults),
    view: { x: 0, y: 0, zoom: 1 },
    weight: "regular",
  };
}
export const defaultThreeBody = configurationStudy("figure-eight");
// The twin a comparison of a configuration starts from.
export const configurationTwin = (name: ThreeBodyName): ThreeBodyTwin =>
  structuredClone(threeBodyConfigurations[name].twin);
// A configuration's study compared with its twin.
const twinStudy = (name: ThreeBodyName): ThreeBodyStudy => ({
  ...configurationStudy(name),
  twin: configurationTwin(name),
});

// The authored studies, in the 2D examples gallery. Each opens over the
// notebook's study without replacing it, and takes nothing from it.
export const threeBodyPresets: {
  title: string;
  note: string;
  study: ThreeBodyStudy;
}[] = [
  {
    title: "Three bodies share a figure-eight",
    note: "Equal masses chase one another around one curve, a third of a period apart",
    study: configurationStudy("figure-eight"),
  },
  {
    title: "A binary and a distant companion",
    note: "A tight pair orbits its center while a lighter third body circles them both",
    study: configurationStudy("hierarchical"),
  },
  {
    title: "A light pair beside a heavy body",
    note: "Lagrange's triangle with one heavy body: Routh's condition holds, so it turns as one",
    study: configurationStudy("lagrange-routh"),
  },
  // Burrau's problem opens on the close dance, so the ejected body leaves
  // the frame rather than shrinking the rest.
  {
    title: "Burrau's three-four-five problem",
    note: "Masses 3, 4 and 5 fall from rest; after a run of close passes the lightest is thrown out",
    study: configurationStudy("pythagorean"),
  },
  {
    title: "A triangle broken by a millionth",
    note: "Lagrange's equal-mass triangle, nudged by 10⁻⁶, turns as one for a while, then comes apart",
    study: configurationStudy("broken-triangle"),
  },
  // A stable neighborhood: the twin's separation grows about linearly.
  {
    title: "A figure-eight and its twin",
    note: "Body 1 of the twin starts 0.01 faster; the two dances drift apart in phase but keep their shape",
    study: twinStudy("figure-eight"),
  },
  // A sensitive encounter, validated against the reference integrator:
  // the twins part while both are still accurate.
  {
    title: "Burrau's problem and a twin",
    note: "Body 1 of the twin starts 10⁻⁴ to the right; after the close passes the twins throw it out opposite ways",
    study: twinStudy("pythagorean"),
  },
];
export const presetThreeBody = (index: number): ThreeBodyStudy =>
  structuredClone(threeBodyPresets[index].study);

// The study's initial state and duration: as edited, or else its
// configuration's.
export const studyBodies = (
  s: ThreeBodyStudy,
  c: ThreeBodyCase,
): ThreeBodyBodies => s.bodies ?? c.bodies;
export const studyDuration = (s: ThreeBodyStudy, c: ThreeBodyCase) =>
  s.duration ?? c.duration;
export const edited = (s: ThreeBodyStudy) =>
  s.bodies !== undefined || s.duration !== undefined;

export function threeBodyRequest(
  s: ThreeBodyStudy,
  c: ThreeBodyCase,
): ThreeBodyRequest {
  return {
    bodies: structuredClone(studyBodies(s, c)),
    duration: studyDuration(s, c),
    samples: threeBodySamples,
  };
}

// The study a configuration switch leaves: the new configuration's state,
// duration, framing, speed and an unpanned view; the trails, faint path,
// triangle and weight as they were.
// A comparison continues with the new configuration's twin.
export function switchConfiguration(
  s: ThreeBodyStudy,
  name: ThreeBodyName,
): ThreeBodyStudy {
  const next = configurationStudy(name);
  return {
    ...next,
    ...(s.twin && { twin: configurationTwin(name) }),
    trail: s.trail,
    window: s.window,
    ghost: s.ghost,
    triangle: s.triangle,
    weight: s.weight,
  };
}

// The masses' total, refused unless it is 1, as the engine refuses it.
export function massTotal(bodies: readonly ThreeBodyBody[]) {
  return bodies.reduce((t, b) => t + b.mass, 0);
}
export const massesTotalOne = (bodies: readonly ThreeBodyBody[]) =>
  Math.abs(massTotal(bodies) - 1) <= threeBodyLimits.massSlack;

// The sample at or before physical time t: playback, seeking and export
// select samples and never interpolate, so nothing reaches past the end.
export function sampleAt(p: ThreeBodyPrepared, t: number): number {
  if (p.available < 1) return -1;
  const span = p.times[p.times.length - 1] - p.times[0];
  const step = span / (p.times.length - 1);
  const k = Math.floor((t - p.times[0]) / step + 1e-9);
  return Math.max(0, Math.min(p.available - 1, k));
}
// The history's last time: its terminal state's, which an encounter or a
// spent budget puts before the duration.
export const endOf = (p: ThreeBodyPrepared) => p.final.time;
// Whether the terminal state lies beyond the last sample.
export const pastSamples = (p: ThreeBodyPrepared) =>
  p.available > 0 && p.final.time > p.times[p.available - 1];

// The study fields an engine refusal names, by the request's paths.
export function refusedField(path: string) {
  const m = /^bodies\.(\d)\.(mass|position|velocity)(?:\.(x|y))?$/.exec(path);
  if (m) return `${m[2]}-${m[1]}-${m[3] ?? "x"}`;
  return path === "duration"
    ? "duration"
    : path === "twin.size"
      ? "twin-size"
      : undefined;
}

// The other two bodies' shift when a twin keeps the center of mass or the
// momentum: −mᵢ·size/(mⱼ + mₖ) each, as engine/threebody.Twin applies it.
export function twinShift(bodies: readonly ThreeBodyBody[], w: ThreeBodyTwin) {
  if (!w.conserve) return 0;
  const others = bodies.reduce((t, b, j) => (j === w.body ? t : t + b.mass), 0);
  return (-bodies[w.body].mass * w.size) / others;
}
// The physical time the pair's clock runs to: the later of the two ends.
export const pairEnd = (h: ThreeBodyPrepared, twin?: ThreeBodyPrepared) =>
  twin ? Math.max(endOf(h), endOf(twin)) : endOf(h);

export const terminalText: Record<ThreeBodyTerminal["reason"], string> = {
  end: "reached the end",
  encounter: "stopped at a close encounter",
  unresolved: "stopped: the step could not be resolved",
  exhausted: "stopped: the step budget ran out",
  drift: "stopped: the energy error left its budget",
  nonfinite: "refused: the starting forces are not finite",
};

const L = threeBodyLimits;
export const threeBodyHelp = {
  configuration: tiered(
    "A sourced reference configuration; choosing one restores its whole initial state.",
    "Each is in the study's units: total mass 1 and G = 1, with the body farthest from the center of mass at distance 1. Periodicity, stability and what the integration observed are stated separately below.",
  ),
  units: tiered(
    "G = 1 and the masses total 1; nothing you enter is rescaled or recentered.",
    `Each mass is ${L.minMass}–1. Positions lie within ±${L.coordinate}, speeds are at most ${L.speed}, and no two bodies start closer than ${L.start}. A time unit is √(L³/GM) for the unit length L.`,
  ),
  mass: tiered(
    `A fraction of the total mass, ${L.minMass}–1; the three must total 1.`,
    "Changing one mass changes no other: a total other than 1 is refused under the mass just changed.",
  ),
  position: `Starting coordinate, within ±${L.coordinate}.`,
  velocity: `Starting velocity component; the speed is at most ${L.speed}.`,
  duration: tiered(
    `Physical time to integrate, up to ${L.duration} time units.`,
    `The history stops earlier if two bodies come within ${readout(L.floor)} of each other, if a step cannot be resolved, after ${formatCount(L.attempts)} attempted steps, or if the relative energy error passes ${readout(L.drift)}. Nothing continues past that.`,
  ),
  speed: tiered(
    `Time units per second of playback and of the movie: ${L.speeds[0]}–${L.speeds[1]}.`,
    "The motion runs once, from the start to the history's last state; a movie's length is the history's span divided by the speed, at most an hour.",
  ),
  trail: tiered(
    "Each body's path so far, whole or over a moving window.",
    "Trails are drawn through the history's samples and end at the shown moment.",
  ),
  window: `Trail length in time units: ${L.windows[0]}–${L.windows[1]}.`,
  ghost: "Draws each body's whole history faintly behind its trail.",
  triangle: "Joins the three bodies at the shown moment.",
  framing: tiered(
    "Fit the whole history, or only the close dance.",
    "The close dance fits the moments when every body is within 2 of the center of mass, so a body thrown far out leaves the frame instead of shrinking the rest. Either frame is fixed for the whole history.",
  ),
  progress:
    "Seek the motion by its physical time; the same time always shows the same sample.",
  twin: tiered(
    "Integrates a twin with one starting value moved, and draws both on one clock and frame.",
    "The twin is dashed, with hollow markers, in its body's ink. Its separation is the farthest any body is from its twin, compared only while both histories last.",
  ),
  twinBody: "The body whose starting value the twin moves.",
  twinComponent: "The position or velocity component moved.",
  twinSize: tiered(
    `How far the component moves, within ±${L.twin}; zero matches exactly.`,
    "In length units for a position and velocity units for a velocity. Nothing else changes, and nothing is renormalized afterward; a twin outside the starting limits is refused.",
  ),
  conserve: tiered(
    "Moves the other two bodies the opposite way, keeping the center of mass or momentum.",
    "Each moves by the perturbed body's mass times the size over their combined mass. Energy and angular momentum still change.",
  ),
};
