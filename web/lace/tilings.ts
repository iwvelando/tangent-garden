// The regular tilings {p,q} the lace draws: p-sided tiles meeting q at
// each corner (engine.laceTilings). {7,3} is the shipped tiling; the others
// are issue #389's research catalog, offered only with ?research=389.
// Components read these descriptors rather than branching on a tiling.
export const laceResearch =
  typeof location !== "undefined" &&
  new URLSearchParams(location.search).get("research") === "389";

export type LaceTilingId = "7,3" | "5,4" | "4,5" | "3,7";
export type LaceTilingInfo = {
  id: LaceTilingId;
  p: number;
  q: number;
  // The tile, singular and plural, its side count and the tiles at a
  // corner in words.
  polygon: string;
  polygons: string;
  sides: string;
  around: string;
  label: string;
  // The depth a research study opens at: its deepest ring that completes
  // within the 1,000-tile limit.
  depth: number;
  // The rings' sizes from depth 0, for help (from engine/lace_tilings_test.go).
  rings: number[];
  research: boolean;
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
    label: "{7,3} heptagons",
    depth: 5,
    rings: [1, 7, 21, 56, 147, 385, 1008],
    research: false,
  },
  {
    id: "5,4",
    p: 5,
    q: 4,
    polygon: "pentagon",
    polygons: "Pentagons",
    sides: "five",
    around: "four",
    label: "{5,4} pentagons",
    depth: 5,
    rings: [1, 5, 15, 40, 105, 275, 720],
    research: true,
  },
  {
    id: "4,5",
    p: 4,
    q: 5,
    polygon: "square",
    polygons: "Squares",
    sides: "four",
    around: "five",
    label: "{4,5} squares",
    depth: 6,
    rings: [1, 4, 12, 28, 64, 148, 340, 780],
    research: true,
  },
  {
    id: "3,7",
    p: 3,
    q: 7,
    polygon: "triangle",
    polygons: "Triangles",
    sides: "three",
    around: "seven",
    label: "{3,7} triangles",
    depth: 8,
    rings: [1, 3, 6, 12, 18, 30, 45, 72, 111],
    research: true,
  },
];

export const tilingOf = (id: string): LaceTilingInfo =>
  laceTilings.find((t) => t.id === id) ?? laceTilings[0];
// The tilings a reader may choose: the shipped one, and with
// ?research=389 the research catalog.
export const offeredTilings = () =>
  laceTilings.filter((t) => laceResearch || !t.research);
// Corners and sides per tile of a result.
export const sidesOf = (r: { tiling: string }) => tilingOf(r.tiling).p;
