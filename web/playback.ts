// Display frames come at multiples of 1000/hz ms, so two at 60 Hz or four at
// 120 Hz span 1000/30 ms only give or take the rounding of their timestamps;
// a gap measured just short of it would wait a frame more and play at 20 or
// 24 frames a second. Gaps are allowed this many milliseconds short: under a
// frame at up to 240 Hz, so a gap still never falls a whole frame short.
const slack = 4;
// Frames come at most 30 a second, or 60 while they need no calculating. A
// request that comes more than lateness times the interval after the one
// before is late: a display frame was missed.
const steady = 1000 / 30,
  fast = 1000 / 60,
  lateness = 1.4;

// Live playback across one or more engines ("lanes"). Progress follows the
// clock from `from` to exactly 1 in `duration` milliseconds. Each lane holds
// at most one request, so work never queues: a slow study skips intermediate
// times instead. With two lanes, one engine calculates while the other's
// frame is drawn; requests are spaced by the measured latency divided among
// the lanes, so the lanes alternate instead of finishing together, and at
// least 1000/30 ms apart, less the slack. Frames that come without
// calculating (redraw: a reveal, a flight) aim for 60 a second instead.
// Two late requests among the last ten fall back to an even 30 a second,
// since a rate that wanders between 30 and 60 moves unevenly on the
// display; after a hold at 30 with nothing late and replies quick enough,
// playback tries 60 again, and each try that falls back doubles the hold.
// A reply older than the frame on screen is dropped, so progress only
// rises.
// Repeating playback wraps from the end to the start (the time asked for is
// in [0, 1), never 1, which is 0 again) and never ends on its own; a reply
// is judged older by the unwrapped time.
export function play<T>(o: {
  from: number;
  duration: number;
  repeat?: boolean;
  redraw?: boolean;
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
    final = false,
    interval = o.redraw ? fast : steady,
    // The last requests at 60, whether each was late; when 30 last had
    // reason to stay; and how long 30 must keep up before trying 60.
    recent: boolean[] = [],
    since = 0,
    hold = 2000;
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
    if (now - last < Math.max(interval, latency / o.lanes.length) - slack) {
      wake();
      return;
    }
    if (o.redraw && last > -Infinity) pace(now - last, now);
    last = now;
    // A frame's timestamp marks the start of the frame and can precede
    // `began`, so clamp at the starting point: extrapolating before it
    // would overshoot the entered endpoint, such as rounding a count of 2
    // down to 1, and a resumed animation would step backward.
    const elapsed = Math.max(o.from, o.from + (now - began) / o.duration),
      time = o.repeat ? elapsed : Math.min(1, elapsed),
      p = o.repeat ? time - Math.floor(time) : time,
      ending = !o.repeat && p === 1;
    final = ending;
    busy[lane] = true;
    const sent = clock();
    new Promise<T>((resolve) => resolve(o.lanes[lane](p))).then(
      (value) => {
        busy[lane] = false;
        if (stopped) return;
        const took = clock() - sent;
        latency = latency ? (latency + took) / 2 : took;
        if (time > shown) {
          shown = time;
          o.show(value, p);
          if (ending) {
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
  // Chooses the next interval from the gap since the last request.
  function pace(gap: number, now: number) {
    const late = gap > lateness * interval;
    if (interval === fast) {
      recent.push(late);
      if (recent.length > 10) recent.shift();
      if (recent.filter(Boolean).length < 2) return;
      interval = steady;
      recent = [];
      since = now;
    } else if (late || latency / o.lanes.length > fast / 2) since = now;
    else if (now - since >= hold) {
      interval = fast;
      hold = Math.min(16_000, hold * 2);
    }
  }
  wake();
  return stop;
}
