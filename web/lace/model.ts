import { defaultPhysical, type LacePhysical } from "./physical";
import {
  readout as formatNumber,
  count as formatCount,
  percent as formatPercent,
  liveReadout,
  withoutResidue,
} from "../number-format";
import { tiered } from "../help";
import type { Repeat } from "../timing";
import type { LineWeight } from "../line-weight";
import type { PlotCamera } from "../planar-link";
import type { Term, Vec } from "../types";
import {
  sidesOf,
  tilingOf,
  type LaceTilingId,
  type LaceTilingInfo,
} from "./tilings";
import {
  exampleLoop,
  motifOf,
  type LaceMotifId,
  type LaceMotifInfo,
} from "./motifs";

// Hyperbolic lace: a finite patch of a regular tiling {p,q} of the
// Poincaré disk, {7,3} by default, grown in Go by reflection from one
// centered tile, with a motif reflected into every tile (engine/lace.go,
// docs/mathematics.md). The tilings' descriptors are in ./tilings, with
// each one's depth bound.
export const laceTiling = "7,3" as const;
export const laceLimits = {
  tiles: 1000,
  candidates: 10000,
  // The isometry's offset |a|, its angles in radians, and the motion's
  // whole orbits and turns either way (engine.LaceMaxOffset and so on).
  offset: 0.8,
  angle: 100,
  turns: 3,
} as const;
export type LaceRequest = {
  tiling: LaceTilingId;
  depth: number;
  maxTiles: number;
  // Where the star's strands turn, as a fraction of the hyperbolic
  // distance from a tile's center to its corners: 0–1.
  starPoint: number;
  // Another motif than the star, and its size (./motifs); absent for the
  // star, which ignores the size.
  motif?: Exclude<LaceMotifId, "star">;
  size?: number;
  // The loop motif's closed curve: Fourier terms with whole frequencies.
  loop?: Term[];
  // Moves the patch; absent, it stays in place.
  isometry?: LaceIsometry;
  // Detail for a view: the cutoffs' patch where it meets this window,
  // and every tile drawn in it at least minRadius in circumradius, both
  // in model units as drawn (laceDetailFor).
  window?: LaceWindow;
  minRadius?: number;
};
export type LaceWindow = {
  xMin: number;
  xMax: number;
  yMin: number;
  yMax: number;
};
// The disk isometry T(z) = e^{iθ}(z − a)/(1 − āz), a = offset·e^{i·direction}
// and θ = rotation, angles in radians (engine.LaceIsometry). It brings the
// point a to the disk's center, then turns the disk.
export type LaceIsometry = {
  offset: number;
  direction: number;
  rotation: number;
};
// The authored closed path from the static isometry (engine.LacePathAt):
// the offset swells to this farthest offset halfway and returns, while the
// direction makes whole orbits and the rotation whole turns.
export type LaceMotion = {
  offset: number;
  orbits: number;
  turns: number;
};
export type LaceCoverage = { radius: number; distance: number };
export type LaceFrameRequest = {
  lace: LaceRequest;
  motion: LaceMotion;
  progress: number;
};
// A moved patch's geometry alone (engine.LaceFrame).
export type LaceFrame = Pick<
  LaceResult,
  | "center"
  | "transform"
  | "vertex"
  | "edgeCenter"
  | "edgeRadius"
  | "edgeStraight"
  | "arcStart"
  | "arcEnd"
  | "arcCenter"
  | "arcRadius"
  | "arcStraight"
  | "arcFirst"
  | "isometry"
  | "coverage"
> & { progress: number };
// Parallel arrays in model units, the rim being the unit circle; see
// engine.LaceResult. Tiles are in breadth-first order, tile 0 the seed.
export type LaceResult = {
  tiling: string;
  center: Vec[];
  depth: number[];
  parent: number[];
  via: number[];
  reversed: boolean[];
  transform: [number, number, number, number][];
  // p vertex and p edge indices per tile, p the tiling's sides.
  corners: number[];
  sides: number[];
  vertex: Vec[];
  vertexTiles: number[];
  edgeA: number[];
  edgeB: number[];
  edgeTiles: number[];
  edgeCenter: Vec[];
  edgeRadius: number[];
  edgeStraight: boolean[];
  // The motif's 2p strokes per tile, in tile order: geodesic segments or
  // circular arcs, each its circle's minor arc, or straight.
  arcStart: Vec[];
  arcEnd: Vec[];
  arcCenter: Vec[];
  arcRadius: number[];
  arcStraight: boolean[];
  // Tile i's strokes run from arcFirst[i] to arcFirst[i + 1] when their
  // number varies, as the loop's do; absent, every tile holds 2p.
  arcFirst?: number[];
  // Under a window, candidates outside the view or too small to draw
  // there, in place of those beyond the depth.
  omitted: { depth: number; precision: number; view?: number; radius?: number };
  stopped: "" | "count" | "candidates";
  pending: number;
  processed: number;
  duplicates: number;
  vertexRadius: number;
  circumradius: number;
  apothem: number;
  sideLength: number;
  // The isometry that placed the patch, and how far about the disk's
  // center it is complete under it.
  isometry: LaceIsometry;
  coverage: LaceCoverage;
};
export type LacePresentation = "complete" | "selected";
// A tile's address: the sides crossed from the center tile, each numbered
// 0 to p − 1 in the tile crossed. It names the same tile under any cutoffs.
export type LaceAddress = number[];
export type LaceStudy = Omit<
  LaceRequest,
  "motif" | "size" | "loop" | "window" | "minRadius"
