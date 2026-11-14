// How numbers read in the interface: readouts, notes, captions and labels.
//
// Not for values the user typed, which are shown exactly as entered (sheet
// definitions, links, ScalarInput text); not for editable generated defaults,
// which `roundedGenerated` in atlas-queue.ts shortens under its own budget;
// and not for SVG path data, GLSL literals or export metadata, which are
// machine-read.

const minus = "−";
const sign = (text: string) => text.replace(/-/g, minus);

// Rounded to `digits` significant digits, with no floating-point tail or
// trailing zeros. Plain between 1e-4 and 10^digits, so a rounded integer is
// never padded with zeros that look exact; scientific (1.2e−5) elsewhere.
export function readout(v: number, digits = 6): string {
  if (Number.isNaN(v)) return "undefined";
  if (v === Infinity) return "∞";
  if (v === -Infinity) return `${minus}∞`;
  if (v === 0) return "0";
  const rounded = Number(v.toPrecision(digits));
  // Rounding up can pass the largest double; keep the digits, not ∞.
  if (!Number.isFinite(rounded))
    return sign(
      v
        .toExponential(digits - 1)
        .replace(/\.?0+e/, "e")
        .replace("e+", "e"),
    );
  const a = Math.abs(rounded);
  const text =
    a >= 1e-4 && a < 10 ** digits
      ? String(a)
      : a.toExponential().replace("e+", "e");
  return (rounded < 0 ? minus : "") + sign(text);
}

// Readouts of a list of values (a family's members, say) with the fewest
// digits, at least `minDigits`, that give different values different labels.
// Rounding is monotonic, so it suffices to part sorted neighbors.
export function distinctReadouts(
  values: readonly number[],
  minDigits = 4,
): string[] {
  const sorted = [
    ...new Set(values.filter(Number.isFinite).map((v) => v + 0)),
  ].sort((a, b) => a - b);
  let digits = minDigits;
  while (
    digits < 17 &&
    sorted.some(
      (v, i) =>
        i > 0 &&
        Number(v.toPrecision(digits)) ===
          Number(sorted[i - 1].toPrecision(digits)),
    )
  )
    digits++;
  return values.map((v) => readout(v, digits));
}

const grouped = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });

// A whole number with en-US grouping, whatever the browser's locale.
export function count(n: number): string {
  if (!Number.isSafeInteger(n)) return readout(n);
  return sign(grouped.format(n || 0));
}

export const plural = (n: number, one: string, many = `${one}s`) =>
  `${count(n)} ${n === 1 ? one : many}`;

export type ReadoutRange = readonly [number, number];
const figureSpace = "\u2007";

// One notation and decimal precision for an entire playback range. Reserve
// integer and sign columns with figure spaces (one tabular digit wide).
// Six significant digits of the range's magnitude, and at least three of
// its span, keep narrow edited ranges perceptible. This is presentation
// only: never feed the rounded text back into an evaluation or a link.
export function liveReadout(v: number, range: ReadoutRange): string {
  if (!Number.isFinite(v) || !range.every(Number.isFinite)) return readout(v);
  const low = Math.min(...range),
    high = Math.max(...range);
  const magnitude = Math.max(Math.abs(low), Math.abs(high));
  const exponent =
    magnitude && (magnitude < 1e-4 || magnitude >= 1e6)
      ? Math.floor(Math.log10(magnitude))
      : 0;
  // Splitting the scale keeps the smallest subnormal's 1e-324 denominator
  // from underflowing, without overflowing the largest double's scale.
  const scale = (n: number) =>
    (n / 10 ** Math.max(-323, exponent)) *
    10 ** (Math.max(-323, exponent) - exponent);
  const a = scale(low),
    b = scale(high),
    x = scale(v);
  const top = Math.max(Math.abs(a), Math.abs(b));
  const span = Number(Math.abs(b - a).toPrecision(12));
  const decimals = Math.max(
    0,
    Math.min(100, 5 - Math.floor(Math.log10(top || 1))),
    span > 0 ? Math.min(100, 2 - Math.floor(Math.log10(span) + 1e-9)) : 0,
  );
  const fixed = (n: number) => Math.abs(n).toFixed(decimals);
  const width = Math.max(fixed(a).length, fixed(b).length);
  const text = fixed(x);
  // A nonzero value below this range's decimal resolution retains its
  // sign as an explicit bound, in the same reserved columns as zero.
  if (v !== 0 && Number(text) === 0) {
    const bound = `${v < 0 ? ">−" : "<"}1e${sign(String(exponent - decimals))}`;
    const columns =
      width +
      (low < 0 ? 1 : 0) +
      (exponent ? `e${sign(String(exponent))}`.length : 0);
    return bound.padStart(columns, figureSpace);
  }
  const negative = x < 0 && Number(text) !== 0;
  return (
    (negative ? minus : low < 0 ? figureSpace : "") +
    text.padStart(width, figureSpace) +
    (exponent ? `e${sign(String(exponent))}` : "")
  );
}

// A fraction, with enough significant digits for small shares. A proper
// fraction must never masquerade as all of a quantity after rounding.
export function percent(share: number): string {
  if (!Number.isFinite(share)) return readout(share);
  if (share < 1 && share > 0 && Number((share * 100).toPrecision(3)) === 100)
    return "over 99.9%";
  return `${readout(share * 100, 3)}%`;
}

// Elapsed wall time has a deliberate tenth-second resolution. Reserve the
// whole-second columns up to the duration; the duration itself stays clean.
export function elapsed(seconds: number, duration: number): string {
  if (!Number.isFinite(seconds) || !Number.isFinite(duration)) return "—";
  const current = sign((seconds || 0).toFixed(1));
  const width = (duration || 0).toFixed(1).length;
  return `${current.padStart(width, figureSpace)} / ${readout(duration)} s`;
}
export const mebibytes = (bytes: number) =>
  `${readout(bytes / (1024 * 1024))} MiB`;

// Timeline and export progress use whole percentage points. Disclose
// sub-percent progress and near-completion without claiming an endpoint.
export function progressPercent(progress: number): string {
  if (!Number.isFinite(progress)) return readout(progress);
  const value = Math.round(progress * 100);
  if (progress > 0 && value === 0) return "under 1%";
  if (progress < 1 && progress > 0 && value === 100) return "over 99%";
  return `${count(value)}%`;
}
