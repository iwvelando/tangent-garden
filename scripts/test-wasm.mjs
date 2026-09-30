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
// Sphere inversion: a circle through the center becomes the line x = R²/2,
// broken once where the source passes through the center between samples.
const sphereInversion = (inversion, extra = {}) =>
  JSON.parse(
    tangentGardenSpatial(
      JSON.stringify({
        format: "parametric",
        construction: "inversion",
        pole: { x: 1, y: -2, z: 3 },
        inversion,
        curve: {
          x: "1+cos(t)",
          y: "sin(t)",
          z: "0",
          min: 0,
          max: 2 * Math.PI + 0.01,
          a: 1,
        },
        samples: 480,
        lines: 24,
        ...extra,
      }),
    ),
  );
{
  const q = sphereInversion({
    center: { x: 0, y: 0, z: 0 },
    radius: 1,
    input: "base",
  });
  assert.equal(q.mesh.length, 0);
  assert.equal(q.inversion.points.length, 481);
  assert.equal(q.inversion.crossings, 1);
  assert.equal(q.inversion.invalid, 0);
  assert.deepEqual(
    q.inversion.breaks.flatMap((b, i) => (b ? [i] : [])),
    [240],
  );
  for (const p of q.inversion.points) assert.ok(Math.abs(p.x - 0.5) < 1e-9);
  for (const s of q.inversion.correspondences) {
    assert.deepEqual(s.source, q.inversion.source[s.sampleIndex]);
    assert.deepEqual(s.image, q.inversion.points[s.sampleIndex]);
  }
  // Orthotomic input: every image lies on the ray from the center through
  // its source with |OJ||OS| = R².
  const center = { x: 0.2, y: 0.1, z: -0.4 };
  const d = sphereInversion({ center, radius: 2, input: "orthotomic" });
  d.inversion.points.forEach((p, i) => {
    const s = d.inversion.source[i];
    if (!p) return;
    const a = ["x", "y", "z"].map((k) => s[k] - center[k]),
      b = ["x", "y", "z"].map((k) => p[k] - center[k]);
    const norm = (v) => Math.hypot(...v);
    assert.ok(Math.abs(norm(a) * norm(b) - 4) < 1e-9);
    assert.ok(a.reduce((sum, v, k) => sum + v * b[k], 0) > 0);
  });
  assert.match(
    sphereInversion({ center: { x: 0, y: 0, z: 0 }, radius: 0, input: "base" })
      .error,
    /radius/,
  );
}
console.log(
  "WASM sphere inversion: center passage, derived input and validation passed",
);
// Spatial harmonic generator: one term traces the ellipse c₀ + A cos t +
// B sin t, closed over 2π; an incommensurate pair is left open.
const spatialHarmonic = (terms, min, max) =>
  JSON.parse(
    tangentGardenSpatial(
      JSON.stringify({
        format: "harmonic",
        construction: "developable",
        length: 1,
        harmonic: { center: { x: 1, y: 2, z: 3 }, terms, min, max },
        samples: 480,
        lines: 24,
      }),
    ),
  );
{
  const ellipse = spatialHarmonic(
    [
      {
        frequency: 1,
        cosine: { x: 2, y: 0, z: 0 },
        sine: { x: 0, y: 0, z: 1 },
      },
    ],
    0,
    2 * Math.PI,
  );
  assert.equal(ellipse.harmonic.period, 2 * Math.PI);
  assert.equal(ellipse.harmonic.closed, true);
  assert.deepEqual(ellipse.base[480], ellipse.base[0]);
  for (const p of ellipse.base) {
    assert.ok(Math.abs(p.y - 2) < 1e-12);
    assert.ok(Math.abs(((p.x - 1) / 2) ** 2 + (p.z - 3) ** 2 - 1) < 1e-12);
  }
  assert.equal(ellipse.harmonic.positions.length, 24);
  for (const s of ellipse.harmonic.positions)
    assert.deepEqual(s.point, ellipse.base[s.sampleIndex]);
  const open = spatialHarmonic(
    [
      {
        frequency: 1,
        cosine: { x: 2, y: 0, z: 0 },
        sine: { x: 0, y: 2, z: 0 },
      },
      {
        frequency: Math.SQRT2,
        cosine: { x: 0, y: 0, z: 0.5 },
        sine: { x: 0, y: 0, z: 0 },
      },
    ],
    0,
    20,
  );
  assert.equal(open.harmonic.period, 0);
  assert.equal(open.harmonic.closed, false);
  assert.match(
    spatialHarmonic(
      [
        {
          frequency: 0,
          cosine: { x: 1, y: 0, z: 0 },
          sine: { x: 0, y: 0, z: 0 },
        },
      ],
      0,
      1,
    ).error,
    /nothing turns/,
  );
}
console.log(
  "WASM spatial harmonics: ellipse, closure, open arc and validation passed",
);
// Framed ribbon: a unit circle is planar, so its rotation-minimizing normal
// stays e_z; one turn of twist from θ₀ = 0 carries D = cos θ U + sin θ V
// around the tangent, and the loop closes without a seam.
const spatialFrame = (frame) =>
  JSON.parse(
    tangentGardenSpatial(
      JSON.stringify({
        format: "harmonic",
        construction: "framed",
        harmonic: {
          center: { x: 0, y: 0, z: 0 },
          terms: [
            {
              frequency: 1,
              cosine: { x: 1, y: 0, z: 0 },
              sine: { x: 0, y: 1, z: 0 },
            },
          ],
          min: 0,
          max: 2 * Math.PI,
        },
        frame: {
          kind: "rotation-minimizing",
          reference: { x: 0, y: 0, z: 1 },
          angle: 0,
          twist: 1,
          offset: 0.5,
          width: 0.25,
          strands: 2,
          closure: "seam",
          ...frame,
        },
        samples: 480,
        lines: 24,
      }),
    ),
  );
{
  const ring = spatialFrame({});
  const q = ring.frame;
  assert.equal(q.kind, "rotation-minimizing");
  assert.equal(q.closed, true);
  assert.equal(q.holonomy, 0);
  assert.equal(q.seam, undefined);
  assert.ok(Math.abs(q.length - 2 * Math.PI) < 1e-12);
  assert.equal(q.strands.length, 2);
  assert.equal(q.frames.length, 24);
  for (const g of q.frames) {
    assert.ok(Math.abs(g.normal.z - 1) < 1e-12);
    const t = (2 * Math.PI * g.sampleIndex) / 480;
    // V = T × e_z is the outward radius; D turns from e_z towards it.
    const p = q.strands[0][g.sampleIndex];
    const want = {
      x: Math.cos(t) * (1 + 0.5 * Math.sin(t)),
      y: Math.sin(t) * (1 + 0.5 * Math.sin(t)),
      z: 0.5 * Math.cos(t),
    };
    for (const axis of ["x", "y", "z"])
      assert.ok(Math.abs(p[axis] - want[axis]) < 1e-12, `strand at ${t}`);
  }
  assert.equal(ring.mesh.length, 6 * 480);
  assert.equal(ring.rulings.length, 24);
  assert.equal(ring.frame.breaks.length, 481);
  // Half a turn cannot close: the seam reports it.
  const half = spatialFrame({ twist: 0.5 });
  assert.ok(Math.abs(Math.abs(half.frame.seam.angle) - Math.PI) < 1e-9);
  assert.match(spatialFrame({ kind: "bishop" }).error, /rotation-minimizing/);
  assert.match(spatialFrame({ strands: 13 }).error, /strands/);
}
console.log(
  "WASM framed ribbon: transported frame, twist, seam and validation passed",
);
// Two unit rings, a(t) at z = −1 and b(t + δ) at z = 1, span the hyperboloid
// x² + y² = cos²(δ/2) + z² sin²(δ/2).
const spatialRuled = (ruled) =>
  JSON.parse(
    tangentGardenSpatial(
      JSON.stringify({
        format: "harmonic",
        construction: "ruled",
        harmonic: {
          center: { x: 0, y: 0, z: -1 },
          terms: [
            {
              frequency: 1,
              cosine: { x: 1, y: 0, z: 0 },
              sine: { x: 0, y: 1, z: 0 },
            },
          ],
          min: 0,
          max: 2 * Math.PI,
        },
        ruled: {
          partner: "thread",
          thread: { x: "cos(t)", y: "sin(t)", z: "1" },
          rate: 1,
          shift: 1.3,
          ...ruled,
        },
        samples: 480,
        lines: 24,
      }),
    ),
  );
{
  const loom = spatialRuled({});
  const q = loom.ruled;
  assert.equal(q.partner, "thread");
  assert.equal(q.closed, true);
  assert.equal(q.developable, false);
  assert.equal(q.breaks.length, 481);
  assert.equal(loom.minus.length, 0);
  assert.equal(loom.plus.length, 481);
  assert.equal(loom.rulings.length, 24);
  assert.equal(loom.mesh.length, 480 * 4 * 6);
  const k = Math.sin(0.65) ** 2;
  for (const v of loom.mesh) {
    const p = v.position;
    assert.ok(
      Math.abs(p.x * p.x + p.y * p.y - Math.cos(0.65) ** 2 - p.z * p.z * k) <
        1e-12,
    );
  }
  // Chords of the circle itself, a quarter turn apart, lie in its plane.
  const chord = spatialRuled({ partner: "chord", shift: Math.PI / 2 });
  assert.equal(chord.ruled.closed, true);
  for (const r of chord.rulings)
    assert.ok(Math.abs(r.to.z + 1) < 1e-12 && Math.abs(r.from.z + 1) < 1e-12);
  // A zero shift collapses every chord.
  assert.equal(
    spatialRuled({ partner: "chord", shift: 0 }).ruled.coincident,
    480,
  );
  assert.match(spatialRuled({ partner: "loom" }).error, /second thread/);
  assert.match(spatialRuled({ rate: 101 }).error, /rate m/);
  assert.match(
    spatialRuled({ thread: { x: "a", y: "0", z: "0" } }).error,
    /b x\(t\)/,
  );
}
console.log(
  "WASM ruled surface: hyperboloid, chords, collapse and validation passed",
);
// Canal surface: spheres of radius 0.5ρ(t) centred on a circle of radius 2.
// With ρ = 1 the envelope is the torus (√(x² + y²) − 2)² + z² = 1/4; a
// profile that grows faster than the centre moves has no real envelope.
const spatialCanal = (canal, frame = {}) =>
  JSON.parse(
    tangentGardenSpatial(
      JSON.stringify({
        format: "harmonic",
        construction: "canal",
        harmonic: {
          center: { x: 0, y: 0, z: 0 },
          terms: [
            {
              frequency: 1,
              cosine: { x: 2, y: 0, z: 0 },
              sine: { x: 0, y: 2, z: 0 },
            },
          ],
          min: 0,
          max: 2 * Math.PI,
        },
        canal: { radius: 0.5, profile: "1", meridians: 4, ...canal },
        frame: {
          kind: "rotation-minimizing",
          reference: { x: 0, y: 0, z: 1 },
          angle: 0,
          twist: 0,
          offset: 0,
          width: 0,
          strands: 0,
          closure: "seam",
          ...frame,
        },
        samples: 480,
        lines: 24,
      }),
    ),
  );
{
  const torus = spatialCanal({});
  const q = torus.canal;
  assert.equal(q.constant, true);
  assert.equal(q.closed, true);
  assert.equal(q.imaginary, 0);
  assert.equal(q.breaks.length, 481);
  assert.equal(q.meridians.length, 4);
  assert.equal(q.circles.length, 24);
  assert.equal(torus.frame.kind, "rotation-minimizing");
  assert.equal(torus.minus.length, 0);
  assert.equal(torus.rulings.length, 0);
  assert.equal(torus.mesh.length, 480 * 24 * 6);
  for (const v of torus.mesh) {
    const p = v.position;
    assert.ok(
      Math.abs((Math.hypot(p.x, p.y) - 2) ** 2 + p.z ** 2 - 0.25) < 1e-12,
    );
  }
  for (const g of q.circles) {
    assert.equal(g.real, true);
    assert.equal(g.radius, 0.5);
    assert.equal(g.points.length, 49);
  }
  // R′ = 0.5·4·cos(4t) reaches 2 = v: collapse where equal, gaps beyond.
  const beads = spatialCanal({ profile: "1+1.2*sin(4*t)" });
  assert.ok(beads.canal.imaginary > 0);
  assert.equal(beads.canal.constant, false);
  assert.ok(Math.abs(beads.canal.steepest - 1.2) < 1e-9);
  assert.ok(beads.canal.circles.some((g) => !g.real && g.points.length === 0));
  assert.ok(beads.omitted > 0);
  assert.match(spatialCanal({ radius: 0 }).error, /radius R/);
  assert.match(spatialCanal({ meridians: 13 }).error, /meridians/);
  assert.match(spatialCanal({ profile: "a*t" }).error, /ρ\(t\)/);
  assert.match(spatialCanal({}, { closure: "trim" }).error, /closure/);
}
console.log("WASM canal surface: torus, lost envelope and validation passed");
const spatialField = (field, construction = "none") =>
  JSON.parse(
    tangentGardenSpatial(
      JSON.stringify({
        format: "field",
        construction,
        field: {
          x: "-y",
          y: "x",
          z: "a",
          seeds: [
            { x: 1, y: 0, z: 0 },
            { x: -1, y: 0, z: 0 },
            { x: 30, y: 0, z: 0 },
          ],
          escape: 10,
          min: 0,
          max: 4 * Math.PI,
          a: 0.25,
          ...field,
        },
        length: 1,
        samples: 480,
        lines: 24,
      }),
    ),
  );
{
  // The rising vortex: helices (cos(φ + t), sin(φ + t), t/4), all indexed
  // by the same times; a seed outside the escape sphere never starts.
  const vortex = spatialField({});
  const q = vortex.field;
  assert.equal(q.paths.length, 3);
  assert.equal(q.timed, false);
  assert.deepEqual(
    q.ends.map((e) => e.reason),
    ["end", "end", "escape"],
  );
  assert.equal(q.ends[2].point, null);
  assert.ok(q.paths[2].every((p) => p === null));
  for (const [k, phi] of [0, Math.PI].entries())
    q.paths[k].forEach((p, i) => {
      const t = (4 * Math.PI * i) / 480;
      assert.ok(
        Math.hypot(
          p.x - Math.cos(phi + t),
          p.y - Math.sin(phi + t),
          p.z - t / 4,
        ) < 1e-8,
      );
    });
  assert.deepEqual(vortex.base, q.paths[0]);
  assert.equal(vortex.mesh.length, 0);
  assert.equal(vortex.minus.length, 0);
  assert.equal(q.arrows.length, 48);
  assert.ok(spatialField({}, "developable").mesh.length > 0);
  // Growth leaves the sphere |r| = 10 at t = ln 10.
  const growth = spatialField({ x: "x", y: "y", z: "z", max: 5 });
  assert.ok(Math.abs(growth.field.ends[0].time - Math.log(10)) < 1e-9);
  assert.equal(spatialField({ z: "t" }).field.timed, true);
  assert.match(spatialField({ z: "w" }).error, /dz\/dt/);
  assert.match(spatialField({ seeds: [] }).error, /seeds/);
  assert.match(spatialField({ escape: -1 }).error, /escape radius/);
}
console.log("WASM vector field: helices, escape and validation passed");