> & {
  // Which motif every tile carries, the star when absent, and the other
  // motifs' sizes, each absent until edited (its descriptor's initial
  // value) and kept while another motif is shown.
  motifKind?: LaceMotifId;
  petalFullness?: number;
  leafFullness?: number;
  ringRadius?: number;
  loopSize?: number;
  // The loop motif's curve, absent until one is woven from Draw a loop:
  // the example leaf (motifs.ts, exampleLoop).
  loopTerms?: Term[];
  edges: boolean;
  motif: boolean;
  selected?: LaceAddress;
  presentation: LacePresentation;
  view: PlotCamera;
  weight: LineWeight;
  // Whether each new selection is framed, and the view to return to when
  // following is turned off; both absent while off.
  follow?: boolean;
  viewBeforeFollow?: PlotCamera;
  // The motion's path and timing; absent, defaultLaceMotion.
  motion?: LaceStudyMotion;
  // Deeper tiles for the view when zoomed in (laceDetailFor); absent or
  // false, zoom only enlarges the patch, as in older links.
  detail?: boolean;
  // The plaque workshop's settings once it has been opened, and whether
  // it is open (physical.ts); absent in older links.
  physical?: LacePhysical;
};
export type LaceStudyMotion = LaceMotion & {
  duration: number;
  repeat: Repeat;
};

// The identity isometry: the patch as generated.
export const centered: LaceIsometry = { offset: 0, direction: 0, rotation: 0 };
// An isometry with no offset and no rotation leaves every point where it
// is, whatever its direction; Go reproduces the unmoved patch exactly.
export const isIdentity = (iso: LaceIsometry | undefined) =>
  !iso || (iso.offset === 0 && iso.rotation === 0);
// A glide along the direction, out to 0.6 and back, looping every 12 s.
export const defaultLaceMotion: LaceStudyMotion = {
  offset: 0.6,
  orbits: 0,
  turns: 0,
  duration: 12,
  repeat: "loop",
};

// The study's motif, and its size.
export const studyMotif = (s: LaceStudy): LaceMotifInfo => motifOf(s.motifKind);
export const motifSize = (s: LaceStudy, m = studyMotif(s)): number =>
  s[m.field] ?? m.initial;
// The study's loop, the example leaf until one is drawn.
export const studyLoop = (s: LaceStudy): readonly Term[] =>
  s.loopTerms ?? exampleLoop;
// Tile t's strokes in the result: [first, end).
export const strokesOf = (r: LaceResult, t: number, p: number) =>
  r.arcFirst
    ? [r.arcFirst[t], r.arcFirst[t + 1]]
    : [2 * p * t, 2 * p * (t + 1)];
// A star's request is as it was before other motifs existed. With zoom
// detail at a zoom past 1.4×, it carries the view's window.
export const laceRequest = (s: LaceStudy): LaceRequest => {
  const m = studyMotif(s);
  const d = laceDetailFor(s);
  return {
    tiling: s.tiling,
    depth: s.depth,
    maxTiles: s.maxTiles,
    starPoint: s.starPoint,
    ...(m.id !== "star" && { motif: m.id, size: motifSize(s, m) }),
    ...(m.drawn && { loop: structuredClone(studyLoop(s)) as Term[] }),
    ...(s.isometry && { isometry: { ...s.isometry } }),
    ...(d && { window: d.window, minRadius: d.minRadius }),
  };
};

// The window's tile limit (engine.LaceMaxViewTiles).
export const laceViewTiles = 2000;
// The longest address a detailed view's link may select: far deeper than
// any view reaches at the 100× zoom limit (about 13 reflections for
// {7,3}, 25 for {3,7}).
export const laceViewAddress = 64;

// Zoom detail (docs/mathematics.md, Hyperbolic lace, Detail for a view),
// the garden's policy (web/garden/model.ts, detailFor) for the lace. Zoom
// snaps down to half-octave levels, factor f = 2^(level/2) ≥ √2, and the
// least drawn circumradius of tiles beyond the cutoffs is the tiling's
// detailRadius over f in model units: on screen it stays that size, to √2
// times it. The window is the view snapped outward to a grid of
// quarter-view cells at that level, plus one cell, clamped to the cells
// around the disk, so small pans and a revisited view ask for the same
// request, and the shown result is replaced, never accumulated. Below √2,
// with detail off, or with the lace moved off center, there is none: the
// static request: off center, the search keeps several times the view's
// tiles (docs/mathematics.md, Detail for a view), so a moved lace keeps
// its patch.
export const laceDetailLevel = (zoom: number) =>
  Math.max(0, Math.floor(2 * Math.log2(zoom)));
