import { tiered } from "../help";
import type { LineWeight } from "../line-weight";
import type { PlotCamera } from "../planar-link";
import type { Vec } from "../types";

// Hyperbolic lace: a finite patch of the {7,3} tiling of the Poincaré disk,
// grown in Go by reflection from one centered heptagon, with a motif
// reflected into every tile (engine/lace.go, docs/mathematics.md).
export const laceTiling = "7,3" as const;
export const laceLimits = {
  depth: 8,
  tiles: 1000,
  candidates: 10000,
} as const;
export const laceStrokes = 14;

export type LaceRequest = {
  tiling: typeof laceTiling;
  depth: number;
  maxTiles: number;
  // Where the motif's strands turn, as a fraction of the hyperbolic
  // distance from a tile's center to its corners: 0–1.
  starPoint: number;
};
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
  // Seven vertex and seven edge indices per tile.
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
  // laceStrokes geodesic arcs per tile, in tile order.
  arcStart: Vec[];
  arcEnd: Vec[];
  arcCenter: Vec[];
  arcRadius: number[];
  arcStraight: boolean[];
  omitted: { depth: number; precision: number };
  stopped: "" | "count" | "candidates";
  pending: number;
  processed: number;
  duplicates: number;
  vertexRadius: number;
  circumradius: number;
  apothem: number;
  sideLength: number;
};
export type LacePresentation = "complete" | "selected";
// A tile's address: the sides crossed from the center tile, each numbered
// 0–6 in the tile crossed. It names the same tile under any cutoffs.
export type LaceAddress = number[];
export type LaceStudy = Omit<LaceRequest, "tiling"> & {
  tiling: typeof laceTiling;
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
};

