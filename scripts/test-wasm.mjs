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
// An ellipse rolling outside a congruent ellipse from matching vertices: its
// focus stays 2a = 4 from the fixed ellipse's far focus (−1.6, 0).
const moving = JSON.parse(
  globalThis.tangentGardenCompute(
    JSON.stringify({
      ...config,
      kind: "rolling",
      curve: { ...config.curve, x: "2*cos(t)", y: "1.2*sin(t)" },
      rolling: {
        side: "right",
        shape: "curve",
        radius: 1,
        arm: 1,
        phase: 0,
        curve: {
          x: "2*cos(t)",
          y: "1.2*sin(t)",
          min: 0,
          max: 2 * Math.PI,
          start: 0,
        },
        point: { x: 1.6, y: 0 },
      },
    }),
  ),
);
assert.equal(moving.invalid, 0);
assert.equal(moving.moving.closed, true);
assert.equal(moving.moving.path.length, config.samples);
assert.equal(moving.moving.positions.length, config.lines);
assert.deepEqual(moving.rolling, []);
moving.derived.forEach((p) =>
  assert.ok(Math.abs(Math.hypot(p.x + 1.6, p.y) - 4) < 1e-8),
);
moving.moving.positions.forEach((s) => {
  assert.deepEqual(s.contact, moving.base[s.sampleIndex]);
  assert.deepEqual(s.point, moving.derived[s.sampleIndex]);
});
assert.equal(result.moving, undefined);
assert.match(
  JSON.parse(
    globalThis.tangentGardenCompute(
      JSON.stringify({
        ...config,
        kind: "rolling",
        rolling: {
          side: "left",
          shape: "curve",
          curve: { x: "cos(t)", y: "sin(t)", min: 0, max: 1, start: 2 },
          point: { x: 0, y: 0 },
        },
      }),
    ),
  ).error,
  /outside its domain/,
);
// Chords from t to 2t on the unit circle envelope the cardioid
// (2e^{it} + e^{2it})/3, touching each chord a third of the way along.
const chords = JSON.parse(
  globalThis.tangentGardenCompute(
    JSON.stringify({
      ...config,
      kind: "envelope",
      curve: { ...config.curve, x: "cos(t)", y: "sin(t)", a: 2 },
      envelope: {
        mode: "chord",
        angle: "",
        x: "cos(a*t)",
        y: "sin(a*t)",
        extend: false,
      },
    }),
  ),
);
assert.equal(chords.second.length, config.samples);
assert.equal(chords.derived[0], null);
assert.equal(chords.derived.at(-1), null);
assert.ok(chords.warnings.some((w) => /endpoints coincide/.test(w)));
for (const i of [1, 250, 500, 998]) {
  const t = (i * 2 * Math.PI) / 999;
  const want = {
    x: (2 * Math.cos(t) + Math.cos(2 * t)) / 3,
    y: (2 * Math.sin(t) + Math.sin(2 * t)) / 3,
  };
  assert.ok(
    Math.hypot(chords.derived[i].x - want.x, chords.derived[i].y - want.y) <
      1e-7,
  );
  assert.equal(chords.virtual[i], false);
}
assert.equal(chords.rays.length, config.lines - 2);
chords.rays.forEach((ray) => {
  assert.deepEqual(ray.end, chords.second[ray.sampleIndex]);
  assert.deepEqual(ray.origin, chords.base[ray.sampleIndex]);
});
assert.equal(result.second, undefined);
assert.match(
  JSON.parse(
    globalThis.tangentGardenCompute(
      JSON.stringify({
        ...config,
        kind: "envelope",
        envelope: { mode: "angle", angle: "s", x: "", y: "", extend: false },
      }),
    ),
  ).error,
  /direction angle/,
);
// Circles centered on the parabola 4y = x² through its focus: the right
// branch is the directrix y = −1, the left collapses to the focus.
const rings = JSON.parse(
  globalThis.tangentGardenCompute(
    JSON.stringify({
      ...config,
      kind: "envelope",
      curve: { ...config.curve, x: "t", y: "t^2/4", min: -3, max: 3 },
      envelope: {
        mode: "circle",
        angle: "",
        x: "",
        y: "",
        extend: false,
        radius: "t^2/4+1",
      },
    }),
  ),
);
assert.deepEqual(
  rings.family.map((path) => path.branch),
  ["left", "right"],
);
assert.equal(rings.derived.length, 0);
assert.equal(rings.circles.length, config.lines);
for (const i of [0, 250, 700, 999]) {
  const t = -3 + (i * 6) / 999;
  const [focus, directrix] = rings.family.map((path) => path.points[i]);
  assert.ok(Math.hypot(focus.x, focus.y - 1) < 1e-8);
  assert.ok(Math.hypot(directrix.x - t, directrix.y + 1) < 1e-8);
}
rings.circles.forEach((c) => {
  const t = c.center.x;
  assert.ok(Math.abs(c.radius - (t * t) / 4 - 1) < 1e-12);
});
assert.match(
  JSON.parse(
    globalThis.tangentGardenCompute(
      JSON.stringify({
        ...config,
        kind: "envelope",
        envelope: { mode: "circle", radius: "s" },
      }),
    ),
  ).error,
  /circle radius/,
);
// A circle through the center of inversion maps to a line, open where the
// circle passes through the center; the pedal of an ellipse about its center
// inverts into the reciprocal ellipse a²x² + b²y² = 1.
const inversion = { center: { x: 0, y: 0 }, radius: 2 };
const inverted = JSON.parse(
  globalThis.tangentGardenCompute(
    JSON.stringify({
      ...config,
      kind: "inversion",
      curve: { ...config.curve, x: "1+cos(t)", y: "sin(t)" },
      inversion,
    }),
  ),
);
assert.equal(inverted.inversion.radius, 2);
assert.equal(inverted.input, undefined);
assert.equal(inverted.inversion.breaks.length, 1);
assert.ok(Math.abs(inverted.inversion.breaks[0] - 500) <= 1);
inverted.derived.forEach(
  (p) => p && assert.ok(Math.abs(p.x - 2) < 1e-9 * Math.max(1, Math.abs(p.y))),
);
inverted.rays.forEach((ray) => {
  assert.deepEqual(ray.origin, inverted.base[ray.sampleIndex]);
  assert.deepEqual(ray.target, inverted.derived[ray.sampleIndex]);
});
const reciprocal = JSON.parse(
  globalThis.tangentGardenCompute(
    JSON.stringify({
      ...config,
      kind: "inversion",
      curve: { ...config.curve, x: "2*cos(t)", y: "1.1*sin(t)" },
      pole: { x: 0, y: 0 },
      input: "pedal",
      inversion: { ...inversion, radius: 1 },
    }),
  ),
);
assert.equal(reciprocal.input.length, config.samples);
reciprocal.derived.forEach((p) =>
  assert.ok(Math.abs(4 * p.x * p.x + 1.21 * p.y * p.y - 1) < 1e-9),
);
assert.match(
  JSON.parse(
    globalThis.tangentGardenCompute(
      JSON.stringify({
        ...config,
        kind: "inversion",
        inversion: { ...inversion, radius: 0 },
      }),
    ),
  ).error,
  /inversion radius/,
);
// Any construction acts on a derived input: unwinding a string from an
// ellipse's evolute, starting with the radius of curvature at the domain
// start, retraces the ellipse. An evolute cannot feed a second-order
// construction.
const involute = JSON.parse(
  globalThis.tangentGardenCompute(
    JSON.stringify({
      ...config,
      kind: "involute",
      input: "evolute",
      offset: Math.pow(4 * Math.sin(0.1) ** 2 + Math.cos(0.1) ** 2, 1.5) / 2,
      curve: {
        ...config.curve,
        x: "2*cos(t)",
        y: "sin(t)",
        min: 0.1,
        max: 1.4,
      },
    }),
  ),
);
assert.equal(involute.invalid, 0);
assert.equal(involute.input.length, config.samples);
involute.derived.forEach((p, j) => {
  const t = 0.1 + (1.3 * j) / (config.samples - 1);
  assert.ok(Math.hypot(p.x - 2 * Math.cos(t), p.y - Math.sin(t)) < 1e-6);
});
assert.match(
  JSON.parse(
    globalThis.tangentGardenCompute(
      JSON.stringify({ ...config, kind: "evolute", input: "evolute" }),
    ),
  ).error,
  /fourth derivative/,
);
// The deltoid 2e^{it} + e^{-2it} closes after 2π, with its epicycles chained
// from the origin; a Lissajous 3:2 figure projects from its two guides.
const deltoid = JSON.parse(
  globalThis.tangentGardenCompute(
    JSON.stringify({
      ...config,
      curve: {
        ...config.curve,
        format: "fourier",
        terms: [
          { frequency: 1, radius: 2, phase: 0 },
          { frequency: -2, radius: 1, phase: 0 },
        ],
      },
    }),
  ),
);
assert.equal(deltoid.harmonic.period, 2 * Math.PI);
assert.equal(deltoid.harmonic.whole, true);
assert.deepEqual(deltoid.harmonic.radii, [2, 1]);
assert.equal(deltoid.harmonic.positions.length, config.lines);
for (const s of deltoid.harmonic.positions) {
  assert.deepEqual(s.joints[0], { x: 0, y: 0 });
  assert.ok(Math.abs(Math.hypot(s.joints[1].x, s.joints[1].y) - 2) < 1e-12);
  assert.deepEqual(s.point, deltoid.base[s.sampleIndex]);
}
const lissajous = JSON.parse(
  globalThis.tangentGardenCompute(
    JSON.stringify({
      ...config,
      curve: {
        ...config.curve,
        format: "lissajous",
        lissajous: {
          amplitudeX: 1,
          amplitudeY: 1,
          frequencyX: 1.5,
          frequencyY: 1,
          phase: 0,
        },
      },
    }),
  ),
);
assert.ok(Math.abs(lissajous.harmonic.period - 4 * Math.PI) < 1e-12);
assert.equal(lissajous.harmonic.whole, false);
assert.equal(lissajous.harmonic.guides.length, 2);
for (const s of lissajous.harmonic.positions) {
  assert.ok(Math.abs(s.joints[0].x - s.point.x) < 1e-12);
  assert.ok(Math.abs(s.joints[1].y - s.point.y) < 1e-12);
}
assert.match(
  JSON.parse(
    globalThis.tangentGardenCompute(
      JSON.stringify({
        ...config,
        curve: { ...config.curve, format: "fourier", terms: [] },
      }),
    ),
  ).error,
  /1–16 terms/,
);
// Seven equal-speed pursuers on the unit heptagon spiral in on logarithmic
// spirals, r = 1 − t sin(π/7), and stop when neighbors are ε apart.
const heptagon = Array.from({ length: 7 }, (_, j) => ({
  x: Math.cos((2 * Math.PI * j) / 7),
  y: Math.sin((2 * Math.PI * j) / 7),
  speed: 1,
}));
const chase = JSON.parse(
  globalThis.tangentGardenCompute(
    JSON.stringify({
      ...config,
      curve: {
        ...config.curve,
        format: "pursuit",
        min: 0,
        max: 2.4,
        pursuit: { pursuers: heptagon, capture: 0.001 },
      },
    }),
  ),
);
const sin7 = Math.sin(Math.PI / 7);
assert.ok(
  Math.abs(chase.pursuit.capture.time - (1 - 0.001 / (2 * sin7)) / sin7) < 1e-9,
);
assert.equal(chase.pursuit.paths.length, 7);
for (const polygon of chase.pursuit.polygons) {
  const t = (2.4 * polygon.sampleIndex) / (config.samples - 1);
  for (const p of polygon.points) {
    assert.ok(Math.abs(Math.hypot(p.x, p.y) - (1 - t * sin7)) < 1e-9);
  }
  assert.deepEqual(
    polygon.points[0],
    chase.pursuit.paths[0][polygon.sampleIndex],
  );
}
assert.equal(chase.pursuit.paths[3].at(-1), null);
assert.match(
  JSON.parse(
    globalThis.tangentGardenCompute(
      JSON.stringify({
        ...config,
        curve: {
          ...config.curve,
          format: "pursuit",
          pursuit: { pursuers: heptagon.slice(0, 1), capture: 0.001 },
        },
      }),
    ),
  ).error,
  /2–16 pursuers/,
);
// Trajectories of a rotation, ẋ = −ay, ẏ = ax with a = 1, are circles; a
// seed outside the escape circle has none, and one field of expressions in
// x, y, and t carries the error.
const field = (f) =>
  JSON.parse(
    globalThis.tangentGardenCompute(
      JSON.stringify({
        ...config,
        curve: {
          ...config.curve,
          format: "field",
          min: 0,
          max: 2 * Math.PI,
          a: 1,
          field: {
            x: "-a*y",
            y: "a*x",
            seeds: [
              { x: 1, y: 0 },
              { x: 0, y: 3 },
            ],
            escape: 2,
            ...f,
          },
        },
      }),
    ),
  );
