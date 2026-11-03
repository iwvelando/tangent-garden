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
// Experiment 2's flower: r(φ) = R(1 + a cos kφ + b cos(jφ + ψ)).
export type BloomSeed = {
  radius: number;
  petals: number;
  depth: number;
  ruffles: number;
  ruffle: number;
  phase: number;
  centerX: number;
  centerY: number;
};
type Run<S> = { seed: S; nodes: number; tau: number; horizon: number };
export type ShortenRequest = {
  convex?: Run<ShortenSeed>;
  bloom?: Run<BloomSeed>;
  times: number[];
};
export type ShortenContour = {
  t: number;
  x: number[];
  y: number[];
  minRho?: number;
  maxRho?: number;
  minKappa?: number;
  maxKappa?: number;
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

export type Spacing = "time" | "radius" | "early";
export type Framing = "physical" | "normalized";
export type Nest = "whole" | "ghost" | "grows";

// The lab's seeds: experiment 2's flowers, and experiment 1's convex loops
// for comparison. Every one is resolved at 512 nodes.
const flower = (
  petals: number,
  depth: number,
  ruffles = 0,
  ruffle = 0,
  phase = 0,
): BloomSeed => ({
  radius: 1,
  petals,
  depth,
  ruffles,
  ruffle,
  phase,
  centerX: 0,
  centerY: 0,
});
export const labSeeds = {
  five: { label: "Five petals", bloom: flower(5, 0.3) },
  six: { label: "Six petals", bloom: flower(6, 0.3) },
  trefoil: { label: "Trefoil", bloom: flower(3, 0.5) },
  "five-ruffled": {
    label: "Five petals, ruffled",
    bloom: flower(5, 0.25, 24, 0.015),
  },
  "eight-ruffled": {
    label: "Eight petals, ruffled",
    bloom: flower(8, 0.15, 32, 0.01, 0.4),
  },
  convex6: {
    label: "Convex, six lobes (experiment 1)",
    convex: {
      radius: 1,
      mode: 6,
      epsilon: 0.5 / 35,
      centerX: 0,
      centerY: 0,
    } as ShortenSeed,
  },
  convex3: {
    label: "Convex, three lobes (experiment 1)",
    convex: {
      radius: 1,
      mode: 3,
      epsilon: 0.5 / 8,
      centerX: 0,
      centerY: 0,
    } as ShortenSeed,
  },
} as const;
export type LabSeed = keyof typeof labSeeds;

export type LabSettings = {
  seed: LabSeed;
  nodes: number;
  tau: number;
  horizon: number;
  count: number;
  spacing: Spacing;
  framing: Framing;
  nest: Nest;
  pacing: Spacing;
  duration: number;
};
export const defaultLab: LabSettings = {
  seed: "five",
  nodes: 512,
  tau: 0.0025,
  horizon: 0.98,
  count: 24,
  spacing: "early",
  framing: "physical",
  nest: "whole",
  pacing: "early",
  duration: 8,
};

// The seed's largest radius, which sets the fixed physical frame.
export function extentOf(s: LabSettings) {
  const seed = labSeeds[s.seed];
  return "bloom" in seed
    ? seed.bloom.radius *
        (1 + Math.abs(seed.bloom.depth) + Math.abs(seed.bloom.ruffle))
    : seed.convex.radius * (1 + Math.abs(seed.convex.epsilon));
}

export function requestOf(s: LabSettings, times: number[]): ShortenRequest {
  const seed = labSeeds[s.seed];
  // Experiment 1 accepts step factors from 0.001.
  return "bloom" in seed
    ? {
        bloom: {
          seed: seed.bloom,
          nodes: s.nodes,
          tau: s.tau,
          horizon: s.horizon,
        },
        times,
      }
    : {
        convex: {
          seed: seed.convex,
          nodes: s.nodes,
          tau: Math.max(s.tau, 0.001),
          horizon: s.horizon,
        },
        times,
      };
}

// Where fraction f of a family or motion falls in [0, end]: equally in time
// (so in area lost); evenly in the radius a circle ending at its extinction
// would have, end·(1 − (1 − f)²); or early, end·f³, where petals change.
export function spaced(f: number, end: number, spacing: Spacing) {
  if (f >= 1) return end;
  if (spacing === "time") return end * f;
  if (spacing === "early") return end * f * f * f;
  return end * (1 - (1 - f) * (1 - f));
}

// A family of count contours from t = 0, before the film's end.
export function familyTimes(end: number, count: number, spacing: Spacing) {
  return Array.from({ length: count }, (_, j) =>
    spaced(j / count, end, spacing),
  );
}

// The physical time shown at playback progress p: linear in time, or in
// the radius a circle would have, with both ends exact.
export function timeAt(p: number, end: number, pacing: Spacing) {
  return spaced(Math.min(1, Math.max(0, p)), end, pacing);
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
export function pageScale(extent: number) {
  return 340 / extent;
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
  floor: "stopped at the size floor (equal-area radius < 0.05 of its start)",
  star: "stopped: the loop stopped being star-shaped about its center",
  resolution: "stopped: curvature no longer resolved",
  positivity: "stopped: a step could not keep ρ positive",
  work: "stopped at a work ceiling",
};
