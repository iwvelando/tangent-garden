// #552 research: the planar three-body history (engine/threebody), shown
// only with ?research=552. Nothing here is a public contract yet; T2 (#553)
// settles the study, its link and its exports.
import type { Vec } from "../types";

export const researchThreeBody = () =>
  typeof location !== "undefined" &&
  new URLSearchParams(location.search).getAll("research").includes("552");

export type ThreeBodyBody = { mass: number; position: Vec; velocity: Vec };
export type ThreeBodyRequest = {
  bodies: ThreeBodyBody[];
  duration: number;
  samples: number;
};
export type ThreeBodyCase = {
  name: string;
  title: string;
  source: string;
  bodies: ThreeBodyBody[];
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

// The sample at or before physical time t: playback, seeking and export
// select samples and never interpolate, so nothing reaches past the end.
export function sampleAt(p: ThreeBodyPrepared, t: number): number {
  if (p.available < 1) return -1;
  const span = p.times[p.times.length - 1] - p.times[0];
  const step = span / (p.times.length - 1);
  const k = Math.floor((t - p.times[0]) / step + 1e-9);
  return Math.max(0, Math.min(p.available - 1, k));
}
