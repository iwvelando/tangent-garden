import { test, expect } from "@playwright/test";
import { play } from "../web/playback";
import { playbackEngineCount } from "../web/engine-client";
import { redraws } from "../web/AnimationPanel";
import { redraws as spatialRedraws } from "../web/spatial/SpatialAnimationPanel";

const flush = () => new Promise((r) => setImmediate(r));

// Plays against a simulated clock: display frames hz times a second (60 by
// default), and each lane replies after its latency. Nothing waits on real
// time.
function simulate(options: {
  lanes: number;
  duration: number;
  from?: number;
  // Milliseconds a request takes, by lane and by the request's order.
  latency: (lane: number, order: number) => number;
  // Lag of the frame timestamp behind the clock, as requestAnimationFrame
  // can report a frame's start before playback began.
  lag?: number;
  failAt?: number;
  repeat?: boolean;
  hz?: number;
  // Frame timestamps rounded to this many milliseconds, as browsers coarsen
  // them, and moved by up to ± jitter.
  resolution?: number;
  jitter?: (frame: number) => number;
  // Frames come without calculating, so playback may aim for 60 a second.
  redraw?: boolean;
  // Whether the page is too busy to draw at a display frame, given the
  // clock and the requests sent so far: the frame is skipped.
  busy?: (at: number, sent: { at: number }[]) => boolean;
}) {
  let t = 1000,
    ids = 0;
  const frames = new Map<number, (now: number) => void>();
  const due: { at: number; settle: () => void }[] = [];
  const sent: { lane: number; p: number; at: number }[] = [];
  const replied: number[] = [];
  const shown: number[] = [];
  const failures: unknown[] = [];
  const busy = Array(options.lanes).fill(0);
  let ended = 0,
    peak = 0;
  const lanes = busy.map(
    (_, lane) => (p: number) =>
      new Promise<number>((resolve, reject) => {
        const order = sent.length;
        sent.push({ lane, p, at: t });
        busy[lane]++;
        peak = Math.max(peak, ...busy);
        due.push({
          at: t + options.latency(lane, order),
          settle: () => {
            busy[lane]--;
            replied.push(order);
            if (order === options.failAt)
              reject(new Error(`request ${order} failed`));
            else resolve(p * 10);
          },
        });
      }),
  );
  const cancel = play({
    from: options.from ?? 0,
    duration: options.duration,
    repeat: options.repeat,
    redraw: options.redraw,
    lanes,
    show: (value, p) => {
      expect(value).toBe(p * 10);
      shown.push(p);
    },
    end: () => ended++,
    fail: (error) => failures.push(error),
    frame: (cb) => {
      frames.set(++ids, cb);
      return ids;
    },
    cancelFrame: (id) => frames.delete(id),
    now: () => t,
  });
  const step = 1000 / (options.hz ?? 60);
  let count = 0;
  const stamp = (at: number) => {
    const r = options.resolution;
    const moved = at + (options.jitter?.(count++) ?? 0);
    return r ? Math.round(moved / r) * r : moved;
  };
  async function advance(ms: number) {
    const until = t + ms;
    while (t < until) {
      const next = Math.min(until, t + step);
      // Replies settle at their own times, between display frames.
      for (;;) {
        due.sort((a, b) => a.at - b.at);
        if (!due.length || due[0].at > next) break;
        const reply = due.shift()!;
        t = Math.max(t, reply.at);
        reply.settle();
        await flush();
      }
      t = next;
      if (options.busy?.(t, sent)) continue;
      const ready = [...frames.values()];
      frames.clear();
      const at = stamp(t - (options.lag ?? 0));
      for (const cb of ready) cb(at);
      await flush();
    }
  }
  return {
    advance,
    cancel,
    sent,
    replied,
    shown,
    failures,
    busy,
    peak: () => peak,
    ended: () => ended,
    pendingFrames: () => frames.size,
  };
}

test("each lane holds one request, progress rises to exactly 1, and ends once", async () => {
  for (const lanes of [1, 2, 3]) {
    const s = simulate({ lanes, duration: 3000, latency: () => 250 });
    await s.advance(5000);
    expect(s.peak()).toBe(1);
    expect(s.ended()).toBe(1);
    expect(s.shown.at(-1)).toBe(1);
    for (let i = 1; i < s.shown.length; i++)
      expect(s.shown[i]).toBeGreaterThan(s.shown[i - 1]);
    expect(Math.min(...s.shown)).toBeGreaterThanOrEqual(0);
    // Nothing is requested after the endpoint, and nothing ticks after it.
    expect(s.sent.filter((r) => r.p === 1)).toHaveLength(1);
    expect(s.pendingFrames()).toBe(0);
  }
});

