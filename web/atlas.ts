import { EngineError, type EngineClient } from "./engine-client";
import type { PlanarStudy } from "./planar-link";
import { refineBudget } from "./refinement";
import {
  refinesBetweenSamples,
  usesPole,
  type Config,
  type Frame,
  type ViewRect,
} from "./types";
import { parameterAt } from "./planar-probe";
import { tiered } from "./help";

export type AtlasSize = 3 | 5;
const atlasSizeKey = "tangent-garden.atlas-size";
let sizeMemory: AtlasSize = 3;
let sizeLoaded = false;
// A presentation preference, independent of any source study or excursion.
export function atlasGridSize(): AtlasSize {
  if (!sizeLoaded) {
    sizeLoaded = true;
    try {
      sizeMemory = localStorage.getItem(atlasSizeKey) === "5" ? 5 : 3;
    } catch {
      /* Keep the page's preference when browser storage is unavailable. */
    }
  }
  return sizeMemory;
}
export function rememberAtlasGridSize(size: AtlasSize) {
  sizeMemory = size;
  sizeLoaded = true;
  try {
    localStorage.setItem(atlasSizeKey, String(size));
  } catch {
    /* Subsequent excursions still use sizeMemory. */
  }
}
export type AtlasPairId = "roulette" | "pole" | "clifford";
export type AtlasRanges = Record<string, [number, number]>;
export type AtlasOptions = { pair?: AtlasPairId; size?: AtlasSize };
type Axis = {
  key: string;
  label: string;
  symbol: string;
  path: readonly string[];
};
export type AtlasPair = {
  id: AtlasPairId;
  label: string;
  axes: readonly [Axis, Axis];
  supports: (config: Config) => boolean;
  ranges: (config: Config) => AtlasRanges;
};

// The catalog owns applicability, request paths, labels and defaults.
// No descriptor switches a study's definition or construction to make it fit.
const positiveRange = (v: number, radius: number): [number, number] => {
  if (v === 0) return [0, radius];
  const from = Math.max(Number.MIN_VALUE, v * 0.75);
  return roundedRange(
    from,
    Math.max(v * 1.25, from + Number.MIN_VALUE),
    Math.abs(v),
  );
};
const around = (v: number, least: number): [number, number] => {
  const d = Math.max(Math.abs(v) * 0.25, least);
  return roundedRange(v - d, v + d, Math.max(Math.abs(v), d));
};
const catalog: readonly AtlasPair[] = [
  {
    id: "roulette",
    label: "Roulette radius / tracing distance",
    axes: [
      {
        key: "radius",
        label: "Rolling radius",
        symbol: "r",
        path: ["curve", "roulette", "radius"],
      },
      {
        key: "arm",
        label: "Tracing distance",
        symbol: "d",
        path: ["curve", "roulette", "arm"],
      },
    ],
    supports: (c) => c.curve.format === "roulette",
    ranges: (c) => ({
      radius: positiveRange(c.curve.roulette.radius, c.curve.roulette.radius),
      arm: positiveRange(c.curve.roulette.arm, c.curve.roulette.radius),
    }),
  },
  {
    id: "pole",
    label: "Pedal pole x / y",
    axes: [
      { key: "x", label: "Pole x", symbol: "x", path: ["pole", "x"] },
      { key: "y", label: "Pole y", symbol: "y", path: ["pole", "y"] },
    ],
    supports: (c) =>
      !["implicit", "attractor"].includes(c.curve.format) &&
      (usesPole(c.kind) || usesPole(c.input)),
    ranges: (c) => ({ x: around(c.pole.x, 1), y: around(c.pole.y, 1) }),
  },
  {
    id: "clifford",
    label: "Clifford coefficients a / b",
    axes: [
      {
        key: "a",
        label: "Coefficient a",
        symbol: "a",
        path: ["curve", "attractor", "a"],
      },
      {
        key: "b",
        label: "Coefficient b",
        symbol: "b",
        path: ["curve", "attractor", "b"],
      },
    ],
    supports: (c) =>
      c.curve.format === "attractor" && c.curve.attractor.map === "clifford",
    ranges: (c) => ({
      a: around(c.curve.attractor.a, 0.25),
      b: around(c.curve.attractor.b, 0.25),
    }),
  },
];
export const atlasPairs = (config: Config) =>
  catalog.filter((p) => p.supports(config));
export const atlasPair = (id: AtlasPairId) => catalog.find((p) => p.id === id)!;
export const atlasControlHelp = {
  pair: "Only pairs used by your current study are offered.",
  size: "Includes both range endpoints.",
  framing: "Compare shapes separately or at one scale.",
};
export const atlasRangeHelp =
  "Constant expressions; endpoints must be finite and increasing.";
