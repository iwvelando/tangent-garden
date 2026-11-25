import type { RootTerm } from "./types";

// #413 research: noncircular source paths for the root journey, shown only
// with ?research=413. Nothing here is a public contract. It has no imports
// beyond types, so the descriptor, link schema and presets can all use it.

export const researchRoots = () =>
  typeof location !== "undefined" &&
  new URLSearchParams(location.search).getAll("research").includes("413");

// Draw a loop's example leaf at 8 terms (engine.FitFourier of its
// outline), drawn clockwise: about 0 it winds −1 times.
export const leafTerms: RootTerm[] = [
  { frequency: 0, radius: 0.07380196413782487, phase: 2.0118362730533916 },
  { frequency: -1, radius: 1.419723912035244, phase: -2.54812186120912 },
  { frequency: 1, radius: 0.44569943540349205, phase: -2.5979464811593407 },
  { frequency: 3, radius: 0.11405156588444013, phase: -2.118376046160493 },
  { frequency: -3, radius: 0.10770905363261428, phase: -2.3105380227028074 },
  { frequency: 2, radius: 0.0539559922425223, phase: -2.915645709915259 },
  { frequency: 5, radius: 0.05395375123749766, phase: -1.8127548668539546 },
  { frequency: -5, radius: 0.04547927263327711, phase: -2.284355839723539 },
];
