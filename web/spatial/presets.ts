import type { SpatialConfig } from "./types";
const base: SpatialConfig = {
  format: "torus",
  construction: "developable",
  pole: { x: 1.5, y: 0, z: 1 },
  inversion: { center: { x: 0, y: 0, z: 0 }, radius: 2, input: "base" },
  involute: {
    anchor: 0,
    offset: 0,
    family: { enabled: false, from: -2, to: 2, count: 5 },
  },
  radius: 2.4,
  tube: 0.85,
  length: 2.3,
  p: 2,
  q: 3,
  samples: 960,
  lines: 96,
  curve: {
    x: "(2.4+0.85*cos(3*t))*cos(2*t)",
    y: "(2.4+0.85*cos(3*t))*sin(2*t)",
    z: "0.85*sin(3*t)",
    min: 0,
    max: 2 * Math.PI,
    a: 1,
  },
};
export const spatialPresets: {
  name: string;
  detail: string;
  config: SpatialConfig;
}[] = [
  {
    name: "Trefoil · (2, 3)",
    detail: "Three folds, one continuous thread",
    config: base,
  },
  {
    name: "Cinquefoil · (2, 5)",
    detail: "A five-fold tangle of tangent silk",
    config: { ...base, q: 5, tube: 0.7, length: 1.8 },
  },
  {
    name: "Woven orbit · (3, 4)",
    detail: "Three turns around, four through",
    config: { ...base, p: 3, q: 4, tube: 1.1, length: 2.1 },
  },
  {
    name: "Helix · a ribbon staircase",
    detail: "A rising curve and its unfolding tangents",
    config: {
      ...base,
      format: "parametric",
      length: 1.5,
      curve: {
        x: "2*cos(t)",
        y: "2*sin(t)",
        z: "a*t/3",
        a: 1,
        min: -3 * Math.PI,
        max: 3 * Math.PI,
      },
    },
  },
  {
    name: "Lissajous · a spatial weave",
    detail: "Three harmonics; the thread pauses twice",
    config: {
      ...base,
      format: "parametric",
      length: 0.9,
      curve: {
        x: "2*sin(2*t+pi/2)",
        y: "2*sin(3*t)",
        z: "a*sin(5*t)",
        a: 1,
        min: 0,
        max: 2 * Math.PI,
      },
    },
  },
  {
    name: "Unwinding a staircase",
    detail: "Taut strings peel stacked spirals off a helix",
    config: {
      ...base,
      format: "parametric",
      construction: "involute",
      involute: {
        anchor: 0,
        offset: 0,
        family: { enabled: true, from: -4, to: 4, count: 9 },
      },
      lines: 32,
      curve: {
        x: "2*cos(t)",
        y: "2*sin(t)",
        z: "a*t",
        a: 1,
        min: -Math.PI,
        max: Math.PI,
      },
    },
  },
  {
    name: "A knot shedding filaments",
    detail: "Seven strings unwound from a (3, 4) knot",
    config: {
      ...base,
      p: 3,
      q: 4,
      tube: 1.1,
      construction: "involute",
      involute: {
        anchor: 0,
        offset: 0,
        family: { enabled: true, from: 0, to: 6, count: 7 },
      },
      lines: 30,
    },
  },
  {
    name: "A knot through perpendiculars",
    detail: "A fixed pole meets the trefoil's moving tangents",
    config: {
      ...base,
      construction: "tangent-foot",
      pole: { x: 0, y: 0, z: 2 },
      lines: 36,
    },
  },
  {
    name: "Half-turns around a helix",
    detail: "A pole reflected across each tangent line",
    config: {
      ...base,
      format: "parametric",
      construction: "orthotomic",
      pole: { x: 1.5, y: 0, z: 0 },
      lines: 36,
      curve: {
        x: "2*cos(t)",
        y: "2*sin(t)",
        z: "a*t/2",
        a: 1,
        min: -2 * Math.PI,
        max: 2 * Math.PI,
      },
    },
  },
  {
    name: "A staircase drawn into a sphere",
    detail: "Inversion pulls every distant turn toward the center",
    config: {
      ...base,
      format: "parametric",
      construction: "inversion",
      inversion: { center: { x: 0, y: 0, z: 0 }, radius: 2, input: "base" },
      lines: 48,
      curve: {
        x: "2*cos(t)",
        y: "2*sin(t)",
        z: "a*t/3",
        a: 1,
        min: -6 * Math.PI,
        max: 6 * Math.PI,
      },
    },
  },
  {
    name: "A trefoil turned inside out",
    detail: "Inside and outside trade places across one sphere",
    config: {
      ...base,
      construction: "inversion",
      inversion: { center: { x: 0, y: 0, z: 0 }, radius: 2.4, input: "base" },
      lines: 48,
    },
  },
  {
    name: "Inverted perpendiculars",
    detail: "A knot's tangent feet, inverted in a sphere",
    config: {
      ...base,
      construction: "inversion",
      pole: { x: 0, y: 0, z: 2 },
      inversion: {
        center: { x: 0, y: 0, z: 0 },
        radius: 2,
        input: "tangent-foot",
      },
      lines: 48,
    },
  },
];
