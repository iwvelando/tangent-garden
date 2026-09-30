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
    transfers = [],
    requests = [];
  // An implicit mesh returns as JSON plus typed views on one buffer.
  const buffer = new ArrayBuffer(8 * 6 + 4 * 5);
  const mesh = {
    positions: new Float64Array(buffer, 0, 3),
    normals: new Float64Array(buffer, 24, 3),
    triangles: new Int32Array(buffer, 48, 3),
    cut: new Int32Array(buffer, 60, 2),
    open: new Int32Array(buffer, 68, 0),
  };
  mesh.positions.set([1, 2, 3]);
  mesh.triangles.set([0, 0, 0]);
  const context = createContext({
    importScripts: () => {}, // Vite's development environment prelude.
    self: {
      postMessage: (reply, transfer) => {
        replies.push(reply);
        transfers.push(transfer);
      },
    },
    tangentGardenTesseract: (json) => {
      requests.push(JSON.parse(json));
      return '{"transported":true}';
    },
    tangentGardenSpatial: (json) =>
      JSON.parse(json).format === "implicit"
        ? {
            json: '{"implicit":{"grid":[4,4,4],"positions":null,"normals":null,"triangles":null,"cut":null,"open":null}}',
            ...mesh,
          }
        : '{"base":[]}',
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
  const bypass = {
    ...base,
    object: "bypass",
    mode: "shadow",
    angles: undefined,
    bypass: {
      inner: 1,
      outer: 2,
      extent: 0.15,
      outside: [3, 0, 0],
      height: 1.2,
      position: 0.5,
      obstacle: "embedded",
      w1: 0,
      w2: 1.2,
    },
  };
  cases.push(
    [bypass, undefined],
    [{ ...bypass, mode: "paired" }, undefined],
    [
      {
        ...bypass,
        mode: "diagram",
        angles: [NaN],
        distance: NaN,
        grid: NaN,
        bypass: { ...bypass.bypass, obstacle: "radial", extent: NaN },
      },
      undefined,
    ],
    [{ ...bypass, bypass: undefined }, "Enter shell bypass parameters."],
    [
      { ...bypass, bypass: { ...bypass.bypass, height: NaN } },
      "Route height H must be a finite constant.",
    ],
    [
      { ...bypass, bypass: { ...bypass.bypass, extent: NaN } },
      "Fourth-coordinate extent ε must be a finite constant.",
    ],
    [
      { ...bypass, bypass: { ...bypass.bypass, outside: [3, NaN, 0] } },
      "Outside point y must be a finite constant.",
    ],
    [
      { ...bypass, bypass: { ...bypass.bypass, outside: [3, 0] } },
      "Outside point requires three coordinates.",
    ],
    [
      { ...bypass, samples: NaN },
      "Shell samples must be a finite whole number.",
    ],
    [{ ...bypass, samples: 8.5 }, "Shell samples must be a whole number."],
  );
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
    "worker validation must name active study fields and preserve tesseract wording",
  );
  assert.equal(requests.length, 6);
  for (const request of requests) {
    assert.deepEqual(request.angles, [0, 0, 0, 0, 0, 0]);
  }
  assert.equal(requests[0].lift.angle, 0);
  assert.equal(requests[1].lift.angle, 0);
  assert.equal(requests[2].lift.angle, Math.PI / 7);
  assert.deepEqual(requests[3].bypass, bypass.bypass);
  assert.equal(requests[4].mode, "paired");
  assert.deepEqual(requests[4].bypass, bypass.bypass);
  assert.equal(requests[5].bypass.extent, 0);
  assert.equal(requests[5].grid, undefined);
  assert.equal(requests[5].distance, undefined);
  // The worker puts the typed arrays back into the result and transfers
  // their buffer instead of copying it.
  const { spatialPresets } = await server.ssrLoadModule(
    "/web/spatial/presets.ts",
  );
  const implicit = spatialPresets.find(
    (p) => p.config.format === "implicit",
  ).config;
  await context.self.onmessage({
    data: { id: 90, action: "spatial", spatial: implicit },
  });
  const level = replies.at(-1).result.implicit;
  assert.deepEqual(Array.from(level.grid), [4, 4, 4]);
  for (const name of Object.keys(mesh)) assert.equal(level[name], mesh[name]);
  assert.deepEqual(Array.from(transfers.at(-1)), [buffer]);
} finally {
  await server.close();
}
console.log("Dev worker: engine worker parses as a classic script.");
