import { HelpText, HelpToggle, useHelp } from "../Field";
import { tiered } from "../help";
import type { AdaptiveResult, RefinedPath, SpatialConfig } from "./types";

// The limit Go enforces on the vertices refining a surface adds
// (engine3/surfacerefine.go), which help text states.
export const surfaceVertices = 131072;

// Refining the surface a construction draws along the curve, with
// refinement between samples (`adaptiveSurface`). Absent means off, as in
// links made before it.
export const surfaceRefineHelp = tiered(
  "Adds rings or rulings between samples wherever the curves on the surface gained points.",
  `Columns go where the curve, a partner thread, strand or meridian, or the surface’s own edges or seams gained points, coarsest bisections first, up to ${surfaceVertices.toLocaleString("en-US")} added vertices. Rulings, cross-lines, contact circles, the probe and framing keep the even samples. A gap an edge or seam finds between samples leaves those faces out.`,
);

// Whether the study's construction draws a surface on its curve.
export const drawsSurface = (c: SpatialConfig) =>
  c.construction === "developable" ||
  c.construction === "ruled" ||
  c.construction === "canal" ||
  (c.construction === "framed" && c.frame.width > 0);

// The refined curves of a result, without its surface's counts.
export const refinedPaths = (adaptive: AdaptiveResult) =>
  Object.values(adaptive)
    .flat()
    .filter((p): p is RefinedPath => typeof p === "object");

// What refining the surface added.
export const surfaceReadout = (adaptive: AdaptiveResult) => {
  const columns = adaptive.columns ?? 0;
  return `${columns.toLocaleString()} ${columns === 1 ? "column" : "columns"} added to the surface${adaptive.capped ? `: the budget of ${surfaceVertices.toLocaleString()} vertices left the finest out` : ""}.`;
};

// The checkbox, its help and readout. Unchecking drops the field, so the
// link is the one made before the setting existed.
export function RefineSurfaceCheck({
  checked,
  onChange,
  refined,
}: {
  checked: boolean;
  onChange: (on: boolean) => void;
  refined?: AdaptiveResult;
}) {
  const help = useHelp();
  return (
    <>
      <div className="probe-switch">
        <label className="check">
          <input
            type="checkbox"
            checked={checked}
            onChange={(e) => onChange(e.target.checked)}
          />
          Refine the surface too
        </label>
        <HelpToggle topic="refining the surface" help={help} />
      </div>
      <HelpText help={help}>{surfaceRefineHelp}</HelpText>
      {checked && refined && (
        <p className="refinement-readout">{surfaceReadout(refined)}</p>
      )}
    </>
  );
}
