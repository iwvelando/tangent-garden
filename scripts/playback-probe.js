// Playback probe: paste into the browser console on any build of the site,
// deployed or local, to time the 3D notebook's engine during an animation.
// It changes nothing: it watches the messages between the page and its
// engine worker. Paste it, press Play, and when playback stops (or pauses)
// it prints how many frames were drawn per second and how long each took.
//
//   request → reply   the worker: Go's work, encoding and the transfer back
//   reply → drawn     the page: receiving it, building GPU buffers, drawing
//
// Playback keeps one calculation in flight, so these two add up to the time
// between drawn frames. Call tangentGardenProbe.report() at any point, or
// tangentGardenProbe.stop() to detach.
(() => {
  if (globalThis.tangentGardenProbe) globalThis.tangentGardenProbe.stop();
  const sent = new Map(),
    frames = [],
    watched = new WeakSet();
  let quiet = 0,
    // A reply waiting for the page to draw it.
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
  function report(automatic = false) {
    if (frames.length < 2) {
      if (!automatic) console.info("Probe: no frames yet.");
      return;
    }
    const span = (frames.at(-1).drawn - frames[0].sent) / 1000;
    const worker = frames.map((f) => f.replied - f.sent),
      page = frames.map((f) => f.drawn - f.replied);
    console.info(
      `Probe: ${frames.length} frames in ${span.toFixed(1)} s, ${(frames.length / span).toFixed(2)} frames per second`,
    );
    console.table({
      "request → reply (ms)": {
        median: Math.round(median(worker)),
        p90: Math.round(p90(worker)),
      },
      "reply → drawn (ms)": {
        median: Math.round(median(page)),
        p90: Math.round(p90(page)),
      },
    });
    frames.length = 0;
  }
  function listen(worker) {
    if (watched.has(worker)) return;
    watched.add(worker);
    worker.addEventListener("message", ({ data }) => {
      const start = sent.get(data?.id);
      if (start === undefined) return;
      sent.delete(data.id);
      waiting = { sent: start, replied: performance.now() };
    });
  }
  Worker.prototype.postMessage = function (message, ...rest) {
    if (message?.action === "spatial") {
      listen(this);
      clearTimeout(quiet);
      sent.set(message.id, performance.now());
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
