import type { FrameResult } from "./types";

// Signed degrees with a true minus sign, one decimal.
export const degrees = (radians: number) => {
  const d = (radians * 180) / Math.PI;
  return `${d < -0.05 ? "−" : ""}${Math.abs(d).toFixed(1)}°`;
};

// What the frame is and what it did on this curve: its kind, the closed
// loop's return angle and seam (or why there is none), and any samples or
// stretches it could not treat normally.
export function frameNote(q: FrameResult): string[] {
  const out = [
    q.kind === "frenet"
      ? "Frenet frame, a diagnostic: U is the principal normal and V the binormal. It is undefined where the curve is straight and reverses at inflections."
      : "Rotation-minimizing frame: U is carried along the curve without turning about the tangent.",
  ];
  if (q.closed) {
    if (q.kind === "frenet")
      out.push("The Frenet frame closes on a closed loop.");
    else if (Math.abs(q.holonomy) < 1e-6)
      out.push(
        "Carried once around the closed loop, the frame returns to itself.",
      );
    else {
      out.push(
        `Carried once around the closed loop, the frame returns turned by ${degrees(q.holonomy)}.`,
      );
      out.push(
        q.correction !== 0
          ? `${degrees(q.correction)} of twist is spread evenly along the loop, so the frame closes.`
          : "The seam is left visible.",
      );
    }
    if (q.seam)
      out.push(
        `With this twist the ribbon does not close: its ends differ by ${degrees(q.seam.angle)}.`,
      );
  } else
    out.push(
      q.pieces > 1
        ? `The curve breaks, so the frame starts again from N₀ on each of its ${q.pieces} stretches, and there is no seam.`
        : "The curve is open, so the frame has no seam.",
    );
  if (q.undefined > 0)
    out.push(
      `${q.undefined} samples without a Frenet normal, where the curve is straight, are left as gaps.`,
    );
  if (q.flips > 0)
    out.push(
      `The Frenet normal reverses ${q.flips === 1 ? "once" : `${q.flips} times`}; the ribbon is not joined across.`,
    );
  if (q.fallbacks > 0)
    out.push(
      `N₀ lies along the tangent where ${q.fallbacks === 1 ? "a stretch begins" : `${q.fallbacks} stretches begin`}, so the coordinate axis least aligned with it is used there.`,
    );
  return out;
}
