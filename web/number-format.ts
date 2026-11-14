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
