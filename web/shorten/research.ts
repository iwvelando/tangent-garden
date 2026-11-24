import { count, readout } from "../number-format";
import { tiered } from "../help";
import type { LoopAdmission, LoopSolver } from "./model";

// #409 research: a user's own loop in Curves that smooth themselves, shown
// only with ?research=409. Nothing here is a public contract.

export const researchLoops = () =>
  typeof location !== "undefined" &&
  new URLSearchParams(location.search).getAll("research").includes("409");

export const loopMethods: Record<LoopSolver, string> = {
  polar:
    "radial graph about the loop's best star center: central differences, ROS2, steps τ / max|ℓ_t|",
  arc: "equal-arclength tangent angle and length: Fourier collocation, ETDRK4, steps c / max θ_α²",
  bgn: "parametric polygon (Barrett–Garcke–Nürnberg), mass-lumped, semi-implicit, steps τ / max κ²",
};

const solverName: Record<LoopSolver, string> = {
  polar: "radial graph",
  arc: "arclength",
  bgn: "polygon (BGN)",
};

export const loopHelp = {
  source: tiered(
    "Evolve the fitted terms, or the outline exactly as drawn.",
    "Fitted terms are the smooth loop Draw a loop made. The outline keeps every corner; only the polygon solver takes corners as given.",
  ),
  solver: tiered(
    "Automatic picks the first solver that admits the loop.",
    "Radial graph needs a star-shaped loop and stops if it stops being one. Arclength needs a smooth loop it can resolve on up to 4,096 nodes. Polygon (BGN) takes any simple polygon, first order in time.",
  ),
};

// One short line of what admission measured; the detail is in the export
// record.
export function admissionText(a: LoopAdmission) {
  const parts = [
    `${solverName[a.solver]} solver on ${count(a.nodes)} nodes`,
    `thickness ${readout(a.thickness, 2)} R`,
    a.source === "fourier"
      ? a.certified
        ? "embedding certified"
        : "embedding not certified"
      : "a simple polygon",
  ];
  const refused = Object.keys(a.refused ?? {}).map(
    (k) => solverName[k as LoopSolver],
  );
  const line = parts.join(" · ");
  return (
    `${line[0].toUpperCase()}${line.slice(1)}.` +
    (refused.length
      ? ` Not admitted by the ${refused.join(" or ")} solver.`
      : "")
  );
}

// The example leaf's fits (engine.FitFourier of sampleLeaf), drawn
// clockwise, so admission reverses them.
const leaf8 = [
  { frequency: 0, radius: 0.07380196413782487, phase: 2.0118362730533916 },
  { frequency: -1, radius: 1.419723912035244, phase: -2.54812186120912 },
  { frequency: 1, radius: 0.44569943540349205, phase: -2.5979464811593407 },
  { frequency: 3, radius: 0.11405156588444013, phase: -2.118376046160493 },
  { frequency: -3, radius: 0.10770905363261428, phase: -2.3105380227028074 },
  { frequency: 2, radius: 0.0539559922425223, phase: -2.915645709915259 },
  { frequency: 5, radius: 0.05395375123749766, phase: -1.8127548668539546 },
  { frequency: -5, radius: 0.04547927263327711, phase: -2.284355839723539 },
];
const leaf16 = [
  ...leaf8,
  { frequency: -2, radius: 0.04396072848670656, phase: 0.40814251391554407 },
  { frequency: 7, radius: 0.03403723823760695, phase: -1.526408283491312 },
  { frequency: -4, radius: 0.03254051970822848, phase: -1.4526628276138145 },
  { frequency: -7, radius: 0.028489763731106788, phase: -2.362185604733915 },
  { frequency: 16, radius: 0.026607116168430714, phase: -0.3331640224735572 },
  { frequency: 15, radius: 0.02619762663683934, phase: 2.68017357555215 },
  { frequency: -16, radius: 0.02574430551972231, phase: -1.579003920080958 },
  { frequency: 14, radius: 0.022641754027524053, phase: 2.6830164161321224 },
];
// r = 1 + b cos u about the origin: a dimple for b < 1, an inner loop above.
const limacon = (b: number) => [
  { frequency: 0, radius: b / 2, phase: 0 },
  { frequency: 1, radius: 1, phase: 0 },
  { frequency: 2, radius: b / 2, phase: 0 },
];

// Research studies, in the gallery's Curves that smooth themselves family
// only under ?research=409. Each names the solver admission chooses.
export const researchShortenPresets = (): {
  title: string;
  note: string;
  study: Partial<import("./model").ShortenStudy>;
}[] => [
  {
    title: "Research: the example leaf, 8 terms",
    note: "Draw a loop's example leaf at 8 terms, evolved on the arclength solver",
    study: { family: "loop", loopTerms: leaf8 },
  },
  {
    title: "Research: the example leaf, 16 terms",
    note: "Sixteen terms keep the leaf's teeth; the arclength solver needs 4,096 nodes",
    study: { family: "loop", loopTerms: leaf16, nest: "ghost" },
  },
  {
    title: "Research: the leaf outline as drawn",
    note: "The 29-point outline itself, corners and all, on the polygon solver",
    study: {
      family: "loop",
      loopTerms: leaf8,
      loopSource: "outline",
      spacing: "early",
    },
  },
  {
    title: "Research: a deep dimple",
    note: "The limaçon r = 1 + 0.9 cos u: only the polygon solver resolves its dimple",
    study: { family: "loop", loopTerms: limacon(0.9) },
  },
  {
    title: "Research: almost a cusp",
    note: "e^{iu} + 0.45 e^{−2iu}, three nearly sharp points",
    study: {
      family: "loop",
      loopTerms: [
        { frequency: 1, radius: 1, phase: 0 },
        { frequency: -2, radius: 0.45, phase: 0 },
      ],
    },
  },
  {
    title: "Research: a hairline inner loop (refused)",
    note: "The limaçon r = 1 + 1.05 cos u crosses itself in a tiny loop",
    study: { family: "loop", loopTerms: limacon(1.05) },
  },
];

// A copy of Draw a loop's example leaf (web/fourier-fit.ts sampleLeaf), kept
// here to avoid an import cycle through planar-link.
export const researchLeaf: { x: number; y: number }[] = [
  { x: -1.9, y: -1.35 },
  { x: -1.65, y: -0.65 },
  { x: -1.7, y: -0.3 },
  { x: -1.35, y: -0.18 },
  { x: -1.4, y: 0.2 },
  { x: -0.98, y: 0.27 },
  { x: -1.02, y: 0.65 },
  { x: -0.57, y: 0.66 },
  { x: -0.55, y: 1.02 },
  { x: -0.12, y: 0.97 },
  { x: 0.05, y: 1.34 },
  { x: 0.4, y: 1.19 },
  { x: 0.74, y: 1.49 },
  { x: 1, y: 1.3 },
  { x: 1.8, y: 1.55 },
  { x: 1.55, y: 0.8 },
  { x: 1.69, y: 0.5 },
  { x: 1.37, y: 0.26 },
  { x: 1.5, y: -0.05 },
  { x: 1.12, y: -0.18 },
  { x: 1.16, y: -0.53 },
  { x: 0.74, y: -0.53 },
  { x: 0.65, y: -0.87 },
  { x: 0.22, y: -0.71 },
  { x: 0.03, y: -1.03 },
  { x: -0.4, y: -0.81 },
  { x: -0.62, y: -1.07 },
  { x: -1.1, y: -0.85 },
  { x: -1.64, y: -1.48 },
];
