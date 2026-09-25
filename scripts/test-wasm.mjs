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
console.log("WASM bridge: analytic ellipse and invalid JSON passed.");
process.exit(0);
