// Issue #397's research preview: with ?research=397 in the address, a ray
// study may light the helicoid–catenoid family and try first-hit
// semantics. Without it nothing here changes the app, its links or its
// gallery. Not a public feature: it does not merge as is.
import type { SpatialConfig } from "./types";

export const minimalOptics =
  typeof location !== "undefined" &&
  new URLSearchParams(location.search).get("research") === "397";

// The study as Go receives it: under the preview, a ray study of the
// family carries the research flag (engine3 RaysRequest.Research), which
// no study or link holds.
export function researchRequest(
  config: SpatialConfig,
): SpatialConfig | (SpatialConfig & { rays: { research: true } }) {
  if (
    !minimalOptics ||
    config.format !== "rays" ||
    config.surface.kind !== "helicoid-catenoid"
  )
    return config;
  return { ...config, rays: { ...config.rays, research: true } };
}
