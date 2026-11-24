import { tiered, type Help } from "../help";
import type { Term } from "../types";
import { exampleLeafTerms } from "../example-leaf";
import type { LaceTilingInfo } from "./tilings";

// The motifs the lace reflects into every tile (engine laceMotifs,
// docs/mathematics.md, Hyperbolic lace, Motifs). Each is one stroke in the
// seed's fundamental triangle, between its center, a side's midpoint and a
// corner, mirrored by all the tile's symmetries; the loop is a closed curve
// drawn in Draw a loop, placed in that triangle's incircle. Components read
// these descriptors rather than branching on a motif.
export type LaceMotifId = "star" | "petals" | "leaves" | "rings" | "loop";
// The study fields holding each motif's size, kept while another motif is
// shown so that choosing it again restores it.
export type LaceMotifField =
  "starPoint" | "petalFullness" | "leafFullness" | "ringRadius" | "loopSize";
export type LaceMotifInfo = {
  id: LaceMotifId;
  label: string;
  field: LaceMotifField;
  // The size field's label, its range as the engine admits it, and its
  // value when the study holds none.
  size: string;
  range: [number, number];
  initial: number;
  help: (t: LaceTilingInfo) => Help<string>;
  // Whether the motif is a curve drawn in Draw a loop, which the lace can
  // send back there to redraw.
  drawn?: boolean;
};

const flower = (t: LaceTilingInfo) => Math.max(t.p, t.q);

export const laceMotifs: readonly LaceMotifInfo[] = [
  {
    id: "star",
    label: "Star",
    field: "starPoint",
    size: "Star point",
    range: [0, 1],
    initial: 0.3,
    help: (t) =>
      tiered(
        "Where each strand turns, from tile center (0) to corner (1).",
        `Measured in the disk's hyperbolic distance. At 0 the strands meet at the center and draw the dual ${t.dual}; small values give ${t.sides}-pointed stars, larger ones strapwork that hugs the tile's sides.`,
      ),
  },
  {
    id: "petals",
    label: "Petals",
    field: "petalFullness",
    size: "Fullness",
    range: [0, 1],
    initial: 1,
    help: (t) =>
      tiered(
        "How wide each petal opens, from a straight spoke (0) to touching (1).",
        `Petals run from each tile's center to its corners: flowers of ${t.p} petals at the centers and ${t.q} at the corners. At 1 the petals of each ${flower(t)}-petal flower touch. The dual tiling draws the same petals.`,
      ),
  },
  {
    id: "leaves",
    label: "Leaves",
    field: "leafFullness",
    size: "Fullness",
    range: [0, 1],
    initial: 1,
    help: (t) =>
      tiered(
        "How wide each leaf opens, from a straight line (0) to touching (1).",
        `Leaves run from each tile's center to its sides' midpoints and join across every side into one leaf between two centers. At 0 they are the dual ${t.dual}' sides, as the star's strands are at star point 0. At 1 the ${t.p} leaves around each center touch.`,
      ),
  },
  {
    id: "rings",
    label: "Rings",
    field: "ringRadius",
    size: "Ring radius",
    range: [0.1, 1],
    initial: 1,
    help: (t) =>
      tiered(
        "Each ring's size, as a share of the tile's inscribed circle: 0.1–1.",
        `Rings are hyperbolic circles about every tile's center, drawn in the disk as circles. At 1 they are the inscribed circles, each touching its ${t.sides} neighbors at the sides' midpoints, ${t.around} around every corner.`,
      ),
  },
  {
    id: "loop",
    label: "Your loop",
    field: "loopSize",
    size: "Loop size",
    range: [0.1, 1],
    initial: 1,
    drawn: true,
    help: (t) =>
      tiered(
        "The loop's size, as a share of the largest circle in its triangle: 0.1–1.",
        `A tile splits into ${2 * t.p} triangles between its center, a side's midpoint and a corner. Each holds one copy of the loop inside its inscribed circle, mirrored across every side like a kaleidoscope, ${2 * t.q} copies around every corner. Draw a new loop replaces it with a fit of up to 16 terms.`,
      ),
  },
];

// The loop the lace shows until one is drawn: the example leaf of Draw a
// loop fitted with 8 terms, as Go fits it.
export const exampleLoop: readonly Term[] = exampleLeafTerms;
// A loop term's whole frequency, within the range Draw a loop fits
// (engine.LaceLoopMaxFrequency).
export const loopMaxFrequency = 64;

export const motifOf = (id: string | undefined): LaceMotifInfo =>
  laceMotifs.find((m) => m.id === id) ?? laceMotifs[0];
// The motif a curve from Draw a loop is woven into.
export const drawnMotif = laceMotifs.find((m) => m.drawn)!;
