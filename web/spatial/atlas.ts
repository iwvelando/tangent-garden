// The 3D notebook's parameter atlas: a curated catalog of spatial pairs,
// their preview quality and work reservations, and the shared queue
// (../atlas-queue.ts) over SpatialStudy. Drawing lives in atlas-paint.ts.
import {
  AtlasQueue,
  axisRangeError,
  roundedRange,
  whole,
  type AtlasAxis,
  type AtlasRanges,
  type AtlasSize,
  type AtlasState,
} from "../atlas-queue";
import type { EngineClient } from "../engine-client";
import { tiered } from "../help";
import type { SpatialStudy } from "./link";
import { surfaceShape } from "./surface";
import type { Frame, SpatialConfig } from "./types";

export type SpatialPairId = "windings" | "ellipsoid";
export type SpatialAtlasPair = {
  id: SpatialPairId;
  label: string;
  axes: readonly [AtlasAxis, AtlasAxis];
  supports: (config: SpatialConfig) => boolean;
  ranges: (config: SpatialConfig) => AtlasRanges;
};
export type SpatialAtlasState = AtlasState<Frame>;

// The notebook's own labels for an ellipsoid's axes.
const axisLabel = (key: "a" | "b") =>
  surfaceShape.ellipsoid.find((f) => f.key === key)!.label;
// The engine's windings: coprime, p 1–8 and q 1–9 (engine3/developable.go).
const windingRange = { p: [1, 8], q: [1, 9] } as const;
// Four whole steps about the source divide into both grid sizes; the span
// moves the least whole amount that keeps both ends in the engine's range.
const wholeWithin = (v: number, [lo, hi]: readonly [number, number]) => {
  const from = Math.min(Math.max(v - 2, lo), hi - 4);
  return [from, from + 4] as [number, number];
};
const scaled = (v: number): [number, number] =>
  roundedRange(v * 0.5, v * 1.5, v * 1.5);

const catalog: readonly SpatialAtlasPair[] = [
  {
    id: "windings",
    label: "Torus knot windings p / q",
    axes: [
      {
        key: "p",
        label: "Windings around p",
        symbol: "p",
        path: ["p"],
        integer: true,
      },
      {
        key: "q",
        label: "Windings through q",
        symbol: "q",
        path: ["q"],
        integer: true,
      },
    ],
    supports: (c) => c.format === "torus" && whole(c.p) && whole(c.q),
    ranges: (c) => ({
      p: wholeWithin(c.p, windingRange.p),
      q: wholeWithin(c.q, windingRange.q),
    }),
  },
  {
    id: "ellipsoid",
    label: "Ellipsoid semi-axes a / b",
    axes: [
      {
        key: "a",
        label: axisLabel("a"),
        symbol: "a",
        path: ["surface", "a"],
      },
      {
        key: "b",
        label: axisLabel("b"),
        symbol: "b",
        path: ["surface", "b"],
      },
    ],
    // A mirror's patch is not a surface study.
    supports: (c) => c.format === "surface" && c.surface.kind === "ellipsoid",
    ranges: (c) => ({ a: scaled(c.surface.a), b: scaled(c.surface.b) }),
  },
];
export const spatialAtlasPairs = (config: SpatialConfig) =>
  catalog.filter((p) => p.supports(config));
export const spatialAtlasPair = (id: SpatialPairId) =>
  catalog.find((p) => p.id === id)!;
export function spatialAtlasDefaults(
  config: SpatialConfig,
  pair: SpatialPairId = spatialAtlasPairs(config)[0]?.id ?? "windings",
): AtlasRanges {
  return spatialAtlasPair(pair).ranges(config);
}
export function spatialAtlasRangeError(
  ranges: AtlasRanges,
  pair: SpatialPairId,
  size: AtlasSize,
) {
  return axisRangeError(ranges, spatialAtlasPair(pair).axes, size);
}

// Preview quality, for cloned requests only. A knot keeps the engine's
// minima (240 samples, 12 rulings) by never asking below them.
const knotPreview = { 3: [480, 48], 5: [240, 24] } as const;
const gridPreview = { 3: 72, 5: 48 } as const;
export function spatialPreviewConfig(
  config: SpatialConfig,
  size: AtlasSize,
): SpatialConfig {
  const preview = structuredClone(config);
  if (config.format === "surface") {
    const s = preview.surface;
    s.uSamples = Math.min(s.uSamples, gridPreview[size]);
    s.vSamples = Math.min(s.vSamples, gridPreview[size]);
    return preview;
  }
  const [samples, lines] = knotPreview[size];
  preview.samples = Math.min(config.samples, samples);
  preview.lines = Math.min(config.lines, lines);
  // Refinement resolves detail below a thumbnail's size; absent flags stay
  // absent.
  for (const flag of [
    "adaptive",
    "adaptiveSurface",
    "adaptiveView",
    "adaptiveFrame",
  ] as const)
    if (flag in config) preview[flag] = false;
  return preview;
}

