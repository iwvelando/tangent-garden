import { availableTargets, subscript, termLabels } from "./animation";
import { EngineError, type EngineClient } from "./engine-client";
import type { PlanarStudy } from "./planar-link";
import { refineBudget } from "./refinement";
import {
  maxTerms,
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
export type AtlasPairId =
  | "roulette"
  | "lissajous"
  | `term-${number}`
  | "level"
  | "pole"
  | "light"
  | "clifford"
  | "dejong";
export type AtlasRanges = Record<string, [number, number]>;
// What a settled source frame reports about its study, which the config alone
// cannot show: whether an implicit F reads the shape parameter a.
export type AtlasFacts = { usesA?: boolean };
export type AtlasOptions = {
  pair?: AtlasPairId;
  size?: AtlasSize;
  facts?: AtlasFacts;
};
// A whole-number axis takes exactly evenly spaced whole numbers, never
// continuous values rounded; its endpoints must differ by a multiple of the
// grid's steps.
export type AtlasAxis = {
  key: string;
  label: string;
  symbol: string;
  path: readonly (string | number)[];
  integer?: boolean;
};
export type AtlasPair = {
  id: AtlasPairId;
  label: string;
  axes: readonly [AtlasAxis, AtlasAxis];
  supports: (config: Config, facts: AtlasFacts) => boolean;
  ranges: (config: Config) => AtlasRanges;
};
// Only Go parses F, so an implicit curve's use of a comes from the frame Go
// returned for that same F.
export function atlasFacts(
  frame: Frame | null | undefined,
  config: Config,
): AtlasFacts {
  return {
    usesA:
      frame?.result.contours?.usesA === true &&
      frame.config.curve.format === "implicit" &&
      frame.config.curve.implicit.f === config.curve.implicit.f,
  };
}

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
// Four whole steps about a whole source divide into both grid sizes.
const wholeAround = (v: number): [number, number] => [v - 2, v + 2];
// The same span, moved the least whole amount that keeps every value on the
// source's side of zero: a Lissajous frequency of 0 flattens the figure.
const wholeBeside = (v: number): [number, number] =>
  v > 0
    ? [Math.max(1, v - 2), Math.max(1, v - 2) + 4]
    : v < 0
      ? [Math.min(-1, v + 2) - 4, Math.min(-1, v + 2)]
      : wholeAround(v);
const whole = (v: number) => Number.isSafeInteger(v);
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
    id: "lissajous",
    label: "Lissajous frequencies m / n",
    axes: [
      {
        key: "m",
        label: "Frequency m",
        symbol: "m",
        path: ["curve", "lissajous", "frequencyX"],
        integer: true,
      },
      {
        key: "n",
        label: "Frequency n",
        symbol: "n",
        path: ["curve", "lissajous", "frequencyY"],
        integer: true,
      },
    ],
    // A zero amplitude makes its own frequency dormant.
    supports: ({ curve: { format, lissajous: l } }) =>
      format === "lissajous" &&
      whole(l.frequencyX) &&
      whole(l.frequencyY) &&
      l.amplitudeX > 0 &&
      l.amplitudeY > 0,
    ranges: (c) => ({
      m: wholeBeside(c.curve.lissajous.frequencyX),
      n: wholeBeside(c.curve.lissajous.frequencyY),
    }),
  },
  // One entry per Fourier term; a zero radius makes its frequency dormant,
  // and a single term only retraces its circle.
  ...Array.from({ length: maxTerms }, (_, k): AtlasPair => ({
    id: `term-${k + 1}`,
    label: `Term ${k + 1} frequency / radius`,
    axes: [
      {
        key: "frequency",
        label: termLabels.Frequency(k + 1),
        symbol: `k${subscript(k + 1)}`,
        path: ["curve", "terms", k, "frequency"],
        integer: true,
      },
      {
        key: "radius",
        label: termLabels.Radius(k + 1),
        symbol: `r${subscript(k + 1)}`,
        path: ["curve", "terms", k, "radius"],
      },
    ],
    supports: ({ curve: { format, terms } }) =>
      format === "fourier" &&
      terms.length >= 2 &&
      k < terms.length &&
      whole(terms[k].frequency) &&
      terms[k].radius > 0,
    ranges: (c) => ({
      frequency: wholeAround(c.curve.terms[k].frequency),
      radius: positiveRange(c.curve.terms[k].radius, c.curve.terms[k].radius),
    }),
  })),
  {
    id: "level",
    label: "Implicit level c / shape parameter a",
    axes: [
      {
        key: "level",
        label: "Level c",
        symbol: "c",
        path: ["curve", "implicit", "level"],
      },
      {
        key: "a",
        label: "Shape parameter a",
        symbol: "a",
        path: ["curve", "a"],
      },
    ],
    supports: (c, facts) => c.curve.format === "implicit" && !!facts.usesA,
    ranges: (c) => ({
      level: around(c.curve.implicit.level, 0.25),
      a: around(c.curve.a, 0.25),
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
    id: "light",
    label: "Point light x / y",
    axes: [
      {
        key: "x",
        label: "Source x",
        symbol: "x",
        path: ["source", "position", "x"],
      },
      {
        key: "y",
        label: "Source y",
        symbol: "y",
        path: ["source", "position", "y"],
      },
    ],
    supports: (c) => {
      const targets = availableTargets(c);
      return targets.includes("sourceX") && targets.includes("sourceY");
    },
    ranges: (c) => ({
      x: around(c.source.position.x, 1),
      y: around(c.source.position.y, 1),
    }),
  },
  ...(["clifford", "dejong"] as const).map((map): AtlasPair => ({
    id: map,
    label: `${map === "clifford" ? "Clifford" : "De Jong"} coefficients a / b`,
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
      c.curve.format === "attractor" && c.curve.attractor.map === map,
    ranges: (c) => ({
      a: around(c.curve.attractor.a, 0.25),
      b: around(c.curve.attractor.b, 0.25),
    }),
  })),
];
export const atlasPairs = (config: Config, facts: AtlasFacts = {}) =>
  catalog.filter((p) => p.supports(config, facts));
export const atlasPair = (id: AtlasPairId) => catalog.find((p) => p.id === id)!;
export const atlasControlHelp = {
  pair: "Only pairs used by your current study are offered.",
  size: "Includes both range endpoints.",
  framing: tiered(
    "Compare shapes separately or at one scale.",
    "Shared-scale artwork appears together after every variant finishes or is marked unavailable. Ready cells can already be inspected. Independent fits appear progressively.",
  ),
};
export const atlasRangeHelp =
  "Constant expressions; endpoints must be finite and increasing.";
export const atlasWholeRangeHelp = tiered(
  "Whole numbers, spaced evenly across the grid.",
  "To minus from must be a multiple of 2 for 3 × 3, or of 4 for 5 × 5. Constant expressions are accepted.",
);
export const atlasEntryHelp = tiered(
  "Compare nearby parameter choices for supported definitions.",
  "Supported: roulette radius and arm; whole Lissajous frequencies; a Fourier term's whole frequency and radius; implicit level and a, when F uses a; active pedal pole or Cartesian point light; Clifford or De Jong coefficients. Curves allow 8,000 samples and 256 lines; refinement, families and integration have work limits. Previews cap quality; inspection restores it.",
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
  pair: AtlasPairId = atlasPairs(config)[0]?.id ?? "roulette",
): AtlasRanges {
  return atlasPair(pair).ranges(config);
}
const implicitPreviewCells = { 3: 256, 5: 160 } as const;
export function atlasPreviewConfig(config: Config, size: AtlasSize): Config {
  const preview = structuredClone(config);
  preview.lines = Math.min(config.lines, size === 3 ? 128 : 64);
  if (config.curve.format === "attractor") {
    const a = preview.curve.attractor;
    a.iterates = Math.min(a.iterates, 50000);
    a.discard = Math.min(a.discard, 1000);
    a.cells = Math.min(a.cells, 128);
  } else if (config.curve.format === "implicit") {
    // A level set's work is its grid; samples and refinement are dormant.
    const v = preview.curve.implicit;
    v.cells = Math.min(v.cells, implicitPreviewCells[size]);
    return preview;
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
// An implicit request evaluates F at most at (cells + 1)² grid points; its
// crossings and refined points are bounded by Go per request.
export function atlasBudget(
  config: Config,
  size: AtlasSize = 3,
  facts: AtlasFacts = {},
): {
  points: number;
  work: number;
  iterations: number;
  density: number;
  grid: number;
  error?: string;
} {
  const preview = atlasPreviewConfig(config, size);
  const n = size * size;
  const density = config.curve.format === "attractor";
  const implicit = config.curve.format === "implicit";
  const reserve = (c: Config) => {
    if (implicit)
      return {
        points: 0,
        work: 0,
        iterations: 0,
        density: 0,
        grid: (c.curve.implicit.cells + 1) ** 2,
      };
    if (density) {
      const a = c.curve.attractor;
      return {
        points: c.lines + 1,
        work: 0,
        iterations: a.discard + a.iterates * (a.fit ? 2 : 1),
        density: a.cells ** 2,
        grid: 0,
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
    return { points, work, iterations: 0, density: 0, grid: 0 };
  };
  const full = reserve(config),
    small = reserve(preview);
  const passes = !density && refines(config) && config.adaptiveView ? 2 : 1;
  const totals = {
    points: n * small.points + full.points,
    work: n * small.work + passes * full.work,
    iterations: n * small.iterations + full.iterations,
    density: n * small.density + full.density,
    grid: n * small.grid + full.grid,
  };
  const over =
    (size !== 3 && size !== 5) ||
    (!density &&
      !implicit &&
      (config.samples > 8000 ||
        n * preview.samples + passes * config.samples > 80000)) ||
    config.lines > 256 ||
    n * preview.lines + passes * config.lines > 2560 ||
    totals.points > 500000 ||
    totals.work > 80000000 ||
    totals.iterations > 20000000 ||
    totals.density > 2000000 ||
    totals.grid > 2000000;
  const error = !atlasPairs(config, facts).length
    ? "This study has no curated parameter pair. Your study is kept."
    : !over
      ? undefined
      : size === 5 && !atlasBudget(config, 3, facts).error
        ? "This study exceeds the 5 × 5 atlas work limit. Choose 3 × 3, or reduce samples, lines, family members, trajectories, pursuers, or refinement in your study."
        : "This study exceeds the atlas work limit. Reduce samples, lines, family members, trajectories, pursuers, or refinement in your study, then try again.";
  return { ...totals, error };
}
export function atlasRangeError(
  ranges: AtlasRanges,
  pair: AtlasPairId = "roulette",
  size: AtlasSize = 3,
) {
  for (const { key, label: name, integer } of atlasPair(pair).axes) {
    const [from, to] = ranges[key] ?? [NaN, NaN];
    const lower = name.toLowerCase();
    if (integer) {
      if (!whole(from))
        return {
          label: `${name} from`,
          message: `${name} from must be a whole number.`,
        };
      if (!whole(to) || to <= from)
        return {
          label: `${name} to`,
          message: `${name} to must be a whole number greater than ${lower} from.`,
        };
      // Exact: the difference of safe integers can exceed 2^53.
      if ((BigInt(to) - BigInt(from)) % BigInt(size - 1))
        return {
          label: `${name} to`,
          message: `${name} to must exceed ${lower} from by a multiple of ${size - 1}, so every grid value is a whole number.`,
        };
      continue;
    }
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
function field(config: Config, axis: AtlasAxis): number {
  return axis.path.reduce<any>((v, key) => v[key], config);
}
function setField(config: Config, axis: AtlasAxis, value: number) {
  const owner = axis.path.slice(0, -1).reduce<any>((v, key) => v[key], config);
  owner[axis.path.at(-1)!] = value;
}
// Inclusive interpolation avoids overflow in b-a. Only the center snaps to
// the frozen value within rounding at the scale of it and the endpoints.
// Endpoint arithmetic matters for a small pole coordinate between ±1: using
// only the coordinate's magnitude loses an otherwise symmetric center.
function axis(
  [a, b]: [number, number],
  current: number,
  size: AtlasSize,
  integer?: boolean,
) {
  // Validated whole endpoints whose difference divides: exact, in integer
  // arithmetic, since b − a and its multiples can exceed 2^53. Every value
  // lies between the safe endpoints, so it converts back exactly.
  if (integer)
    return Array.from({ length: size }, (_, i) =>
      Number(
        BigInt(a) + (BigInt(i) * (BigInt(b) - BigInt(a))) / BigInt(size - 1),
      ),
    );
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
    const pair =
      options.pair ??
      atlasPairs(study.config, options.facts)[0]?.id ??
      "roulette";
    const descriptor = atlasPair(pair);
    const size = options.size ?? 3;
    const facts = options.facts ?? {};
    const error =
      this.failed ??
      atlasBudget(study.config, size, facts).error ??
      (!descriptor?.supports(study.config, facts)
        ? "This study has no curated parameter pair for that choice."
        : undefined) ??
      atlasRangeError(ranges, pair, size)?.message;
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
        descriptor.axes[1].integer,
      ).flatMap((y) =>
        axis(
          ranges[descriptor.axes[0].key],
          field(study.config, descriptor.axes[0]),
          size,
          descriptor.axes[0].integer,
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
