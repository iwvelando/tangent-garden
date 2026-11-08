import assert from "node:assert/strict";

// Called by the real WASM bridge suite, and separately during focused TDD.
export function checkFourierFit() {
  const fit = (request) =>
    JSON.parse(globalThis.tangentGardenFit(JSON.stringify(request)));
  assert.match(fit({ count: 8 }).error, /outline/i);
  const points = Array.from({ length: 128 }, (_, j) => {
    const a = (2 * Math.PI * j) / 128;
    return { x: 3 + 2 * Math.cos(a), y: -1 + 2 * Math.sin(a) };
  });
  assert.match(fit({ points, closed: false, count: 8 }).error, /Close/);
  const two = fit({ points, closed: true, count: 2 });
  assert.equal(two.terms.length, 2);
  assert.equal(two.terms[0].frequency, 0);
  assert.equal(two.terms[1].frequency, 1);
  assert.ok(Math.abs(two.terms[0].radius - Math.sqrt(10)) < 1e-12);
  assert.ok(Math.abs(two.terms[1].radius - 2) < 0.001);
  assert.equal(two.sampleCount, 1024);
  const eight = fit({ count: 8 });
  assert.deepEqual(eight.terms.slice(0, 2), two.terms);
  assert.ok(eight.rms <= two.rms + 1e-12);
  assert.match(
    fit({ points: Array(4097).fill(points[0]), closed: true, count: 8 }).error,
    /4096/,
  );
  // A failed replacement must release the previous cached stroke.
  assert.match(fit({ count: 8 }).error, /outline/i);
  assert.match(globalThis.tangentGardenFit(" ".repeat(524289)), /large/);
  assert.match(globalThis.tangentGardenFit("{"), /error/);
  assert.match(fit({ count: 8 }).error, /outline/i);
  const source = {
    input: "curve",
    curve: {
      format: "parametric",
      x: "20+3*cos(t)",
      y: "-8+3*sin(t)",
      min: 0,
      max: 2 * Math.PI,
    },
  };
  const imported = fit({ source, count: 8 });
  assert.ok(imported.outline?.points.length > 256, JSON.stringify(imported));
  assert.ok(imported.outline.points.length <= 4096);
  assert.ok(imported.outline.evaluations <= 32768);
  assert.ok(
    imported.outline.previewRadius >=
      imported.terms.reduce((s, t) => s + t.radius, 0),
  );
  assert.equal(
    imported.outline.previewRadius,
    fit({ count: 16 }).terms.reduce((s, t) => s + t.radius, 0),
  );
  assert.equal(imported.terms[1].frequency, 1);
  assert.ok(Math.abs(imported.terms[1].radius - 3) < 0.001);
  assert.deepEqual(fit({ count: 2 }).terms, imported.terms.slice(0, 2));
  assert.match(
    fit({ source: { ...source, curve: { ...source.curve, max: 6 } }, count: 8 })
      .error,
    /open/,
  );
  assert.match(fit({ count: 8 }).error, /outline/i);
  assert.match(fit({ source, points, closed: true, count: 8 }).error, /one/);
  console.log(
    "Fourier fit: real WASM projection, prefix, closure, bounds and cache invalidation passed",
  );
}
