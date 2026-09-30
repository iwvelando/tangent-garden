import { test, expect } from "@playwright/test";
import { play } from "../web/playback";
import { playbackEngineCount } from "../web/engine-client";

const flush = () => new Promise((r) => setImmediate(r));

// Plays against a simulated clock: display frames every 1000/60 ms, and each
// lane replies after its latency. Nothing waits on real time.
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
  async function advance(ms: number) {
    const until = t + ms;
    while (t < until) {
      t = Math.min(until, t + 1000 / 60);
      due.sort((a, b) => a.at - b.at);
      while (due.length && due[0].at <= t) due.shift()!.settle();
      await flush();
      const ready = [...frames.values()];
      frames.clear();
      for (const cb of ready) cb(t - (options.lag ?? 0));
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