const rotation = field({});
assert.equal(rotation.field.paths.length, 2);
for (const [j, p] of rotation.field.paths[0].entries()) {
  const t = (2 * Math.PI * j) / (config.samples - 1);
  assert.ok(Math.hypot(p.x - Math.cos(t), p.y - Math.sin(t)) < 1e-8);
  assert.deepEqual(p, rotation.base[j]);
}
assert.ok(rotation.field.paths[1].every((p) => p === null));
assert.deepEqual(rotation.field.ends, [
  { time: 2 * Math.PI, reason: "end" },
  { time: 0, reason: "escape" },
]);
for (const arrow of rotation.field.arrows)
  assert.ok(
    Math.hypot(
      arrow.velocity.x + arrow.point.y,
      arrow.velocity.y - arrow.point.x,
    ) < 1e-15,
  );
assert.equal(rotation.field.arrows.length, config.lines);
// Without t there is one direction field; with it there is none.
assert.equal(rotation.field.timed, false);
assert.ok(rotation.field.grid.points.length > 100);
for (const { point, velocity } of rotation.field.grid.points)
  assert.ok(Math.hypot(velocity.x + point.y, velocity.y - point.x) < 1e-15);
const timed = field({ x: "-a*y*cos(t)" });
assert.equal(timed.field.timed, true);
assert.equal(timed.field.grid.points.length, 0);
assert.match(field({ y: "x*z" }).error, /dy\/dt: unknown name "z"/);
// Cassini ovals ((x − a)² + y²)((x + a)² + y²) = b⁴ with a = 1 split into
// two at b < a and join into one at b > a; a family of levels comes back
// beside them, and the gradient at representative points.
const cassini = (implicit) =>
  JSON.parse(
    globalThis.tangentGardenCompute(
      JSON.stringify({
        ...config,
        curve: {
          ...config.curve,
          format: "implicit",
          a: 1,
          implicit: {
            f: "((x-a)^2+y^2)*((x+a)^2+y^2)",
            level: 0.9 ** 4,
            family: { enabled: false, from: 0, to: 0, count: 0 },
            window: { xMin: -2, xMax: 2, yMin: -1.5, yMax: 1.5 },
            cells: 81,
            ...implicit,
          },
        },
      }),
    ),
  );
