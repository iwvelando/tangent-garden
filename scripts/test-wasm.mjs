import { readFileSync } from "node:fs";
import assert from "node:assert/strict";
await import("../public/wasm_exec.js");
const go = new globalThis.Go();
const { instance } = await WebAssembly.instantiate(
  readFileSync("public/engine.wasm"),
  go.importObject,
);
void go.run(instance);
const config = {
  kind: "evolute",
  curve: {
    format: "parametric",
    x: "2*cos(t)",
    y: "3*sin(t)",
    min: 0,
    max: Math.PI * 2,
  },
  samples: 1000,
  lines: 30,
};
const result = JSON.parse(
  globalThis.tangentGardenCompute(JSON.stringify(config)),
);
assert.equal(result.base.length, 1000);
assert.ok(Math.abs(result.derived[0].x + 2.5) < 1e-5);
assert.equal(result.rays.length, 30);
assert.ok(JSON.parse(globalThis.tangentGardenCompute("{")).error);
const scalars = JSON.parse(
  globalThis.tangentGardenScalars(JSON.stringify(["2*pi", "phi", "ln(e)"])),
);
assert.deepEqual(scalars.values, [2 * Math.PI, (1 + Math.sqrt(5)) / 2, 1]);
assert.ok(JSON.parse(globalThis.tangentGardenScalars('["t"]')).error);
assert.ok(JSON.parse(globalThis.tangentGardenScalars('["1/0"]')).error);
assert.equal(result.rays.at(-1).sampleIndex, 999);
const pedal = JSON.parse(
  globalThis.tangentGardenCompute(
    JSON.stringify({
      ...config,
      kind: "pedal",
      curve: { ...config.curve, x: "cos(t)", y: "sin(t)" },
      pole: { x: 1, y: 0 },
    }),
  ),
);
assert.equal(pedal.invalid, 0);
assert.equal(pedal.rays.length, config.lines);
for (const i of [0, 249, 500, 999]) {
  const t = (i * 2 * Math.PI) / 999;
  assert.ok(
    Math.abs(pedal.derived[i].x - (1 + Math.cos(t) - Math.cos(t) ** 2)) < 1e-7,
  );
  assert.ok(
    Math.abs(pedal.derived[i].y - Math.sin(t) * (1 - Math.cos(t))) < 1e-7,
  );
  assert.equal(pedal.virtual[i], false);
}
// Contrapedal and orthotomic of the unit circle about the pole (1, 0).
const family = Object.fromEntries(
  ["contrapedal", "orthotomic"].map((kind) => [
    kind,
    JSON.parse(
      globalThis.tangentGardenCompute(
        JSON.stringify({
          ...config,
          kind,
          curve: { ...config.curve, x: "cos(t)", y: "sin(t)" },
          pole: { x: 1, y: 0 },
        }),
      ),
    ),
  ]),
);
for (const i of [0, 249, 500, 999]) {
  const t = (i * 2 * Math.PI) / 999;
  const c = Math.cos(t);
  const s = Math.sin(t);
  const k = family.contrapedal.derived[i];
  const q = family.orthotomic.derived[i];
  assert.ok(Math.abs(k.x - c * c) < 1e-7 && Math.abs(k.y - c * s) < 1e-7);
  assert.ok(Math.abs(q.x - (1 + 2 * c - 2 * c * c)) < 1e-7);
  assert.ok(Math.abs(q.y - 2 * s * (1 - c)) < 1e-7);
}
assert.equal(family.contrapedal.invalid, 0);
assert.equal(family.orthotomic.rays.length, config.lines);
assert.ok(
  JSON.parse(
    globalThis.tangentGardenCompute(
      JSON.stringify({ ...config, kind: "orthotomic", pole: { x: "a", y: 0 } }),
    ),
  ).error,
);
console.log(
  "WASM bridge: analytic ellipse, pedal cardioid, contrapedal circle, orthotomic cardioid, and invalid JSON passed.",
);
process.exit(0);
