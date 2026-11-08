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
  "Close a drawn outline explicitly, or use your current closed base curve. Compare 2–16 Fourier terms and watch their rotating circles trace the fit. Use the example leaf or a mouse, pen, or finger. Capture stops at 4,096 points. Cancel keeps your study; adoption replaces it. Links preserve fitted terms, not the outline.",
);

export const fitSourceHelp = tiered(
  "Import a closed base curve without changing its model coordinates.",
  "Parametric, polar, roulette, Lissajous and Fourier curves only. Sampling permits 4,096 points and 32,768 evaluations, coordinates within ±100,000 and fitted radii up to 100,000. Open endpoints, gaps, jumps, lengths below 0.000001 and unresolved approximations are refused. Sampled chord tolerance differs from fit residuals. Arc-length parameterization preserves start and direction, but generally changes existing Fourier coefficients.",
);

export const fitTermsHelp = tiered(
  "Choose 2–16 terms, including the fixed translation.",
  "More terms recover finer detail. The first point fixes the phase origin; drawing direction is preserved. Samples are evenly spaced along the closed outline, so drawing slowly does not add weight.",
);

export const fitCorrectionHelp = tiered(
  "Move a point and its nearby arc, then refit the edited outline.",
  "Drag a point or select it. Arrows move 1% of the frame span; Shift moves 0.1%. Reach: 5%, 10% or 20% per direction. Keep 3–4,096 points (three distinct), length ≥0.000001, coordinates within ±100,000 and fitted radii ≤100,000. Undo retains the original and 32 edits, dropping oldest intermediate edits. Reference and history disappear on leaving.",
);

export const fitOutlineViewHelp = tiered(
  "Zoom for precise corrections; drag open space or use two fingers to pan.",
  "Drag open space to pan; pinch or Zoom in/out magnifies 1–32×. Two fingers pan anywhere; a second finger cancels the tentative edit. Lift both before correcting again. Plus/minus zoom; Home or Fit outline resets. The close-up stays through refits and undo. Model coordinates and the fitted preview stay intact.",
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
  outline?: FourierOutline;
  editedPoints?: Vec[];
  previewRadius?: number;
};
export type FourierOutline = {
  points: Vec[];
  tolerance: number;
  evaluations: number;
  closureTolerance: number;
  previewRadius: number;
};

const fittedOffset = 0.15;

export function curveFitUnavailable(study: PlanarStudy): string | undefined {
  if (study.config.input !== "curve")
    return "Use a direct base curve, not a derived input.";
  if (
    !["parametric", "polar", "roulette", "lissajous", "fourier"].includes(
      study.config.curve.format,
    )
  )
    return "Current-curve fitting accepts direct parametric, polar, roulette, Lissajous and Fourier curves. This source is unavailable; you can still draw an outline.";
}

// The fixed offset suits the drawing window and anything larger. An imported
// curve can be far smaller, where its normals would dwarf it, so below 2.4
// across it keeps the proportion a curve of that size has, as a short value.
function outlineOffset(outline?: FourierOutline) {
  if (!outline) return fittedOffset;
  const xs = outline.points.map((p) => p.x),
    ys = outline.points.map((p) => p.y);
  const across = Math.hypot(
    Math.max(...xs) - Math.min(...xs),
    Math.max(...ys) - Math.min(...ys),
  );
  return Math.min(fittedOffset, Number((across / 16).toPrecision(2)));
}