const ovals = (b) => {
  const r = cassini({ level: b ** 4 });
  assert.deepEqual(r.base, []);
  assert.deepEqual(r.derived, []);
  for (const { points } of r.contours.curve.contours)
    for (const { x, y } of points)
      assert.ok(
        Math.abs(((x - 1) ** 2 + y ** 2) * ((x + 1) ** 2 + y ** 2) - b ** 4) <
          1e-12,
      );
  return r.contours;
};
assert.equal(ovals(0.9).curve.contours.length, 2);
assert.equal(ovals(1.1).curve.contours.length, 1);
const nested = ovals(1.1);
assert.equal(nested.columns, 81);
assert.equal(nested.rows, 61);
assert.equal(nested.normals.length, config.lines);
for (const { point, gradient } of nested.normals) {
  const { x, y } = point;
  const exact = {
    x:
      2 * (x - 1) * ((x + 1) ** 2 + y ** 2) +
      2 * (x + 1) * ((x - 1) ** 2 + y ** 2),
    y: 2 * y * ((x + 1) ** 2 + y ** 2) + 2 * y * ((x - 1) ** 2 + y ** 2),
  };
  assert.ok(Math.hypot(gradient.x - exact.x, gradient.y - exact.y) < 1e-8);
}
const levels = cassini({
  family: { enabled: true, from: 0.5, to: 2.3, count: 4 },
}).contours.family;
assert.deepEqual(
  levels.map((l) => [l.level, l.contours.length]),
  [
    [0.5, 2],
    [1.1, 1],
    [1.7, 1],
    [2.3, 1],
  ],
);
// y/(x² + y² − a²) has a pole on the circle of radius a: it changes sign
// across it without reaching any level, and is located there.
const pole = cassini({ f: "y/(x^2+y^2-a^2)", level: 1 }).contours;
assert.ok(pole.discontinuities.length > 100);
for (const { x, y } of pole.discontinuities)
  assert.ok(Math.abs(Math.hypot(x, y) - 1) < 1e-12);