export function laceDetailFor(s: LaceStudy) {
  if (!s.detail) return undefined;
  if (s.isometry && s.isometry.offset > 0) return undefined;
  return laceDetailView(s.tiling, s.view);
}
// The policy's level, cutoff and window for a tiling at a view, or
// undefined below √2.
export function laceDetailView(tiling: LaceTilingId, view: PlotCamera) {
  const s = { tiling, view };
  const level = laceDetailLevel(s.view.zoom);
  if (level === 0) return undefined;
  const factor = 2 ** (level / 2);
  const cell = lacePage.width / (laceScale * factor) / 4;
  const k = laceScale * s.view.zoom,
    v = s.view;
  // Cells covering the disk, and one more on each side; a view beyond
  // them keeps a one-cell window there, outside the disk.
  const reach = Math.ceil(1 / cell) + 1;
  const index = (value: number, round: (v: number) => number, by: number) =>
    Math.max(-reach, Math.min(reach, round(value / cell) + by));
  const span = (lo: number, hi: number) => {
    const a = index(lo, Math.floor, -1);
    return [a, Math.max(a + 1, index(hi, Math.ceil, 1))];
  };
  const [i0, i1] = span((-500 - v.x) / k, (500 - v.x) / k);
  const [j0, j1] = span((v.y - 380) / k, (v.y + 380) / k);
  return {
    level,
    factor,
    minRadius: tilingOf(s.tiling).detailRadius / (laceScale * factor),
    window: {
      xMin: i0 * cell,
      xMax: i1 * cell,
      yMin: j0 * cell,
      yMax: j1 * cell,
    },
  };
}
// A frame's geometry on its frozen patch: the patch's tiles and incidence
// with the frame's positions.
export function movedResult(source: LaceResult, frame: LaceFrame): LaceResult {
  const { progress: _, ...geometry } = frame;
  return { ...source, ...geometry };
}