export const atlasEntryHelp = tiered(
  "Compare nearby parameter choices for supported definitions.",
  "Supported definitions: Roulette inside/outside a circle or along a line; a pedal-family pole in use; Clifford map coefficients. Curves allow 8,000 samples and 256 lines; refinement, families and integration have work limits. Previews cap quality; inspection restores it. Clifford grids allow 20 million evaluated iterations and two million density bins in total.",
);
export type AtlasCell = {
  values: [number, number];
  frame?: Frame;
  error?: string;
};
export type AtlasState = {
  cells: AtlasCell[];
  selection: { index: number; frame?: Frame; error?: string } | null;
  queued: number;
  error?: string;
  failed?: string;
};
// Remove only rounding-sized tails in generated values. Carry the operand
// scale: cancellation in 1.15 - 1 leaves more uncertainty than epsilon times
// its small result. Interpolation uses its endpoint scale for the same reason.
// Never apply this to the source, copied/entered endpoints, or raw scalar text.
export function roundedGenerated(value: number, scale: number) {
  if (!Number.isFinite(value) || value === 0) return value;
  for (let digits = 1; digits <= 16; digits++) {
    const short = Number(value.toPrecision(digits));
    if (
      Number.isFinite(short) &&
      Math.abs(short - value) <=
        Number.EPSILON * Math.max(Math.abs(value), scale)
    )
      return short;
  }
  return value;
}
function roundedRange(
  from: number,
  to: number,
  scale: number,
): [number, number] {
  const cleaned: [number, number] = [
    roundedGenerated(from, scale),
    roundedGenerated(to, scale),
  ];
  // Do not collapse distinct subnormal endpoints or repair an invalid range.
  return cleaned[0] < cleaned[1] ? cleaned : [from, to];
}
export function atlasDefaults(
  config: Config,
  pair = atlasPairs(config)[0]?.id ?? "roulette",
): AtlasRanges {
  return atlasPair(pair).ranges(config);
}
export function atlasPreviewConfig(config: Config, size: AtlasSize): Config {
  const preview = structuredClone(config);
  preview.lines = Math.min(config.lines, size === 3 ? 128 : 64);
  if (config.curve.format === "attractor") {
    const a = preview.curve.attractor;
    a.iterates = Math.min(a.iterates, 50000);
    a.discard = Math.min(a.discard, 1000);
    a.cells = Math.min(a.cells, 128);
  } else {
    preview.samples = Math.min(config.samples, size === 3 ? 2000 : 1000);
    // Thumbnail refinement is expensive and resolves detail below their size.
    preview.adaptive = false;
    preview.adaptiveView = false;
    preview.adaptiveFrame = false;
  }
  // Preserve absent false flags, too, when no refinement was requested.
  if (!config.adaptive) {
    preview.adaptive = config.adaptive;
    preview.adaptiveView = config.adaptiveView;
    preview.adaptiveFrame = config.adaptiveFrame;
  }
  return preview;
}

// Whether a study is refined between samples; Go ignores the flag elsewhere.
const refines = (c: Config) =>
  !!c.adaptive && refinesBetweenSamples(c.curve.format);