// The 4D engine has its own request/result contract.
const hyper = {
  mode: "section",
  angles: [0, 0, 0, 0, 0, 0],
  distance: 4,
  slice: 0,
  spread: 2,
  count: 1,
  grid: 0,
  samples: 64,
  clip: 4,
};
const h = JSON.parse(globalThis.tangentGardenTesseract(JSON.stringify(hyper)));
assert.deepEqual(h.sections[0], {
  id: "section/0",
  level: 0,
  vertices: 8,
  edges: 12,
  faces: 6,
  dimension: 3,
});
assert.equal(h.paths.length, 12);
assert.equal(h.faces.length, 6);
for (const change of [
  { mode: "perspective", distance: 2 },
  { mode: "stereo", samples: 300 },
  { mode: "orthographic", grid: -1 },
  { count: 1.5 },
  { mode: "bad" },
  { angles: [0, 0, "x", 0, 0, 0] },
])
  assert.ok(
    JSON.parse(
      globalThis.tangentGardenTesseract(
        JSON.stringify({ ...hyper, ...change }),
      ),
    ).error,
  );
for (const mode of ["perspective", "orthographic", "stereo"])
  assert.equal(
    JSON.parse(
      globalThis.tangentGardenTesseract(JSON.stringify({ ...hyper, mode })),
    ).paths.length,
    32,
  );
