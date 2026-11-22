// Scan for changes: an implicit study scanned along its level or shape
// parameter for places where the mesh's reading changes (engine3/scan.go;
// docs/mathematics.md, Scanning for topology changes). One scan at a time,
// in a worker of its own. Nothing of a scan enters a link, history or
// export.
import { EngineClient } from "../engine-client";
import { count, plural, readout } from "../number-format";
import type { ImplicitConfig } from "./types";

// The request and its reply, as engine3 defines them.
export type ScanAxis = "level" | "a";
export type ScanRequest = {
  implicit: ImplicitConfig;
  axis: ScanAxis;
  from: number;
  to: number;
  samples: number;
  depth: number;
  recheck: boolean;
  critical: boolean;
};
export type ScanMessage = { start: ScanRequest } | { step: true };
export type ScanReading = {
  status: "complete" | "cut" | "incomplete" | "refused";
  pieces: number[];
  cut: number[];
  why?: string;
  singular: number;
  triangles: number;
};
export type ScanSample = {
  value: number;
  coarse: boolean;
  reading: ScanReading;
};
export type ScanRecheck = {
  cells: number;
  lo: number;
  hi: number;
  before: ScanReading;
  after: ScanReading;
  depth: number;
  outcome:
    | "pending"
    | "agrees"
    | "below"
    | "above"
    | "differs"
    | "unresolved"
    | "skipped";
};
export type ScanCritical = {
  value: number;
  index: number;
  points: number;
  at: { x: number; y: number; z: number };
};
export type ScanCandidate = {
  lo: number;
  hi: number;
  before: ScanReading;
  after: ScanReading;
  kind: "change" | "box" | "unresolved" | "singular";
  through?: ScanSample;
  depth: number;
  singular: number[];
  lattice?: ScanRecheck;
  finer?: ScanRecheck;
  stability: "stable" | "unstable" | "unchecked";
  spread: [number, number];
  // Null when the search was not made, and empty when it found none.
  critical: ScanCritical[] | null;
  // A merged box interval's count of the box candidates it holds.
  merged?: number;
};
export type ScanResult = {
  axis: ScanAxis;
  from: number;
  to: number;
  samples: ScanSample[];
  candidates: ScanCandidate[];
  calls: number;
  cells: number;
  stop: "running" | "complete" | "calls" | "cells" | "canceled";
  unresolved: number;
  singular: number;
  // Bisection stopped short of its depth to keep room for the rechecks.
  curtailed: boolean;
};
// The engine's limits (engine3/scan.go).
export const scanLimits = {
  samples: [3, 65],
  depth: [0, 12],
  calls: 1024,
  cells: 64_000_000,
} as const;

export type ScanState =
  | { status: "idle" }
  | {
      status: "running" | "done" | "canceled";
      request: ScanRequest;
      result: ScanResult | null;
      // Milliseconds since the scan started, and until it stopped.
      elapsed: number;
    }
  | { status: "failed"; request: ScanRequest; message: string; field?: string };

// One scan at a time, each in its own worker, stepped one mesher call at a
// time. Cancel closes the worker at once; a reply for an earlier scan is
// dropped. Nothing here enters a link.
export class ScanSession {
  private client: EngineClient | null = null;
  private generation = 0;
  private last: ScanState = { status: "idle" };
  constructor(private onChange: (state: ScanState) => void) {}
  private set(state: ScanState) {
    this.last = state;
    this.onChange(state);
  }
  async start(request: ScanRequest) {
    this.close();
    const generation = ++this.generation;
    const client = (this.client = new EngineClient());
    const started = performance.now();
    const current = () => generation === this.generation;
    this.set({ status: "running", request, result: null, elapsed: 0 });
    try {
      let result = await client.implicitScan({ start: request });
      while (current() && result.stop === "running") {
        this.set({
          status: "running",
          request,
          result,
          elapsed: performance.now() - started,
        });
        result = await client.implicitScan({ step: true });
      }
      if (!current()) return;
      this.set({
        status: "done",
        request,
        result,
        elapsed: performance.now() - started,
      });
    } catch (e) {
      if (!current()) return;
      const error = e as Error & { field?: string };
      this.set({
        status: "failed",
        request,
        message: error.message,
        field: error.field,
      });
    } finally {
      if (current()) this.close();
    }
  }
  // Stops the scan, keeping what it found so far.
  cancel() {
    if (this.last.status !== "running") return;
    const { request, result, elapsed } = this.last;
    this.generation++;
    this.close();
    this.set({ status: "canceled", request, result, elapsed });
  }
  // Forgets the scan, as when the study changes.
  clear() {
    this.generation++;
    this.close();
    if (this.last.status !== "idle") this.set({ status: "idle" });
  }
  dispose() {
    this.generation++;
    this.close();
  }
  private close() {
    this.client?.dispose();
    this.client = null;
  }
}

// What a reading shows, as a noun phrase: "one closed piece of χ 2",
// "eight closed pieces of χ 2 and one cut piece of χ −22", or why it
// shows nothing to compare.
export function describeReading(r: ScanReading): string {
  if (r.status === "refused") return "refused by the mesher";
  if (r.status === "incomplete")
    return {
      open: "incomplete: cells left out",
      poles: "incomplete: a pole or jump",
      refinement: "incomplete: refinement ran out",
      crossings: "incomplete: crossings not meshed",
      "one-sided": "incomplete: one-sided",
    }[r.why ?? "open"]!;
  const groups = (pieces: number[], kind: string) => {
    const by = new Map<number, number>();
    for (const e of pieces) by.set(e, (by.get(e) ?? 0) + 1);
    return [...by].map(
      ([e, n]) =>
        `${plural(n, `${kind} piece`, `${kind} pieces`)} of χ ${count(e)}`,
    );
  };
  const parts = [...groups(r.pieces, "closed"), ...groups(r.cut, "cut")];
  return parts.length ? parts.join(" and ") : "no surface";
}

