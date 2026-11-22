import { tiered, type Help } from "../help";
import { readout as formatNumber } from "../number-format";

// The garden's seeds (engine/apollonian_seeds.go, engine/apollonian_split.go,
// docs/mathematics.md): the original −1, 2, 2, 3, the default, five more,
// and the split diameter, the one seed with a parameter. Go is the
// authority on the circles; this describes them for the page: how they are
// named, how many seed circles they have, and the normalization from their
// exact curvatures (in units where the enclosing circle has curvature
// b₀ = −scale) to the drawing's units, where the enclosing radius is 1.
// The choice lists them in this order.
export type GardenSeedId =
  | "-1,2,2,3"
  | "-2,3,6,7"
  | "-3,5,8,8"
  | "-6,11,14,15"
  | "3-2r3,1,1,1"
  | "-1,3,3,3,3,3,3,3"
  | "split";

// A seed's exact values, fixed for the catalog and a function of its
// parameter for the split diameter.
export type GardenSeedValues = {
  // The heading's eyebrow.
  curvatures: string;
  // The curvatures as an exported file records them: numbers, or text
  // for p + q√3.
  record: readonly (number | string)[];
  // |b₀| as p + q√3, and the weighted centers' denominator.
  scale: [number, number];
  denominator: number;
};

// The split diameter's member: the fraction m/n, in lowest terms.
export type GardenSplit = [number, number];

// A seed's parameter: its field in the study and the request, label, help,
// the range the engine admits, the value it opens with, and the seed's
// values for one member.
export type GardenFamily = {
  label: string;
  help: Help<string>;
  range: [number, number];
  initial: number;
  maxDenominator: number;
  values: (split: GardenSplit) => GardenSeedValues;
};

export type GardenSeedDescriptor = {
  id: GardenSeedId;
  // The choice's label.
  label: string;
  symmetry: string;
  // Seed circles, the enclosing circle included.
  seeds: number;
  // Shown under the choice while the seed is chosen.
  note?: string;
} & (
  | { values: GardenSeedValues; family?: undefined }
  | { family: GardenFamily; values?: undefined }
);

// The integers of the split diameter at m/n (engine/apollonian_split.go):
// curvatures −m(n − m), n(n − m), nm and n² − m(n − m), enclosing, left,
// right and top, with weighted centers over D = m(n − m).
function splitValues([m, n]: GardenSplit): GardenSeedValues {
  const d = m * (n - m);
  const record = [-d, n * (n - m), n * m, n * n - d];
  return {
    curvatures: record.map((v) => rootText(v)).join(", "),
    record,
    scale: [d, 0],
    denominator: d,
  };
}

const splitFamily: GardenFamily = {
  label: "Split",
  help: tiered(
    "The left seed circle's radius, in enclosing radii: 0.05–0.95.",
    "The right circle fills the rest of the diameter. The value is rounded to the nearest fraction with a denominator of at most 100, which makes every curvature an integer; 1/2 is the original seed. A new split clears the selection.",
  ),
  range: [0.05, 0.95],
  initial: 0.25,
  maxDenominator: 100,
  values: splitValues,
};