export const defaultLace: LaceStudy = {
  tiling: laceTiling,
  depth: 5,
  maxTiles: 1000,
  starPoint: 0.3,
  edges: true,
  motif: true,
  presentation: "complete",
  view: { x: 0, y: 0, zoom: 1 },
  weight: "regular",
};
// The authored studies, in the 2D examples gallery. Each opens the lace
// over the notebook's study without replacing it, and takes nothing from it.
// The {7,3} studies come first, so their places in the gallery and in
// journeys are unchanged.
export const lacePresets: readonly {
  title: string;
  note: string;
  study: LaceStudy;
}[] = [
  {
    title: "Seven-pointed stars receding to the rim",
    note: "A heptagon reflected across its sides fills a disk whose rim is infinitely far away",
    study: { ...defaultLace },
  },
  // Address 4, 0, 3, tile 66: three reflections toward the lower right,
  // each tile's center within 5° of the ray to the last one.
  {
    title: "One tile and its path of reflections",
    note: "The tiles crossed from the center to one tile, every copy the same size in the disk's own measure",
    study: {
      ...defaultLace,
      selected: [4, 0, 3],
    },
  },
  // The signature motion. Tile 24 (address 4, 6) lies beyond the center
  // tile's corner at direction −π/14, a mirror line of the tiling, at
  // Euclidean radius 0.71814307181038606. Gliding the disk out to that
  // offset along the mirror brings the tile to the center halfway, drawn at
  // full size, and carries it back to its place: the picture stays
  // symmetric about the mirror throughout. It opens still and unmoved.
  {
    title: "A tile glides to the center and back",
    note: "A disk isometry draws one small tile in to the middle along a mirror line, then lets it flow out again",
    study: {
      ...defaultLace,
      selected: [4, 6],
      isometry: { offset: 0, direction: -Math.PI / 14, rotation: 0 },
      motion: {
        offset: 0.71814307181038606,
        orbits: 0,
        turns: 0,
        duration: 10,
        repeat: "loop",
      },
    },
  },
  // The catalog's signature still: {5,4} at its deepest complete ring.
  {
    title: "Pentagonal flowers, four at every corner",
    note: "Right-angled pentagons, impossible on a flat plane, reflected out to the rim",
    study: { ...defaultLace, tiling: "5,4", depth: 5 },
  },
  // Tile 9 (address 0, 4) is the pentagon opposite the center tile across
  // its top corner, on that corner's mirror at Euclidean radius
  // 0.68712149944502521 (tanh R): the glide carries it to the center.
  {
    title: "A pentagon glides to the center and back",
    note: "The pentagon across the top corner drawn in to the middle along a mirror line",
    study: {
      ...defaultLace,
      tiling: "5,4",
      depth: 5,
      selected: [0, 4],
      isometry: { offset: 0, direction: Math.PI / 2, rotation: 0 },
      motion: {
        offset: 0.68712149944502521,
        orbits: 0,
        turns: 0,
        duration: 10,
        repeat: "loop",
      },
    },
  },
  {
    title: "Square stars, five at every corner",
    note: "Squares with 72° corners: the dual of the pentagons, each corner a pentagon's center",
    study: { ...defaultLace, tiling: "4,5", depth: 6 },
  },
  // Tile 6 (address 0, 2) lies two squares out through side midpoints, at
  // Euclidean radius 0.7861513777574235 (tanh 2h) in direction 3π/4.
  {
    title: "A square glides to the center and back",
    note: "Two squares out through their sides' midpoints, drawn in along a mirror line",
    study: {
      ...defaultLace,
      tiling: "4,5",
      depth: 6,
      selected: [0, 2],
      isometry: { offset: 0, direction: (3 * Math.PI) / 4, rotation: 0 },
      motion: {
        offset: 0.7861513777574235,
        orbits: 0,
        turns: 0,
        duration: 10,
        repeat: "loop",
      },
    },
  },
  // Duality: at star point 0 every strand runs from a tile's center to a
  // side's midpoint, so the strands are the dual tiling's sides.
  {
    title: "Pentagons whose strands draw the squares",
    note: "At star point 0 each pentagon's strands run to its sides' midpoints and trace the dual {4,5} tiling",
    study: { ...defaultLace, tiling: "5,4", depth: 5, starPoint: 0 },
  },
  // {3,7} at depth 10, its deepest complete ring: 742 tiles.
  {
    title: "Triangles, seven at every corner",
    note: "The dual of the heptagons: slender triangles whose slow rings reach ten deep",
    study: { ...defaultLace, tiling: "3,7", depth: 10 },
  },
  // The motifs beside the star (./motifs), each at full size. Petals at
  // fullness 1 touch around each heptagon's center.
  {
    title: "Petals, a flower in every heptagon",
    note: "Lenses from each center to its corners: seven-petal flowers, joined by three-petal ones at every corner",
    study: { ...defaultLace, motifKind: "petals", edges: false },
  },
  // Leaves at fullness 1 touch around each pentagon's center, and join
  // across every side into one leaf between two centers.
  {
    title: "Leaves joined across every side",
    note: "Lenses from each pentagon's center to its sides' midpoints, each meeting its mirror image across the side",
    study: { ...defaultLace, tiling: "5,4", depth: 5, motifKind: "leaves" },
  },
  // The inscribed circles, tangent at every side's midpoint: a packing of
  // circles all the same hyperbolic size, five around each gap.
  {
    title: "Circles that touch at every side",
    note: "Each square's inscribed circle, all the same size in the disk's own measure, touching four neighbors",
    study: {
      ...defaultLace,
      tiling: "4,5",
      depth: 6,
      motifKind: "rings",
      edges: false,
    },
  },
  // The pentagon glide (tile 9, address 0, 4) with rings: the packing
  // flows in along a mirror line, each circle swelling as it nears the
  // center and shrinking as it leaves, always touching its neighbors.
  {
    title: "Rings glide to the center and back",
    note: "Tangent circles flow in along a mirror line and out again, every one keeping its hyperbolic size",
    study: {
      ...defaultLace,
      tiling: "5,4",
      depth: 5,
      motifKind: "rings",
      selected: [0, 4],
      isometry: { offset: 0, direction: Math.PI / 2, rotation: 0 },
      motion: {
        offset: 0.68712149944502521,
        orbits: 0,
        turns: 0,
        duration: 10,
        repeat: "loop",
      },
    },
  },
  // The loop motif with the example leaf of Draw a loop (motifs.ts,
  // exampleLoop): one copy in each of a heptagon's 14 triangles, mirrored
  // across every side, so 14 leaves ring each center and 6 each corner.
  {
    title: "A drawn leaf in every triangle",
    note: "The example leaf from Draw a loop, mirrored like a kaleidoscope into each of every heptagon's fourteen triangles",
    study: { ...defaultLace, motifKind: "loop" },
  },
  // A festive ornament ready to print: {7,3} stars with short points
  // (0.2) and no tile sides, so each heptagon's center holds a seven-armed
  // flake joined to its neighbors. It opens with Make physical's settings
  // for a 120 mm openwork plaque of whole tiles (floor 0), which keeps the
  // central flake, its seven neighbors and seven smaller flakes beyond as
  // one body.
  {
    title: "Seven-armed snowflakes, an ornament to print",
    note: "Short-pointed stars draw a flake at every heptagon's center; Make physical prints the central flakes as one openwork ornament",
    study: {
      ...defaultLace,
      starPoint: 0.2,
      edges: false,
      physical: { ...defaultPhysical("motif"), diameter: 120, floor: 0 },
    },
  },
];
export const presetLace = (index: number): LaceStudy =>
  structuredClone(lacePresets[index].study) as LaceStudy;