// The value of the axis, as text: "c = −12.5" or "a = 1".
export const axisValue = (axis: ScanAxis, v: number) =>
  `${axis === "level" ? "c" : "a"}\u00a0=\u00a0${readout(v)}`;

// The critical value that leads a candidate: the one nearest its spread,
// and of those the one found at most points.
export function leadingCritical(c: ScanCandidate): ScanCritical | undefined {
  const off = (k: ScanCritical) =>
    Math.max(0, c.spread[0] - k.value, k.value - c.spread[1]);
  return [...(c.critical ?? [])].sort(
    (a, b) => off(a) - off(b) || b.points - a.points,
  )[0];
}

// A Morse index, read as the event it makes when the level passes it.
export function indexName(axis: ScanAxis, k: ScanCritical): string {
  if (k.index < 0) return "degenerate";
  if (axis === "a") return `index ${count(k.index)}`;
  return k.index === 0
    ? "index 0, a minimum"
    : k.index === 3
      ? "index 3, a maximum"
      : `index ${count(k.index)}, a saddle`;
}

// A candidate's headline: its critical point when one was found, else what
// kind of change, near where.
export function candidateTitle(axis: ScanAxis, c: ScanCandidate): string {
  const lead = leadingCritical(c);
  if (lead && c.kind !== "unresolved")
    return `Critical point at ${axisValue(axis, lead.value)}`;
  const near = axisValue(axis, (c.spread[0] + c.spread[1]) / 2);
  switch (c.kind) {
    case "change":
      return `Change near ${near}`;
    case "box":
      return c.merged
        ? `${count(c.merged)} box cuts near ${near}`
        : `Box cut near ${near}`;
    case "singular":
      return `Singular sample at ${axisValue(axis, c.through!.value)}`;
    case "unresolved":
      return `Unresolved near ${near}`;
  }
}

export const stabilityText: Record<ScanCandidate["stability"], string> = {
  stable: "On all three grids",
  unstable: "Not the same on every grid",
  unchecked: "Not rechecked",
};

const recheckText: Record<ScanRecheck["outcome"], string> = {
  pending: "pending",
  agrees: "the same change",
  below: "the change lies lower",
  above: "the change lies higher",
  differs: "reads differently",
  unresolved: "incomplete",
  skipped: "skipped at the work limit",
};

const between = (axis: ScanAxis, lo: number, hi: number) =>
  `${axisValue(axis, lo)} and ${readout(hi)}`;

// A candidate's note in two tiers: what changed and where, then how the
// grids saw it.
export function candidateNote(
  axis: ScanAxis,
  c: ScanCandidate,
): { brief: string; more: string } {
  const change = `${describeReading(c.before)} → ${describeReading(c.after)}`;
  const spread = between(axis, c.spread[0], c.spread[1]);
  const lead = leadingCritical(c);
  const more: string[] = [];
  let brief: string;
  switch (c.kind) {
    case "unresolved":
      brief = c.through
        ? `${change}, through a sample at ${axisValue(axis, c.through.value)} whose mesh is ${describeReading(c.through.reading)}: no change is claimed.`
        : `${change}: an incomplete mesh shows no topology to compare.`;
      break;
    case "singular":
      brief = `Reads ${describeReading(c.through!.reading)}, with vertices where ∇F vanishes, between samples that read ${describeReading(c.before)}.`;
      break;
    default:
      brief = c.merged
        ? `${change} through ${count(c.merged)} changes the grids do not agree on, between ${spread}.`
        : `${change}, between ${spread}.`;
  }
  if (lead && c.kind !== "unresolved") {
    const others = (c.critical ?? []).filter((k) => k !== lead);
    more.push(
      `The critical point, ${indexName(axis, lead)}, ${lead.points > 1 ? `found at ${count(lead.points)} points` : "found at one point"} by Newton's method: numerical evidence, not a certificate.`,
    );
    if (others.length)
      more.push(
        `Also near: ${others.map((k) => `${axisValue(axis, k.value)} (${indexName(axis, k)})`).join("; ")}.`,
      );
  } else if (c.critical && c.kind !== "unresolved")
    more.push("No critical point was found near it.");
  if (c.merged)
    more.push(
      "Merged: each was unstable, with no critical point beside it, as where the box cuts a band thinner than a cell.",
    );
  if (c.kind === "change" || c.kind === "box") {
    if (!c.merged) {
      const own = between(axis, c.lo, c.hi);
      more.push(
        `On this grid between ${own}, after ${plural(c.depth, "bisection", "bisections")}.`,
      );
    }
    const rechecks = [c.lattice, c.finer]
      .filter((r): r is ScanRecheck => !!r)
      .map((r) => `${count(r.cells)} cells, ${recheckText[r.outcome]}`);
    if (rechecks.length) more.push(`Rechecked on ${rechecks.join("; ")}.`);
  }
  if (c.through && c.kind === "change")
    more.push(
      `Through a sample at ${axisValue(axis, c.through.value)} that reads ${describeReading(c.through.reading)}, with vertices where ∇F vanishes.`,
    );
  return { brief, more: more.join(" ") };
}

export function stopText(r: ScanResult): string {
  switch (r.stop) {
    case "running":
      return "Scanning";
    case "complete":
      return "Scan complete";
    case "calls":
      return `Stopped at the limit of ${count(scanLimits.calls)} meshes`;
    case "cells":
      return `Stopped at the limit of ${count(scanLimits.cells)} cells meshed`;
    case "canceled":
      return "Canceled";
  }
}
