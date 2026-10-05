import { test, expect } from "@playwright/test";
import { matte } from "../web/matte";

// Pages as the renderer would draw them: ink of color c and coverage a,
// over black and over white, rounded to 8 bits as a drawing buffer is.
function pages(pixels: { c: number[]; a: number }[]) {
  const black = new Uint8Array(pixels.length * 4),
    white = new Uint8Array(pixels.length * 4);
  pixels.forEach(({ c, a }, i) => {
    for (let k = 0; k < 3; k++) {
      black[i * 4 + k] = Math.round(c[k] * a);
      white[i * 4 + k] = Math.round(c[k] * a + 255 * (1 - a));
    }
    black[i * 4 + 3] = white[i * 4 + 3] = 255;
  });
  return { black, white };
}

test("full ink keeps its exact color, and an empty page is clear", () => {
  const { black, white } = pages([
    { c: [20, 118, 105], a: 1 },
    { c: [200, 40, 7], a: 0 },
  ]);
  expect(Array.from(matte(black, white))).toEqual([
    20, 118, 105, 255, 0, 0, 0, 0,
  ]);
});

test("partial coverage composites back onto any background", () => {
  // See-through sheets: n layers of opacity α cover 1 − (1 − α)ⁿ.
  const cases = [];
  for (const n of [1, 2, 3, 5])
    for (const alpha of [0.05, 0.3, 0.35, 0.8])
      cases.push({ c: [161, 107, 29], a: 1 - (1 - alpha) ** n });
  for (let a = 0.01; a < 1; a += 0.07) cases.push({ c: [112, 80, 162], a });
  const { black, white } = pages(cases);
  const out = matte(black, white);
  for (const background of [
    [243, 241, 234],
    [11, 21, 23],
    [128, 128, 128],
  ])
    cases.forEach(({ c, a }, i) => {
      const alpha = out[i * 4 + 3] / 255;
      expect(Math.abs(alpha - a)).toBeLessThanOrEqual(1 / 255);
      for (let k = 0; k < 3; k++) {
        // The file over the background against the page drawn over it:
        // within the rounding of three 8-bit values.
        const composite = out[i * 4 + k] * alpha + background[k] * (1 - alpha);
        const drawn = c[k] * a + background[k] * (1 - a);
        expect(Math.abs(composite - drawn)).toBeLessThan(1.5);
      }
    });
});

test("pages of different sizes are refused", () => {
  expect(() => matte(new Uint8Array(8), new Uint8Array(4))).toThrow(
    /differ in size/,
  );
});