console.log("Tesseract WASM contract passed");

const spatialPursuit = (pursuit, construction = "none") =>
  JSON.parse(
    tangentGardenSpatial(
      JSON.stringify({
        format: "pursuit",
        construction,
        pursuit: {
          pursuers: [
            { x: 1, y: 0, z: 0, speed: 1 },
            { x: -0.5, y: Math.sqrt(3) / 2, z: 0, speed: 1 },
            { x: -0.5, y: -Math.sqrt(3) / 2, z: 0, speed: 1 },
          ],
          capture: 0.01,
          min: 0,
          max: 2,
          ...pursuit,
        },
        length: 1,
        samples: 480,
        lines: 24,
      }),
    ),
  );
{
  // Three equal pursuers from the unit triangle close to ε = 0.01, the gap
  // √3 r, at r = 0.01/√3, which takes (1 − r)/(v sin(π/3)).
  const triangle = spatialPursuit({});
  const q = triangle.pursuit;
  const capture = (1 - 0.01 / Math.sqrt(3)) / Math.sin(Math.PI / 3);
  assert.equal(q.paths.length, 3);
  assert.ok(Math.abs(q.capture.time - capture) < 1e-9);
  assert.equal(q.capture.target, (q.capture.pursuer + 1) % 3);
  assert.equal(q.end, q.capture.time);
  assert.equal(q.exhausted, false);
  assert.equal(q.final.length, 3);
  assert.deepEqual(triangle.base, q.paths[0]);
  q.paths.forEach((path) =>
    path.forEach((p, i) => {
      const t = (2 * i) / 480;
      if (t > q.end) assert.equal(p, null);
      else
        assert.ok(
          p.z === 0 &&
            Math.abs(Math.hypot(p.x, p.y) - (1 - t * Math.sin(Math.PI / 3))) <
              1e-9,
        );
    }),
  );
  assert.ok(
    q.polygons.length > 12 && q.polygons.every((p) => p.points.length === 3),
  );
  assert.ok(spatialPursuit({}, "developable").mesh.length > 0);
  assert.equal(spatialPursuit({ max: 0.5 }).pursuit.capture, null);
  assert.match(spatialPursuit({ pursuers: [] }).error, /2–16 pursuers/);
  assert.match(spatialPursuit({ capture: 0 }).error, /capture distance/);
}
console.log("WASM spatial pursuit: triangle, capture and validation passed");
const spatialSurface = (surface) =>
  JSON.parse(
    tangentGardenSpatial(
      JSON.stringify({
        format: "surface",
        // The curve's own fields are ignored for a surface.
        construction: "developable",
        length: -1,
        samples: 0,
        lines: 0,
        surface: {
          kind: "ellipsoid",
          a: 1.5,
          b: 1.5,
          c: 1.5,
          uMin: 0,
          uMax: 2 * Math.PI,
          vMin: -Math.PI / 2,
          vMax: Math.PI / 2,
          uSamples: 36,
          vSamples: 18,
          curves: 7,
          reverse: false,
          offset: 0.5,
          reach: 1,
          ...surface,
        },
      }),
    ),
  );
{
  // A sphere of radius 1.5: its offset by 0.5 is the sphere of radius 2,
  // both focal sheets collapse to the centre, and its poles are chart
  // singularities.
  const round = spatialSurface({});
  const q = round.surface;
  assert.deepEqual(round.base, []);
  assert.equal(q.surface.points.length, 37);
  assert.equal(q.surface.points[0].length, 19);
  assert.equal(q.singular, 2 * 37);
  assert.equal(q.umbilics, 37 * 17);
  assert.deepEqual(
    q.focal.map((f) => f.shape),
    ["point", "point"],
  );
  q.offset.points.flat().forEach((p) => {
    if (p) assert.ok(Math.abs(Math.hypot(p.x, p.y, p.z) - 2) < 1e-12);
  });
  q.focal[0].points.flat().forEach((p) => {
    if (p) assert.ok(Math.hypot(p.x, p.y, p.z) < 1e-12);
  });
  assert.equal(q.lines.length, 49 - 14);
  assert.equal(q.offset.normals[0][0], null);
  // A torus: the axis and the core circle.
  const ring = spatialSurface({
    kind: "torus",
    a: 2,
    b: 0.8,
    vMin: 0,
    vMax: 2 * Math.PI,
    offset: 0,
  }).surface;
  assert.equal(ring.offset, null);
  assert.deepEqual(
    ring.focal.map((f) => f.shape),
    ["curve", "curve"],
  );
  ring.focal[1].points.flat().forEach((p) => {
    assert.ok(
      Math.abs(Math.hypot(p.x, p.y) - 2) < 1e-12 && Math.abs(p.z) < 1e-12,
    );
  });
  assert.match(spatialSurface({ kind: "klein" }).error, /unknown surface/);
  assert.match(spatialSurface({ a: 0 }).error, /semi-axes/);
  assert.match(spatialSurface({ uSamples: 240, vSamples: 61 }).error, /14,400/);
  assert.match(spatialSurface({ curves: 1 }).error, /parameter curves/);
}
console.log("WASM surface: sphere, torus and validation passed");
const spatialRays = (surface, rays) =>
  JSON.parse(
    tangentGardenSpatial(
      JSON.stringify({
        format: "rays",
        // The curve's fields and the surface study's offset and normal reach
        // are ignored for a ray study.
        samples: 0,
        lines: 0,
        surface: {
          kind: "paraboloid",
          a: 0.5,
          b: 0.5,
          c: 0,
          uMin: -1.5,
          uMax: 1.5,
          vMin: -1.5,
          vMax: 1.5,
          uSamples: 24,
          vSamples: 24,
          curves: 5,
          reverse: false,
          offset: -1e9,
          reach: -1e9,
          ...surface,
        },
        rays: {
          interaction: "reflect",
          n1: 1,
          n2: 1.5,
          light: "parallel",
          azimuth: 0,
          elevation: -90,
          source: { x: 0, y: 0, z: 0 },
          length: 2,
          receiver: { plane: "none", at: 0, c1: 0, c2: 0, size: 2, bins: 32 },
          ...rays,
        },
      }),
    ),
  );
{
  // Axial light reflects through the paraboloid's focus, 1/(2k) = 1 above
  // its vertex: both branches collapse to that real point.
  const dish = spatialRays({}, {});
  const q = dish.rays;
  assert.deepEqual(dish.base, []);
  assert.equal(dish.surface, undefined);
  assert.deepEqual(
    q.caustics.map((c) => [c.branch, c.virtual, c.shape]),
    [
      [1, false, "point"],
      [1, true, "none"],
      [2, false, "point"],
      [2, true, "none"],
    ],
  );
  assert.equal(q.stigmatic, 25 * 25);
  assert.equal(q.source, null);
  q.caustics[0].points.flat().forEach((p) => {
    assert.ok(Math.hypot(p.x, p.y, p.z - 1) < 1e-12);
  });
  assert.equal(q.lines.length, 25);
  // Every reflected ray passes through the focus.
  q.lines.forEach((l) => {
    const d = {
      x: l.end.x - l.point.x,
      y: l.end.y - l.point.y,
      z: l.end.z - l.point.z,
    };
    const w = { x: -l.point.x, y: -l.point.y, z: 1 - l.point.z };
    const along = (w.x * d.x + w.y * d.y + w.z * d.z) / 4;
    assert.ok(
      Math.hypot(w.x - along * d.x, w.y - along * d.y, w.z - along * d.z) <
        1e-12,
    );
  });
  // A plane mirror images a point source, virtually, behind it.
  const plane = spatialRays(
    { a: 0, b: 0 },
    { light: "point", source: { x: 0.2, y: -0.1, z: 1.5 } },
  ).rays;
  assert.deepEqual(plane.source, { x: 0.2, y: -0.1, z: 1.5 });
  assert.ok(plane.lines.length > 0 && plane.lines.every((l) => l.virtual));
  assert.ok(q.lines.every((l) => !l.virtual));
  assert.equal(plane.caustics[1].shape, "point");
  plane.caustics[1].points.flat().forEach((p) => {
    assert.ok(Math.hypot(p.x - 0.2, p.y + 0.1, p.z + 1.5) < 1e-12);
  });
  // Behind the mirror, nothing is lit.
  assert.equal(spatialRays({ reverse: true }, {}).rays.unlit, 25 * 25);
  assert.match(
    spatialRays({}, { light: "laser" }).error,
    /parallel or a point/,
  );
  assert.match(spatialRays({}, { length: -1 }).error, /ray length/);
  assert.match(spatialRays({ kind: "klein" }, {}).error, /unknown surface/);
  assert.equal(q.receiver, null);
  // A lamp 1 below the water's surface z = 0, shining up from n₁ = 1.33
  // into air, is totally reflected outside Snell's window, a disc of
  // radius tan θ_c where sin θ_c = 1/1.33.
  const water = spatialRays(
    { a: 0, b: 0, reverse: true },
    {
      interaction: "refract",
      n1: 1.33,
      n2: 1,
      light: "point",
      source: { x: 0, y: 0, z: -1 },
    },
  ).rays;
  const snell = Math.tan(Math.asin(1 / 1.33));
  let beyond = 0;
  for (let i = 0; i <= 24; i++)
    for (let j = 0; j <= 24; j++)
      if (Math.hypot(-1.5 + i / 8, -1.5 + j / 8) >= snell) beyond++;
  assert.equal(water.total, beyond);
  assert.ok(water.lines.some((l) => l.total));
  water.lines.forEach((l) => {
    const r = Math.hypot(l.point.x, l.point.y);
    assert.equal(l.total, r >= snell);
    // Transmitted rays leave upward; totally reflected ones back down.
    assert.equal(l.end.z > 0, !l.total);
  });
  assert.ok(water.caustics.every((c) => !c.virtual || c.shape !== "none"));
  // Parallel light at 30° from the normal crossing a flat interface
  // delivers cos 30° of its irradiance to every bin of a parallel receiver.
  const floor = spatialRays(
    { a: 0, b: 0 },
    {
      interaction: "refract",
      elevation: -60,
      receiver: { plane: "z", at: -1, c1: 0.1, c2: 0, size: 1, bins: 16 },
    },
  ).rays.receiver;
  const cos = Math.sqrt(3) / 2;
  assert.equal(floor.irradiance.length, 16);
  floor.irradiance.flat().forEach((e) => assert.ok(Math.abs(e - cos) < 1e-12));
  assert.ok(Math.abs(floor.emitted - 9 * cos) < 1e-12);
  assert.ok(
    Math.abs(
      floor.received +
        floor.outside +
        floor.away +
        floor.total +
        floor.edge -
        floor.emitted,
    ) < 1e-12,
  );
  const [corner] = floor.corners;
  assert.ok(Math.hypot(corner.x + 0.4, corner.y + 0.5, corner.z + 1) < 1e-15);
  assert.match(
    spatialRays({}, { interaction: "absorb" }).error,
    /reflect or refract/,
  );
  assert.match(
    spatialRays({}, { interaction: "refract", n2: 0 }).error,
    /refractive indices/,
  );
  assert.match(
    spatialRays({}, { receiver: { plane: "z", size: 1, bins: 4 } }).error,
    /bins/,
  );
}
console.log(
  "WASM rays: paraboloid focus, plane mirror, Snell's window, receiver and validation passed",
);
const spatialImplicit = (implicit) =>
  JSON.parse(
    tangentGardenSpatial(
      JSON.stringify({
        format: "implicit",
        // The curve's fields are ignored for an implicit surface.
        samples: 0,
        lines: 0,
        implicit: {
          f: "x^2 + y^2 + z^2 - a",
          a: 1,
          level: 0,
          box: {
            xMin: -1.3,
            xMax: 1.3,
            yMin: -1.3,
            yMax: 1.3,
            zMin: -1.3,
            zMax: 1.3,
          },
          cells: 24,
          sections: {
            normal: { x: 0, y: 0, z: 1 },
            from: -0.5,
            to: 0.5,
            count: 3,
          },
          ...implicit,
        },
      }),
    ),
  );
{
  // The unit sphere: every vertex on it, its normal outward, one closed
  // piece of Euler characteristic 2, and circles of latitude.
  const ball = spatialImplicit({});
  const m = ball.implicit;
  assert.deepEqual(ball.base, []);
  assert.equal(ball.surface, undefined);
  assert.deepEqual(m.grid, [24, 24, 24]);
  assert.ok(m.triangles.length > 0 && m.triangles.length % 3 === 0);
  for (let k = 0; k < m.positions.length; k += 3) {
    const [x, y, z] = m.positions.slice(k, k + 3);
    assert.ok(Math.abs(x * x + y * y + z * z - 1) < 1e-12);
    assert.ok(
      Math.hypot(m.normals[k] - x, m.normals[k + 1] - y, m.normals[k + 2] - z) <
        1e-8,
    );
  }
  assert.deepEqual(m.components, [
    { triangles: m.triangles.length / 3, euler: 2, closed: true },
  ]);
  assert.deepEqual(m.cut, []);
  assert.deepEqual(m.open, []);
  assert.equal(m.sections.length, 3);
  m.sections.forEach((s, k) => {
    assert.equal(s.offset, [-0.5, 0, 0.5][k]);
    assert.equal(s.paths.length, 1);
    assert.equal(s.paths[0].closed, true);
    s.paths[0].points.forEach((p) => {
      assert.equal(p.z, s.offset);
      assert.ok(
        Math.abs(Math.hypot(p.x, p.y) - Math.sqrt(1 - s.offset ** 2)) < 1e-12,
      );
    });
  });
  // A pole is counted and marked, never meshed.
  const pole = spatialImplicit({
    f: "1/(x - 0.0501)",
    cells: 10,
    box: { xMin: -1, xMax: 1, yMin: -1, yMax: 1, zMin: -1, zMax: 1 },
  }).implicit;
  assert.equal(pole.triangles.length, 0);
  assert.equal(pole.discontinuities, 441);
  pole.marks.forEach((p) => assert.ok(Math.abs(p.x - 0.0501) < 1e-12));
  assert.match(spatialImplicit({ f: "x + t" }).error, /cannot use t/);
  assert.match(spatialImplicit({ cells: 128 }).error, /262,144 cells/);
  assert.match(
    spatialImplicit({
      sections: { normal: { x: 0, y: 0, z: 0 }, from: 0, to: 0, count: 1 },
    }).error,
    /section normal/,
  );
}
console.log("WASM implicit: sphere, sections, pole and validation passed");