// Reserve N capped previews and one original-quality inspection. Bounds are
// operation/storage counts, not timings; fitted densities traverse iterates twice.
export function atlasBudget(
  config: Config,
  size: AtlasSize = 3,
): {
  points: number;
  work: number;
  iterations: number;
  density: number;
  error?: string;
} {
  const preview = atlasPreviewConfig(config, size);
  const n = size * size;
  const density = config.curve.format === "attractor";
  const reserve = (c: Config) => {
    if (density) {
      const a = c.curve.attractor;
      return {
        points: c.lines + 1,
        work: 0,
        iterations: a.discard + a.iterates * (a.fit ? 2 : 1),
        density: a.cells ** 2,
      };
    }
    const family =
      c.kind === "offset" && c.stack.enabled
        ? c.stack.count
        : c.kind === "envelope" && c.envelope.mode === "circle"
          ? 2
          : 0;
    const format = c.curve.format;
    const generated =
      format === "field"
        ? c.curve.field.seeds.length
        : format === "pursuit"
          ? c.curve.pursuit.pursuers.length
          : 1;
    const paths = 2 + (c.input === "curve" ? 0 : 1) + family + generated - 1;
    const refined = refines(c);
    const points =
      paths * (c.samples + (refined ? refineBudget : 0)) +
      (generated > 1 ? generated * c.lines : 0) +
      (format === "field" ? 21 * 21 : 0);
    // Seven RK stages per attempted step; fields also evaluate the initial
    // speed. Sampling between stored steps runs RK again (at most seven
    // stages, two coordinates), including inside construction stencils.
    const integration =
      format === "field"
        ? generated * 50000 * 8 * 2
        : format === "pursuit"
          ? generated * 40000 * 7 * 2
          : 0;
    const integrated = c.kind === "rolling" || c.kind === "involute";
    const sampling = format === "field" || format === "pursuit" ? 14 : 1;
    const work =
      integration +
      points *
        sampling *
        (c.input === "curve" ? 9 : 81) *
        (refined ? 8 : 1) *
        (integrated ? 16 : 1) *
        (refined && c.adaptiveFrame ? 2 : 1);
    return { points, work, iterations: 0, density: 0 };
  };
  const full = reserve(config),
    small = reserve(preview);
  const passes = !density && refines(config) && config.adaptiveView ? 2 : 1;
  const totals = {
    points: n * small.points + full.points,
    work: n * small.work + passes * full.work,
    iterations: n * small.iterations + full.iterations,
    density: n * small.density + full.density,
  };
  const over =
    (size !== 3 && size !== 5) ||
    (!density &&
      (config.samples > 8000 ||
        n * preview.samples + passes * config.samples > 80000)) ||
    config.lines > 256 ||
    n * preview.lines + passes * config.lines > 2560 ||
    totals.points > 500000 ||
    totals.work > 80000000 ||
    totals.iterations > 20000000 ||
    totals.density > 2000000;
  const error = !atlasPairs(config).length
    ? "This study has no curated parameter pair. Your study is kept."
    : !over
      ? undefined
      : size === 5 && !atlasBudget(config, 3).error
        ? "This study exceeds the 5 × 5 atlas work limit. Choose 3 × 3, or reduce samples, lines, family members, trajectories, pursuers, or refinement in your study."
        : "This study exceeds the atlas work limit. Reduce samples, lines, family members, trajectories, pursuers, or refinement in your study, then try again.";
  return { ...totals, error };
}
export function atlasRangeError(
  ranges: AtlasRanges,
  pair: AtlasPairId = "roulette",
) {
  for (const { key, label: name } of atlasPair(pair).axes) {
    const [from, to] = ranges[key] ?? [NaN, NaN];
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
function field(config: Config, axis: Axis): number {
  return axis.path.reduce<any>((v, key) => v[key], config);
}
function setField(config: Config, axis: Axis, value: number) {
  const owner = axis.path.slice(0, -1).reduce<any>((v, key) => v[key], config);
  owner[axis.path.at(-1)!] = value;
}
// Inclusive interpolation avoids overflow in b-a. Only the center snaps to
// the frozen value within rounding at the scale of it and the endpoints.
// Endpoint arithmetic matters for a small pole coordinate between ±1: using
// only the coordinate's magnitude loses an otherwise symmetric center.
function axis([a, b]: [number, number], current: number, size: AtlasSize) {
  return Array.from({ length: size }, (_, i) => {
    if (i === 0) return a;
    if (i === size - 1) return b;
    const p = i / (size - 1);
    const value = (1 - p) * a + p * b;
    return i === (size - 1) / 2 &&
      Math.abs(value - current) <=
        Number.EPSILON * Math.max(Math.abs(current), Math.abs(a), Math.abs(b))
      ? current
      : roundedGenerated(value, Math.max(Math.abs(a), Math.abs(b)));
  });
}
const maxNumbers = 4000000;
// Bound delivered geometry as well as the preflight reservation: a result
// includes diagnostics, representative circles and refinement breaks too.
function numbers(value: unknown): number {
  if (typeof value === "number") return 1;
  if (!value || typeof value !== "object") return 0;
  return Object.values(value).reduce<number>((n, v) => n + numbers(v), 0);
}

/** One caller-owned worker, one numerical request, at most twenty-five grid outcomes and one
 * inspection. A generation invalidates delivery, not just what is painted.
 * A selection has priority over unsent cells; repeated selections coalesce.
 */
export class ParameterAtlas {
  state: AtlasState = { cells: [], selection: null, queued: 0 };
  private source: PlanarStudy | null = null;
  private pair: AtlasPair = atlasPair("roulette");
  private size: AtlasSize = 3;
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
  generate(
    study: PlanarStudy,
    ranges: AtlasRanges,
    options: AtlasOptions = {},
  ) {
    this.cancel();
    const pair = options.pair ?? atlasPairs(study.config)[0]?.id ?? "roulette";
    const descriptor = atlasPair(pair);
    const size = options.size ?? 3;
    const error =
      this.failed ??
      atlasBudget(study.config, size).error ??
      (!descriptor?.supports(study.config)
        ? "This study has no curated parameter pair for that choice."
        : undefined) ??
      atlasRangeError(ranges, pair)?.message;
    if (error) {
      this.state = { ...this.state, error };
      this.emit();
      return;
    }
    this.source = structuredClone(study);
    this.pair = descriptor;
    this.size = size;
    this.state = {
      cells: axis(
        ranges[descriptor.axes[1].key],
        field(study.config, descriptor.axes[1]),
        size,
      ).flatMap((y) =>
        axis(
          ranges[descriptor.axes[0].key],
          field(study.config, descriptor.axes[0]),
          size,
        ).map((x) => ({ values: [x, y] as [number, number] })),
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
    this.pair.axes.forEach((axis, i) =>
      setField(study.config, axis, this.state.cells[index].values[i]),
    );
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
    const config = selection
      ? study.config
      : atlasPreviewConfig(study.config, this.size);
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
      .compute(config, study.bounds, {
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
