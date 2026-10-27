import { EngineError, type EngineClient } from "./engine-client";
import type { PlanarStudy } from "./planar-link";
import { refineBudget } from "./refinement";
import type { Config, Frame, ViewRect } from "./types";
import { parameterAt } from "./planar-probe";
import { tiered } from "./help";

export type AtlasRanges = { radius: [number, number]; arm: [number, number] };
export const atlasRangeHelp =
  "Constant expressions; endpoints must be finite and increasing.";
export const atlasEntryHelp = tiered(
  "Compare nearby parameter choices for supported definitions.",
  "Supported definitions: Roulette, rolling inside or outside a fixed circle or along a line. Try Hypotrochoid & its evolute. Up to 8,000 samples and 256 construction lines per study; refinement, stacks and composed constructions have additional work limits.",
);
export type AtlasCell = {
  radius: number;
  arm: number;
  frame?: Frame;
  error?: string;
};
export type AtlasState = {
  cells: AtlasCell[];
  selection: { index: number; frame?: Frame; error?: string } | null;
  queued: number;
  error?: string;
  // The worker failed; nothing more can be calculated in this excursion.
  failed?: string;
};

export function atlasDefaults(config: Config): AtlasRanges {
  const { radius, arm } = config.curve.roulette;
  // Very small and near-limit values still need distinct, accepted scalar
  // endpoints. Engine-invalid combinations remain cells, never clamped.
  const range = (v: number): [number, number] => {
    if (v === 0) return [0, radius];
    const from = Math.max(Number.MIN_VALUE, v * 0.75);
    return [from, Math.max(v * 1.25, from + Number.MIN_VALUE)];
  };
  return { radius: range(radius), arm: range(arm) };
}

// Reservation for nine results and one independently calculated inspection.
// Count all generated paths, even hidden layers; refinement has a separate
// per-path budget. Weight nested stencils and integrated constructions rather
// than treating a composed study as a cheap roulette evaluation.
export function atlasBudget(config: Config) {
  const family =
    config.kind === "offset" && config.stack.enabled
      ? config.stack.count
      : config.kind === "envelope" && config.envelope.mode === "circle"
        ? 2
        : 0;
  const paths = 2 + (config.input === "curve" ? 0 : 1) + family;
  const points =
    10 * paths * (config.samples + (config.adaptive ? refineBudget : 0));
  const integrated = config.kind === "rolling" || config.kind === "involute";
  const stencil = config.input === "curve" ? 9 : 81;
  const work =
    points *
    stencil *
    (config.adaptive ? 8 : 1) *
    (integrated ? 16 : 1) *
    (config.adaptive && config.adaptiveFrame ? 2 : 1);
  const error =
    config.curve.format !== "roulette"
      ? "The parameter atlas is available for roulette curves. Your study is kept."
      : points > 500000 ||
          work > 80000000 ||
          config.samples * 10 > 80000 ||
          config.lines * 10 > 2560
        ? "This study exceeds the atlas work limit. Reduce samples, construction lines, stack members, or refinement in your study, then try again."
        : undefined;
  return { points, work, error };
}

export function atlasRangeError(ranges: AtlasRanges) {
  for (const [key, name] of [
    ["radius", "Rolling radius"],
    ["arm", "Tracing distance"],
  ] as const) {
    const [from, to] = ranges[key];
    if (!Number.isFinite(from))
      return {
        label: `${name} from`,
        message: `${name} from must be a finite constant.`,
      };
    if (!Number.isFinite(to) || to <= from)
      return {
        label: `${name} to`,
        message: `${name} to must be finite and greater than ${name.toLowerCase()} from.`,
      };
  }
  return null;
}

// A midpoint within rounding of the frozen value is that value, so a range
// symmetric about it (as the defaults are) centers on the study itself.
const axis = ([a, b]: [number, number], current: number) => {
  const middle = a / 2 + b / 2;
  return [
    a,
    Math.abs(middle - current) <= Number.EPSILON * Math.abs(current)
      ? current
      : middle,
    b,
  ];
};
const maxNumbers = 4000000;
// Bound delivered geometry as well as the preflight reservation: a result
// includes diagnostics, representative circles and refinement breaks too.
function numbers(value: unknown): number {
  if (typeof value === "number") return 1;
  if (!value || typeof value !== "object") return 0;
  return Object.values(value).reduce<number>((n, v) => n + numbers(v), 0);
}

/** One caller-owned worker, one numerical request, nine grid outcomes and one
 * inspection. A generation invalidates delivery, not just what is painted.
 * A selection has priority over unsent cells; repeated selections coalesce.
 */