// Curved solids use the same real WASM bridge, without polyhedral counts.
for (const object of ["ball", "tube"]) {
  const request = { ...hyper, object, radius: 2, tube: 0.6, curves: 5 };
  const compute = (change = {}) =>
    JSON.parse(
      tangentGardenTesseract(JSON.stringify({ ...request, ...change })),
    );
  const support = object === "ball" ? 2 : 0.6;
  const result = compute({ slice: support * 0.6 });
  assert.equal(result.object, object);
  assert.equal(result.operation, "section");
  assert.equal(result.sections[0].dimension, 3);
  assert.ok(Math.abs(result.sections[0].radius - support * 0.8) < 1e-12);
  assert.equal(result.sections[0].vertices, undefined);
  assert.equal(
    compute({ slice: support }).sections[0].kind,
    object === "ball" ? "point" : "core-circle",
  );
  assert.equal(compute({ slice: 1.025 * support }).sections[0].kind, "empty");
  assert.ok(compute({ mode: "perspective" }).error);
  assert.ok(compute({ angles: [0, 0, 0, 0.1, 0, 0] }).error);
  const largest = {
    ...request,
    object: "tube",
    count: 16,
    curves: 16,
    samples: 127,
    spread: 0,
  };
  const start = performance.now();
  const json = tangentGardenTesseract(JSON.stringify(largest));
  const parsed = JSON.parse(json);
  assert.equal(parsed.emittedPoints, 65536);
  assert.equal(parsed.evaluations, 65024);
  console.log(
    `Curved WASM ${object}: largest tube ${(performance.now() - start).toFixed(1)} ms including JSON parse, ${Buffer.byteLength(json)} JSON bytes, ${instance.exports.mem.buffer.byteLength} bytes WASM linear-memory high-water`,
  );
}
console.log("Curved sections WASM contract passed");

