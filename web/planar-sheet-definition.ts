import { plainSheetValue, type SheetValue } from "./atlas-sheet-notes";
// Literal descriptions of the active definition, not a second evaluator.
import { mapFormulas, mapNames } from "./attractor";
import type { Config } from "./types";

export function planarSheetDefinition(
  config: Config,
  value: SheetValue = plainSheetValue,
): string[] {
  const c = config.curve;
  const domain = `t ∈ [${c.min}, ${c.max}]; a = ${value(["curve", "a"], c.a)}`;
  const construction = `Construction: ${config.kind}; input: ${config.input}`;
  switch (c.format) {
    case "parametric":
      return [`r(t) = (${c.x}, ${c.y})`, domain, construction];
    case "cartesian":
      return [
        `y(x) = ${c.y}`,
        `x ∈ [${c.min}, ${c.max}]; a = ${value(["curve", "a"], c.a)}`,
        construction,
      ];
    case "polar":
      return [`Polar r(t) = ${c.r}`, domain, construction];
    case "roulette": {
      const r = c.roulette;
      const formula =
        r.roll === "inside"
          ? "z(t) = (R−r) exp(it) + d exp(i(φ−(R−r)t/r))"
          : r.roll === "outside"
            ? "z(t) = (R+r) exp(it) − d exp(i(φ+(R+r)t/r))"
            : "z(t) = rt + ir + d exp(i(φ−t−π/2))";
      return [
        `Roulette · ${r.roll}`,
        formula,
        `${r.roll !== "line" ? `R = ${r.fixedRadius}; ` : ""}r = ${value(["curve", "roulette", "radius"], r.radius)}; d = ${value(["curve", "roulette", "arm"], r.arm)}; φ = ${r.phase} rad`,
        `t ∈ [${c.min}, ${c.max}]`,
        construction,
      ];
    }
    case "lissajous": {
      const l = c.lissajous;
      return [
        "x(t) = A sin(mt+φ); y(t) = B sin(nt)",
        `A = ${l.amplitudeX}; B = ${l.amplitudeY}; m = ${value(["curve", "lissajous", "frequencyX"], l.frequencyX)}; n = ${value(["curve", "lissajous", "frequencyY"], l.frequencyY)}; φ = ${l.phase} rad`,
        `t ∈ [${c.min}, ${c.max}]`,
        construction,
      ];
    }
    case "fourier":
      return [
        "z(t) = Σ rⱼ exp(i(ωⱼt+φⱼ))",
        ...c.terms.map(
          (term, i) =>
            `Term ${i + 1}: r = ${value(["curve", "terms", i, "radius"], term.radius)}; ω = ${value(["curve", "terms", i, "frequency"], term.frequency)}; φ = ${term.phase} rad`,
        ),
        `t ∈ [${c.min}, ${c.max}]`,
        construction,
      ];
    case "implicit":
      return [
        `F(x, y) = ${c.implicit.f}`,
        `F(x, y) = c; c = ${value(["curve", "implicit", "level"], c.implicit.level)}; a = ${value(["curve", "a"], c.a)}`,
        ...(c.implicit.family.enabled
          ? [
              `Other levels: ${c.implicit.family.from} to ${c.implicit.family.to}, ${c.implicit.family.count} levels`,
            ]
          : []),
      ];
    case "attractor": {
      const a = c.attractor;
      return [
        `${mapNames[a.map]} iterated map`,
        mapFormulas[a.map],
        `a = ${value(["curve", "attractor", "a"], a.a)}; b = ${value(["curve", "attractor", "b"], a.b)}; c = ${a.c}; d = ${a.d}`,
        `Start = (${a.start.x}, ${a.start.y}); ${a.iterates} preview iterates after ${a.discard} discarded`,
      ];
    }
    case "field":
      return [
        `dx/dt = ${c.field.x}; dy/dt = ${c.field.y}`,
        `Seeds: ${c.field.seeds.map((p) => `(${p.x}, ${p.y})`).join(", ")}; escape radius = ${c.field.escape}`,
        domain,
        construction,
      ];
    case "pursuit":
      return [
        "Cyclic pursuit · each point follows the next",
        ...c.pursuit.pursuers.map(
          (p, i) => `Point ${i + 1}: (${p.x}, ${p.y}); speed = ${p.speed}`,
        ),
        `Capture distance = ${c.pursuit.capture}; t ∈ [${c.min}, ${c.max}]`,
        construction,
      ];
  }
}
