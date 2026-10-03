import { test, expect } from "@playwright/test";
import { progressAt, cycles, type Pace, type Repeat } from "../web/timing";
import { exportTiming } from "../web/export-quality";

// The time an animation has reached (the clock and the timeline, from 0 to
// 1 over its duration) as the progress of its motion: repeated once, as a
// loop or back and forth, at a steady or eased pace.
const repeats: Repeat[] = ["once", "loop", "back-and-forth"];
const paces: Pace[] = ["steady", "ease"];

test("steady once is the identity, so existing animations keep their timing", () => {
  for (let i = 0; i <= 1000; i++) {
    const t = i / 1000;
    expect(progressAt(t, "once", "steady")).toBe(t);
    expect(progressAt(t, "loop", "steady")).toBe(t);
  }
  // Outside the timeline it holds its ends.
  expect(progressAt(-0.25, "once", "steady")).toBe(0);
  expect(progressAt(1.5, "once", "steady")).toBe(1);
});

test("every repeat and pace reaches its endpoints exactly", () => {
  for (const pace of paces) {
    for (const repeat of repeats) expect(progressAt(0, repeat, pace)).toBe(0);
    expect(progressAt(1, "once", pace)).toBe(1);
    expect(progressAt(1, "loop", pace)).toBe(1);
    // Back and forth turns at the end exactly halfway, and is home again.
    expect(progressAt(0.5, "back-and-forth", pace)).toBe(1);
    expect(progressAt(1, "back-and-forth", pace)).toBe(0);
  }
});

test("back and forth retraces its outward pass in reverse", () => {
  for (const pace of paces)
    for (let i = 0; i <= 200; i++) {
      const t = i / 200;
      expect(progressAt(1 - t, "back-and-forth", pace)).toBeCloseTo(
        progressAt(t, "back-and-forth", pace),
        14,
      );
      // Outward it is the single pass at twice the speed.
      if (t <= 0.5)
        expect(progressAt(t, "back-and-forth", pace)).toBeCloseTo(
          progressAt(2 * t, "once", pace),
          14,
        );
    }
});

test("easing is a half cosine: monotone, symmetric, at rest at both ends", () => {
  const ease = (t: number) => progressAt(t, "once", "ease");
  // Independent closed form.
  for (let i = 0; i <= 100; i++) {
    const t = i / 100;
    expect(ease(t)).toBeCloseTo((1 - Math.cos(Math.PI * t)) / 2, 14);
    expect(ease(t) + ease(1 - t)).toBeCloseTo(1, 14);
    if (i) expect(ease(t)).toBeGreaterThan(ease(t - 0.01));
  }
  // Its speed vanishes at both ends and peaks at π/2 halfway.
  const h = 1e-6;
  expect(ease(h) / h).toBeLessThan(1e-4);
  expect((1 - ease(1 - h)) / h).toBeLessThan(1e-4);
  expect((ease(0.5 + h) - ease(0.5 - h)) / (2 * h)).toBeCloseTo(Math.PI / 2, 6);
  // Back and forth, eased, is one smooth cosine: no corner at either turn.
  for (const t of [0, 0.25, 0.5, 0.75])
    expect(progressAt(t, "back-and-forth", "ease")).toBeCloseTo(
      (1 - Math.cos(2 * Math.PI * t)) / 2,
      14,
    );
});

test("only a loop and back and forth repeat", () => {
  expect(cycles("once")).toBe(false);
  expect(cycles("loop")).toBe(true);
  expect(cycles("back-and-forth")).toBe(true);
});

test("a repeating export leaves out the frame that is the first again", () => {
  for (const duration of [0.1, 0.1234, 1, 4, 30])
    for (const fps of [15, 30, 60]) {
      const once = exportTiming(duration, fps),
        cyclic = exportTiming(duration, fps, true);
      const count = Math.max(2, Math.ceil(duration * fps));
      expect(cyclic).toHaveLength(count);
      expect(once).toHaveLength(count);
      // Equally spaced over one period, the next frame being time 1, which
      // is time 0 again.
      cyclic.forEach((f, i) => expect(f.progress).toBe(i / count));
      // The same frame durations, so the file keeps its duration.
      expect(cyclic.map((f) => f.duration)).toEqual(
        once.map((f) => f.duration),
      );
      expect(cyclic.reduce((s, f) => s + f.duration, 0)).toBe(
        Math.round(duration * 1000),
      );
    }
  // Unchanged without the option: both endpoints.
  expect(exportTiming(1, 15).map((f) => f.progress)).toEqual(
    Array.from({ length: 15 }, (_, i) => i / 14),
  );
  expect(exportTiming(1, 15, false)).toEqual(exportTiming(1, 15));
});
