import {
  maxRefinedTetrahedra,
  type ImplicitBox,
  type ImplicitResult,
} from "./types";

const count = (n: number, one: string, many: string) =>
  `${n.toLocaleString()} ${n === 1 ? one : many}`;
const words = [
  "no",
  "one",
  "two",
  "three",
  "four",
  "five",
  "six",
  "seven",
  "eight",
  "nine",
  "ten",
  "eleven",
  "twelve",
];
const number = (n: number) => words[n] ?? n.toLocaleString();
// Go's shape: cells along the box's longest side, and as many along the
// others as keeps them nearest to cubes, at least one.
export function implicitGrid(box: ImplicitBox, cells: number) {
  const sides = [box.xMax - box.xMin, box.yMax - box.yMin, box.zMax - box.zMin];
  const h = Math.max(...sides) / cells;
  return sides.map((s) => Math.max(1, Math.round(s / h))) as [
    number,
    number,
    number,
  ];
}
// A piece of the mesh by its topology: a closed orientable surface of
// Euler characteristic χ has genus (2 − χ)/2.
function piece(c: ImplicitResult["components"][number]) {
  const euler = `Euler characteristic ${c.euler.toLocaleString().replace("-", "−")}`;
  if (!c.closed) return `open, with ${euler}`;
  return c.euler % 2 === 0 && c.euler <= 2
    ? `closed, of genus ${(2 - c.euler) / 2} (${euler})`
    : `closed, with ${euler}`;
}
// What the mesh is, where it stops, and what was not meshed, with why.
export function implicitNote(r: ImplicitResult): string[] {
  const out: string[] = [];
  const triangles = r.triangles.length / 3;
  if (!triangles)
    out.push(
      `No surface: F − c keeps one sign at every grid point of the ${r.grid.join(" × ")} grid${r.discontinuities ? ", or changes it only across poles and jumps" : ""}. A piece smaller than a cell, or a level F touches without crossing, is not found.`,
    );
  else {
    // Pieces with the same description are counted together.
    const groups = new Map<string, number>();
    for (const c of r.components)
      groups.set(piece(c), (groups.get(piece(c)) ?? 0) + 1);
    const kinds = [...groups].map(([what, n]) => `${number(n)} ${what}`);
    out.push(
      r.components.length === 1
        ? `The mesh is one piece, ${piece(r.components[0])}.`
        : groups.size === 1
          ? `The mesh has ${number(r.components.length)} pieces, each ${piece(r.components[0])}.`
          : `The mesh has ${number(r.components.length)} pieces: ${kinds.join("; ")}.`,
      `It has ${count(triangles, "triangle", "triangles")} on ${count(r.positions.length / 3, "vertex", "vertices")}, from a ${r.grid.join(" × ")} grid.`,
    );
  }
  const { levels, reached, bisected, unresolved, exhausted } = r.refinement;
  if (levels > 0) {
    const of = `${levels} ${levels === 1 ? "level" : "levels"}`;
    out.push(
      bisected
        ? `Refinement bisected ${count(bisected, "tetrahedron", "tetrahedra")}, reaching ${reached} of ${of}, where an edge's midpoint lay across the level from both its ends.`
        : `Refinement up to ${of} split nothing: no edge's midpoint lay across the level from both its ends.`,
    );
    if (exhausted)
      out.push(
        `Refinement stopped at its budget of ${maxRefinedTetrahedra.toLocaleString()} tetrahedra with ${unresolved.toLocaleString()} still disagreeing with a sample: use fewer cells or a smaller box.`,
      );
    else if (unresolved)
      out.push(
        `${count(unresolved, "tetrahedron", "tetrahedra")} at the deepest level still ${unresolved === 1 ? "disagrees" : "disagree"} with a sample: the surface there is finer than refinement reaches.`,
      );
  }
  if (r.cut.length)
    out.push(
      `The box cuts it open along ${count(r.cut.length / 2, "edge", "edges")}.`,
    );
  if (r.nonfinite)
    out.push(
      `F is not finite at ${levels > 0 ? count(r.nonfinite, "point sampled", "points sampled") : count(r.nonfinite, "grid point", "grid points")}: the cells beside them are left out${r.open.length ? ", and the mesh stops there" : ""}.`,
    );
  else if (r.open.length)
    out.push(
      `The mesh stops beside cells left out, along ${count(r.open.length / 2, "edge", "edges")}.`,
    );
  if (r.discontinuities)
    out.push(
      `${count(r.discontinuities, "grid edge changes", "grid edges change")} sign across a pole or a jump rather than a root: ${r.marks.length < r.discontinuities ? `the first ${r.marks.length.toLocaleString()} are` : r.discontinuities === 1 ? "it is" : "they are"} marked with crosses and never meshed.`,
    );
  if (r.singular)
    out.push(
      `${count(r.singular, "vertex has", "vertices have")} no normal: ∇F vanishes there, as at a cone point, or is not finite.`,
    );
  if (r.ambiguous)
    out.push(
      levels > 0
        ? `${count(r.ambiguous, "grid face has", "grid faces have")} corners alternating in sign; refinement samples each face's centre, and splits the face where the grid's diagonal disagrees with it.`
        : `${count(r.ambiguous, "grid face has", "grid faces have")} corners alternating in sign; there the grid's diagonal, not F, decides whether the surface joins across, so compare a finer grid.`,
    );
  if (r.sections.length) {
    const paths = r.sections.flatMap((s) => s.paths);
    const loops = paths.filter((p) => p.closed).length;
    const missed = r.sections.filter(
      (s) => !s.skipped && !s.polygon.length,
    ).length;
    const open = paths.length - loops;
    const held =
      loops && open
        ? `${count(loops, "closed curve", "closed curves")} and ${count(open, "open one", "open ones")}`
        : loops
          ? count(loops, "closed curve", "closed curves")
          : open
            ? count(open, "open curve", "open curves")
            : "no curve";
    out.push(
      `The ${r.sections.length === 1 ? "section holds" : `${number(r.sections.length)} sections hold`} ${held}${open ? `; an open curve ends at the box or beside cells left out` : ""}.`,
    );
    if (missed)
      out.push(
        `${count(missed, "plane misses", "planes miss")} the box, or only touches it.`,
      );
    if (r.sectionDiscontinuities)
      out.push(
        `${count(r.sectionDiscontinuities, "section crossing was", "section crossings were")} rejected as a pole or jump.`,
      );
    if (r.sectionsSkipped)
      out.push(
        `The last ${count(r.sectionsSkipped, "plane was", "planes were")} skipped: the sections would bisect more than 65,536 grid edges in all. Use fewer cells or planes.`,
      );
    if (r.truncated)
      out.push(
        "Section refinement stopped at 131,072 points; later curves are drawn with straighter chords.",
      );
  }
  return out;
}
