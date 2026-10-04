import { test, expect } from "@playwright/test";
import { markupGap, markupRefusal } from "../web/loop-check";

// The 2D and 4D notebooks judge a loop on the drawing itself: the SVG the
// renderer makes at the start and at the end, compared number for number
// and otherwise character for character, leaving out metadata that records
// the inputs rather than draws them.
const drawing = (path: string, extra = "") =>
  `<svg viewBox="0 0 1000 760" data-animation-progress="0.5"><desc>{"a":0}</desc><path d="${path}" stroke="#1a2b3c" stroke-width="1.5"/>${extra}</svg>`;

test("matching drawings have no gap, within a hundredth of a pixel", () => {
  const a = drawing("M10.000,20.000 L30.000,40.000 ");
  expect(markupGap(a, a)).toBe(0);
  // Rounding at the third decimal, and a negative zero.
  expect(markupGap(a, drawing("M10.001,19.999 L30.000,40.000 "))).toBe(0);
  expect(markupGap(drawing("M-0.000,1 "), drawing("M0.000,1 "))).toBe(0);
});

test("metadata that records the inputs is not the drawing", () => {
  const a = drawing("M1,2 ");
  const b = a
    .replace('data-animation-progress="0.5"', 'data-animation-progress="1"')
    .replace('{"a":0}', '{"a":6.283185307179586}');
  expect(markupGap(a, b)).toBe(0);
  const titled = (t: string) =>
    a.replace("<desc>", `<title>${t}</title><desc>`);
  expect(markupGap(titled("start"), titled("end, with more words"))).toBe(0);
});

test("moved geometry reports the largest difference in pixels", () => {
  const a = drawing("M10,20 L30,40 L50,60 ");
  expect(markupGap(a, drawing("M10,20 L30,42.5 L50,61 "))).toBeCloseTo(2.5);
  // A color or width is drawn too.
  expect(
    markupGap(a, a.replace('stroke-width="1.5"', 'stroke-width="2"')),
  ).toBeCloseTo(0.5);
});

test("different pieces are named as such", () => {
  const a = drawing("M10,20 L30,40 ");
  // A gap in a curve, one more point, one more element, another color.
  expect(markupGap(a, drawing("M10,20 M30,40 "))).toBe("pieces");
  expect(markupGap(a, drawing("M10,20 L30,40 L50,60 "))).toBe("pieces");
  expect(markupGap(a, drawing("M10,20 L30,40 ", '<circle r="2"/>'))).toBe(
    "pieces",
  );
  expect(markupGap(a, a.replace("#1a2b3c", "#1a2b3d"))).toBe("pieces");
});

test("a refusal names what differs and what to do", () => {
  const a = drawing("M10,20 L30,40 ");
  expect(markupRefusal(a, a, " Choose Back and forth.")).toBeNull();
  expect(
    markupRefusal(a, drawing("M10,20 L30,43 "), " Choose Back and forth."),
  ).toBe(
    "Repeat can loop only motion that ends where it starts, but the drawing at the end lies up to 3.0 pixels from the drawing at the start. Choose Back and forth.",
  );
  expect(markupRefusal(a, drawing("M10,20 "), " Choose Back and forth.")).toBe(
    "Repeat can loop only motion that ends where it starts, but the drawing at the end has different pieces from the drawing at the start. Choose Back and forth.",
  );
});
