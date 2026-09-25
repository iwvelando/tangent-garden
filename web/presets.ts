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
  },
  source: { kind: "point", position: { x: 1, y: 0 }, angle: -90 },
  nIncident: 1.2,
  nTransmitted: 1,
  offset: 0,
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
];
