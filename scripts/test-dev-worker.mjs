import assert from "node:assert/strict";
import { Script, createContext } from "node:vm";
import { createServer } from "vite";

// The engine worker is classic so it can importScripts Go's wasm_exec.js. The
// production build bundles it, but the dev server serves it unbundled, so any
// import or export (even the `export {}` left by type-only imports) makes it a
// module and the worker fails to start ("Numerical engine is closed."). Parse
// exactly what the dev server sends.
const server = await createServer({
  logLevel: "silent",
  server: { ws: false },
});
try {
  const worker = await server.transformRequest(
    "/web/engine.worker.ts?worker_file&type=classic",
  );
  assert.ok(worker, "Dev server did not serve the engine worker");
  assert.doesNotThrow(
    () => new Script(worker.code, { filename: "engine.worker.ts" }),
    "The engine worker must parse as a classic script in dev: reference types inline, with no import or export",
  );
  // Exercise the served production validation/transport code. Geometry stays
  // in the real WASM tests; this bridge stub records only what the worker sends.
  const replies = [],
    requests = [];
  const context = createContext({
    importScripts: () => {}, // Vite's development environment prelude.
    self: { postMessage: (reply) => replies.push(reply) },
    tangentGardenTesseract: (json) => {
      requests.push(JSON.parse(json));
      return '{"transported":true}';
    },
  });
  new Script(`${worker.code}\nready = Promise.resolve();`).runInContext(
    context,
  );
  const base = {
    object: "tesseract",
    mode: "perspective",
    angles: [0, 0, 0, 0, 0, 0],
    distance: 4,
    grid: 0,
    samples: 64,
  };
  const lift = {
    ...base,
    object: "lift",
    mode: "reference",
    lift: {
      center: [0, 0, 0],
      support: 2,
      height: 0.32,
      angle: Math.PI / 4,
      from: [-1.5, 0, 0],
      to: [1.5, 0, 0],
      radiusFrom: 0.05,
      radiusTo: 2,
    },
  };
  const cases = [
    [{ ...base, angles: [] }, "Enter six tesseract rotation angles."],
    [
      { ...base, distance: NaN },
      "Fill in every active tesseract parameter with a finite constant.",
    ],
    [{ ...lift, angles: undefined }, undefined],
    [{ ...lift, angles: [NaN], lift: { ...lift.lift, angle: NaN } }, undefined],
    [
      {
        ...lift,
        mode: "lifted",
        angles: undefined,
        distance: NaN,
        grid: NaN,
        lift: { ...lift.lift, angle: Math.PI / 7 },
      },
      undefined,
    ],
    [
      { ...lift, lift: { ...lift.lift, support: NaN } },
      "Lift support radius L must be a finite constant.",
    ],
    [
      { ...lift, mode: "lifted", lift: { ...lift.lift, angle: NaN } },
      "Presentation xw angle must be a finite constant.",
    ],
    [
      { ...lift, samples: NaN },
      "Thread samples must be a finite whole number.",
    ],
    [{ ...lift, samples: 8.5 }, "Thread samples must be a whole number."],
    [
      { ...lift, lift: { ...lift.lift, center: [0, 0] } },
      "Lift center requires three coordinates.",
    ],
  ];
  const actual = [];
  for (const [q] of cases) {
    await context.self.onmessage({
      data: { id: replies.length, action: "tesseract", tesseract: q },
    });
    actual.push(replies.at(-1).error);
  }
  assert.deepEqual(
    actual,
    cases.map(([, error]) => error),
    "worker validation must name active lift fields and preserve tesseract wording",
  );
  assert.equal(requests.length, 3);
  for (const request of requests) {
    assert.deepEqual(request.angles, [0, 0, 0, 0, 0, 0]);
  }
  assert.equal(requests[0].lift.angle, 0);
  assert.equal(requests[1].lift.angle, 0);
  assert.equal(requests[2].lift.angle, Math.PI / 7);
} finally {
  await server.close();
}
console.log("Dev worker: engine worker parses as a classic script.");
