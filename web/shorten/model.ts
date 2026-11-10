import { tiered } from "../help";
import type { LineWeight } from "../line-weight";
import type { PlotCamera } from "../planar-link";
import type { Repeat } from "../timing";

// Curves that smooth themselves: a smooth closed loop evolving by curve
// shortening, dX/dt = −κ n_out, solved in Go (engine/shorten; see
// docs/mathematics.md#curve-shortening). A flower is a radial graph about
// its center; a convex loop is its support function. Types mirror
// engine/shorten's request and reply.

// A flower, r(φ) = R(1 + a cos kφ + b cos(jφ + ψ)) (engine/shorten.Bloom).
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
// A convex loop's support function h(θ) = R(1 + ε cos mθ)
// (engine/shorten.Seed).
export type ConvexSeed = {
  radius: number;
  mode: 0 | 3 | 6;
  epsilon: number;
  centerX: number;
  centerY: number;
};
type Run<S> = { seed: S; nodes: number; tau: number; horizon: number };
export type ShortenRequest = {
  convex?: Run<ConvexSeed>;
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

export type Spacing = "early" | "radius" | "time";
export type Framing = "physical" | "normalized";
export type Nest = "whole" | "ghost" | "grows";
export type ShortenFamily = "flower" | "convex";

// The study. Both seeds' settings are kept, so switching between them
// returns to the other's last values; only the chosen family is solved.
export type ShortenStudy = {
  family: ShortenFamily;
  petals: number;
  depth: number;
  ruffles: number;
  ruffle: number;
  phase: number;
  lobes: 3 | 6;
  ripple: number;
  contours: number;
  spacing: Spacing;
  nest: Nest;
  framing: Framing;
  view: PlotCamera;
  weight: LineWeight;
  // The motion's timing; absent, defaultShortenMotion.
  motion?: ShortenMotion;
};
export type ShortenMotion = {
  duration: number;
  repeat: Repeat;
  pacing: Spacing;
};

// The engine's limits (engine/shorten): seeds, the fixed resolution and
// step factor of each solver, and the study's own counts.
export const shortenLimits = {
  petals: 12,
  ruffles: [8, 64],
  depths: 0.9,
  contours: 48,
  flower: { nodes: 512, tau: 0.0025 },
  convex: { nodes: 256, tau: 0.005 },
  // Every film runs to the size floor: the equal-area radius at 1/20 of its
  // start, near extinction.
  horizon: 0.999,
} as const;
// The largest convex ripple for m lobes: |ε|(m² − 1) ≤ ½.
export const rippleLimit = (lobes: 3 | 6) => 0.5 / (lobes * lobes - 1);

export const defaultShortenMotion: ShortenMotion = {
  duration: 8,
  repeat: "once",
  pacing: "early",
};
export const defaultShorten: ShortenStudy = {
  family: "flower",
  petals: 5,
  depth: 0.3,
  ruffles: 0,
  ruffle: 0,
  phase: 0,
  lobes: 6,
  ripple: 1 / 70,
  contours: 24,
  spacing: "early",
  nest: "whole",
  framing: "physical",
  view: { x: 0, y: 0, zoom: 1 },
  weight: "regular",
};

// The authored studies, in the 2D examples gallery. Each opens over the
// notebook's study without replacing it, and takes nothing from it. The
// flowers come first; the convex loop of R14.1's first experiment last.
export const shortenPresets: {
  title: string;
  note: string;
  study: ShortenStudy;
}[] = [
  {
    title: "A flower remembering a circle",
    note: "Five petals retract and their notches fill as the loop shrinks toward a round point",
    study: { ...defaultShorten },
  },
  {
    title: "A trefoil folding into a circle",
    note: "Three deep lobes melt into a disk; each loop is the curve a moment later",
    study: { ...defaultShorten, petals: 3, depth: 0.5 },
  },
  // Six petals; the motion lays each loop down as it passes.
  {
    title: "Six petals, a nest that grows",
    note: "Play to watch the nest build loop by loop as the petals give way",
    study: { ...defaultShorten, petals: 6, nest: "grows" },
  },
  // Eight shallow petals with 32 ruffles a hundredth of the radius deep,
  // which the flow smooths first; later loops are faint while it plays.
  {
    title: "Eight petals and their faint future",
    note: "Play to watch the loop shrink through the faint loops still ahead of it",
    study: {
      ...defaultShorten,
      petals: 8,
      depth: 0.15,
      ruffles: 32,
      ruffle: 0.01,
      phase: 0.4,
      nest: "ghost",
    },
  },
  {
    title: "A gently rippled convex loop",
    note: "A convex loop can only ripple slightly, and the ripples fade within the first few loops",
    study: {
      ...defaultShorten,
      family: "convex",
      lobes: 3,
      ripple: 1 / 16,
      spacing: "radius",
      contours: 16,
    },
  },
];
export const presetShorten = (index: number): ShortenStudy =>
  structuredClone(shortenPresets[index].study);

// The engine's request for a study and some physical times.
export function shortenRequest(
  s: ShortenStudy,
  times: number[],
): ShortenRequest {
  if (s.family === "convex") {
    const { nodes, tau } = shortenLimits.convex;
    return {
      convex: {
        seed: {
          radius: 1,
          mode: s.lobes,
          epsilon: s.ripple,
          centerX: 0,
          centerY: 0,
        },
        nodes,
        tau,
        horizon: shortenLimits.horizon,
      },
      times,
    };
  }
  const { nodes, tau } = shortenLimits.flower;
  return {
    bloom: {
      seed: {
        radius: 1,
        petals: s.petals,
        depth: s.depth,
        ruffles: s.ruffles,
        ruffle: s.ruffle,
        phase: s.phase,
        centerX: 0,
        centerY: 0,
      },
      nodes,
      tau,
      horizon: shortenLimits.horizon,
    },
    times,
  };
}

// The study fields an engine refusal names, by the request's seed paths.
export const refusedField: Record<string, keyof ShortenStudy> = {
  "seed.petals": "petals",
  "seed.depth": "depth",
  "seed.ruffles": "ruffles",
  "seed.ruffle": "ruffle",
  "seed.phase": "phase",
  "seed.mode": "lobes",
  "seed.epsilon": "ripple",
  // A convex ripple the grid cannot resolve; the node count is fixed.
  nodes: "ripple",
};

// Where fraction f of a family or motion falls in [0, end]: early,
// end·f³, dense where petals change fastest; evenly in the radius a circle
// ending at its extinction would have, end·(1 − (1 − f)²); or equally in
// time, so in area lost.
export function spaced(f: number, end: number, spacing: Spacing) {
  if (f >= 1) return end;
  if (spacing === "time") return end * f;
  if (spacing === "early") return end * f * f * f;
  return end * (1 - (1 - f) * (1 - f));
}

// A family of count loops from t = 0, before the film's end.
export function familyTimes(end: number, count: number, spacing: Spacing) {
  return Array.from({ length: count }, (_, j) =>
    spaced(j / count, end, spacing),
  );
}

// The physical time shown at motion progress p, both ends exact.
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

// The seed's largest radius, which fixes the physical frame: every drawing
// shows the whole seed at zoom 1, and the nest shrinks within it.
export function extentOf(s: ShortenStudy) {
  return s.family === "convex"
    ? 1 + Math.abs(s.ripple)
    : 1 + Math.abs(s.depth) + Math.abs(s.ruffle);
}
export const shortenPage = { width: 1000, height: 760 };
export const shortenZoom: [number, number] = [0.1, 100];
// Page units per unit length at zoom 1.
export const pageScale = (extent: number) => 340 / extent;

export const stopText: Record<string, string> = {
  horizon: "reached the size floor",
  floor: "stops at the size floor, a twentieth of the starting radius",
  curvature: "stops at the curvature floor, a twentieth of the starting radius",
  star: "stops where the loop would leave its rays (no longer star-shaped)",
  resolution: "stops where the curvature is no longer resolved",
  positivity: "stops where no step keeps the loop valid",
  work: "stops at the work limit",
};

const plain = (v: number) => v.toLocaleString("en-US");
export const shortenHelp = {
  family: tiered(
    "A flower, which may be nonconvex, or a convex loop.",
    "A flower is a radial graph about its center; a convex loop is solved by its support function. Each keeps its own settings when you switch.",
  ),
  petals: tiered(
    `Petals around the loop: 0 (none) or 2–${shortenLimits.petals}.`,
    "Many deep petals curve too sharply to resolve and are refused under Petal depth.",
  ),
  depth: tiered(
    `How far petals reach, as a fraction of the radius.`,
    `Petal and ruffle depths together are at most ${shortenLimits.depths}; 0 without petals. Without ruffles, petals deeper than 1/(k² + 1) make the loop nonconvex. Too deep for the resolution is refused, as is a loop whose tangents come within atan(1/10) of its rays.`,
  ),
  ruffles: tiered(
    `Fine ripples around the loop: 0 (none) or ${shortenLimits.ruffles[0]}–${shortenLimits.ruffles[1]}.`,
    "Any count other than the petals'. Ruffles vanish long before petals do.",
  ),
  ruffle: tiered(
    "How far ruffles reach, as a fraction of the radius.",
    `0 without ruffles. Petal and ruffle depths together are at most ${shortenLimits.depths}; sharp ruffles cannot be resolved and are refused under Petal depth.`,
  ),
  phase: tiered(
    "Turns the ruffles against the petals, in radians.",
    "Any finite value; constants such as pi/5 work.",
  ),
  lobes: "Three or six gentle lobes.",
  ripple: tiered(
    "Lobe depth ε, with |ε|(m² − 1) ≤ ½ for m lobes.",
    `So |ε| ≤ 1/16 for three lobes and 1/70 for six, which keeps the loop's radius of curvature at least half its radius: a convex loop can only ripple slightly.`,
  ),
  contours: tiered(
    `Loops drawn in the nest: 1–${shortenLimits.contours}.`,
    "The first is the seed; the rest sample the same evolution at later times.",
  ),
  spacing: tiered(
    "When the nest's loops are drawn.",
    "Early packs them where petals change fastest (t ∝ j³); equal radius steps a circle evenly; equal time steps the area evenly, since area falls at exactly 2π per unit time.",
  ),
  nest: tiered(
    "Show the whole nest, or only loops up to the shown time.",
    "During the motion, later loops can be faint or left out, so the nest builds as the loop shrinks. At rest the whole nest is drawn.",
  ),
  framing: tiered(
    "Physical scale, or each loop rescaled to the starting area.",
    "Normalized scales each loop by √(A₀/A) about its centroid, both measured from the drawn loop. It is presentation only: the evolution and the readouts stay physical.",
  ),
  progress:
    "Seek the motion by its time; the same time always shows the same loop.",
  duration: tiered(
    "Seconds for the whole motion: 0.1–3,600.",
    "Export makes at most 7,200 frames.",
  ),
  repeat: tiered(
    "Once, or back and forth.",
    "The loop ends far smaller than it starts, so it cannot loop seamlessly; back and forth plays it out and back within the duration.",
  ),
  pacing: tiered(
    "How the motion's time maps to the flow's.",
    "Early lingers where petals change fastest (t ∝ p³); equal radius shrinks a circle at a steady rate; physical time is linear in the flow's time.",
  ),
  limits: `Solved on ${plain(shortenLimits.flower.nodes)} nodes for flowers and ${plain(shortenLimits.convex.nodes)} for convex loops.`,
};
