// The regular tilings {p,q} the lace draws: p-sided tiles meeting q at
// each corner (engine.laceTilings). {7,3} is the default. Components read
// these descriptors rather than branching on a tiling.
export type LaceTilingId = "7,3" | "5,4" | "4,5" | "3,7";
export type LaceTilingInfo = {
  id: LaceTilingId;
  p: number;
  q: number;
  // The tile, singular and plural, its side count and the tiles at a
  // corner in words, and the dual tiling's tiles.
  polygon: string;
  polygons: string;
  sides: string;
  around: string;
  dual: string;
  label: string;
  // The depth the tiling opens at: its deepest ring that completes within
  // the 1,000-tile limit.
  depth: number;
  // The deepest depth the engine accepts: 8, or 11 for {3,7}, whose slow
  // rings need it to reach the tile limit (engine.LaceMaxDepthTriangles).
  maxDepth: number;
  // The rings' sizes from depth 0 to maxDepth, for help (from
  // engine/lace_tilings_test.go).
  rings: number[];
};

export const laceTilings: readonly LaceTilingInfo[] = [
  {
    id: "7,3",
    p: 7,
    q: 3,
    polygon: "heptagon",
    polygons: "Heptagons",
    sides: "seven",
    around: "three",
    dual: "triangles",
    label: "{7,3} heptagons",
    depth: 5,
    maxDepth: 8,
    rings: [1, 7, 21, 56, 147, 385, 1008, 2639, 6909],
  },
  {
    id: "5,4",
    p: 5,
    q: 4,
    polygon: "pentagon",
    polygons: "Pentagons",
    sides: "five",
    around: "four",
    dual: "squares",
    label: "{5,4} pentagons",
    depth: 5,
    maxDepth: 8,
    rings: [1, 5, 15, 40, 105, 275, 720, 1885, 4935],
  },
  {
    id: "4,5",
    p: 4,
    q: 5,
    polygon: "square",
    polygons: "Squares",
    sides: "four",
    around: "five",
    dual: "pentagons",
    label: "{4,5} squares",
    depth: 6,
    maxDepth: 8,
    rings: [1, 4, 12, 28, 64, 148, 340, 780, 1792],
  },
  {
    id: "3,7",
    p: 3,
    q: 7,
    polygon: "triangle",
    polygons: "Triangles",
    sides: "three",
    around: "seven",
    dual: "heptagons",
    label: "{3,7} triangles",
    depth: 10,
    maxDepth: 11,
    rings: [1, 3, 6, 12, 18, 30, 45, 72, 111, 174, 270, 420],
  },
];

export const tilingOf = (id: string): LaceTilingInfo =>
  laceTilings.find((t) => t.id === id) ?? laceTilings[0];
// The deepest depth any tiling accepts, the longest address a link holds.
export const deepestDepth = Math.max(...laceTilings.map((t) => t.maxDepth));
// Corners and sides per tile of a result.
export const sidesOf = (r: { tiling: string }) => tilingOf(r.tiling).p;
