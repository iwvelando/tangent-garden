// The base curve of "Inside a star's point" (web/presets.ts), for tests that
// measure its drawing against the exact curve.

// The hypotrochoid (3 cos t + c cos 3t, 3 sin t − c sin 3t), c = 0.96, the
// star's base curve: its point at t = 0, (3.96, 0), has radius of curvature
// ρ = (3 − 3c)²/(3 + 9c).
const c = 0.96;
export const tip = { x: 3 + c, y: 0 };
export const rho = (3 - 3 * c) ** 2 / (3 + 9 * c);
// The distance from a point near the tip to the star, minimized over t
// near 0 by a fine search and then golden sections.
export function distanceToStar(p: { x: number; y: number }) {
  const d = (t: number) =>
    Math.hypot(
      3 * Math.cos(t) + c * Math.cos(3 * t) - p.x,
      3 * Math.sin(t) - c * Math.sin(3 * t) - p.y,
    );
  let best = 0;
  for (let k = -2000; k <= 2000; k++)
    if (d(k * 5e-5) < d(best)) best = k * 5e-5;
  let a = best - 5e-5,
    b = best + 5e-5;
  const g = (Math.sqrt(5) - 1) / 2;
  for (let k = 0; k < 80; k++) {
    const m1 = b - g * (b - a),
      m2 = a + g * (b - a);
    if (d(m1) < d(m2)) b = m2;
    else a = m1;
  }
  return d((a + b) / 2);
}
