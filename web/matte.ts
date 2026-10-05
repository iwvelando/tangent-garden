// A transparent page from two opaque ones. Every way the 3D renderer puts
// color on its page is linear in the background B: a pixel shows
// P + B·T, where P is everything drawn (premultiplied) and T what lets the
// background through. See-through sheets are the example: over B they give
// B·(1 − α)ⁿ + c̄·(1 − (1 − α)ⁿ), so T = (1 − α)ⁿ, the page's alpha is
// 1 − T and P = c̄·(1 − T). Drawn over black the page is P; over white it is
// P + T. Both are drawn by the same program as the opaque drawing, so where
// the drawing covers its page the transparent one has exactly its ink.
//
// black and white are 8-bit RGBA pages of the same size; the result is
// straight (not premultiplied) RGBA, as a PNG stores it. T is the mean of
// the three channels' estimates, which agree but for rounding.
export function matte(black: Uint8Array, white: Uint8Array) {
  if (black.length !== white.length)
    throw new Error("The two pages differ in size.");
  const out = new Uint8ClampedArray(black.length);
  for (let i = 0; i < black.length; i += 4) {
    const through =
      Math.max(0, white[i] - black[i]) +
      Math.max(0, white[i + 1] - black[i + 1]) +
      Math.max(0, white[i + 2] - black[i + 2]);
    const alpha = 255 - Math.round(through / 3);
    if (alpha <= 0) continue;
    const k = 255 / alpha;
    out[i] = Math.round(black[i] * k);
    out[i + 1] = Math.round(black[i + 1] * k);
    out[i + 2] = Math.round(black[i + 2] * k);
    out[i + 3] = alpha;
  }
  return out;
}
