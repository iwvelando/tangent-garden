import type { Config, HarmonicResult, Term } from "./types";

// A period as a multiple of π when it is one with a small denominator, both
// to read (2π/3) and as a constant expression for the domain (2*pi/3).
export function periodText(period: number) {
  const turns = period / Math.PI;
  for (let q = 1; q <= 1000; q++) {
    const p = Math.round(turns * q);
    if (p > 0 && Math.abs(turns * q - p) <= 1e-9 * p) {
      const pi = p === 1 ? "π" : `${p}π`;
      return {
        text: q === 1 ? pi : `${pi}/${q}`,
        expression: `${p === 1 ? "pi" : `${p}*pi`}${q === 1 ? "" : `/${q}`}`,
      };
    }
  }
  return { text: `${period.toPrecision(6)}`, expression: String(period) };
}

// Closure depends only on the frequencies that move the curve, so a result
// computed for other amplitudes or phases still describes it.
export function closureKey(curve: Config["curve"]) {
  if (curve.format === "lissajous") {
    const l = curve.lissajous;
    return JSON.stringify([
      l.amplitudeX !== 0 && l.frequencyX,
      l.amplitudeY !== 0 && l.frequencyY,
    ]);
  }
  return JSON.stringify(
    curve.terms.map((term) => term.radius !== 0 && term.frequency),
  );
}

export function closureNote(harmonic: HarmonicResult) {
  if (harmonic.constant)
    return "Nothing turns: every term has zero frequency or zero radius, so the curve is a single point.";
  if (!harmonic.period)
    return "The frequencies are not in a whole-number ratio with denominators up to 1,000, so the curve never closes exactly. It is not forced closed.";
  const span = periodText(harmonic.period).text;
  return harmonic.whole
    ? `Every frequency is a whole number, so the curve is closed: it repeats after t spans ${span}.`
    : `The frequencies are in a whole-number ratio, so the curve closes after t spans ${span}.`;
}

// A term to add after the last: the next frequency up, turning the other
// way, at half the radius.
export function nextTerm(terms: Term[]): Term {
  const last = terms.at(-1);
  const top = Math.max(0, ...terms.map((t) => Math.abs(t.frequency)));
  const sign = last && last.frequency > 0 ? -1 : 1;
  const frequency = Number.isFinite(top) ? sign * (Math.floor(top) + 1) : 1;
  const radius =
    last && Number.isFinite(last.radius) && last.radius > 0
      ? last.radius / 2
      : 0.5;
  return { frequency, radius, phase: 0 };
}