// Every drawing frames the rim the same way: the unit circle centered in
// the 1000 × 760 page with a margin. The manual camera pans and zooms from
// there; zoom is a camera action and never moves the disk's geometry.
export const lacePage = { width: 1000, height: 760 };
export const laceScale = 350;
export const laceZoom: [number, number] = [0.1, 100];
export function toModel(p: Vec, camera: PlotCamera) {
  return {
    x: (p.x - 500 - camera.x) / (laceScale * camera.zoom),
    y: (380 + camera.y - p.y) / (laceScale * camera.zoom),
  };
}

// The view that frames tile i, as the Apollonian garden frames a circle:
// the bounding box of its corners centered, the box's larger side a quarter
// of the page's height, never zoomed out past the whole disk nor in past
// the zoom limit. A tile's sides bow only slightly beyond its corners.
export function followView(
  r: Pick<LaceResult, "vertex" | "corners" | "tiling">,
  i: number,
): PlotCamera {
  let x0 = Infinity,
    x1 = -Infinity,
    y0 = Infinity,
    y1 = -Infinity;
  const p = sidesOf(r);
  for (let k = 0; k < p; k++) {
    const v = r.vertex[r.corners[p * i + k]];
    x0 = Math.min(x0, v.x);
    x1 = Math.max(x1, v.x);
    y0 = Math.min(y0, v.y);
    y1 = Math.max(y1, v.y);
  }
  const side = Math.max(x1 - x0, y1 - y0);
  const zoom = Math.min(
    laceZoom[1],
    Math.max(1, lacePage.height / 4 / (side * laceScale)),
  );
  const k = laceScale * zoom;
  // Adding zero keeps a centered view's pan free of negative zeros.
  return { x: (-(x0 + x1) / 2) * k + 0, y: ((y0 + y1) / 2) * k + 0, zoom };
}

// A tile's address, from its parents back to the center tile.
export function addressOf(r: LaceResult, i: number): LaceAddress {
  const out: number[] = [];
  for (let t = i; t > 0; t = r.parent[t]) out.push(r.via[t]);
  return out.reverse();
}
// The tile with an address, or −1 when the cutoffs leave it out. The
// first tile to reach another keeps it, so each step is the child through
// that side.
const children = new WeakMap<LaceResult, Map<number, number>>();
function childOf(r: LaceResult, tile: number, side: number) {
  let map = children.get(r);
  if (!map) {
    map = new Map();
    for (let i = 1; i < r.parent.length; i++)
      map.set(sidesOf(r) * r.parent[i] + r.via[i], i);
    children.set(r, map);
  }
  return map.get(sidesOf(r) * tile + side) ?? -1;
}
export function indexOf(r: LaceResult, address: LaceAddress | undefined) {
  if (!address || r.center.length === 0) return -1;
  let t = 0;
  for (const side of address) {
    // A side another tiling's tile has, but this one's does not.
    if (side >= sidesOf(r)) return -1;
    t = childOf(r, t, side);
    if (t < 0) return -1;
  }
  return t;
}
// The tile across each side of tile i, or −1 beyond the patch.
const adjacency = new WeakMap<LaceResult, number[][]>();
export function neighbors(r: LaceResult, i: number): number[] {
  const p = sidesOf(r);
  let byEdge = adjacency.get(r);
  if (!byEdge) {
    byEdge = r.edgeA.map(() => []);
    for (let t = 0; t < r.center.length; t++)
      for (let k = 0; k < p; k++) byEdge[r.sides[p * t + k]].push(t);
    adjacency.set(r, byEdge);
  }
  return Array.from({ length: p }, (_, k) => {
    const tiles = byEdge[r.sides[p * i + k]];
    return tiles.find((t) => t !== i) ?? -1;
  });
}

// The tiles a presentation draws: all of them, or the selected tile and
// the tiles crossed to reach it from the center (with nothing selected,
// the center tile alone).
export function presented(
  r: LaceResult,
  presentation: LacePresentation,
  selected: number,
): number[] {
  if (presentation === "complete") return r.center.map((_, i) => i);
  const path: number[] = [];
  for (let t = Math.max(0, selected); t >= 0; t = r.parent[t]) path.push(t);
  return path.reverse();
}

