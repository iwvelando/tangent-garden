// The 3D drawing's colors, as [light theme, dark theme] RGB pairs from 0 to
// 1. The WebGL fragment shader is written from these values, and vector
// linework uses them directly, so both draw a line in the same color.
type RGB = [number, number, number];
type Pair = readonly [RGB, RGB];

export const palette = {
  background: [
    [243 / 255, 241 / 255, 234 / 255],
    [11 / 255, 21 / 255, 23 / 255],
  ],
  teal: [
    [0.3, 0.62, 0.56],
    [0.23, 0.7, 0.67],
  ],
  gold: [
    [0.9, 0.66, 0.36],
    [0.94, 0.65, 0.31],
  ],
  // A surface's focal sheets: rust for the first, slate for the second.
  rust: [
    [0.72, 0.36, 0.26],
    [0.9, 0.55, 0.42],
  ],
  slate: [
    [0.33, 0.4, 0.66],
    [0.58, 0.66, 0.92],
  ],
  // A receiver's irradiance: no light, the faintest, and the peak.
  empty: [
    [0.91, 0.9, 0.86],
    [0.12, 0.14, 0.14],
  ],
  faint: [
    [0.84, 0.83, 0.79],
    [0.21, 0.23, 0.23],
  ],
  full: [
    [0.08, 0.09, 0.1],
    [0.98, 0.97, 0.92],
  ],
  // Receding construction lines: unwinding strings, connectors, rays.
  recede: [
    [0.58, 0.66, 0.63],
    [0.24, 0.37, 0.37],
  ],
  // Involute filaments and other families run from their first color to
  // their last (decorative, not a measured quantity); the dark theme's last
  // color is its gold.
  familyFirst: [
    [0.04, 0.38, 0.36],
    [0.4, 0.88, 0.8],
  ],
  familyLast: [
    [0.66, 0.4, 0.12],
    [0.94, 0.65, 0.31],
  ],
  // Construction lines (ink 1) and the curves themselves (ink 2).
  construction: [
    [0.1, 0.3, 0.29],
    [0.63, 0.89, 0.83],
  ],
  curve: [
    [0.5, 0.25, 0.09],
    [1, 0.87, 0.58],
  ],
  offset: [
    [0.58, 0.66, 0.58],
    [0.42, 0.54, 0.5],
  ],
} satisfies Record<string, Pair>;

// A color as a GLSL literal, and a pair chosen by the shader's `dark`
// uniform, 0 or 1.
export const vec3 = (c: RGB) =>
  `vec3(${c.map((n) => (Number.isInteger(n) ? n.toFixed(1) : String(n))).join(",")})`;
export const glsl = (pair: Pair) =>
  `mix(${vec3(pair[0])},${vec3(pair[1])},dark)`;

const mixed = (a: RGB, b: RGB, t: number): RGB =>
  a.map((x, i) => x + (b[i] - x) * t) as RGB;

// The color the shader gives a line of this ink and phase. Only lines are
// covered: shaded sheets (ink 0 and below) and receiver bins (7) are not.
export function lineColor(ink: number, phase: number, dark: boolean): RGB {
  const k = dark ? 1 : 0;
  if (ink > 5.5) return palette.slate[k];
  if (ink > 4.5) return palette.rust[k];
  if (ink > 3.5) return palette.recede[k];
  if (ink > 2.5)
    return mixed(palette.familyFirst[k], palette.familyLast[k], 0.7 * phase);
  return ink < 1.5 ? palette.construction[k] : palette.curve[k];
}

export const hex = (c: RGB) =>
  "#" +
  c
    .map((x) =>
      Math.round(255 * Math.max(0, Math.min(1, x)))
        .toString(16)
        .padStart(2, "0"),
    )
    .join("");
