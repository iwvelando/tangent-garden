// The 24-cell's drawing, assembled from the engine's vertex arrays and
// incidence (engine4/cell24.go). Go computes every coordinate; this only
// pairs the returned points by the returned vertex IDs, so the vertex
// arrays can travel in the typed buffer rather than as one JSON path per
// edge. Each path keeps its 4D endpoints beside their xyz shadow.
import type { Result } from "./types";

type Path = Result["paths"][number];
type Marker = NonNullable<Result["markers"]>[number];

// Role inks, by family: the 24-cell, the selected cell, the dual, and the
// selected cell's center with its dual edges. Layers: the 24-cell's roles
// draw with Edges, the dual's with Guides.
export const polytopeFamilies = {
  primal: 0,
  cell: 1,
  dual: 2,
  center: 3,
} as const;
export const dualRoles: readonly string[] = [
  "dual",
  "spoke",
  "center",
  "vertex",
];

// The most paths a 24-cell result draws: both edge sets, the selected
// cell's 12 edges and 3 diagonals, and the 8 dual edges from its center
// (engine4 cell24DrawnPaths). Edges drawn in a selected role are not
// drawn again in the crystal's.
export const polytopePathBound = 96 + 96 + 12 + 3 + 8;
export const polytopeMarkerBound = 24;

// The selected item a source ID names: the cell centered on dual vertex k.
export function cellOf(source: string): number | undefined {
  const m = /^cell24\/dual\/vertex\/(\d+)$/.exec(source);
  return m ? Number(m[1]) : undefined;
}

export function expandPolytope(result: Result): Result {
  const p = result.polytope;
  if (!p) return result;
  const { primal, dual } = p,
    crystal = p.view === "crystal";
  const paths: Path[] = [],
    markers: Marker[] = [];
  const segment = (
    layer: typeof primal,
    a: number,
    b: number,
    source: string,
    role: Path["role"],
    family: number,
    dashed = false,
  ) =>
    paths.push({
      points: [layer.points[a], layer.points[b]],
      fourPoints: [layer.rotated[a], layer.rotated[b]],
      family,
      guide: dualRoles.includes(role),
      source,
      branch: "0",
      role,
      ...(dashed ? { dashed } : {}),
    });
  const cellEdges = new Set(p.cellEdges),
    spokes = new Set(p.neighborEdges);
  if (crystal) {
    primal.edges.forEach(([a, b], j) => {
      if (!cellEdges.has(j))
        segment(primal, a, b, `cell24/primal/edge/${j}`, "primal", 0);
    });
    dual.edges.forEach(([a, b], j) => {
      if (!spokes.has(j))
        segment(dual, a, b, `cell24/dual/edge/${j}`, "dual", 2);
    });
  }
  p.neighborEdges.forEach((j) => {
    const [a, b] = dual.edges[j];
    // From the center outward.
    const [from, to] = a === p.selected ? [a, b] : [b, a];
    segment(dual, from, to, `cell24/dual/edge/${j}`, "spoke", 3);
  });
  for (const j of p.cellEdges) {
    const [a, b] = primal.edges[j];
    segment(primal, a, b, `cell24/primal/edge/${j}`, "cell", 1);
  }
  for (let i = 0; i < 6; i += 2)
    segment(
      primal,
      p.cellVertices[i],
      p.cellVertices[i + 1],
      `cell24/primal/cell/${p.selected}/diagonal/${i / 2}`,
      "diagonal",
      1,
      true,
    );
  const marker = (k: number, role: Marker["role"], family: number) =>
    markers.push({
      id: `cell24/dual/vertex/${k}`,
      role,
      point: dual.points[k],
      fourPoint: dual.rotated[k],
      family,
    });
  const others = crystal
    ? dual.points.map((_, k) => k).filter((k) => k !== p.selected)
    : p.neighbors;
  for (const k of others) marker(k, "vertex", 2);
  marker(p.selected, "center", 3);
  return { ...result, paths, markers };
}