// Which side of a tile's side k a point lies on matches the tile's center:
// inside the geodesic's circle or not, or for a diameter, the same side
// of the line through the origin.
function sameSide(r: LaceResult, tile: number, k: number, p: Vec) {
  const e = r.sides[sidesOf(r) * tile + k];
  const c = r.center[tile];
  if (r.edgeStraight[e]) {
    const a = r.vertex[r.edgeA[e]].x !== 0 || r.vertex[r.edgeA[e]].y !== 0;
    const u = a ? r.vertex[r.edgeA[e]] : r.vertex[r.edgeB[e]];
    const side = (v: Vec) => Math.sign(u.x * v.y - u.y * v.x);
    return side(p) === side(c) || side(p) === 0;
  }
  const o = r.edgeCenter[e],
    rho = r.edgeRadius[e];
  const inside = (v: Vec) => Math.hypot(v.x - o.x, v.y - o.y) < rho;
  return inside(p) === inside(c);
}
export function contains(r: LaceResult, tile: number, p: Vec) {
  const n = sidesOf(r);
  for (let k = 0; k < n; k++) if (!sameSide(r, tile, k, p)) return false;
  return true;
}
// A tile's Euclidean reach from its center to its farthest corner.
function reach(r: LaceResult, i: number) {
  let m = 0;
  const p = sidesOf(r);
  for (let k = 0; k < p; k++) {
    const v = r.vertex[r.corners[p * i + k]];
    m = Math.max(m, Math.hypot(v.x - r.center[i].x, v.y - r.center[i].y));
  }
  return m;
}
// The tile a pointer means: the drawn tile containing it, since tiles
// cover the patch without overlapping. Beyond the drawn tiles, as past
// the patch's edge or between a path's tiles, the tile whose corners come
// within tolerance page units, nearest first; otherwise −1. The test is
// arithmetic, so no hit geometry enters the drawing or exports.
export function hitTile(
  r: LaceResult,
  among: number[],
  at: Vec,
  camera: PlotCamera,
  tolerance: number,
): number {
  const p = toModel(at, camera),
    scale = laceScale * camera.zoom;
  let best = -1,
    bestGap = Infinity;
  for (const i of among) {
    const c = r.center[i];
    const d = Math.hypot(p.x - c.x, p.y - c.y);
    const out = reach(r, i);
    if (d <= out && contains(r, i, p)) return i;
    const gap = (d - out) * scale;
    if (gap <= tolerance && gap < bestGap) {
      best = i;
      bestGap = gap;
    }
  }
  return best;
}

// A tile's number in the reader's terms: one-based breadth-first order.
export const tileName = (i: number) => `Tile ${formatCount(i + 1)}`;
// Sides are numbered 1 to p for the reader, 0 to p − 1 in addresses.
export const sideName = (k: number) => `side ${k + 1}`;
export const addressText = (a: LaceAddress) =>
  a.length ? a.map((k) => k + 1).join(" → ") : "none";
// Hyperbolic distance from the origin, 2 artanh |z|.
export const fromCenter = (v: Vec) => 2 * Math.atanh(Math.hypot(v.x, v.y));
// Hyperbolic distance between two points of the disk,
// 2 asinh(|z − w| / √((1 − |z|²)(1 − |w|²))).
export const between = (z: Vec, w: Vec) =>
  2 *
  Math.asinh(
    Math.hypot(z.x - w.x, z.y - w.y) /
      Math.sqrt((1 - z.x * z.x - z.y * z.y) * (1 - w.x * w.x - w.y * w.y)),
  );
// How large a tile is drawn, relative to the center tile.
export const drawnShare = (r: LaceResult, i: number) =>
  reach(r, i) / r.vertexRadius;

// Frozen ranges for a moving tile's facts. Disk coordinates lie within
// the rim. Hyperbolic distances stay below 10: a supported patch's tile
// centers lie within 7.5 of the center tile ({4,5}'s farthest, at 1,000
// tiles, is 7.43 away), and the isometry adds at most 2 artanh 0.8 ≈ 2.2.
// Drawn sizes are shares of a tile's size at the disk's center.
const liveRanges = {
  disk: [-1, 1],
  distance: [0, 10],
  share: [0, 100],
} as const;
// A detailed view's tiles lie deeper: about 25 from the center at the
// 100× zoom limit, so their moving distances get a wider frozen range.
const deepDistance = [0, 40] as const;

