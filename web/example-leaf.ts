import type { Term, Vec } from "./types";

// Draw a loop's example leaf, shared by everything that offers it before a
// loop is drawn: Draw a loop itself, hyperbolic lace's loop motif and the
// loop of curves that smooth themselves. It has no other imports, so any
// module can use it without a cycle through the study's link schema.

// The authored outline, drawn clockwise, available without a pointing
// device.
export const exampleLeafPoints: readonly Vec[] = [
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

// The outline fitted with 8 terms, as Go fits it (engine.FitFourier).
export const exampleLeafTerms: readonly Term[] = [
  { frequency: 0, radius: 0.07380196413782487, phase: 2.0118362730533916 },
  { frequency: -1, radius: 1.419723912035244, phase: -2.54812186120912 },
  { frequency: 1, radius: 0.44569943540349205, phase: -2.5979464811593407 },
  { frequency: 3, radius: 0.11405156588444013, phase: -2.118376046160493 },
  { frequency: -3, radius: 0.10770905363261428, phase: -2.3105380227028074 },
  { frequency: 2, radius: 0.0539559922425223, phase: -2.915645709915259 },
  { frequency: 5, radius: 0.05395375123749766, phase: -1.8127548668539546 },
  { frequency: -5, radius: 0.04547927263327711, phase: -2.284355839723539 },
];