export const gardenSeeds: readonly GardenSeedDescriptor[] = [
  {
    id: "-1,2,2,3",
    label: "−1, 2, 2, 3 · two mirrors",
    symmetry: "two mirrors",
    seeds: 4,
    values: {
      curvatures: "−1, 2, 2, 3",
      record: [-1, 2, 2, 3],
      scale: [1, 0],
      denominator: 1,
    },
  },
  {
    id: "-1,3,3,3,3,3,3,3",
    label: "Six around one · six-fold",
    symmetry: "six turns and six mirrors",
    seeds: 8,
    values: {
      curvatures: "−1 and seven circles of 3",
      record: [-1, 3, 3, 3, 3, 3, 3, 3],
      scale: [1, 0],
      denominator: 1,
    },
    note: "Not a single Descartes seed: each of its twelve first gaps is filled from a virtual opposite, the other circle tangent to its three, which is not drawn.",
  },
  {
    id: "3-2r3,1,1,1",
    label: "3 − 2√3, 1, 1, 1 · three-fold",
    symmetry: "three turns and three mirrors",
    seeds: 4,
    values: {
      curvatures: "3 − 2√3, 1, 1, 1",
      record: ["3 − 2√3", 1, 1, 1],
      scale: [-3, 2],
      denominator: 3,
    },
  },
  {
    id: "-2,3,6,7",
    label: "−2, 3, 6, 7 · one mirror",
    symmetry: "one mirror",
    seeds: 4,
    values: {
      curvatures: "−2, 3, 6, 7",
      record: [-2, 3, 6, 7],
      scale: [2, 0],
      denominator: 2,
    },
  },
  {
    id: "-3,5,8,8",
    label: "−3, 5, 8, 8 · one mirror",
    symmetry: "one mirror",
    seeds: 4,
    values: {
      curvatures: "−3, 5, 8, 8",
      record: [-3, 5, 8, 8],
      scale: [3, 0],
      denominator: 3,
    },
  },
  {
    id: "-6,11,14,15",
    label: "−6, 11, 14, 15 · no symmetry",
    symmetry: "no symmetry",
    seeds: 4,
    values: {
      curvatures: "−6, 11, 14, 15",
      record: [-6, 11, 14, 15],
      scale: [6, 0],
      denominator: 30,
    },
  },
  {
    id: "split",
    label: "Split diameter · editable",
    symmetry: "one mirror, two at 1/2",
    seeds: 4,
    family: splitFamily,
  },
];

export const seedOf = (id: string): GardenSeedDescriptor =>
  gardenSeeds.find((s) => s.id === id) ?? gardenSeeds[0];

// A study's member of its seed's family: the entered value rounded to the
// nearest fraction m/n with n at most the family's denominator, compared
// exactly; a tie goes to the smaller denominator, then the smaller
// numerator. Values are first clamped to 0–1, so one outside it gives 0/1
// or 1/1, which the engine refuses with the range. Undefined for a seed
// without a family, or a value that is not finite.
export function splitOf(study: {
  seed: string;
  split?: number;
}): GardenSplit | undefined {
  const family = seedOf(study.seed).family;
  const v = study.split;
  if (!family || v === undefined || !Number.isFinite(v)) return undefined;
  return nearestFraction(v, family.maxDenominator);
}
export function nearestFraction(value: number, most: number): GardenSplit {
  const v = Math.min(1, Math.max(0, value));
  // Nearer 0 or 1 than half of 1/most, nothing else is closer.
  if (v < 0.5 / most) return [0, 1];
  if (v > 1 - 0.5 / most) return [1, 1];
  // v = M/2^k exactly: scaling by a power of two is exact.
  let k = 0;
  while (!Number.isInteger(v * 2 ** k)) k++;
  const M = BigInt(v * 2 ** k),
    K = 2n ** BigInt(k);
  let best: GardenSplit = [0, 1],
    err = M,
    errOver = 1n;
  for (let n = 1; n <= most; n++) {
    const N = BigInt(n);
    const floor = (M * N) / K;
    for (const m of [floor, floor + 1n]) {
      const e = M * N - m * K;
      const abs = e < 0n ? -e : e;
      // |v − m/n| = abs/(n·2^k); compare abs/n against the best's.
      if (abs * errOver < err * N) {
        best = [Number(m), n];
        err = abs;
        errOver = N;
      }
    }
  }
  return best;
}
// Whether a member is one the engine admits: within the family's range.
export const admittedSplit = (family: GardenFamily, [m, n]: GardenSplit) =>
  m / n >= family.range[0] && m / n <= family.range[1];
// A seed's exact values: fixed, or its family's at a member strictly
// between 0 and 1. Undefined for a family without one.
export function seedValuesAt(
  id: string,
  split?: GardenSplit,
): GardenSeedValues | undefined {
  const seed = seedOf(id);
  if (seed.values) return seed.values;
  return split && split[0] > 0 && split[0] < split[1]
    ? seed.family.values(split)
    : undefined;
}
// A study's seed values, at its member.
export const seedValues = (study: { seed: string; split?: number }) =>
  seedValuesAt(study.seed, splitOf(study));
// The fraction as text, as the note and record give it.
export const fractionText = ([m, n]: GardenSplit) =>
  `${formatNumber(m)}/${formatNumber(n)}`;

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