assert.match(cassini({ f: "x+t" }).error, /F\(x, y\) cannot use t/);
// The reference Clifford study, (a, b, c, d) = (−1.4, 1.6, 1, 0.7) from
// (0.1, 0.1): every accumulated iterate is counted in its fitted window,
// which stays within 1 + |c| by 1 + |d|, and the same request gives the same
// counts. Its first iterates follow the map; a Hénon orbit that leaves
// ±100000 stops there.
const iterated = (attractor) =>
  JSON.parse(
    globalThis.tangentGardenCompute(
      JSON.stringify({
        ...config,
        curve: {
          ...config.curve,
          format: "attractor",
          attractor: {
            map: "clifford",
            a: -1.4,
            b: 1.6,
            c: 1,
            d: 0.7,
            start: { x: 0.1, y: 0.1 },
            discard: 1000,
            iterates: 800000,
            fit: true,
            window: { xMin: -2, xMax: 2, yMin: -2, yMax: 2 },
            cells: 600,
            ...attractor,
          },
        },
      }),
    ),
  );
const clifford = iterated({}).attractor;
assert.deepEqual(iterated({}).attractor, clifford);
assert.equal(
  clifford.counts.reduce((sum, n) => sum + n, 0),
  800000,
);
assert.equal(clifford.accumulated, 800000);
assert.equal(clifford.outside, 0);
assert.equal(clifford.escape, 0);
assert.equal(clifford.counts.length, clifford.columns * clifford.rows);
assert.equal(Math.max(clifford.columns, clifford.rows), 600);
assert.equal(
  clifford.counts.reduce((m, n) => Math.max(m, n), 0),
  clifford.max,
);
const { window } = clifford;
assert.ok(window.xMin >= -2 && window.xMax <= 2);
assert.ok(window.yMin >= -1.7 && window.yMax <= 1.7);
assert.equal(clifford.orbit.length, config.lines + 1);
clifford.orbit.slice(1).forEach(({ x, y }, k) => {
  const p = clifford.orbit[k];
  assert.ok(
    Math.abs(x - (Math.sin(-1.4 * p.y) + Math.cos(-1.4 * p.x))) < 1e-14,
  );
  assert.ok(
    Math.abs(y - (Math.sin(1.6 * p.x) + 0.7 * Math.cos(1.6 * p.y))) < 1e-14,
  );
});
const henon = iterated({
  map: "henon",
  a: 1.4,
  b: 0.3,
  start: { x: 2, y: 0 },
  discard: 1,
  iterates: 100,
}).attractor;
assert.deepEqual([henon.escape, henon.accumulated], [4, 2]);
assert.match(iterated({ iterates: 5000001 }).error, /accumulate 0–5,000,000/);
console.log(
  "WASM bridge: analytic ellipse, pedal cardioid, contrapedal circle, orthotomic cardioid, circle offsets, offset stack with circles, astroid roulette, rolling epicycloid, rolling ellipses, circle chords, circles through a focus, a circle inverted into a line, an inverted pedal, an involute of an evolute, a Fourier deltoid, a Lissajous figure, a heptagon pursuit, rotation trajectories, Cassini ovals, Clifford and Hénon densities, and invalid JSON passed.",
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
const spatialCustom = JSON.parse(
  globalThis.tangentGardenSpatial(
    JSON.stringify({
      format: "parametric",
      curve: {
        x: "2*cos(t)",
        y: "2*sin(t)",
        z: "a*t",
        a: 0.25,
        min: 0,
        max: 2 * Math.PI,
      },
      length: 1,
      samples: 480,
      lines: 48,
    }),
  ),
);
assert.equal(spatialCustom.invalid, 0);
assert.equal(spatialCustom.base.length, 481);
assert.ok(Math.abs(spatialCustom.base.at(-1).z - Math.PI / 2) < 1e-12);
assert.equal(spatialCustom.mesh.at(-1).sampleIndex, 480);
assert.equal(spatialCustom.rulings.at(-1).sampleIndex, 480);
assert.ok(spatialCustom.bounds.radius > 2);
console.log("Spatial custom-expression WASM bridge passed.");
// Helix involute family: s = k t with k = √(4 + 1/9); each member lies in
// the plane z = c/(3k), with its string reaching back to the curve.
const helixInvolute = (involute) =>
  JSON.parse(
    globalThis.tangentGardenSpatial(
      JSON.stringify({
        format: "parametric",
        construction: "involute",
        involute,
        curve: {
          x: "2*cos(t)",
          y: "2*sin(t)",
          z: "t/3",
          a: 1,
          min: 0,
          max: 2 * Math.PI,
        },
        samples: 480,
        lines: 25,
      }),
    ),
  );
const unwound = helixInvolute({
  anchor: 0,
  offset: 0,
  family: { enabled: true, from: -1, to: 2, count: 4 },
});
const speed = Math.sqrt(4 + 1 / 9);
[-1, 0, 1, 2].forEach((c, k) =>
  assert.ok(Math.abs(unwound.involute.members[k].offset - c) < 1e-15),
);
for (const member of unwound.involute.members)
  for (const p of member.points)
    assert.ok(Math.abs(p.z - member.offset / (3 * speed)) < 1e-9);
assert.equal(unwound.involute.strings.length, 25);
assert.equal(unwound.involute.unreached, 0);
assert.equal(unwound.mesh.length, 0);
assert.equal(unwound.rulings.length, 0);
assert.ok(unwound.bounds.radius > speed * 2 * Math.PI - 2);
assert.match(
  helixInvolute({ anchor: 7, offset: 0, family: { enabled: false } }).error,
  /anchor/,
);
console.log("Spatial involute-family WASM bridge passed.");

// Spatial projection of a helix: independently known unit tangent, including
// an out-of-plane pole. Transport keeps feet and sample correspondences.
for (const construction of ["tangent-foot", "orthotomic"]) {
  const pole = { x: 1, y: -2, z: 3 };
  const q = JSON.parse(
    tangentGardenSpatial(
      JSON.stringify({
        format: "parametric",
        construction,
        pole,
        curve: {
          x: "2*cos(t)",
          y: "2*sin(t)",
          z: "t/3",
          min: -Math.PI,
          max: Math.PI,
          a: 1,
        },
        samples: 480,
        lines: 24,
      }),
    ),
  );
  assert.equal(q.invalid, 0);
  assert.equal(q.projection.invalid, 0);
  assert.equal(q.projection.constructions.length, 24);
  assert.equal(q.projection.points.length, 481);
  assert.equal(q.mesh.length, 0);
  q.projection.feet.forEach((h, i) => {
    const t = -Math.PI + (2 * Math.PI * i) / 480,
      k = Math.sqrt(4 + 1 / 9);
    const r = { x: 2 * Math.cos(t), y: 2 * Math.sin(t), z: t / 3 };
    const v = {
      x: (-2 * Math.sin(t)) / k,
      y: (2 * Math.cos(t)) / k,
      z: 1 / (3 * k),
    };
    const d =
      (pole.x - r.x) * v.x + (pole.y - r.y) * v.y + (pole.z - r.z) * v.z;
    for (const axis of ["x", "y", "z"]) {
      assert.ok(Math.abs(h[axis] - r[axis] - d * v[axis]) < 1e-8);
      assert.ok(
        Math.abs(
          q.projection.points[i][axis] -
            (construction === "tangent-foot"
              ? h[axis]
              : 2 * h[axis] - pole[axis]),
        ) < 1e-12,
      );
    }
  });
  for (const s of q.projection.constructions) {
    assert.deepEqual(s.contact, q.base[s.sampleIndex]);
    assert.deepEqual(s.foot, q.projection.feet[s.sampleIndex]);
    assert.deepEqual(s.image, q.projection.points[s.sampleIndex]);
  }
}
console.log(
  "WASM spatial projections: helix feet, half-turns and sample identities passed",
);
process.exit(0);