// The explanation beside the drawing for the selected tile. While a motion
// plays, is paused or seeks, its numbers change with every frame: they keep
// the moved wording and one width throughout (liveReadout), so the text
// wraps alike and the controls below it hold still.
export function explain(
  r: LaceResult,
  i: number,
  moving = false,
  deep = false,
) {
  const far = deep ? deepDistance : liveRanges.distance;
  const d = r.depth[i];
  const side = formatNumber(r.sideLength);
  const t = tilingOf(r.tiling);
  const angle = formatNumber(360 / t.q);
  // Disk coordinates have unit scale: a tile carried to the disk's center
  // reads 0 there, not its rounding error near 1e-16.
  const disk = (v: number) => formatNumber(withoutResidue(v));
  const at = `(${disk(r.center[i].x)}, ${disk(r.center[i].y)})`;
  // Moved, the center tile no longer lies at the disk's center, so the
  // distance from it, which the isometry keeps, is named apart from the
  // distance from the disk's center, which it changes.
  const live = (v: number, range: readonly [number, number]) =>
    liveReadout(withoutResidue(v), range);
  const motion = `Depth ${d} · drawn at (${live(r.center[i].x, liveRanges.disk)}, ${live(r.center[i].y, liveRanges.disk)}) · hyperbolic distance ${live(between(r.center[0], r.center[i]), far)} from the center tile and ${live(fromCenter(r.center[i]), far)} from the disk's center · drawn ${live(100 * drawnShare(r, i), liveRanges.share)}% of a tile's size at the disk's center`;
  const facts = moving
    ? motion
    : isIdentity(r.isometry)
      ? `Depth ${d} · center ${at} · hyperbolic distance ${disk(fromCenter(r.center[i]))} from the center · drawn ${formatPercent(drawnShare(r, i))} of the center tile's size`
      : `Depth ${d} · drawn at ${at} · hyperbolic distance ${formatNumber(between(r.center[0], r.center[i]))} from the center tile and ${disk(fromCenter(r.center[i]))} from the disk's center · drawn ${formatPercent(drawnShare(r, i))} of a tile's size at the disk's center`;
  if (i === 0)
    return {
      facts,
      // The moving wording, whose height the page reserves at rest so
      // that starting a motion moves nothing below it.
      reserve: motion,
      text: `The center tile: a regular ${t.polygon} whose ${t.sides} sides are each ${side} long in the disk's hyperbolic measure, meeting at ${angle}°. Every other tile is a copy of it made by reflection, and so is its motif.`,
    };
  const a = addressOf(r, i);
  const steps = a.map((k, n) =>
    n === 0 ? sideName(k) : `then its ${sideName(k)}`,
  );
  return {
    facts,
    reserve: motion,
    text: `Reflecting the center tile across its ${steps.join(", ")} gives this tile. Each reflection preserves hyperbolic distance, so its sides are still ${side} long and its angles ${angle}°, though the disk draws it smaller near the rim. ${
      d % 2
        ? "After an odd number of reflections its corners and its motif run clockwise; "
        : "After an even number of reflections its corners and its motif run counterclockwise again; "
    }the motif has all ${t.sides} of the ${t.polygon}'s mirror symmetries, so its copy is the same however the tile is reached.`,
  };
}

// What finite cutoffs left out, outside the artwork: the counts, and when
// a ceiling ended generation, a notice that the patch is incomplete. With
// detail, it also gives the view's least drawn radius on screen at this
// zoom, and says that tile numbers count the view's tiles.
export function cutoffSummary(r: LaceResult, q: LaceRequest, zoom = 1) {
  const n = r.center.length;
  const deepest = n ? Math.max(...r.depth) : 0;
  let gap = 1;
  for (const v of r.vertex) gap = Math.min(gap, 1 - Math.hypot(v.x, v.y));
  const tiles = (n: number) =>
    `${formatCount(n)} ${n === 1 ? "tile" : "tiles"}`;
  const parts = [
    `${tiles(n)} at depths 0–${deepest}; the outermost corners lie ${formatNumber(gap)} inside the rim, which no tile reaches.`,
  ];
  const cut = [
    r.omitted.depth && `${tiles(r.omitted.depth)} beyond depth ${q.depth}`,
    r.omitted.view && `${tiles(r.omitted.view)} outside this view`,
    r.omitted.radius &&
      `${tiles(r.omitted.radius)} too small to draw in this view`,
    r.omitted.precision &&
      `${tiles(r.omitted.precision)} too near the rim to place reliably`,
  ].filter(Boolean);
  if (cut.length) parts.push(`Left out: ${cut.join("; ")}.`);
  if (q.window && q.minRadius)
    parts.push(
      `Beyond the cutoffs' patch, this view's tiles reach ${formatNumber(q.minRadius * laceScale * zoom)} drawing units in radius, however deep. Tile numbers count this view's tiles; addresses are the same in every view.`,
    );
  // Moved off center, the patch's finite edge nears the disk's center on
  // one side: say how far it is complete about the center.
  if (r.isometry.offset > 0)
    parts.push(
      r.coverage.radius > 0
        ? `Moved off center, it is complete only to radius ${formatNumber(r.coverage.radius)} about the disk's center (hyperbolic distance ${formatNumber(r.coverage.distance)}); beyond, the tiling goes on but this finite patch stops.`
        : "Moved off center, the disk's center lies beyond the patch.",
    );
  const stopped =
    r.stopped === "count"
      ? `Stopped at the ${formatCount(q.window ? laceViewTiles : q.maxTiles)}-tile limit${q.window ? " for a view" : ""} with ${tiles(r.pending)} unexpanded, so depth ${deepest} is incomplete.`
      : r.stopped === "candidates"
        ? `Stopped after examining ${formatCount(laceLimits.candidates)} candidate tiles with ${tiles(r.pending)} unexpanded, so depth ${deepest} is incomplete.`
        : "";
  return { text: parts.join(" "), stopped };
}