export class RouletteAtlas {
  state: AtlasState = { cells: [], selection: null, queued: 0 };
  private source: PlanarStudy | null = null;
  private generation = 0;
  private choice = 0;
  private working = false;
  private failed?: string;
  private remaining: number[] = [];
  private wanted: { index: number; choice: number; view?: ViewRect } | null =
    null;
  private retained = new Map<number, number>();
  constructor(
    private engine: Pick<EngineClient, "compute"> &
      Partial<Pick<EngineClient, "dispose">>,
    private changed: (state: AtlasState) => void,
  ) {}
  private emit() {
    this.state = {
      ...this.state,
      queued: this.remaining.length + (this.wanted ? 1 : 0),
    };
    this.changed(this.state);
  }
  cancel() {
    this.generation++;
    this.choice++;
    this.remaining = [];
    this.wanted = null;
    this.source = null;
    this.retained.clear();
    this.state = {
      cells: [],
      selection: null,
      queued: 0,
      ...(this.failed && { error: this.failed, failed: this.failed }),
    };
    this.emit();
  }
  generate(study: PlanarStudy, ranges: AtlasRanges) {
    this.cancel();
    const error =
      this.failed ??
      atlasBudget(study.config).error ??
      atlasRangeError(ranges)?.message;
    if (error) {
      this.state = { ...this.state, error };
      this.emit();
      return;
    }
    this.source = structuredClone(study);
    this.state = {
      cells: axis(ranges.arm, study.config.curve.roulette.arm).flatMap((arm) =>
        axis(ranges.radius, study.config.curve.roulette.radius).map(
          (radius) => ({ radius, arm }),
        ),
      ),
      selection: null,
      queued: 0,
    };
    this.remaining = this.state.cells.map((_, i) => i);
    this.emit();
    this.pump();
  }
  inspect(index: number, view?: ViewRect) {
    const cell = this.state.cells[index];
    if (!cell?.frame || !this.source) return;
    this.wanted = { index, choice: ++this.choice, view };
    this.state = { ...this.state, selection: { index } };
    this.retained.delete(-1);
    this.emit();
    this.pump();
  }
  candidate(): PlanarStudy | null {
    const selection = this.state.selection;
    if (!selection?.frame || !this.source) return null;
    return this.variant(selection.index);
  }
  private variant(index: number) {
    const study = structuredClone(this.source!);
    const { radius, arm } = this.state.cells[index];
    study.config.curve.roulette = {
      ...study.config.curve.roulette,
      radius,
      arm,
    };
    return study;
  }
  private pump() {
    if (this.working || !this.source) return;
    const selection = this.wanted;
    const index = selection?.index ?? this.remaining.shift();
    if (index === undefined) return;
    this.wanted = null;
    const generation = this.generation;
    const study = this.variant(index);
    const resolved = this.state.cells[index].frame?.config ?? study.config;
    this.working = true;
    this.emit();
    const current = () =>
      generation === this.generation &&
      (!selection || selection.choice === this.choice);
    const refuse = (message: string) => {
      if (selection)
        this.state = { ...this.state, selection: { index, error: message } };
      else
        this.state = {
          ...this.state,
          cells: this.state.cells.map((cell, i) =>
            i === index ? { ...cell, error: message } : cell,
          ),
        };
    };
    void this.engine
      .compute(study.config, study.bounds, {
        diagnostics: study.probe.enabled,
        ...(selection &&
          study.probe.enabled &&
          study.probe.between && {
            probe: {
              t: parameterAt(
                resolved.curve.min,
                resolved.curve.max,
                study.probe.position,
              ),
            },
          }),
        ...(selection?.view && { view: selection.view }),
      })
      .then(
        (frame) => {
          if (!current()) return;
          const count = numbers(frame.result);
          const total =
            [...this.retained.values()].reduce((a, b) => a + b, 0) + count;
          if (total > maxNumbers) {
            refuse(
              "The atlas geometry limit was reached. Reduce the study’s quality and try again.",
            );
            return;
          }
          this.retained.set(selection ? -1 : index, count);
          // Ownership crosses this boundary once; no result or caller-supplied
          // config can mutate another candidate or the frozen source.
          const own = structuredClone(frame);
          if (selection)
            this.state = { ...this.state, selection: { index, frame: own } };
          else
            this.state = {
              ...this.state,
              cells: this.state.cells.map((cell, i) =>
                i === index ? { ...cell, frame: own } : cell,
              ),
            };
        },
        (error: Error) => {
          // Go refuses a cell with an EngineError. Anything else is the worker
          // failing: a request deadline does not stop synchronous Go work, so
          // never send another cell behind that computation, even after
          // regeneration.
          if (!(error instanceof EngineError)) {
            this.failed = `The atlas’s numerical engine stopped: ${error.message} Close the atlas and reopen it to continue.`;
            this.remaining = [];
            this.wanted = null;
            this.source = null;
            // Reported even when an edit already canceled this generation.
            this.state = {
              ...this.state,
              selection: null,
              error: this.failed,
              failed: this.failed,
            };
            this.emit();
            this.engine.dispose?.();
            return;
          }
          if (current()) refuse(error.message);
        },
      )
      .finally(() => {
        this.working = false;
        if (current()) this.emit();
        this.pump();
      });
  }
}