// The curves a knot request computes: the base, a derived input the
// construction is built on, the construction's own members and a shadow's
// two paths.
function knotPaths(c: SpatialConfig) {
  const onInput = ["developable", "involute", "framed", "ruled", "canal"];
  const members = {
    none: 0,
    developable: 1,
    involute: c.involute.family.enabled ? c.involute.family.count : 1,
    "tangent-foot": 1,
    orthotomic: 1,
    inversion: c.inversion.input === "base" ? 1 : 2,
    framed: 1 + c.frame.strands,
    ruled: 2,
    canal: 1 + c.canal.meridians,
  }[c.construction];
  return (
    1 +
    (onInput.includes(c.construction) && c.input !== "base" ? 1 : 0) +
    members +
    (c.shadow ? 2 : 0)
  );
}
// Points a refined curve may add (engine3/refine.go).
const refinedPoints = 16384;
const limits = { points: 1000000, cells: 1000000, geodesic: 2000000 };
// Reserve N capped previews and one original-quality inspection. These are
// operation counts, not timings or heap sizes.
export function spatialAtlasBudget(
  config: SpatialConfig,
  size: AtlasSize = 3,
): { points: number; cells: number; geodesic: number; error?: string } {
  const n = size * size;
  const preview = spatialPreviewConfig(config, size);
  const reserve = (c: SpatialConfig) => {
    if (c.format === "surface") {
      const s = c.surface;
      const g = s.geodesics;
      return {
        points: 0,
        // The patch, its two focal sheets and an offset.
        cells: s.uSamples * s.vSamples * (3 + (s.offset !== 0 ? 1 : 0)),
        geodesic: g ? g.count * (g.samples + 1) : 0,
      };
    }
    return {
      points: knotPaths(c) * (c.samples + (c.adaptive ? refinedPoints : 0)),
      cells: 0,
      geodesic: 0,
    };
  };
  const small = reserve(preview),
    full = reserve(config);
  const totals = {
    points: n * small.points + full.points,
    cells: n * small.cells + full.cells,
    geodesic: n * small.geodesic + full.geodesic,
  };
  const over =
    totals.points > limits.points ||
    totals.cells > limits.cells ||
    totals.geodesic > limits.geodesic;
  const error = !spatialAtlasPairs(config).length
    ? "This study has no curated parameter pair. Your study is kept."
    : !over
      ? undefined
      : size === 5 && !spatialAtlasBudget(config, 3).error
        ? "This study exceeds the 5 × 5 atlas work limit. Choose 3 × 3, or reduce samples, family members or the geodesic fan in your study."
        : "This study exceeds the atlas work limit. Reduce samples, family members or the geodesic fan in your study, then try again.";
  return { ...totals, error };
}

export const spatialAtlasEntryHelp = tiered(
  "Compare nearby torus knots or ellipsoids, then adopt one.",
  "Supported: a torus knot's windings p and q, and an ellipsoid's semi-axes a and b. Previews cap samples and grids; inspection restores your quality. Knots reserve up to 1,000,000 curve points, ellipsoids 1,000,000 sheet cells and 2,000,000 geodesic points.",
);

/** The 3D atlas: the shared queue over SpatialStudy. */
export class SpatialAtlas extends AtlasQueue<SpatialStudy, Frame> {
  constructor(
    private engine: Pick<EngineClient, "computeSpatial"> &
      Partial<Pick<EngineClient, "dispose">>,
    changed: (state: SpatialAtlasState) => void,
  ) {
    super(engine, changed);
  }
  generate(
    study: SpatialStudy,
    ranges: AtlasRanges,
    options: { pair?: SpatialPairId; size?: AtlasSize } = {},
  ) {
    const pair =
      options.pair ?? spatialAtlasPairs(study.config)[0]?.id ?? "windings";
    const descriptor = spatialAtlasPair(pair);
    const size = options.size ?? 3;
    this.begin(
      study,
      descriptor.axes,
      ranges,
      size,
      () =>
        spatialAtlasBudget(study.config, size).error ??
        (!descriptor.supports(study.config)
          ? "This study has no curated parameter pair for that choice."
          : undefined) ??
        spatialAtlasRangeError(ranges, pair, size)?.message,
    );
  }
  protected geometry(frame: Frame) {
    return frame.result;
  }
  protected request(
    study: SpatialStudy,
    _index: number,
    selection: object | null,
  ) {
    return this.engine.computeSpatial(
      selection ? study.config : spatialPreviewConfig(study.config, this.size),
    );
  }
}