// Help that names a tiling's own depth bound, rings and star.
export function tilingHelp(t: LaceTilingInfo) {
  const held = t.rings.slice(0, t.depth + 1).reduce((a, b) => a + b, 0);
  return {
    depth: tiered(
      `Reflections from the center tile: 0–${t.maxDepth}.`,
      `Each depth reflects the previous ring of tiles across their outer sides. Depth ${t.depth} holds ${formatCount(held)} tiles; deeper rings exceed the tile limit, which then stops the last ring partway.`,
    ),
    starPoint: motifOf("star").help(t),
    detail: tiered(
      "Generate deeper tiles for the view as you zoom past 1.4×.",
      `Zoom snaps down to steps of √2. The cutoffs' patch stays, and beyond it the view gets every tile drawn at least ${formatNumber(t.detailRadius)} drawing units in radius, to 1.4 times it, however deep; at most ${formatCount(laceViewTiles)} tiles. A lace moved off center keeps its patch. A motion keeps its tiles until stopped.`,
    ),
  };
}
export const laceHelp = {
  maxTiles: tiered(
    `Most tiles kept: 1–${formatCount(laceLimits.tiles)}.`,
    `Tiles are added ring by ring. Reaching this count stops generation, leaving the last ring incomplete; the summary says so. Generation also stops after examining ${formatCount(laceLimits.candidates)} candidate tiles.`,
  ),
  tiling: tiered(
    "Which regular tiling {p,q}: p-sided tiles meeting q at each corner.",
    "Pentagons and squares are each other's duals, as are heptagons and triangles: the centers of one are the corners of the other. Changing the tiling clears the selection and opens at the deepest ring the tile limit completes.",
  ),
  motifKind: tiered(
    "The motif every tile carries: a star, petals, leaves, rings or your own loop.",
    "Each is one stroke between a tile's center, a side's midpoint and a corner, or your loop inside the triangle they make, mirrored into all the tile's symmetries, so every tile carries the same motif. Each keeps its own size.",
  ),
  edges: "Show the tiles' sides, each drawn once where two tiles share it.",
  motif: "Show the motif, the same strands reflected into every tile.",
  presentation:
    "Show every tile, or only the selected tile and those crossed to reach it.",
  follow: tiered(
    "Center each newly selected tile, zoomed to a quarter of the drawing's height.",
    "Pan and zoom freely while following; the next selection frames again. Turning this off returns to the view from before you turned it on. With reduced motion requested, the view moves at once. The camera moves only when you select: while the disk moves, it holds still.",
  ),
  offset: tiered(
    `Brings the point this far out to the middle: 0–${laceLimits.offset}.`,
    "In model units, where the rim has radius 1; 0.8 is hyperbolic distance 2.2. The rim stays put while the tiles move through it, each keeping its hyperbolic size, unlike zoom.",
  ),
  direction: tiered(
    "Which way that point lies, in radians counterclockwise from the right.",
    `−${laceLimits.angle}–${laceLimits.angle} radians; constants such as pi/7 work. It is also the line the motion glides along.`,
  ),
  rotation: tiered(
    "Turns the disk about its center, in radians counterclockwise.",
    `−${laceLimits.angle}–${laceLimits.angle} radians, applied after the offset, so the point brought to the middle stays there.`,
  ),
  motionOffset: tiered(
    `The offset reached halfway through the motion: 0–${laceLimits.offset}.`,
    "The offset eases from the isometry's to this and back, while the direction orbits. The motion starts and ends at the isometry, the same tiles throughout, so every loop is seamless.",
  ),
  orbits: tiered(
    `Whole turns of the direction: −${laceLimits.turns}–${laceLimits.turns}.`,
    "With 0, the lace glides out and back along one line through the center; otherwise the point at the middle circles the disk.",
  ),
  turns: tiered(
    `Whole turns of rotation: −${laceLimits.turns}–${laceLimits.turns}.`,
    "The disk turns about its center at a steady rate, after the offset.",
  ),
  progress:
    "Seek the motion by its time; the same time always shows the same frame.",
  duration: tiered(
    "Seconds for the whole motion: 0.1–3,600.",
    "Export makes at most 7,200 frames.",
  ),
  repeat: tiered(
    "Once, loop, or back and forth: every frame returns.",
    "The motion ends where it starts, with the same tiles, camera and layers, so a loop is seamless. Back and forth plays the motion, then reverses it, within the duration. Repeating playback continues until paused; a repeating export leaves out its last frame, which is its first.",
  ),
  tile: tiered(
    "Choose a tile by its number, in ring order.",
    "Or click or tap a tile in the drawing. Numbers follow ring order and stay the same when the cutoffs change, as long as the tile is generated.",
  ),
};
