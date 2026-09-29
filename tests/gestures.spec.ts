import { test, expect } from "@playwright/test";
import { createGesture } from "../web/gestures";

const touch = (pointerId: number, clientX: number, clientY: number) => ({
  pointerId,
  clientX,
  clientY,
  pointerType: "touch",
  shiftKey: false,
});

test("one pointer drags, with shift carried for a mouse", () => {
  const g = createGesture();
  g.down({ ...touch(1, 10, 10), pointerType: "mouse", shiftKey: true });
  expect(
    g.move({ ...touch(1, 15, 7), pointerType: "mouse", shiftKey: true }),
  ).toEqual({ kind: "drag", dx: 5, dy: -3, shift: true });
  expect(g.move(touch(2, 0, 0))).toBeNull();
  g.up(touch(1, 15, 7));
  expect(g.move(touch(1, 20, 7))).toBeNull();
});

test("two pointers pinch and pan about their midpoint", () => {
  const g = createGesture();
  g.down(touch(1, 100, 100));
  g.down(touch(2, 200, 100));
  // Spreading one finger doubles their distance and moves the midpoint.
  const spread = g.move(touch(2, 300, 100))!;
  expect(spread.kind).toBe("pinch");
  if (spread.kind !== "pinch") return;
  expect(spread.scale).toBeCloseTo(2, 12);
  expect([spread.dx, spread.dy]).toEqual([50, 0]);
  expect(spread.mid).toEqual({ x: 200, y: 100 });
  // Moving together pans without zooming.
  g.move(touch(1, 100, 140));
  const pan = g.move(touch(2, 300, 140))!;
  expect(pan.kind).toBe("pinch");
  if (pan.kind !== "pinch") return;
  expect(pan.dy).toBe(20);
});

test("fingers landing and lifting never jump, and a third is ignored", () => {
  const g = createGesture();
  g.down(touch(1, 0, 0));
  g.move(touch(1, 10, 0));
  g.down(touch(2, 100, 0));
  g.down(touch(3, 50, 50));
  expect(g.move(touch(3, 90, 90))).toBeNull();
  g.move(touch(2, 120, 0));
  g.up(touch(2, 120, 0));
  // The remaining finger drags on from where it is.
  expect(g.move(touch(1, 13, 4))).toEqual({
    kind: "drag",
    dx: 3,
    dy: 4,
    shift: false,
  });
  g.up(touch(1, 13, 4));
  // Coincident fingers have no distance to scale by.
  g.down(touch(4, 5, 5));
  g.down(touch(5, 5, 5));
  const still = g.move(touch(5, 5, 5))!;
  expect(still.kind === "pinch" && still.scale).toBe(1);
});
