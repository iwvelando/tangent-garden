import { plainSheetValue, type SheetValue } from "../atlas-sheet-notes";
import type { SpatialConfig } from "./types";

export function spatialSheetDefinition(
  c: SpatialConfig,
  value: SheetValue = plainSheetValue,
): string[] {
  if (c.format === "implicit")
    return [
      `F(x, y, z) = ${c.implicit.f}`,
      `F(x, y, z) = c; c = ${value(["implicit", "level"], c.implicit.level)}; a = ${value(["implicit", "a"], c.implicit.a)}`,
    ];
  if (c.format === "surface") {
    const s = c.surface;
    return [
      "Ellipsoid · x²/a² + y²/b² + z²/c² = 1",
      `a = ${value(["surface", "a"], s.a)}; b = ${value(["surface", "b"], s.b)}; c = ${s.c}`,
      `u ∈ [${s.uMin}, ${s.uMax}]; v ∈ [${s.vMin}, ${s.vMax}]`,
    ];
  }
  return [
    "Torus knot",
    "r(t) = ((R+ρ cos(qt)) cos(pt), (R+ρ cos(qt)) sin(pt), ρ sin(qt))",
    `R = ${c.radius}; ρ = ${c.tube}; p = ${value(["p"], c.p)}; q = ${value(["q"], c.q)}; 0 ≤ t ≤ 2π`,
    `Construction: ${c.construction}; input: ${c.input}`,
  ];
}
