import type { Config } from "./types";
const base: Config = {
  kind: "evolute",
  curve: {
    a: 1,
    format: "parametric",
    x: "2*cos(t)",
    y: "3*sin(t)",
    r: "1+0.3*cos(3*t)",
    min: 0,
    max: 2 * Math.PI,
    roulette: { roll: "inside", fixedRadius: 5, radius: 2, arm: 3, phase: 0 },
  },
  source: { kind: "point", position: { x: 1, y: 0 }, angle: -90 },
  nIncident: 1.2,
  pole: { x: 0, y: 0 },
  nTransmitted: 1,
  offset: 0,
  distance: 0,
  stack: { enabled: false, from: -0.5, to: 0.5, count: 6 },
  circles: false,
  rolling: { side: "right", radius: 0.5, arm: 0.5, phase: 0 },
  samples: 1000,
  lines: 48,
};
export const presets: { title: string; note: string; config: Config }[] = [
  {
    title: "Ellipse & its evolute",
    note: "From the notebooks · study 07",
    config: base,
  },
  {
    title: "Unwinding a circle",
    note: "From the notebooks · study 01",
    config: {
      ...base,
      kind: "involute",
      curve: { ...base.curve, x: "cos(t)", y: "sin(t)" },
      lines: 32,
    },
  },
  {
    title: "Light inside a circle",
    note: "From the notebooks · catacaustic 01",
    config: {
      ...base,
      kind: "catacaustic",
      curve: { ...base.curve, x: "cos(t)", y: "sin(t)" },
    },
  },
  {
    title: "Through a parabola",
    note: "From the notebooks · diacaustic",
    config: {
      ...base,
      kind: "diacaustic",
      curve: { ...base.curve, x: "t", y: "t^2/4", min: -4, max: 4 },
      source: { ...base.source, position: { x: 0, y: 2 } },
      lines: 35,
    },
  },
  {
    title: "Cycloid & its evolute",
    note: "From the notebooks · study 05",
    config: {
      ...base,
      curve: { ...base.curve, x: "2*(t-sin(t))", y: "2*(1+cos(t))" },
    },
  },
  {
    title: "Three-cusped curve",
    note: "From the notebooks · study 08",
    config: {
      ...base,
      curve: { ...base.curve, x: "cos(t)+cos(2*t)/2", y: "sin(t)-sin(2*t)/2" },
    },
  },
  {
    title: "Spiral, unwound",
    note: "From the notebooks · study 02",
    config: {
      ...base,
      kind: "involute",
      curve: {
        ...base.curve,
        x: "exp(t)*sin(t)",
        y: "exp(t)*cos(t)",
        max: Math.PI,
      },
      // This spiral's speed is √2·eᵗ, so c = √2 makes the involute use the arc-length
      // antiderivative √2·eᵗ itself rather than the one anchored at zero at t = 0.
      offset: Math.SQRT2,
    },
  },
  {
    title: "Parallel light & a circle",
    note: "A source at infinity",
    config: {
      ...base,
      kind: "catacaustic",
      curve: { ...base.curve, x: "cos(t)", y: "sin(t)" },
      source: { ...base.source, kind: "parallel", angle: 0 },
    },
  },
  {
    title: "Ellipse & its pedal",
    note: "A pole and its tangent projections",
    config: {
      ...base,
      kind: "pedal",
      curve: { ...base.curve, x: "2*cos(t)", y: "1.1*sin(t)" },
      pole: { x: 1.65, y: 0.3 },
      lines: 64,
    },
  },
  {
    title: "Ellipse & its contrapedal",
    note: "The center projected onto each normal",
    config: {
      ...base,
      kind: "contrapedal",
      curve: { ...base.curve, x: "2*cos(t)", y: "1.1*sin(t)" },
      pole: { x: 0, y: 0 },
      lines: 64,
    },
  },
  {
    title: "Ellipse & its orthotomic",
    note: "A focus reflected onto a circle",
    config: {
      ...base,
      kind: "orthotomic",
      // Foci at (±1, 0): reflecting one across every tangent lands on the
      // circle of radius 2a = 4 about the other.
      curve: { ...base.curve, x: "2*cos(t)", y: "sqrt(3)*sin(t)" },
      pole: { x: 1, y: 0 },
      lines: 64,
    },
  },
  {
    title: "Flower & its offset",
    note: "Every point moved along its normal",
    config: {
      ...base,
      kind: "offset",
      // The petal tips have radius of curvature about 0.245, so moving 0.4
      // inward folds each tip into a swallowtail with cusps on the evolute.
      curve: { ...base.curve, format: "polar", r: "1+0.18*cos(5*t)" },
      distance: 0.4,
      lines: 120,
    },
  },
  {
    title: "Flower & its offset stack",
    note: "Eighteen parallel curves, 0.105 apart",
    config: {
      ...base,
      kind: "offset",
      curve: { ...base.curve, format: "polar", r: "1+0.18*cos(5*t)" },
      // d = 0.105k for k = −9…8. The inner members fold at the petal tips
      // and the outer ones at the waists, where the curve is concave.
      stack: { enabled: true, from: -0.945, to: 0.84, count: 18 },
      lines: 60,
    },
  },
  {
    title: "Circles & their envelope",
    note: "Rolling a coin around an ellipse",
    config: {
      ...base,
      kind: "offset",
      curve: { ...base.curve, x: "2*cos(t)", y: "1.1*sin(t)" },
      // Radius 0.5 is below the least radius of curvature 1.1²/2 = 0.605, so
      // both envelope branches, the offsets ±0.5, stay smooth.
      stack: { enabled: true, from: -0.5, to: 0.5, count: 2 },
      circles: true,
    },
  },
  {
    title: "Hypotrochoid & its evolute",
    note: "A circle rolling inside a circle",
    config: {
      ...base,
      kind: "evolute",
      // The reference study: R=5, r=2, d=3 closes after two turns, t∈[0,4π].
      // Its evolute is a five-pointed star.
      curve: { ...base.curve, format: "roulette", min: 0, max: 4 * Math.PI },
      samples: 2000,
      lines: 40,
    },
  },
  {
    title: "Flower & a rolling circle",
    note: "A circle rolling inside a flower",
    config: {
      ...base,
      kind: "rolling",
      curve: { ...base.curve, format: "polar", r: "1+0.18*cos(5*t)" },
      // The flower's length is about 7.41469 = 10 · 2π · 0.11800838, so ten
      // turns of this rim point nearly complete one lap: its ten cusps touch
      // the petal tips and waists. The ratio is not forced to close.
      rolling: { side: "left", radius: 0.118, arm: 0.118, phase: 0 },
      samples: 2000,
      lines: 60,
    },
  },
];
