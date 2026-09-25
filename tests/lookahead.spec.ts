import { test, expect } from "@playwright/test";
import { inOrder } from "../web/lookahead";

const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Tracks how many started tasks have not yet been consumed.
function tracked(delays: number[], fail?: number) {
  const started: number[] = [];
  let outstanding = 0,
    peak = 0;
  const start = async (i: number) => {
    started.push(i);
    outstanding++;
    peak = Math.max(peak, outstanding);
    await delay(delays[i % delays.length]);
    if (i === fail) throw new Error(`frame ${i} failed`);
    return i * 10;
  };
  return {
    start,
    started,
    consumed: () => outstanding--,
    peak: () => peak,
  };
}

test("results arrive in index order with bounded work in progress", async () => {
  for (const window of [1, 2, 4]) {
    const t = tracked([9, 1, 5, 0, 7, 2, 3]);
    const out: number[] = [];
    for await (const value of inOrder(20, window, t.start)) {
      t.consumed();
      out.push(value);
    }
    expect(out).toEqual(Array.from({ length: 20 }, (_, i) => i * 10));
    expect(t.started).toEqual(Array.from({ length: 20 }, (_, i) => i));
    expect(t.peak()).toBeLessThanOrEqual(window);
    if (window > 1) expect(t.peak()).toBe(window);
  }
});

test("work overlaps: a window of 4 is faster than one at a time", async () => {
  const time = async (window: number) => {
    const began = performance.now();
    for await (const _ of inOrder(12, window, () => delay(20))) void _;
    return performance.now() - began;
  };
  expect(await time(4)).toBeLessThan((await time(1)) / 2);
});

test("an error surfaces at its own index, after earlier results", async () => {
  const t = tracked([5, 0, 3], 3);
  const out: number[] = [];
  await expect(async () => {
    for await (const value of inOrder(10, 3, t.start)) {
      t.consumed();
      out.push(value);
    }
  }).rejects.toThrow("frame 3 failed");
  expect(out).toEqual([0, 10, 20]);
});

test("abort and early exit start no new work and leave no unhandled rejections", async () => {
  const unhandled: unknown[] = [];
  const record = (reason: unknown) => unhandled.push(reason);
  process.on("unhandledRejection", record);
  try {
    const controller = new AbortController();
    const t = tracked([2]);
    await expect(async () => {
      for await (const value of inOrder(50, 3, t.start, controller.signal)) {
        t.consumed();
        if (value === 20) controller.abort();
      }
    }).rejects.toThrow();
    const count = t.started.length;
    await delay(30);
    expect(t.started.length).toBe(count);
    expect(count).toBeLessThanOrEqual(3 + 3);

    // Pending tasks that fail after the consumer stops must not escape.
    const failing = (i: number) =>
      delay(5).then(() => {
        throw new Error(`late ${i}`);
      });
    for await (const _ of inOrder(10, 4, (i) =>
      i === 0 ? Promise.resolve(0) : failing(i),
    ))
      break;
    await delay(30);
    expect(unhandled).toEqual([]);
  } finally {
    process.off("unhandledRejection", record);
  }
});

test("invalid windows are rejected", async () => {
  for (const window of [0, -1, 1.5, NaN])
    await expect(async () => {
      for await (const _ of inOrder(3, window, async () => 0)) void _;
    }).rejects.toThrow("window");
});
