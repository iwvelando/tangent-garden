import { readout as formatNumber } from "../number-format";

// The garden's seeds (engine/apollonian_seeds.go). Only the original is
// public; the rest are issue #385's research catalog, offered only with
// ?research=385 in the address. Go is the authority on the circles; this
// describes them for the page: how they are named, how many seed circles
// they have, and the normalization from their exact curvatures (in units
// where the enclosing circle has curvature b₀ = −scale) to the drawing's
// units, where the enclosing radius is 1.
export type GardenSeedId =
  | "-1,2,2,3"
  | "-2,3,6,7"
  | "-3,5,8,8"
  | "-6,11,14,15"
  | "3-2r3,1,1,1"
  | "-1,3,3,3,3,3,3,3";

export type GardenSeedDescriptor = {
  id: GardenSeedId;
  // The choice's label, and the heading's eyebrow.
  label: string;
  curvatures: string;
  symmetry: string;
  // Seed circles, the enclosing circle included.
  seeds: number;
  // |b₀| as p + q√3, and the weighted centers' denominator.
  scale: [number, number];
  denominator: number;
  research: boolean;
};

export const gardenSeeds: readonly GardenSeedDescriptor[] = [
  {
    id: "-1,2,2,3",
    label: "−1, 2, 2, 3 · two mirrors",
    curvatures: "−1, 2, 2, 3",
    symmetry: "two mirrors",
    seeds: 4,
    scale: [1, 0],
    denominator: 1,
    research: false,
  },
  {
    id: "-2,3,6,7",
    label: "−2, 3, 6, 7 · one mirror",
    curvatures: "−2, 3, 6, 7",
    symmetry: "one mirror",
    seeds: 4,
    scale: [2, 0],
    denominator: 2,
    research: true,
  },
  {
    id: "-3,5,8,8",
    label: "−3, 5, 8, 8 · one mirror",
    curvatures: "−3, 5, 8, 8",
    symmetry: "one mirror",
    seeds: 4,
    scale: [3, 0],
    denominator: 3,
    research: true,
  },
  {
    id: "-6,11,14,15",
    label: "−6, 11, 14, 15 · no symmetry",
    curvatures: "−6, 11, 14, 15",
    symmetry: "no symmetry",
    seeds: 4,
    scale: [6, 0],
    denominator: 30,
    research: true,
  },
  {
    id: "3-2r3,1,1,1",
    label: "3 − 2√3, 1, 1, 1 · three-fold",
    curvatures: "3 − 2√3, 1, 1, 1",
    symmetry: "three turns and three mirrors",
    seeds: 4,
    scale: [-3, 2],
    denominator: 3,
    research: true,
  },
  {
    id: "-1,3,3,3,3,3,3,3",
    label: "Six around one · six-fold",
    curvatures: "−1 and seven circles of 3",
    symmetry: "six turns and six mirrors",
    seeds: 8,
    scale: [1, 0],
    denominator: 1,
    research: true,
  },
];

export const seedOf = (id: string): GardenSeedDescriptor =>
  gardenSeeds.find((s) => s.id === id) ?? gardenSeeds[0];

const root3 = Math.sqrt(3);
export const rootValue = (p: number, q = 0) => (q ? p + q * root3 : p);

// p + q√3 as text, in the interface's number format.
export function rootText(p: number | bigint, q: number | bigint = 0) {
  const n = (v: number | bigint) => formatNumber(Number(v));
  const neg = (v: number | bigint) => (typeof v === "bigint" ? v < 0n : v < 0);
  const abs = (v: number | bigint) =>
    typeof v === "bigint" ? (v < 0n ? -v : v) : Math.abs(v);
  const isZero = (v: number | bigint) => Number(v) === 0;
  if (isZero(q)) return neg(p) ? `−${n(abs(p))}` : n(p);
  const r = Number(abs(q)) === 1 ? "√3" : `${n(abs(q))}√3`;
  if (isZero(p)) return neg(q) ? `−${r}` : r;
  return `${neg(p) ? "−" : ""}${n(abs(p))} ${neg(q) ? "−" : "+"} ${r}`;
}
