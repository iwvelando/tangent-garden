// Issue #406's research preview: with ?research=406 in the address, an
// implicit study can be scanned along its level or shape parameter for
// places where the mesh's reading changes (engine3/scan.go). Without it
// nothing here changes the app, its links or its gallery. Not a public
// feature: it does not merge as is.
import { EngineClient } from "../engine-client";
import { count, plural, readout } from "../number-format";
import type { ImplicitConfig } from "./types";

export { eventScan } from "./research";

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
  critical?: ScanCritical[];
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
  `${axis === "level" ? "c" : "a"} = ${readout(v)}`;

// A candidate's headline: what kind of change, near where.
export function candidateTitle(axis: ScanAxis, c: ScanCandidate): string {
  const near = axisValue(axis, (c.spread[0] + c.spread[1]) / 2);
  switch (c.kind) {
    case "change":
      return `Change near ${near}`;
    case "box":
      return `Box cut near ${near}`;
    case "singular":
      return `Singular sample at ${axisValue(axis, c.through!.value)}`;
    case "unresolved":
      return `Unresolved near ${near}`;
  }
}

export const stabilityText: Record<ScanCandidate["stability"], string> = {
  stable: "Found on all three grids",
  unstable: "Not found the same way on every grid",
  unchecked: "Not rechecked",
};

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
