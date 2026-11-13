// A dual pair's drawing, the 24-cell's (engine4/cell24.go) or the
// tesseract and 16-cell's (engine4/cell16.go), assembled from the engine's
// vertex arrays and incidence. Go computes every coordinate; this only
// pairs the returned points by the returned vertex IDs, so the vertex
// arrays can travel in the typed buffer rather than as one JSON path per
// edge. Each path keeps its 4D endpoints beside their xyz shadow. IDs take
// the result's object as their prefix.
import type { Result } from "./types";

type Path = Result["paths"][number];
type Marker = NonNullable<Result["markers"]>[number];

// Role inks, by family: the primal, the selected cell, the dual, and the
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

// The most paths an orthogonal 24-cell shadow draws: both edge sets, the selected
// cell's 12 edges and 3 diagonals, and the 8 dual edges from its center
// (engine4 cell24DrawnPaths). Edges drawn in a selected role are not
// drawn again in the crystal's.
export const polytopePathBound = 96 + 96 + 12 + 3 + 8;
export const polytopeMarkerBound = 24;
// The tesseract and 16-cell: both edge sets and the selected cube's 4
// diagonals (engine4 cell16DrawnPaths), and the 8 centers.
export const pair16PathBound = 32 + 24 + 4;
export const pair16MarkerBound = 8;

// The selected item a source ID names: the cell centered on dual vertex k.
export function cellOf(source: string): number | undefined {
  const m = /^cell(?:24|16)\/dual\/vertex\/(\d+)$/.exec(source);
  return m ? Number(m[1]) : undefined;
}

export function expandPolytope(result: Result): Result {
  const p = result.polytope;
  if (!p) return result;
  if (p.sections) return expandSections(result);
  const { primal, dual } = p,
    crystal = p.view === "crystal",
    id = result.object;
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
        segment(primal, a, b, `${id}/primal/edge/${j}`, "primal", 0);
    });
    dual.edges.forEach(([a, b], j) => {
      if (!spokes.has(j))
        segment(dual, a, b, `${id}/dual/edge/${j}`, "dual", 2);
    });
  }
  p.neighborEdges.forEach((j) => {
    const [a, b] = dual.edges[j];
    // From the center outward.
    const [from, to] = a === p.selected ? [a, b] : [b, a];
    segment(dual, from, to, `${id}/dual/edge/${j}`, "spoke", 3);
  });
  for (const j of p.cellEdges) {
    const [a, b] = primal.edges[j];
    segment(primal, a, b, `${id}/primal/edge/${j}`, "cell", 1);
  }
  // The cell's vertices come as opposite pairs: its diagonals.
  for (let i = 0; i < p.cellVertices.length; i += 2)
    segment(
      primal,
      p.cellVertices[i],
      p.cellVertices[i + 1],
      `${id}/primal/cell/${p.selected}/diagonal/${i / 2}`,
      "diagonal",
      1,
      true,
    );
  const marker = (k: number, role: Marker["role"], family: number) =>
    markers.push({
      id: `${id}/dual/vertex/${k}`,
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

// Every point is already an intersection computed by Go. Only returned
// indices/provenance choose paths, roles and the sparse construction.
function expandSections(result: Result): Result {
  const p = result.polytope!;
  const paths: Path[] = [],
    markers: Marker[] = [],
    faces: Result["faces"] = [];
  for (const s of p.sections!) {
    const dual = s.object === "dual";
    const selected = (i: number) =>
      dual
        ? s.origins[i].includes(p.selected)
        : s.vertexCells[i].includes(p.selected);
    for (const [j, [a, b]] of s.edges.entries()) {
      const accent = dual
        ? selected(a) || selected(b)
        : selected(a) && selected(b);
      if (p.view === "cell" && !accent) continue;
      paths.push({
        points: [s.points[a], s.points[b]],
        fourPoints: [s.fourPoints[a], s.fourPoints[b]],
        source: `${s.id}/edge/${j}`,
        sectionId: s.id,
        branch: "0",
        role: dual ? (accent ? "spoke" : "dual") : accent ? "cell" : "primal",
        family: dual ? (accent ? 3 : 2) : accent ? 1 : 0,
        guide: dual,
      });
    }
    for (const [j, f] of (p.sections!.length === 2 ? s.facets : []).entries()) {
      const accent = !dual && f.vertices.every(selected);
      if (p.view === "cell" && !accent) continue;
      faces.push({
        points: f.vertices.map((i) => s.points[i]),
        family: dual ? 2 : accent ? 1 : 0,
        guide: dual,
        source: `${s.id}/facet/${j}`,
        sectionId: s.id,
      });
    }
    s.points.forEach((point, i) => {
      // Point contacts of either solid remain visible. Other dual section
      // vertices mark edges crossing from the selected cell's center.
      if (s.dimension !== 0 && !(dual && selected(i))) return;
      if (p.view === "cell" && !selected(i)) return;
      markers.push({
        id: `${s.id}/vertex/${i}`,
        point,
        fourPoint: s.fourPoints[i],
        family: dual ? (selected(i) ? 3 : 2) : selected(i) ? 1 : 0,
        role: dual ? (selected(i) ? "center" : "vertex") : "sample",
      });
    });
  }
  return { ...result, paths, markers, faces };
}