export const laceRequest = (s: LaceStudy): LaceRequest => ({
  tiling: s.tiling,
  depth: s.depth,
  maxTiles: s.maxTiles,
  starPoint: s.starPoint,
});

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
export const lacePresets = [
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
] as const satisfies readonly {
  title: string;
  note: string;
  study: LaceStudy;
}[];
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
  r: Pick<LaceResult, "vertex" | "corners">,
  i: number,
): PlotCamera {
  let x0 = Infinity,
    x1 = -Infinity,
    y0 = Infinity,
    y1 = -Infinity;
  for (let k = 0; k < 7; k++) {
    const v = r.vertex[r.corners[7 * i + k]];
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
      map.set(7 * r.parent[i] + r.via[i], i);
    children.set(r, map);
  }
  return map.get(7 * tile + side) ?? -1;
}
export function indexOf(r: LaceResult, address: LaceAddress | undefined) {
  if (!address || r.center.length === 0) return -1;
  let t = 0;
  for (const side of address) {
    t = childOf(r, t, side);
    if (t < 0) return -1;
  }
  return t;
}
// The tile across each side of tile i, or −1 beyond the patch.
const adjacency = new WeakMap<LaceResult, number[][]>();
export function neighbors(r: LaceResult, i: number): number[] {
  let byEdge = adjacency.get(r);
  if (!byEdge) {
    byEdge = r.edgeA.map(() => []);
    for (let t = 0; t < r.center.length; t++)
      for (let k = 0; k < 7; k++) byEdge[r.sides[7 * t + k]].push(t);
    adjacency.set(r, byEdge);
  }
  return Array.from({ length: 7 }, (_, k) => {
    const tiles = byEdge[r.sides[7 * i + k]];
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
  const e = r.sides[7 * tile + k];
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
  for (let k = 0; k < 7; k++) if (!sameSide(r, tile, k, p)) return false;
  return true;
}
// A tile's Euclidean reach from its center to its farthest corner.
function reach(r: LaceResult, i: number) {
  let m = 0;
  for (let k = 0; k < 7; k++) {
    const v = r.vertex[r.corners[7 * i + k]];
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

const number = (v: number) => v.toLocaleString("en-US");
// A tile's number in the reader's terms: one-based breadth-first order.
export const tileName = (i: number) => `Tile ${number(i + 1)}`;
// Sides are numbered 1–7 for the reader, 0–6 in addresses.
export const sideName = (k: number) => `side ${k + 1}`;
export const addressText = (a: LaceAddress) =>
  a.length ? a.map((k) => k + 1).join(" → ") : "none";
// Hyperbolic distance from the origin, 2 artanh |z|.
export const fromCenter = (v: Vec) => 2 * Math.atanh(Math.hypot(v.x, v.y));
// How large a tile is drawn, relative to the center tile.
export const drawnShare = (r: LaceResult, i: number) =>
  reach(r, i) / r.vertexRadius;
const percent = (v: number) =>
  v >= 0.1 ? `${Math.round(v * 100)}%` : `${(v * 100).toPrecision(2)}%`;

// The explanation beside the drawing for the selected tile.
export function explain(r: LaceResult, i: number) {
  const d = r.depth[i];
  const side = r.sideLength.toFixed(3);
  const facts = `Depth ${d} · center (${r.center[i].x.toFixed(4)}, ${r.center[i].y.toFixed(4)}) · hyperbolic distance ${fromCenter(r.center[i]).toFixed(3)} from the center · drawn ${percent(drawnShare(r, i))} of the center tile's size`;
  if (i === 0)
    return {
      facts,
      text: `The center tile: a regular heptagon whose seven sides are each ${side} long in the disk's hyperbolic measure, meeting at 120°. Every other tile is a copy of it made by reflection, and so is its motif.`,
    };
  const a = addressOf(r, i);
  const steps = a.map((k, n) =>
    n === 0 ? sideName(k) : `then its ${sideName(k)}`,
  );
  return {
    facts,
    text: `Reflecting the center tile across its ${steps.join(", ")} gives this tile. Each reflection preserves hyperbolic distance, so its sides are still ${side} long and its angles 120°, though the disk draws it smaller near the rim. ${
      d % 2
        ? "After an odd number of reflections its corners and its motif run clockwise; "
        : "After an even number of reflections its corners and its motif run counterclockwise again; "
    }the motif has all seven of the heptagon's mirror symmetries, so its copy is the same however the tile is reached.`,
  };
}

// What finite cutoffs left out, outside the artwork: the counts, and when
// a ceiling ended generation, a notice that the patch is incomplete.
export function cutoffSummary(r: LaceResult, q: LaceRequest) {
  const n = r.center.length;
  const deepest = n ? Math.max(...r.depth) : 0;
  let gap = 1;
  for (const v of r.vertex) gap = Math.min(gap, 1 - Math.hypot(v.x, v.y));
  const tiles = (n: number) => `${number(n)} ${n === 1 ? "tile" : "tiles"}`;
  const parts = [
    `${tiles(n)} at depths 0–${deepest}; the outermost corners lie ${gap.toPrecision(2)} inside the rim, which no tile reaches.`,
  ];
  const cut = [
    r.omitted.depth && `${tiles(r.omitted.depth)} beyond depth ${q.depth}`,
    r.omitted.precision &&
      `${tiles(r.omitted.precision)} too near the rim to place reliably`,
  ].filter(Boolean);
  if (cut.length) parts.push(`Left out: ${cut.join("; ")}.`);
  const stopped =
    r.stopped === "count"
      ? `Stopped at the ${number(q.maxTiles)}-tile limit with ${tiles(r.pending)} unexpanded, so depth ${deepest} is incomplete.`
      : r.stopped === "candidates"
        ? `Stopped after examining ${number(laceLimits.candidates)} candidate tiles with ${tiles(r.pending)} unexpanded, so depth ${deepest} is incomplete.`
        : "";
  return { text: parts.join(" "), stopped };
}

export const laceHelp = {
  depth: tiered(
    `Reflections from the center tile: 0–${laceLimits.depth}.`,
    `Each depth reflects the previous ring of tiles across their outer sides. Depth 5 holds 617 tiles; deeper rings exceed the tile limit, which then stops the last ring partway.`,
  ),
  maxTiles: tiered(
    `Most tiles kept: 1–${number(laceLimits.tiles)}.`,
    `Tiles are added ring by ring. Reaching this count stops generation, leaving the last ring incomplete; the summary says so. Generation also stops after examining ${number(laceLimits.candidates)} candidate tiles.`,
  ),
  starPoint: tiered(
    "Where each strand turns, from tile center (0) to corner (1).",
    "Measured in the disk's hyperbolic distance. At 0 the strands meet at the center and draw the dual triangles; small values give seven-pointed stars, larger ones strapwork that hugs the tile's sides.",
  ),
  edges: "Show the tiles' sides, each drawn once where two tiles share it.",
  motif: "Show the motif, the same strands reflected into every tile.",
  presentation:
    "Show every tile, or only the selected tile and those crossed to reach it.",
  follow: tiered(
    "Center each newly selected tile, zoomed to a quarter of the drawing's height.",
    "Pan and zoom freely while following; the next selection frames again. Turning this off returns to the view from before you turned it on. With reduced motion requested, the view moves at once.",
  ),
  tile: tiered(
    "Choose a tile by its number, in ring order.",
    "Or click or tap a tile in the drawing. Numbers follow ring order and stay the same when the cutoffs change, as long as the tile is generated.",
  ),
};