test("a fast study asks for 30 frames a second, whatever the display's rate", async () => {
  // A display's frames are 1000/hz ms apart, so two at 60 Hz or four at
  // 120 Hz span 1000/30 ms, give or take the rounding of their timestamps.
  // Waiting for a gap of at least 1000/30 ms then waits a frame more half
  // the time, and plays at 20 to 24 frames a second.
  for (const hz of [60, 120, 144])
    for (const lanes of [1, 2])
      for (const [resolution, jitter] of [
        [0, undefined],
        [0.1, undefined],
        [0.005, (k: number) => ((k * 7919) % 11) / 10 - 0.5],
      ] as const) {
        const s = simulate({
          lanes,
          duration: 10_000,
          hz,
          resolution,
          jitter,
          latency: () => 5,
        });
        await s.advance(4000);
        const name = `${hz} Hz, ${lanes} lanes, ${resolution} ms`;
        // Settled: requests over the last three seconds.
        const recent = s.sent.filter((r) => r.at > s.sent[0].at + 1000);
        const rate =
          ((recent.length - 1) * 1000) / (recent.at(-1)!.at - recent[0].at);
        expect(rate, name).toBeGreaterThan(hz === 144 ? 28 : 29.5);
        expect(rate, name).toBeLessThanOrEqual(30.5);
        // Never two requests a display frame or less apart than 30 a second
        // allows.
        for (let i = 1; i < s.sent.length; i++)
          expect(s.sent[i].at - s.sent[i - 1].at, name).toBeGreaterThan(
            1000 / 30 - 1000 / hz,
          );
        s.cancel();
      }
});

// Requests a second between two clock times, and the gaps between them.
function rate(sent: { at: number }[], from: number, to: number) {
  const at = sent.map((r) => r.at).filter((t) => t >= from && t < to);
  return {
    perSecond: ((at.length - 1) * 1000) / (at.at(-1)! - at[0]),
    gaps: at.slice(1).map((t, i) => t - at[i]),
  };
}

test("frames that come without calculating play at 60 a second", async () => {
  for (const hz of [60, 120, 144])
    for (const lanes of [1, 2]) {
      const s = simulate({
        lanes,
        duration: 10_000,
        hz,
        resolution: 0.1,
        redraw: true,
        latency: () => 2,
      });
      await s.advance(4000);
      const name = `${hz} Hz, ${lanes} lanes`;
      const { perSecond, gaps } = rate(s.sent, 2000, 5000);
      // Every other display frame at 144 Hz, 72 a second, is the even rate
      // nearest 60.
      expect(perSecond, name).toBeGreaterThan(59.5);
      expect(perSecond, name).toBeLessThan(hz === 144 ? 72.5 : 60.5);
      for (const gap of gaps)
        expect(gap, name).toBeGreaterThan(1000 / 60 - 1000 / hz);
      s.cancel();
    }
});

test("a display frame missed now and then keeps playback at 60", async () => {
  // A pause, as for garbage collection, misses one display frame a second.
  let skipped = -Infinity;
  const s = simulate({
    lanes: 1,
    duration: 10_000,
    resolution: 0.1,
    redraw: true,
    latency: () => 2,
    busy: (at) => {
      if (at - skipped < 1000) return false;
      skipped = at;
      return true;
    },
  });
  await s.advance(5000);
  const { perSecond, gaps } = rate(s.sent, 1500, 5500);
  expect(gaps.filter((g) => g > 25).length).toBeGreaterThanOrEqual(3);
  expect(perSecond).toBeGreaterThan(57);
  s.cancel();
});

test("frames that come late fall back to an even 30 a second, and return to 60 once they keep up", async () => {
  // Replies take 30 ms between 2 and 5 seconds, more than a 60th of a
  // second, and 2 ms otherwise.
  const s = simulate({
    lanes: 1,
    duration: 20_000,
    resolution: 0.1,
    redraw: true,
    latency: (_, order) => {
      const at = s.sent[order].at - s.sent[0].at;
      return at >= 2000 && at < 5000 ? 30 : 2;
    },
  });
  await s.advance(10_000);
  const start = s.sent[0].at;
  expect(rate(s.sent, start + 500, start + 2000).perSecond).toBeGreaterThan(
    59.5,
  );
  // Within a quarter of a second, every gap is two display frames.
  const slow = rate(s.sent, start + 2250, start + 5000);
  for (const gap of slow.gaps) expect(gap).toBeCloseTo(1000 / 30, 0);
  // Back at 60 within a few seconds of keeping up.
  expect(rate(s.sent, start + 8000, start + 10_000).perSecond).toBeGreaterThan(
    59.5,
  );
  s.cancel();
});

