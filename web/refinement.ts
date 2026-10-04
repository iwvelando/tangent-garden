// Refinement between samples, shared by the 2D and 3D notebooks: the drawn
// curves Go refines (engine/refine), what a reveal shows of them, and how a
// readout totals them.

// Mirrors engine.RefinedPath and engine3.RefinedPath: a drawn curve with
// points inserted between its uniform samples. at is each point's position
// in sample steps, whole at the samples (all present) and fractional
// between them; a null point breaks the line.
export type RefinedPath<P> = {
  points: (P | null)[];
  at: number[];
  tolerance: number;
  inserted: number;
  breaks: number;
  unresolved: number;
  exhausted: boolean;
};

// The limits Go enforces, which help text states.
export const refineDepth = 10;
export const refineBudget = 16384;

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
  const inserted = total("inserted"),
    breaks = total("breaks"),
    unresolved = total("unresolved");
  return [
    `${plural(inserted, "point", "points")} added between samples.`,
    breaks > 0 && `${plural(breaks, "break", "breaks")} found between samples.`,
    unresolved > 0 &&
      `${plural(unresolved, "piece stays", "pieces stay")} coarser than the tolerance${paths.some((p) => p.exhausted) ? `: the budget of ${refineBudget.toLocaleString()} points ran out` : ", at the finest step"}.`,
  ]
    .filter(Boolean)
    .join(" ");
}
