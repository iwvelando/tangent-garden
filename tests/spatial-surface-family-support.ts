import { presetStudy } from "../web/spatial/link";
import { spatialPresets } from "../web/spatial/presets";
import { restore } from "../web/lifted";
import type { SpatialResult } from "../web/spatial/types";
export function restoredSurface(r: any): SpatialResult {
  return restore(r.result, {
    ...r.lifted,
    floats: new Float64Array(r.lifted.floats),
  }) as SpatialResult;
}

export const surfaceSource = () => {
  const s = presetStudy(
    spatialPresets.findIndex((p) => p.name === "A staircase becoming a throat"),
  );
  s.config.surface.uSamples = 24;
  s.config.surface.vSamples = 12;
  s.config.surface.curves = 5;
  return s;
};
export const surfaceSettings = () => ({
  enabled: true,
  target: "surfaceB" as const,
  from: 0,
  to: Math.PI / 2,
  count: 3,
  selected: 1,
  presentation: "family" as const,
  motion: "reveal" as const,
  width: 1,
});
