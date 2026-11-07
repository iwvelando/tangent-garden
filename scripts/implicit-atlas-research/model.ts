// Experimental admission only. This module is deliberately outside web/;
// the public spatial atlas does not admit implicit fields until #369.
import {
  AtlasQueue,
  axisRangeError,
  type AtlasAxis,
  type AtlasRanges,
  type AtlasSize,
  type AtlasState,
} from "../../web/atlas-queue";
import type { EngineClient } from "../../web/engine-client";
import { presetStudy, type SpatialStudy } from "../../web/spatial/link";
import { spatialPresets } from "../../web/spatial/presets";
import type { Frame, SpatialConfig } from "../../web/spatial/types";

export const axes: readonly [AtlasAxis, AtlasAxis] = [
  { key: "level", label: "Level c", symbol: "c", path: ["implicit", "level"] },
  { key: "a", label: "Shape a", symbol: "a", path: ["implicit", "a"] },
];
export const previewCells = { 3: 24, 5: 16 } as const;
export function previewConfig(config: SpatialConfig, size: AtlasSize) {
  const preview = structuredClone(config);
  preview.implicit.cells = Math.min(config.implicit.cells, previewCells[size]);
  preview.implicit.refine = 0;
  return preview;
}

// Base-grid reservations, not an expression-evaluation or latency bound.
// Refinement/crossings retain the ordinary engine's independent work limits.
export function gridShape(config: SpatialConfig) {
  const { box: b, cells } = config.implicit;
  const sides = [b.xMax - b.xMin, b.yMax - b.yMin, b.zMax - b.zMin];
  const step = Math.max(...sides) / cells;
  return sides.map((s) => Math.max(1, Math.round(s / step)));
}
export function budget(config: SpatialConfig, size: AtlasSize) {
  const preview = previewConfig(config, size);
  const grid = (c: SpatialConfig) => gridShape(c).reduce((a, b) => a * b, 1);
  // The engine samples sections at min(256, 4*cells), not the mesh grid's resolution.
  const sections = (c: SpatialConfig) =>
    c.implicit.sections.count * Math.min(256, 4 * c.implicit.cells) ** 2;
  const gridCells = size ** 2 * grid(preview) + grid(config);
  const sectionCells = size ** 2 * sections(preview) + sections(config);
  const error =
    !Number.isFinite(gridCells) || gridCells > 400_000
      ? "The atlas reserves more than 400,000 base grid cells. Reduce the source grid."
      : !Number.isFinite(sectionCells) || sectionCells > 2_000_000
        ? "The atlas reserves more than 2,000,000 section cells. Reduce the section count or source grid."
        : undefined;
  return { gridCells, sectionCells, error };
}

export class ImplicitAtlas extends AtlasQueue<SpatialStudy, Frame> {
  constructor(
    private engine: Pick<EngineClient, "computeSpatial"> & {
      dispose?: () => void;
    },
    changed: (state: AtlasState<Frame>) => void,
  ) {
    super(engine, changed);
  }
  generate(study: SpatialStudy, ranges: AtlasRanges, size: AtlasSize) {
    this.begin(study, axes, ranges, size, () =>
      study.config.format !== "implicit"
        ? "This experiment needs an implicit surface."
        : (axisRangeError(ranges, axes, size)?.message ??
          budget(study.config, size).error),
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
      selection ? study.config : previewConfig(study.config, this.size),
    );
  }
}

const cube = (r: number) => ({
  xMin: -r,
  xMax: r,
  yMin: -r,
  yMax: r,
  zMin: -r,
  zMax: r,
});
export const cases = [
  {
    id: "drops",
    label: "Drops · disconnected, joined and singular",
    f: "((x-a)^2+y^2+z^2)*((x+a)^2+y^2+z^2)",
    ranges: { level: [0.6, 1.4], a: [0.8, 1.2] },
    cells: 56,
    refine: 1,
    box: cube(2),
    sections: 1,
  },
  {
    id: "sphere",
    label: "Spheres · including empty levels",
    f: "x^2+y^2+z^2-a",
    ranges: { level: [-0.5, 1.5], a: [-0.5, 1.5] },
    cells: 48,
    refine: 0,
    box: cube(2),
    sections: 7,
  },
  {
    id: "gyroid",
    label: "Gyroid · oscillatory field",
    f: "sin(a*x)*cos(a*y)+sin(a*y)*cos(a*z)+sin(a*z)*cos(a*x)",
    ranges: { level: [-0.5, 0.5], a: [0.8, 1.2] },
    cells: 48,
    refine: 0,
    box: cube(Math.PI),
    sections: 3,
  },
  {
    id: "gaps",
    label: "Domain gaps · undefined half-space",
    f: "sqrt(x-a)+y^2+z^2",
    ranges: { level: [-0.5, 1.5], a: [-0.5, 0.5] },
    cells: 48,
    refine: 0,
    box: cube(2),
    sections: 3,
  },
  {
    id: "pole",
    label: "Poles · never joined across",
    f: "1/(x-a)+y^2+z^2",
    ranges: { level: [-0.5, 1.5], a: [-0.5, 0.5] },
    cells: 48,
    refine: 0,
    box: cube(2),
    sections: 3,
  },
  {
    id: "expensive",
    label: "Gyroid · 64 cells, 3 refinement levels",
    f: "sin(a*x)*cos(a*y)+sin(a*y)*cos(a*z)+sin(a*z)*cos(a*x)",
    ranges: { level: [-0.5, 0.5], a: [0.8, 1.2] },
    cells: 64,
    refine: 3,
    box: cube(Math.PI),
    sections: 7,
  },
  {
    id: "unavailable",
    label: "Unavailable · invalid section normal",
    f: "x^2+y^2+z^2-a",
    ranges: { level: [-0.5, 1.5], a: [-0.5, 1.5] },
    cells: 48,
    refine: 0,
    box: cube(2),
    sections: 1,
  },
] as const;
export type CaseId = (typeof cases)[number]["id"];
export function experiment(id: CaseId) {
  const sample = cases.find((c) => c.id === id)!;
  const study = presetStudy(
    spatialPresets.findIndex((p) => p.name === "Two drops meeting"),
  );
  const q = study.config.implicit;
  Object.assign(q, {
    f: sample.f,
    cells: sample.cells,
    refine: sample.refine,
    box: { ...sample.box },
    a: (sample.ranges.a[0] + sample.ranges.a[1]) / 2,
    level: (sample.ranges.level[0] + sample.ranges.level[1]) / 2,
    sections: {
      normal: { x: 0, y: 0, z: id === "unavailable" ? 0 : 1 },
      from: -0.6,
      to: 0.6,
      count: sample.sections,
    },
  });
  study.animation.mode = "parameters";
  study.animation.camera = "current";
  study.animation.duration = 6;
  study.animation.tracks = [
    {
      target: "level",
      from: String(sample.ranges.level[0]),
      to: String(sample.ranges.level[1]),
    },
  ];
  delete study.story;
  return {
    study,
    ranges: structuredClone(sample.ranges) as unknown as AtlasRanges,
  };
}

// Numeric-entry bound and exact typed-array payload bytes are different units.
// Neither includes the worker's WASM heap, GPU storage or temporary copies.
export function typedBytes(value: unknown): number {
  if (!value || typeof value !== "object") return 0;
  if (ArrayBuffer.isView(value)) return value.byteLength;
  return Object.values(value).reduce<number>((n, v) => n + typedBytes(v), 0);
}
