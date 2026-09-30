// Live playback across one or more engines ("lanes"). Progress follows the
// clock from `from` to exactly 1 in `duration` milliseconds. Each lane holds
// at most one request, so work never queues: a slow study skips intermediate
// times instead. With two lanes, one engine calculates while the other's
// frame is drawn; requests are spaced by the measured latency divided among
// the lanes, so the lanes alternate instead of finishing together. A reply
// older than the frame on screen is dropped, so progress only rises.
export function play<T>(o: {
  from: number;
  duration: number;
  lanes: ((p: number) => Promise<T>)[];
  show: (value: T, p: number) => void;
  end: () => void;
  fail: (error: unknown) => void;
  frame?: (cb: (now: number) => void) => number;
  cancelFrame?: (id: number) => void;
  now?: () => number;
}): () => void {
  const frame = o.frame ?? requestAnimationFrame,
    cancelFrame = o.cancelFrame ?? cancelAnimationFrame,
    clock = o.now ?? (() => performance.now());
  const began = clock(),
    busy = o.lanes.map(() => false);
  let stopped = false,
    ticking = 0,
    // When the last request was sent, by frame time.
    last = -Infinity,
    latency = 0,
    shown = -Infinity,
    final = false;
  const stop = () => {
    stopped = true;
    cancelFrame(ticking);
    ticking = 0;
  };
  const wake = () => {
    if (!ticking && !stopped && !final) ticking = frame(tick);
  };
  function tick(now: number) {
    ticking = 0;
    if (stopped || final) return;
    const lane = busy.indexOf(false);
    if (lane < 0) return; // A reply wakes playback.
    if (now - last < Math.max(1000 / 30, latency / o.lanes.length)) {
      wake();
      return;
    }
    last = now;
    // A frame's timestamp marks the start of the frame and can precede
    // `began`, so clamp at the starting point: extrapolating before it
    // would overshoot the entered endpoint, such as rounding a count of 2
    // down to 1, and a resumed animation would step backward.
    const p = Math.min(
      1,
      Math.max(o.from, o.from + (now - began) / o.duration),
    );
    final = p === 1;
    busy[lane] = true;
    const sent = clock();
    new Promise<T>((resolve) => resolve(o.lanes[lane](p))).then(
      (value) => {
        busy[lane] = false;
        if (stopped) return;
        const took = clock() - sent;
        latency = latency ? (latency + took) / 2 : took;
        if (p > shown) {
          shown = p;
          o.show(value, p);
          if (p === 1) {
            stop();
            o.end();
            return;
          }
        }
        wake();
      },
      (error) => {
        busy[lane] = false;
        if (stopped) return;
        stop();
        o.fail(error);
      },
    );
    wake();
  }
  wake();
  return stop;
}
