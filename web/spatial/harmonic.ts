import { periodText } from "../harmonic";
import type {
  HarmonicCurve,
  HarmonicTerm,
  SpatialHarmonicResult,
  Vec3,
} from "./types";

const zero = (v: Vec3) => v.x === 0 && v.y === 0 && v.z === 0;
// A term moves the curve when it turns and has a nonzero vector.
export const moves = (t: HarmonicTerm) =>
  t.frequency !== 0 && !(zero(t.cosine) && zero(t.sine));

// Closure depends only on the moving frequencies and the domain, so a result
// computed for other vectors or another center still describes it.
export const harmonicClosureKey = (h: HarmonicCurve) =>
  JSON.stringify([h.terms.map((t) => moves(t) && t.frequency), h.min, h.max]);

export function harmonicClosureNote(h: SpatialHarmonicResult, span: number) {
  if (!h.period)
    return "The frequencies are not in a whole-number ratio with denominators up to 1,000, so the curve never repeats exactly. It is drawn as an open arc over the domain, not forced closed.";
  const period = periodText(h.period).text;
  const kind = h.whole
    ? "Every moving frequency is a whole number"
    : "The frequencies are in a whole-number ratio";
  if (!h.closed)
    return `${kind}, so the curve repeats after t spans ${period}. The domain is not a whole number of periods, so it is drawn as an open arc.`;
  const turns = Math.round(span / h.period);
  return `${kind}, so the curve repeats after t spans ${period}. The domain spans ${turns === 1 ? "one period" : `${turns} periods`}, so it is drawn closed.`;
}

// A term to add after the last: the next frequency up, turning the other way,
// with the last term's vectors halved (or a small circle when it has none).
export function nextHarmonicTerm(terms: HarmonicTerm[]): HarmonicTerm {
  const last = terms.at(-1);
  const top = Math.max(0, ...terms.map((t) => Math.abs(t.frequency)));
  const sign = last && last.frequency > 0 ? -1 : 1;
  const frequency = Number.isFinite(top) ? sign * (Math.floor(top) + 1) : 1;
  const usable =
    last &&
    [last.cosine, last.sine].every((v) =>
      [v.x, v.y, v.z].every(Number.isFinite),
    ) &&
    !(zero(last.cosine) && zero(last.sine));
  const half = (v: Vec3) => ({ x: v.x / 2, y: v.y / 2, z: v.z / 2 });
  return usable
    ? { frequency, cosine: half(last.cosine), sine: half(last.sine) }
    : {
        frequency,
        cosine: { x: 0.5, y: 0, z: 0 },
        sine: { x: 0, y: 0.5, z: 0 },
      };
}

const subscripts = "₀₁₂₃₄₅₆₇₈₉";
const subscript = (n: number) =>
  [...String(n)].map((d) => subscripts[+d]).join("");
// Field and track labels, numbered from 1 as subscripts: ω₁, A₂ x.
export const harmonicLabels = {
  frequency: (n: number) => `Frequency ω${subscript(n)}`,
  cosine: (n: number, axis: keyof Vec3) => `A${subscript(n)} ${axis}`,
  sine: (n: number, axis: keyof Vec3) => `B${subscript(n)} ${axis}`,
  center: (axis: keyof Vec3) => `c₀ ${axis}`,
};
