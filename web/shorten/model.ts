// Research preview for #322: convex curve shortening through Go's support-
// function solver (engine/shorten). Types mirror engine/shorten's request
// and reply; nothing here is link-saved or a product contract.

export type ShortenSeed = {
  radius: number;
  // 0 is a circle; 3 or 6 lobes ripple the support function.
  mode: 0 | 3 | 6;
  epsilon: number;
  centerX: number;
  centerY: number;
};
export type ShortenRequest = {
  seed: ShortenSeed;
  nodes: number;
  tau: number;
  horizon: number;
  times: number[];
};
export type ShortenContour = {
  t: number;
  x: number[];
  y: number[];
  minRho: number;
  maxRho: number;
  area: number;
  length: number;
  centerX: number;
  centerY: number;
  steps: number;
};
export type ShortenStats = {
  accepted: number;
  rejected: number;
  attempted: number;
  discarded: number;
  remeshed: number;
  nodeUpdates: number;
  checkpoints: number;
  stride: number;
};
export type ShortenReply = {
  end: number;
  extinction: number;
  area0: number;
  stop: string;
  stats: ShortenStats;
  contours: ShortenContour[];
  fresh: boolean;
};

export type Spacing = "time" | "radius";
export type Framing = "physical" | "normalized";

// The lab's settings. The ripple is a fraction of the largest allowed,
// |ε|(m² − 1) ≤ 1/2, so every value the control offers is supported.
export type LabSettings = {
  mode: 0 | 3 | 6;
  ripple: number;
  nodes: number;
  tau: number;
  horizon: number;
  count: number;
  spacing: Spacing;
  framing: Framing;
  pacing: Spacing;
  duration: number;
};
export const defaultLab: LabSettings = {
  mode: 6,
  ripple: 1,
  nodes: 256,
  tau: 0.005,
  horizon: 0.98,
  count: 12,
  spacing: "radius",
  framing: "physical",
  pacing: "radius",
  duration: 8,
};

export function seedOf(s: LabSettings): ShortenSeed {
  const m = s.mode;
  return {
    radius: 1,
    mode: m,
    epsilon: m === 0 ? 0 : (s.ripple * 0.5) / (m * m - 1),
    centerX: 0,
    centerY: 0,
  };
}

export function requestOf(s: LabSettings, times: number[]): ShortenRequest {
  return {
    seed: seedOf(s),
    nodes: s.nodes,
    tau: s.tau,
    horizon: s.horizon,
    times,
  };
}

// A family of count contours from t = 0, before the film's end: equally
// spaced in time (so in area lost), or so that a circle ending at its
// extinction steps evenly in radius, t_j = end·(1 − (1 − j/K)²).
export function familyTimes(end: number, count: number, spacing: Spacing) {
  return Array.from({ length: count }, (_, j) => {
    const f = j / count;
    return spacing === "time" ? end * f : end * (1 - (1 - f) * (1 - f));
  });
}

// The physical time shown at playback progress p: linear in time, or in
// the radius a circle would have, with both ends exact.
export function timeAt(p: number, end: number, pacing: Spacing) {
  const q = Math.min(1, Math.max(0, p));
  if (q === 1) return end;
  return pacing === "time" ? end * q : end * (1 - (1 - q) * (1 - q));
}

// The declared normalized presentation: a measured loop rescaled about its
// measured centroid by √(A₀/A), placed at the origin. Presentation only:
// nothing returns to the solver.
export function normalized(
  c: Pick<ShortenContour, "x" | "y" | "area" | "centerX" | "centerY">,
  area0: number,
) {
  const scale = Math.sqrt(area0 / c.area);
  return {
    scale,
    x: c.x.map((v) => (v - c.centerX) * scale),
    y: c.y.map((v) => (v - c.centerY) * scale),
  };
}

export const labPage = { width: 1000, height: 760 };
// Page units per unit length: the seed's largest support value fills a
// fixed fraction of the page height in every frame, with no auto-fit.
export function pageScale(seed: ShortenSeed) {
  return 330 / (seed.radius * (1 + Math.abs(seed.epsilon)));
}

export function pathOf(x: number[], y: number[], k: number) {
  let d = "";
  for (let i = 0; i < x.length; i++)
    d += `${i ? "L" : "M"}${(500 + x[i] * k).toFixed(2)} ${(380 - y[i] * k).toFixed(2)}`;
  return d + "Z";
}

export const stopText: Record<string, string> = {
  horizon: "reached the horizon",
  curvature: "stopped at the curvature floor (min ρ < 0.05·√(A₀/π))",
  resolution: "stopped: curvature no longer resolved",
  positivity: "stopped: a step could not keep ρ positive",
  work: "stopped at a work ceiling",
};
