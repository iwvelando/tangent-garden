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
  console.log(
    "Fourier fit: real WASM projection, prefix, closure, bounds and cache invalidation passed",
  );
}
