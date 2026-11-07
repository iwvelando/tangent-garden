import {
  AtlasQueue,
  axisRangeError,
  type AtlasRanges,
  type AtlasSize,
  type AtlasState,
} from "../atlas-queue";
import type { EngineClient } from "../engine-client";
import { tiered } from "../help";
import { objects } from "./objects";
import type { TesseractStudy } from "./link";
import type { Config, Result } from "./types";
import type { TesseractPairId } from "./atlas-pairs";
import { rotationPair } from "./atlas-pairs";
export type { TesseractPairId } from "./atlas-pairs";
export type TesseractFrame = { config: Config; result: Result };
export type TesseractAtlasState = AtlasState<TesseractFrame>;
export const tesseractAtlasPairs = (c: Config) =>
  (objects[c.object].atlas?.pairs ?? []).filter((p) => p.supports(c));
export const tesseractAtlasPair = (c: Config, id: TesseractPairId) =>
  objects[c.object].atlas?.pairs.find((p) => p.id === id);
export function tesseractAtlasDefaults(
  c: Config,
  pair = tesseractAtlasPairs(c)[0]?.id,
): AtlasRanges {
  return pair ? (tesseractAtlasPair(c, pair)?.ranges(c) ?? {}) : {};
}
export const tesseractAtlasRangeError = (
  c: Config,
  ranges: AtlasRanges,
  pair: TesseractPairId,
  size: AtlasSize,
) => axisRangeError(ranges, tesseractAtlasPair(c, pair)?.axes ?? [], size);
export function tesseractPreviewConfig(c: Config, size: AtlasSize): Config {
  const preview = structuredClone(c);
  const quality = objects[c.object].atlas;
  if (!quality) return preview;
  preview.samples = Math.min(c.samples, quality.samples[size]);
  if (quality.grid) preview.grid = Math.min(c.grid, quality.grid[size]);
  return preview;
}
export function tesseractAtlasBudget(
  c: Config,
  size: AtlasSize = 3,
): { points: number; error?: string } {
  const catalog = objects[c.object].atlas;
  const points = catalog
    ? size * size * catalog.points(tesseractPreviewConfig(c, size)) +
      catalog.points(c)
    : 0;
  const error = !tesseractAtlasPairs(c).length
    ? "This study has no curated parameter pair. Your study is kept."
    : !Number.isFinite(points) || points > 1000000
      ? size === 5 && !tesseractAtlasBudget(c, 3).error
        ? "This study exceeds the 5 × 5 atlas work limit. Choose 3 × 3, or reduce the source quality."
        : "This study exceeds the atlas work limit of 1,000,000 reserved points. Reduce the source quality."
      : undefined;
  return { points, error };
}
export const tesseractAtlasEntryHelp = tiered(
  "Compare Hopf bouquets or nearby rotations and projections, then adopt one.",
  "Pairs follow the active object and view. Both panels and cameras are kept. Preview samples are capped; inspection restores source quality. Across previews and one inspection, at most 1,000,000 points are reserved; retained geometry is limited to 4,000,000 numbers. Invalid variants remain unavailable.",
);
export class TesseractAtlas extends AtlasQueue<TesseractStudy, TesseractFrame> {
  constructor(
    private engine: Pick<EngineClient, "tesseract"> &
      Partial<Pick<EngineClient, "dispose">>,
    changed: (s: TesseractAtlasState) => void,
  ) {
    super(engine, changed);
  }
  generate(
    study: TesseractStudy,
    ranges: AtlasRanges,
    options: { pair?: TesseractPairId; size?: AtlasSize } = {},
  ) {
    const pair = options.pair ?? tesseractAtlasPairs(study.config)[0]?.id;
    const descriptor = pair && tesseractAtlasPair(study.config, pair);
    const size = options.size ?? 3;
    if (!descriptor) {
      // Admission fails before axes are read; use the shared publication
      // path so consumers receive the refusal as well as the empty state.
      this.begin(
        study,
        rotationPair.axes,
        ranges,
        size,
        () => "This study has no curated parameter pair. Your study is kept.",
      );
      return;
    }
    // An absent optional amplitude has the engine's zero value. Normalize
    // only this owned snapshot; older links and the source stay untouched.
    const source = structuredClone(study);
    if (pair === "flower" && source.config.weave!.amplitude === undefined)
      source.config.weave!.amplitude = 0;
    this.begin(
      source,
      descriptor.axes,
      ranges,
      size,
      () =>
        tesseractAtlasBudget(source.config, size).error ??
        (!descriptor.supports(source.config)
          ? "This study has no curated parameter pair for that choice."
          : undefined) ??
        axisRangeError(ranges, descriptor.axes, size)?.message,
    );
  }
  protected geometry(frame: TesseractFrame) {
    return frame.result;
  }
  protected async request(
    study: TesseractStudy,
    _index: number,
    selection: object | null,
  ): Promise<TesseractFrame> {
    const config = selection
      ? study.config
      : tesseractPreviewConfig(study.config, this.size);
    return { config, result: await this.engine.tesseract(config) };
  }
}