test("a page too busy to draw 60 a second plays at 30, trying 60 again less and less often", async () => {
  // The page misses a display frame whenever it has sent two requests in
  // the last 40 ms: it keeps up with 30 a second but not with 60.
  const s = simulate({
    lanes: 2,
    duration: 60_000,
    resolution: 0.1,
    redraw: true,
    latency: () => 2,
    busy: (at, sent) => sent.filter((r) => r.at > at - 40).length >= 2,
  });
  await s.advance(40_000);
  const start = s.sent[0].at;
  const { perSecond, gaps } = rate(s.sent, start + 1000, start + 40_000);
  expect(perSecond).toBeGreaterThan(29);
  expect(perSecond).toBeLessThan(32);
  // Each try at 60 shows as single-frame gaps a few requests apart; tries
  // come after 2, 4, 8 and 16 seconds at 30, so four in 40 seconds rather
  // than a dozen.
  const tries = gaps.filter(
    (g, i) => g < 20 && !gaps.slice(Math.max(0, i - 3), i).some((h) => h < 20),
  ).length;
  expect(tries).toBeGreaterThanOrEqual(2);
  expect(tries).toBeLessThanOrEqual(4);
  s.cancel();
});

test("one lane asks for the next frame only after the previous reply", async () => {
  const s = simulate({ lanes: 1, duration: 2000, latency: () => 100 });
  await s.advance(3000);
  for (let i = 1; i < s.sent.length; i++)
    expect(s.sent[i].at).toBeGreaterThanOrEqual(s.sent[i - 1].at + 100);
  expect(s.shown).toEqual(s.sent.map((r) => r.p));
});

test("two lanes stagger by half a frame's latency and draw twice the frames", async () => {
  const run = async (lanes: number) => {
    const s = simulate({ lanes, duration: 6000, latency: () => 300 });
    await s.advance(7000);
    return s;
  };
  const one = await run(1),
    two = await run(2);
  // Settled requests alternate lanes about 150 ms apart, not bunched.
  const steady = two.sent.slice(4, -2);
  for (let i = 1; i < steady.length; i++) {
    expect(steady[i].lane).not.toBe(steady[i - 1].lane);
    const gap = steady[i].at - steady[i - 1].at;
    expect(gap).toBeGreaterThan(120);
    expect(gap).toBeLessThan(190);
  }
  expect(two.shown.length).toBeGreaterThan(1.7 * one.shown.length);
  expect(two.shown.at(-1)).toBe(1);
});

test("a reply older than the frame on screen is dropped", async () => {
  // The first request is slow; the second overtakes it.
  const s = simulate({
    lanes: 2,
    duration: 4000,
    latency: (_, order) => (order === 0 ? 600 : 100),
  });
  await s.advance(700);
  const first = s.sent[0].p,
    second = s.sent[1].p;
  expect(s.replied.indexOf(1)).toBeLessThan(s.replied.indexOf(0));
  expect(s.shown).toContain(second);
  expect(s.shown).not.toContain(first);
  for (let i = 1; i < s.shown.length; i++)
    expect(s.shown[i]).toBeGreaterThan(s.shown[i - 1]);
});

test("canceling shows and sends nothing more", async () => {
  const s = simulate({ lanes: 2, duration: 4000, latency: () => 300 });
  await s.advance(1000);
  s.cancel();
  const shown = s.shown.length,
    sent = s.sent.length;
  await s.advance(5000);
  expect(s.shown).toHaveLength(shown);
  expect(s.sent).toHaveLength(sent);
  expect(s.replied).toHaveLength(sent);
  expect(s.ended()).toBe(0);
  expect(s.pendingFrames()).toBe(0);
});

test("a failure stops playback once and ignores later replies", async () => {
  const s = simulate({
    lanes: 2,
    duration: 4000,
    latency: () => 200,
    failAt: 3,
  });
  await s.advance(5000);
  expect(s.failures).toHaveLength(1);
  expect(String(s.failures[0])).toContain("request 3 failed");
  const failedAt = s.replied.indexOf(3);
  // Replies settled after the failure are never drawn.
  const afterwards = s.replied.slice(failedAt + 1).map((o) => s.sent[o].p);
  for (const p of afterwards) expect(s.shown).not.toContain(p);
  expect(s.sent.length).toBeLessThanOrEqual(failedAt + 2);
  expect(s.ended()).toBe(0);
  expect(s.pendingFrames()).toBe(0);
});

test("frame clocks before the start clamp to the starting progress", async () => {
  const s = simulate({
    lanes: 2,
    duration: 2000,
    from: 0.4,
    lag: 50,
    latency: () => 80,
  });
  await s.advance(3000);
  expect(s.sent[0].p).toBe(0.4);
  expect(Math.min(...s.sent.map((r) => r.p))).toBe(0.4);
  expect(s.shown.at(-1)).toBe(1);
});

