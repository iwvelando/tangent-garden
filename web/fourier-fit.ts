import type { EngineClient } from "./engine-client";
import {
  defaultAnimation,
  defaultLayers,
  presetStudy,
  type PlanarStudy,
} from "./planar-link";
import type { Frame, Term, Vec } from "./types";
import { tiered } from "./help";

export const fitEntryHelp = tiered(
  "Draw any shape as one outline, then turn it into an editable study.",
  "Close the outline explicitly, then compare 2–16 Fourier terms and watch their rotating circles trace the fit. Use the example leaf or draw with a mouse, pen, or finger. Capture stops at 4,096 points. Cancel keeps your original study; adoption replaces it. Links preserve fitted terms, not the raw stroke.",
);

export const fitTermsHelp = tiered(
  "Choose 2–16 terms, including the fixed translation.",
  "More terms recover finer detail. The first point fixes the phase origin; drawing direction is preserved. Samples are evenly spaced along the closed outline, so drawing slowly does not add weight.",
);

export const maxStrokePoints = 4096;
// Equal scale in the 1000 × 760 input rectangle; x right, y up.
export const strokeWindow = { width: 6, height: 4.56 };
// An authored single outline, available without a pointing device.
export const sampleLeaf: Vec[] = [
  { x: -1.9, y: -1.35 },
  { x: -1.65, y: -0.65 },
  { x: -1.7, y: -0.3 },
  { x: -1.35, y: -0.18 },
  { x: -1.4, y: 0.2 },
  { x: -0.98, y: 0.27 },
  { x: -1.02, y: 0.65 },
  { x: -0.57, y: 0.66 },
  { x: -0.55, y: 1.02 },
  { x: -0.12, y: 0.97 },
  { x: 0.05, y: 1.34 },
  { x: 0.4, y: 1.19 },
  { x: 0.74, y: 1.49 },
  { x: 1, y: 1.3 },
  { x: 1.8, y: 1.55 },
  { x: 1.55, y: 0.8 },
  { x: 1.69, y: 0.5 },
  { x: 1.37, y: 0.26 },
  { x: 1.5, y: -0.05 },
  { x: 1.12, y: -0.18 },
  { x: 1.16, y: -0.53 },
  { x: 0.74, y: -0.53 },
  { x: 0.65, y: -0.87 },
  { x: 0.22, y: -0.71 },
  { x: 0.03, y: -1.03 },
  { x: -0.4, y: -0.81 },
  { x: -0.62, y: -1.07 },
  { x: -1.1, y: -0.85 },
  { x: -1.64, y: -1.48 },
];
export type FourierFitResult = {
  terms: Term[];
  rms: number;
  maxResidual: number;
  sampleCount: number;
  length: number;
};

// A complete ordinary study, independent of the source's controls, camera,
// family, probe and animation. A short normal offset is hidden on opening;
// the base and its rotating circles lead. Motion remains explicitly opt-in.
export function fittedStudy(terms: Term[]): PlanarStudy {
  const study = presetStudy(0);
  study.config = {
    ...study.config,
    kind: "offset",
    distance: 0.15,
    stack: { ...study.config.stack, enabled: false },
    circles: false,
    input: "curve",
    curve: {
      ...study.config.curve,
      format: "fourier",
      min: 0,
      max: 2 * Math.PI,
      terms: structuredClone(terms),
    },
    inversion: { center: { x: 0, y: 0 }, radius: 2 },
    samples: 1025,
    lines: 48,
    adaptive: true,
    adaptiveView: false,
  };
  study.bounds = { min: "0", max: "2*pi" };
  study.layers = { ...defaultLayers, derived: false };
  study.animation = { ...structuredClone(defaultAnimation), duration: 10 };
  delete study.family;
  return study;
}

export type FitState = {
  count: number;
  pending: boolean;
  fit?: FourierFitResult;
  frame?: Frame;
  error?: string;
};
type FitEngine = Pick<EngineClient, "fitFourier" | "compute" | "dispose">;

// Exactly one worker and one request at a time. Selection changes replace a
// single wanted count; the current worker caches only this stroke's fit.
export class FourierFitSession {
  private generation = 0;
  private client: FitEngine | null = null;
  private wanted = 8;
  private state: FitState = { count: 8, pending: false };
  private running = false;
  constructor(
    private factory: () => FitEngine,
    private publish: (state: FitState) => void,
  ) {}
  close(points: Vec[]) {
    this.cancel();
    this.client = this.factory();
    this.state = { count: this.wanted, pending: true };
    this.publish(this.state);
    void this.run(points);
  }
  select(count: number) {
    if (!Number.isInteger(count) || count < 2 || count > 16) return;
    this.wanted = count;
    this.state = { count, pending: !!this.client };
    this.publish(this.state);
    if (this.client && !this.running) void this.run();
  }
  private async run(points?: Vec[]) {
    const client = this.client,
      generation = this.generation;
    if (!client) return;
    this.running = true;
    try {
      while (generation === this.generation) {
        const count = this.wanted;
        try {
          const fit = await client.fitFourier(count, points);
          points = undefined;
          if (generation !== this.generation) return;
          if (count !== this.wanted) continue;
          const study = fittedStudy(fit.terms);
          const frame = await client.compute(study.config, study.bounds);
          if (generation !== this.generation) return;
          if (count !== this.wanted) continue;
          this.state = { count, pending: false, fit, frame };
          this.publish(this.state);
          return;
        } catch (error) {
          if (generation !== this.generation) return;
          if (count !== this.wanted) continue;
          this.state = {
            count,
            pending: false,
            error: (error as Error).message,
          };
          this.publish(this.state);
          return;
        }
      }
    } finally {
      if (generation === this.generation) this.running = false;
    }
  }
  candidate(): PlanarStudy | null {
    return !this.state.pending &&
      this.state.frame &&
      this.state.fit &&
      !this.state.error
      ? fittedStudy(this.state.fit.terms)
      : null;
  }
  cancel() {
    this.generation++;
    this.client?.dispose();
    this.client = null;
    this.running = false;
    this.state = { count: this.wanted, pending: false };
    this.publish(this.state);
  }
}
