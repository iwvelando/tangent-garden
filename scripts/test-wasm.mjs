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
// Offsets of the counterclockwise circle of radius 2: positive d moves inward,
// d = 2 collapses to the center, and a missing distance means zero.
for (const [distance, radius] of [
  [0.5, 1.5],
  [-1, 3],
  [2, 0],
  [undefined, 2],
]) {
  const offset = JSON.parse(
    globalThis.tangentGardenCompute(
      JSON.stringify({
        ...config,
        kind: "offset",
        curve: { ...config.curve, x: "2*cos(t)", y: "2*sin(t)" },
        distance,
      }),
    ),
  );
  assert.equal(offset.invalid, 0);
  assert.equal(offset.rays.length, config.lines);
  for (const i of [0, 249, 500, 999]) {
    const t = (i * 2 * Math.PI) / 999;
    assert.ok(Math.abs(offset.derived[i].x - radius * Math.cos(t)) < 1e-7);
    assert.ok(Math.abs(offset.derived[i].y - radius * Math.sin(t)) < 1e-7);
  }
}
assert.ok(
  JSON.parse(
    globalThis.tangentGardenCompute(
      JSON.stringify({ ...config, kind: "offset", distance: "1" }),
    ),
  ).error,
);
// A stack of offsets of a radius-2 circle is three concentric circles, with
// generating circles of the largest distance centered on the curve.
const stack = JSON.parse(
  globalThis.tangentGardenCompute(
    JSON.stringify({
      ...config,
      kind: "offset",
      curve: { ...config.curve, x: "2*cos(t)", y: "2*sin(t)" },
      stack: { enabled: true, from: -1, to: 0.5, count: 3 },
      circles: true,
    }),
  ),
);
assert.equal(stack.invalid, 0);
assert.equal(stack.derived.length, 0);
assert.deepEqual(
  stack.family.map((path) => path.distance),
  [-1, -0.25, 0.5],
);
for (const [k, radius] of [3, 2.25, 1.5].entries())
  for (const i of [0, 249, 500, 999]) {
    const t = (i * 2 * Math.PI) / 999;
    const p = stack.family[k].points[i];
    assert.ok(Math.abs(p.x - radius * Math.cos(t)) < 1e-7);
    assert.ok(Math.abs(p.y - radius * Math.sin(t)) < 1e-7);
  }
assert.equal(stack.circles.length, config.lines);
for (const [i, circle] of stack.circles.entries()) {
  assert.equal(circle.radius, 1);
  assert.equal(circle.sampleIndex, stack.rays[i].sampleIndex);
  assert.ok(Math.abs(Math.hypot(circle.center.x, circle.center.y) - 2) < 1e-9);
}
assert.match(
  JSON.parse(
    globalThis.tangentGardenCompute(
      JSON.stringify({
        ...config,
        kind: "offset",
        stack: { enabled: true, from: -1, to: 1, count: 65 },
      }),
    ),
  ).error,
  /2–64/,
);
// A rim point of a circle rolling inside one four times its size traces an
// astroid, which closes after one turn with four cusps.
const roulette = JSON.parse(
  globalThis.tangentGardenCompute(
    JSON.stringify({
      ...config,
      kind: "offset",
      distance: 0.1,
      curve: {
        ...config.curve,
        format: "roulette",
        roulette: {
          roll: "inside",
          fixedRadius: 4,
          radius: 1,
          arm: 1,
          phase: 0,
        },
      },
    }),
  ),
);
assert.equal(roulette.roulette.turns, 1);
assert.equal(roulette.roulette.lobes, 4);
assert.equal(roulette.roulette.fixedRadius, 4);
assert.equal(roulette.roulette.positions.length, config.lines);
for (const p of roulette.base.filter(Boolean))
  assert.ok(
    Math.abs(Math.cbrt(p.x * p.x) + Math.cbrt(p.y * p.y) - Math.cbrt(16)) <
      1e-9,
  );