test("a helper engine plays wherever an export could add one", () => {
  for (const [cores, touch, count] of [
    [1, false, 1],
    [2, false, 1],
    [3, false, 2],
    [16, false, 2],
    [2, true, 1],
    [8, true, 2],
  ] as const)
    expect(playbackEngineCount(cores, touch)).toBe(count);
});

test("repeating playback wraps to the start and never ends on its own", async () => {
  for (const lanes of [1, 2]) {
    const s = simulate({
      lanes,
      duration: 1000,
      latency: () => 40,
      repeat: true,
    });
    await s.advance(3500);
    expect(s.ended()).toBe(0);
    // Three wraps: the time falls back below where it was, and stays in
    // [0, 1), never asking for 1 (which is 0 again).
    const wraps = s.shown.filter((p, i) => i && p < s.shown[i - 1]).length;
    expect(wraps).toBe(3);
    expect(Math.max(...s.sent.map((r) => r.p))).toBeLessThan(1);
    expect(Math.min(...s.sent.map((r) => r.p))).toBeGreaterThanOrEqual(0);
    // Still asking for frames until canceled, and nothing after.
    const asked = s.sent.length;
    await s.advance(200);
    expect(s.sent.length).toBeGreaterThan(asked);
    s.cancel();
    const canceled = s.sent.length;
    await s.advance(1000);
    expect(s.sent).toHaveLength(canceled);
    expect(s.pendingFrames()).toBe(0);
  }
});

test("a repeating reply older than the frame on screen is dropped across a wrap", async () => {
  // The first request after 95% of the cycle is slow; requests after the
  // wrap overtake it.
  let slow = -1;
  const s: ReturnType<typeof simulate> = simulate({
    lanes: 2,
    duration: 1000,
    repeat: true,
    latency: (_, order) => {
      if (slow < 0 && s.sent[order].p > 0.95) slow = order;
      return order === slow ? 300 : 30;
    },
  });
  await s.advance(2500);
  const late = s.sent[slow].p;
  const overtaken = s.replied.indexOf(slow);
  // A request after the wrap, at a smaller time, replied first and was shown.
  const wrapped = s.replied
    .slice(0, overtaken)
    .filter((o) => o > slow && s.sent[o].p < late);
  expect(wrapped.length).toBeGreaterThan(0);
  expect(s.shown).toContain(s.sent[wrapped[0]].p);
  expect(s.shown).not.toContain(late);
  s.cancel();
});

test("repeating playback resumed at the end continues from the start", async () => {
  const s = simulate({
    lanes: 1,
    duration: 1000,
    from: 1,
    latency: () => 20,
    repeat: true,
  });
  await s.advance(400);
  // The first display frame comes one frame after resuming.
  expect(s.sent[0].p).toBeGreaterThanOrEqual(0);
  expect(s.sent[0].p).toBeLessThan(0.05);
  expect(s.shown.at(-1)).toBeGreaterThan(0.3);
  expect(s.ended()).toBe(0);
  s.cancel();
});

test("only animations whose frames come without calculating aim for 60", () => {
  type Planar = Parameters<typeof redraws>[0];
  const study = (attractor?: object) =>
    ({ result: attractor ? { attractor } : {} }) as Planar["original"];
  const planar = (s: Partial<Planar>) =>
    redraws({ tracks: [], original: study(), ...s } as Planar);
  // Drawn from the prepared study.
  expect(planar({ mode: "reveal" })).toBe(true);
  expect(planar({ mode: "trace" })).toBe(true);
  expect(planar({ mode: "probe" })).toBe(true);
  expect(
    planar({
      mode: "parameters",
      tracks: [{ target: "rayLength" }] as Planar["tracks"],
    }),
  ).toBe(true);
  // A flight calculates each piece once, if refined to its views.
  expect(planar({ mode: "path" })).toBe(true);
  expect(planar({ mode: "path", refine: true })).toBe(true);
  // Calculated every frame.
  expect(planar({ mode: "reveal", original: study({}) })).toBe(false);
  expect(planar({ mode: "probe", between: true })).toBe(false);
  expect(
    planar({
      mode: "parameters",
      tracks: [{ target: "a" }] as Planar["tracks"],
    }),
  ).toBe(false);

  for (const mode of [
    "reveal",
    "orbit",
    "trace",
    "probe",
    "cut",
    "path",
  ] as const)
    expect(spatialRedraws({ mode }), mode).toBe(true);
  expect(spatialRedraws({ mode: "parameters" })).toBe(false);
  expect(spatialRedraws({ mode: "probe", between: true })).toBe(false);
});