// A complete ordinary study, independent of the source's controls, camera,
// family, probe and animation. A short normal offset is hidden on opening;
// the base and its rotating circles lead. Motion remains explicitly opt-in.
export function fittedStudy(
  terms: Term[],
  distance = fittedOffset,
): PlanarStudy {
  const study = presetStudy(0);
  study.config = {
    ...study.config,
    kind: "offset",
    distance,
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

export type FourierCorrection = { index: number; target: Vec; reach: number };
export const maxOutlineEdits = 32;
export type OutlineEditing = {
  points: Vec[];
  original: Vec[];
  canUndo: boolean;
  canRedo: boolean;
  retained: number;
  changed: boolean;
};
export type FitState = {
  count: number;
  pending: boolean;
  fit?: FourierFitResult;
  frame?: Frame;
  error?: string;
  outline?: FourierOutline;
  editing?: OutlineEditing;
  fitEdited?: boolean;
  fitPoints?: Vec[];
};
type FitEngine = Pick<EngineClient, "fitFourier" | "compute" | "dispose">;

// Exactly one worker and one request at a time. Selection changes replace a
// single wanted count; the current worker caches only this stroke's fit. The
// stroke is resent until Go accepts it, since a refusal leaves no cached fit.
export class FourierFitSession {
  private generation = 0;
  private client: FitEngine | null = null;
  private stroke?: Vec[];
  private source?: Pick<PlanarStudy, "config" | "bounds">;
  private outline?: FourierOutline;
  private history: Vec[][] = [];
  private cursor = 0;
  private correction?: FourierCorrection;
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
    this.stroke = structuredClone(points);
    this.state = { count: this.wanted, pending: true };
    this.publish(this.state);
    void this.run();
  }
  useCurve(study: PlanarStudy) {
    this.cancel();
    this.client = this.factory();
    this.source = structuredClone({
      config: study.config,
      bounds: study.bounds,
    });
    this.state = { count: this.wanted, pending: true };
    this.publish(this.state);
    void this.run();
  }
  private changed() {
    const points = this.history[this.cursor],
      original = this.history[0];
    return (
      !!points &&
      (points.length !== original.length ||
        points.some((p, i) => p.x !== original[i].x || p.y !== original[i].y))
    );
  }
  private editing(): OutlineEditing | undefined {
    if (!this.history.length) return;
    return {
      points: structuredClone(this.history[this.cursor]),
      original: structuredClone(this.history[0]),
      canUndo: this.cursor > 0 || !!this.correction,
      canRedo: this.cursor < this.history.length - 1,
      retained: this.history.length,
      changed: this.changed(),
    };
  }
  private remember(points: Vec[]) {
    this.history = this.history.slice(0, this.cursor + 1);
    this.history.push(structuredClone(points));
    // Pin the original; discard the oldest intermediate edit at the cap.
    if (this.history.length > maxOutlineEdits + 1) this.history.splice(1, 1);
    this.cursor = this.history.length - 1;
  }
  private refit(points: Vec[], correction?: FourierCorrection) {
    this.generation++;
    this.client?.dispose();
    this.client = this.factory();
    this.running = false;
    this.source = undefined;
    this.stroke = structuredClone(points);
    this.correction = correction && structuredClone(correction);
    this.state = {
      ...this.state,
      count: this.wanted,
      pending: true,
      error: undefined,
      outline: this.outline,
      editing: this.editing(),
    };
    this.publish(this.state);
    void this.run();
  }
  correct(correction: FourierCorrection) {
    if (!this.history.length || this.state.pending) return;
    this.refit(this.history[this.cursor], correction);
  }
  undo() {
    if (!this.history.length) return;
    if (!this.correction && this.cursor > 0) this.cursor--;
    this.refit(this.history[this.cursor]);
  }
  redo() {
    if (this.cursor >= this.history.length - 1) return;
    this.refit(this.history[++this.cursor]);
  }
  restoreOriginal() {
    if (!this.history.length) return;
    this.remember(this.history[0]);
    this.refit(this.history[this.cursor]);
  }
  select(count: number) {
    if (!Number.isInteger(count) || count < 2 || count > 16) return;
    this.wanted = count;
    // Keep the last fitted drawing and its residuals together while the
    // replacement computes. candidate() still refuses pending adoption.
    this.state = {
      ...this.state,
      count,
      pending: !!this.client,
      error: undefined,
    };
    this.publish(this.state);
    if (this.client && !this.running) void this.run();
  }
  private async run() {
    const client = this.client,
      generation = this.generation;
    if (!client) return;
    this.running = true;
    try {
      while (generation === this.generation) {
        const count = this.wanted;
        try {
          const input = this.stroke;
          const correction = this.correction;
          const fit = await client.fitFourier(
            count,
            input,
            this.source,
            correction,
          );
          if (generation !== this.generation) return;
          if (!this.history.length && (fit.outline?.points || input)) {
            this.history = [structuredClone(fit.outline?.points ?? input!)];
            this.cursor = 0;
          }
          if (correction && fit.editedPoints) this.remember(fit.editedPoints);
          this.correction = undefined;
          this.stroke = undefined;
          this.source = undefined;
          this.outline ??= fit.outline;
          if (count !== this.wanted) continue;
          const study = fittedStudy(fit.terms, outlineOffset(this.outline));
          const frame = await client.compute(study.config, study.bounds);
          if (generation !== this.generation) return;
          if (count !== this.wanted) continue;
          this.state = {
            count,
            pending: false,
            fit,
            frame,
            outline: this.outline,
            editing: this.editing(),
            fitEdited: this.changed(),
            fitPoints: this.history.length
              ? structuredClone(this.history[this.cursor])
              : undefined,
          };
          this.publish(this.state);
          return;
        } catch (error) {
          if (generation !== this.generation) return;
          if (count !== this.wanted) continue;
          this.state = {
            ...this.state,
            count,
            pending: false,
            error: (error as Error).message,
            outline: this.outline,
            editing: this.editing(),
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
      ? fittedStudy(this.state.fit.terms, outlineOffset(this.outline))
      : null;
  }
  cancel() {
    this.generation++;
    this.client?.dispose();
    this.client = null;
    this.stroke = undefined;
    this.source = undefined;
    this.outline = undefined;
    this.history = [];
    this.cursor = 0;
    this.correction = undefined;
    this.running = false;
    this.state = { count: this.wanted, pending: false };
    this.publish(this.state);
  }
}