for (const s of roulette.roulette.positions) {
  assert.ok(Math.abs(Math.hypot(s.contact.x, s.contact.y) - 4) < 1e-12);
  assert.ok(Math.abs(Math.hypot(s.center.x, s.center.y) - 3) < 1e-12);
  assert.deepEqual(s.point, roulette.base[s.sampleIndex]);
}
assert.equal(
  JSON.parse(globalThis.tangentGardenCompute(JSON.stringify(config))).roulette,
  undefined,
);
assert.match(
  JSON.parse(
    globalThis.tangentGardenCompute(
      JSON.stringify({
        ...config,
        curve: {
          ...config.curve,
          format: "roulette",
          roulette: { roll: "inside", fixedRadius: 1, radius: 1, arm: 1 },
        },
      }),
    ),
  ).error,
  /smaller than the fixed radius/,
);
// A circle of radius 1 rolling outside a circle of radius 3 traces the
// three-cusped epicycloid (4cos t − cos 4t, 4sin t − sin 4t).
const rolling = JSON.parse(
  globalThis.tangentGardenCompute(
    JSON.stringify({
      ...config,
      kind: "rolling",
      curve: { ...config.curve, x: "3*cos(t)", y: "3*sin(t)" },
      rolling: { side: "right", radius: 1, arm: 1, phase: 0 },
    }),
  ),
);
assert.equal(rolling.invalid, 0);
rolling.derived.forEach((p, j) => {
  const t = (j * 2 * Math.PI) / (config.samples - 1);
  assert.ok(
    Math.hypot(
      p.x - (4 * Math.cos(t) - Math.cos(4 * t)),
      p.y - (4 * Math.sin(t) - Math.sin(4 * t)),
    ) < 1e-9,
  );
});
assert.equal(rolling.rolling.length, config.lines);
rolling.rolling.forEach((s, k) => {
  assert.deepEqual(s.contact, rolling.base[s.sampleIndex]);
  assert.deepEqual(s.point, rolling.derived[s.sampleIndex]);
  assert.deepEqual(rolling.rays[k].origin, s.contact);
  assert.ok(Math.abs(Math.hypot(s.center.x, s.center.y) - 4) < 1e-9);
});
assert.deepEqual(result.rolling, []);
assert.match(
  JSON.parse(
    globalThis.tangentGardenCompute(
      JSON.stringify({
        ...config,
        kind: "rolling",
        rolling: { side: "up", radius: 1, arm: 1, phase: 0 },
      }),
    ),
  ).error,
  /left or right/,
);
console.log(
  "WASM bridge: analytic ellipse, pedal cardioid, contrapedal circle, orthotomic cardioid, circle offsets, offset stack with circles, astroid roulette, rolling epicycloid, and invalid JSON passed.",
);
const spatial = JSON.parse(
  globalThis.tangentGardenSpatial(
    JSON.stringify({
      radius: 2.4,
      tube: 0.85,
      length: 2.3,
      p: 2,
      q: 3,
      samples: 480,
      lines: 96,
    }),
  ),
);
assert.equal(spatial.base.length, 481);
assert.equal(spatial.mesh.length, 5760);
assert.equal(spatial.rulings.length, 96);
assert.deepEqual(spatial.base[0], spatial.base.at(-1));
assert.ok(Math.abs(spatial.base[0].x - 3.25) < 1e-12);
assert.ok(spatial.base.some((p) => Math.abs(p.z) > 0.8));
assert.ok(JSON.parse(globalThis.tangentGardenSpatial("{")).error);
assert.ok(
  JSON.parse(
    globalThis.tangentGardenSpatial(
      JSON.stringify({
        radius: 2,
        tube: 1,
        length: 1,
        p: 2.5,
        q: 3,
        samples: 480,
        lines: 96,
      }),
    ),
  ).error,
);
console.log("Spatial WASM bridge: knot, mesh, closure, and validation passed.");
process.exit(0);
