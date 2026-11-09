import assert from "node:assert/strict";

// Called by the real WASM bridge suite, and separately during focused TDD.
// Walks the returned chain itself: each circle sits where the vectors before it
// end, at every sampled position.
function assertBoundsHoldChain(box, terms) {
  for (let i = 0; i <= 720; i++) {
    const u = (i * Math.PI) / 360;
    let x = 0,
      y = 0;
    for (const { frequency, radius, phase } of terms) {
      assert.ok(x - radius >= box.minX - 1e-9 && x + radius <= box.maxX + 1e-9);
      assert.ok(y - radius >= box.minY - 1e-9 && y + radius <= box.maxY + 1e-9);
      x += radius * Math.cos(frequency * u + phase);
      y += radius * Math.sin(frequency * u + phase);
    }
  }
}

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
  // The bounds reach the page unchanged by the term count, and hold every
  // circle of the chain and the source's own circle, close to its far edge.
  const whole = fit({ count: 16 });
  assert.deepEqual(imported.previewBounds, whole.previewBounds);
  assertBoundsHoldChain(whole.previewBounds, whole.terms);
  assert.ok(whole.previewBounds.maxX > 22.99);
  assert.ok(whole.previewBounds.maxX < 24);
  assert.ok(whole.previewBounds.minY >= -22);
  assert.equal(imported.terms[1].frequency, 1);
  assert.ok(Math.abs(imported.terms[1].radius - 3) < 0.001);
  assert.deepEqual(fit({ count: 2 }).terms, imported.terms.slice(0, 2));
  // An open source returns its outline alone and caches no fit; the same
  // points then fit as an explicitly closed outline, chord included.
  const open = fit({
    source: { ...source, curve: { ...source.curve, max: Math.PI } },
    count: 8,
  });
  assert.equal(open.outline?.open, true, JSON.stringify(open).slice(0, 200));
  assert.equal(open.terms, undefined);
  assert.ok(Math.abs(open.outline.points[0].x - 23) < 1e-12);
  assert.ok(Math.abs(open.outline.points.at(-1).x - 17) < 1e-12);
  assert.match(fit({ count: 8 }).error, /outline/i);
  const joined = fit({
    points: open.outline.points,
    closed: true,
    close: true,
    count: 8,
  });
  assert.equal(joined.terms.length, 8);
  assert.ok(Math.abs(joined.length - (3 * Math.PI + 6)) < 0.01);
  // The closing segment returns divided, ahead of nothing but the source.
  assert.ok(joined.closedPoints.length > open.outline.points.length + 50);
  assert.deepEqual(
    joined.closedPoints.slice(0, open.outline.points.length),
    open.outline.points,
  );
  assert.deepEqual(fit({ count: 2 }).terms, joined.terms.slice(0, 2));
  assert.equal(
    fit({ points: joined.closedPoints, closed: true, count: 8 }).closedPoints,
    undefined,
  );
  assert.match(fit({ points, close: true, count: 8 }).error, /close/i);
  assert.match(
    fit({
      points,
      closed: true,
      close: true,
      count: 8,
      correction: { index: 0, target: { x: 5, y: 0 }, reach: 0.1 },
    }).error,
    /close/i,
  );
  assert.equal(imported.outline.open, undefined);
  assert.match(fit({ source, points, closed: true, count: 8 }).error, /one/);
  const corrected = fit({
    points,
    closed: true,
    count: 8,
    correction: { index: 0, target: { x: 5.5, y: -1 }, reach: 0.1 },
  });
  assert.ok(corrected.editedPoints, JSON.stringify(corrected));
  assert.deepEqual(corrected.editedPoints[0], { x: 5.5, y: -1 });
  assert.deepEqual(corrected.editedPoints[64], points[64]);
  assertBoundsHoldChain(corrected.previewBounds, corrected.terms);
  const direct = fit({
    points: corrected.editedPoints,
    closed: true,
    count: 8,
  });
  assert.deepEqual(corrected.terms, direct.terms);
  assert.equal(corrected.rms, direct.rms);
  assert.equal(corrected.maxResidual, direct.maxResidual);
  assert.deepEqual(fit({ count: 2 }).terms, corrected.terms.slice(0, 2));
  assert.match(
    fit({
      points,
      closed: true,
      count: 8,
      correction: { index: 0, target: { x: 100001, y: 0 }, reach: 0.1 },
    }).error,
    /coordinates/,
  );
  assert.match(fit({ count: 8 }).error, /outline/);
  assert.match(
    fit({
      count: 8,
      correction: { index: 0, target: { x: 1, y: 0 }, reach: 0.1 },
    }).error,
    /outline/,
  );
  console.log(
    "Fourier fit: real WASM projection, prefix, closure, bounds and cache invalidation passed",
  );
}
