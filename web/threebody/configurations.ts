// The three-body configurations: one descriptor per reference case of the
// Go corpus (engine/threebody/corpus.go), which owns the masses, initial
// states, sources, periods and the separate periodicity, stability and
// observed-evidence statements. Here each case has its short explanation
// and the playback and presentation it opens with. Components read these
// and never branch on a configuration's name.
export const threeBodyNames = [
  "figure-eight",
  "lagrange-equal",
  "lagrange-routh",
  "hierarchical",
  "pythagorean",
  "broken-triangle",
  "head-on",
] as const;
export type ThreeBodyName = (typeof threeBodyNames)[number];

// A twin: one declared component of one body's initial state moved by
// size (engine/threebody.Twin); with conserve the other two bodies move
// the opposite way together, keeping the center of mass or the momentum.
export type ThreeBodyTwin = {
  body: 0 | 1 | 2;
  kind: "position" | "velocity";
  axis: "x" | "y";
  size: number;
  conserve: boolean;
};
type Defaults = {
  speed: number;
  trail: "whole" | "window";
  window: number;
  ghost: boolean;
  triangle: boolean;
  framing: "whole" | "close";
};
// Each configuration's twin is the one a comparison starts from, when it
// is turned on or the configuration is chosen while comparing. A twin the
// reference integrator has checked states its evidence, measured in the
// WASM build (engine/threebody's TestExampleTwinsAgainstTheReference); it
// is shown only for that twin of the unedited configuration.
export const threeBodyConfigurations: Record<
  ThreeBodyName,
  {
    explanation: string;
    defaults: Defaults;
    twin: ThreeBodyTwin;
    twinEvidence?: string;
  }
> = {
  // Three periods; short trails chase one another around the faint eight.
  "figure-eight": {
    explanation:
      "Three equal masses follow one curve, each a third of a period behind the next. It is a choreography: after a third of a period the bodies have only traded places.",
    defaults: {
      speed: 2,
      trail: "window",
      window: 3,
      ghost: true,
      triangle: false,
      framing: "whole",
    },
    twin: { body: 0, kind: "velocity", axis: "x", size: 0.01, conserve: true },
    twinEvidence:
      "Both histories stay within 10⁻⁶ of the double-double reference throughout. Their separation grows about linearly, to 0.17 after one period: a neighboring orbit, not a sensitive one.",
  },
  "lagrange-equal": {
    explanation:
      "Three equal masses at the corners of an equilateral triangle turn rigidly about their center. The rotation is an exact solution, but an unstable one: the smallest error grows until the triangle breaks.",
    defaults: {
      speed: 2,
      trail: "whole",
      window: 3,
      ghost: true,
      triangle: true,
      framing: "whole",
    },
    twin: { body: 0, kind: "position", axis: "x", size: 1e-6, conserve: false },
  },
  "lagrange-routh": {
    explanation:
      "The same rigid rotation with one heavy body. When one mass dominates, Routh's condition holds and the rotation is linearly stable.",
    defaults: {
      speed: 3,
      trail: "whole",
      window: 3,
      ghost: true,
      triangle: true,
      framing: "whole",
    },
    twin: { body: 2, kind: "velocity", axis: "x", size: 0.01, conserve: true },
  },
  hierarchical: {
    explanation:
      "A tight binary of two equal masses orbits its center while a lighter third body circles the pair far outside it. Widely separated orbits like these stay regular, though no proof says so.",
    defaults: {
      speed: 1,
      trail: "whole",
      window: 3,
      ghost: true,
      triangle: false,
      framing: "whole",
    },
    twin: { body: 2, kind: "velocity", axis: "x", size: 0.01, conserve: true },
  },
  // The lightest body is ejected: the close dance keeps the others in view.
  pythagorean: {
    explanation:
      "Masses in the ratio 3 : 4 : 5 start at rest at the corners of a 3-4-5 right triangle, each opposite the side of its own length. They fall together, pass close again and again, and the lightest is finally thrown out while the other two leave as a bound pair.",
    defaults: {
      speed: 2,
      trail: "whole",
      window: 3,
      ghost: true,
      triangle: false,
      framing: "close",
    },
    twin: { body: 0, kind: "position", axis: "x", size: 1e-4, conserve: false },
    twinEvidence:
      "The twins pass 10⁻³ apart at t = 17.1, while both histories are still within 10⁻⁶ of the double-double reference (until t = 23.1), so the parting is the perturbation's, not rounding's. The reference confirms that body 1 leaves the history upward and the twin downward.",
  },
  "broken-triangle": {
    explanation:
      "Lagrange's equal-mass triangle with one body moved outward by a millionth of the distance. The rotation holds for a while; then the small error grows until the triangle comes apart.",
    defaults: {
      speed: 3,
      trail: "whole",
      window: 3,
      ghost: true,
      triangle: true,
      framing: "whole",
    },
    twin: { body: 0, kind: "position", axis: "x", size: 1e-6, conserve: false },
  },
  "head-on": {
    explanation:
      "Two bodies fall straight toward each other from rest while a light third body watches. Point masses collide, and the history stops honestly just before.",
    defaults: {
      speed: 0.1,
      trail: "whole",
      window: 3,
      ghost: true,
      triangle: false,
      framing: "whole",
    },
    twin: { body: 2, kind: "position", axis: "y", size: 0.01, conserve: false },
  },
};
