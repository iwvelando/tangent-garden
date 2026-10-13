// Refinement between samples, shared by the 2D and 3D notebooks: the drawn
// curves Go refines (engine/refine), what a reveal shows of them, and how a
// readout totals them.

import { tiered } from "./help";

// Mirrors engine.RefinedPath and engine3.RefinedPath: a drawn curve with
// points inserted between its uniform samples. at is each point's position
// in sample steps, whole at the samples (all present) and fractional
// between them; a null point breaks the line. A 2D caustic also says
// whether each point is virtual, as the result's own virtual does at the
// samples.
export type RefinedPath<P> = {
  points: (P | null)[];
  at: number[];
  virtual?: boolean[];
  tolerance: number;
  inserted: number;
  breaks: number;
  unresolved: number;
  exhausted: boolean;
  // The tolerance of the pieces in view, when a 2D drawing is refined to a
  // view finer than the study.
  view?: number;
};

// The limits Go enforces, which help text states.
export const refineDepth = 10;
export const refineBudget = 16384;
// How far a 2D drawing zooms: refined to its view, or not.
export const viewZoom = 1000;
export const plainZoom = 20;

// Refinement to the view's help, stating the limits Go enforces
// (engine/adaptive.go, View.focus).
export const viewHelp = tiered(
  `Once you zoom in, refines what is in view to its own scale, and zooms to ${viewZoom.toLocaleString("en-US")}×.`,
  `In view, each chord stays within 2 × 10⁻⁴ of the view's half diagonal of the curve, and shorter than a quarter of it; elsewhere the study's tolerance holds. A view is refined once the drawing rests, and playback at the current view uses it. Without this, zoom stops at ${plainZoom}×.`,
);

// A refined curve's points up to the last revealed sample; the inserted
// points do not change the framing.
export function revealRefined<P>(
  path: RefinedPath<P> | undefined,
  last: number,
): RefinedPath<P> | undefined {
  if (!path) return path;
  const count = path.at.findIndex((u) => u > last);
  return count < 0
    ? path
    : {
        ...path,
        points: path.points.slice(0, count),
        at: path.at.slice(0, count),
        ...(path.virtual && { virtual: path.virtual.slice(0, count) }),
      };
}

// What refinement added to the drawn curves, and what it could not resolve.
export function refinementReadout(
  refined: (RefinedPath<unknown> | undefined)[],
) {
  const paths = refined.filter((p): p is RefinedPath<unknown> => !!p);
  const total = (key: "inserted" | "breaks" | "unresolved") =>
    paths.reduce((sum, p) => sum + p[key], 0);
  const plural = (n: number, one: string, many: string) =>
    `${n.toLocaleString()} ${n === 1 ? one : many}`;
  // How much finer the view is refined than the study, on the curve where
  // it is finest.
  const finer = Math.max(
    0,
    ...paths.map((p) => (p.view ? p.tolerance / p.view : 0)),
  );
  const inserted = total("inserted"),
    breaks = total("breaks"),
    unresolved = total("unresolved");
  return [
    `${plural(inserted, "point", "points")} added between samples.`,
    finer >= 2 && `Up to ${Math.round(finer).toLocaleString()}× finer in view.`,
    breaks > 0 && `${plural(breaks, "break", "breaks")} found between samples.`,
    unresolved > 0 &&
      `${plural(unresolved, "piece stays", "pieces stay")} coarser than the tolerance${paths.some((p) => p.exhausted) ? `: the budget of ${refineBudget.toLocaleString()} points ran out` : ", at the finest step"}.`,
  ]
    .filter(Boolean)
    .join(" ");
}