// Localized lift: observe actual clipped and connected geometry through WASM.
{
  const request = {
    object: "lift",
    mode: "reference",
    samples: 256,
    lift: {
      center: [0, 0, 0],
      support: 2,
      height: 0.32,
      angle: Math.PI / 4,
      from: [-5, 0, 0],
      to: [5, 0, 0],
      radiusFrom: 0.05,
      radiusTo: 2.5,
    },
  };
  const compute = (q) => JSON.parse(tangentGardenTesseract(JSON.stringify(q)));
  const sliced = compute(request);
  assert.equal(sliced.object, "lift");
  assert.equal(sliced.lift.thickness, 0.02);
  assert.ok(Math.abs(sliced.lift.missingRadius - Math.sqrt(3)) < 1e-12);
  const paths = sliced.paths.filter(
    (p) => p.source === "lift/thread/2" && !p.guide,
  );
  assert.equal(paths.length, 2);
  assert.equal(paths[0].role, "reference");
  assert.ok(Math.abs(paths[0].points.at(-1)[0] + Math.sqrt(3)) < 1e-12);
  assert.ok(Math.abs(paths[1].points[0][0] - Math.sqrt(3)) < 1e-12);
  const liftedRequest = { ...request, mode: "lifted" };
  const start = performance.now();
  const json = tangentGardenTesseract(JSON.stringify(liftedRequest));
  const full = JSON.parse(json);
  assert.equal(full.paths.filter((p) => !p.guide).length, 6);
  for (const p of full.paths.filter((p) => !p.guide))
    for (let i = 0; i < p.points.length; i++) {
      const v = p.fourPoints[i],
        s2 = (v[0] ** 2 + v[1] ** 2 + v[2] ** 2) / 4;
      assert.ok(Math.abs(v[3] - (s2 < 1 ? 0.32 * (1 - s2) ** 2 : 0)) < 1e-12);
      assert.ok(
        Math.abs(p.points[i][0] - (v[0] - v[3]) / Math.sqrt(2)) < 1e-12,
      );
    }
  assert.ok(full.emittedPoints < 2500);
  assert.ok(full.evaluations < 2700);
  assert.equal(
    compute({ ...request, lift: { ...request.lift, height: 0.02 } }).lift
      .missingRadius,
    0,
  );
  assert.match(
    compute({ ...request, lift: { ...request.lift, support: 0 } }).error,
    /support radius/,
  );
  const seam = compute({
    ...request,
    lift: {
      ...request.lift,
      center: [-1.75, 0, 0.5],
      support: 3.5 / Math.sqrt(0.75),
    },
  });
  const contacts = seam.paths.filter(
    (p) => p.source === "lift/circle" && !p.guide,
  );
  assert.equal(contacts.length, 1);
  assert.deepEqual(contacts[0].parameters, [0, 0]);
  assert.deepEqual(contacts[0].points, [
    [1.75, 0, 0.5],
    [1.75, 0, 0.5],
  ]);
  assert.equal(seam.lift.visibleIntervals, 6);
  const wrapped = compute({
    ...request,
    lift: { ...request.lift, center: [-1.75, 0, 0.5], support: 1 },
  });
  assert.equal(
    wrapped.paths.filter((p) => p.source === "lift/circle" && !p.guide).length,
    2,
  );
  assert.equal(wrapped.lift.visibleIntervals, 9);
  console.log(
    `Localized lift WASM: ${full.paths.length} paths, ${full.emittedPoints} points, ${full.evaluations} evaluations; ${(performance.now() - start).toFixed(1)} ms including parse; ${Buffer.byteLength(json)} JSON bytes; ${instance.exports.mem.buffer.byteLength} bytes linear-memory high-water`,
  );
}

process.exit(0);
