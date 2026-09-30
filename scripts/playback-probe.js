// Playback probe: paste into the browser console on any build of the site,
// deployed or local, to time the 3D notebook's engines during an animation.
// It changes nothing: it watches the messages between the page and its
// engine workers. Paste it, press Play, and when playback stops (or pauses)
// it prints how many frames were drawn per second and how long each took.
//
//   drawn → drawn     the interval between frames on screen
//   request → reply   one engine's round trip: Go's work, encoding, transfer
//   reply → drawn     the page: receiving it, building GPU buffers, drawing
//
// With one engine the round trip and the page's time add up to the interval.
// Where playback has a second engine, their calculations overlap and the
// interval can be shorter than a round trip; "engines" says how many
// answered. Call tangentGardenProbe.report() at any point, or
// tangentGardenProbe.stop() to detach; report() also returns the numbers.
(() => {
  if (globalThis.tangentGardenProbe) globalThis.tangentGardenProbe.stop();
  const sent = new Map(),
    frames = [],
    trips = [],
    answered = new Set(),
    watched = new WeakSet();
  let quiet = 0,
    // The latest reply, waiting for the page to draw it.
    waiting = null;
  const post = Worker.prototype.postMessage;
  const gl = WebGLRenderingContext.prototype,
    draws = { drawArrays: gl.drawArrays, drawElements: gl.drawElements };
  for (const [name, draw] of Object.entries(draws))
    gl[name] = function (...args) {
      if (waiting) {
        waiting.drawn = performance.now();
        frames.push(waiting);
        // Playback asks for the next frame soon after one is drawn, so a
        // pause of several frames' time with nothing asked means it stopped.
        clearTimeout(quiet);
        quiet = setTimeout(
          () => report(true),
          Math.max(2000, 3 * (waiting.drawn - waiting.sent)),
        );
        waiting = null;
      }
      return draw.apply(this, args);
    };
  const median = (v) => [...v].sort((a, b) => a - b)[Math.floor(v.length / 2)];
  const p90 = (v) =>
    [...v].sort((a, b) => a - b)[
      Math.min(v.length - 1, Math.floor(v.length * 0.9))
    ];
  const row = (v) => ({
    median: Math.round(median(v)),
    p90: Math.round(p90(v)),
  });
  function report(automatic = false) {
    if (frames.length < 2) {
      if (!automatic) console.info("Probe: no frames yet.");
      return null;
    }
    const span = (frames.at(-1).drawn - frames[0].sent) / 1000;
    const intervals = frames.slice(1).map((f, i) => f.drawn - frames[i].drawn);
    console.info(
      `Probe: ${frames.length} frames in ${span.toFixed(1)} s, ${(frames.length / span).toFixed(2)} frames per second, ${answered.size} engine${answered.size === 1 ? "" : "s"}`,
    );
    const times = {
      "drawn → drawn (ms)": row(intervals),
      "request → reply (ms)": row(trips),
      "reply → drawn (ms)": row(frames.map((f) => f.drawn - f.replied)),
    };
    console.table(times);
    const summary = {
      frames: frames.length,
      seconds: span,
      fps: frames.length / span,
      engines: answered.size,
      ...times,
    };
    frames.length = 0;
    trips.length = 0;
    answered.clear();
    return summary;
  }
  function listen(worker) {
    if (watched.has(worker)) return;
    watched.add(worker);
    worker.addEventListener("message", ({ data }) => {
      const start = sent.get(data?.id + ":" + workerId(worker));
      if (start === undefined) return;
      sent.delete(data.id + ":" + workerId(worker));
      const now = performance.now();
      trips.push(now - start);
      answered.add(worker);
      waiting = { sent: start, replied: now };
    });
  }
  // Each engine numbers its own requests, so key them by worker too.
  const ids = new WeakMap();
  let workers = 0;
  const workerId = (worker) => {
    if (!ids.has(worker)) ids.set(worker, ++workers);
    return ids.get(worker);
  };
  Worker.prototype.postMessage = function (message, ...rest) {
    if (message?.action === "spatial") {
      listen(this);
      clearTimeout(quiet);
      sent.set(message.id + ":" + workerId(this), performance.now());
    }
    return post.call(this, message, ...rest);
  };
  globalThis.tangentGardenProbe = {
    report: () => report(),
    stop() {
      Worker.prototype.postMessage = post;
      Object.assign(gl, draws);
      clearTimeout(quiet);
      delete globalThis.tangentGardenProbe;
    },
  };
  console.info("Probe ready: press Play in the 3D notebook's animation.");
})();
