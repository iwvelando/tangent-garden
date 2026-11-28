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

type Defaults = {
  speed: number;
  trail: "whole" | "window";
  window: number;
  ghost: boolean;
  triangle: boolean;
  framing: "whole" | "close";
};
export const threeBodyConfigurations: Record<
  ThreeBodyName,
  { explanation: string; defaults: Defaults }
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
  },
};
