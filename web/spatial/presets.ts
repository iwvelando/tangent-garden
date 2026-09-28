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
  // A harmonic trefoil: two circles turning opposite ways, with a vertical
  // wave. The faster circle is the larger, so the curve never stops.
  harmonic: {
    center: { x: 0, y: 0, z: 0 },
    terms: [
      {
        frequency: 1,
        cosine: { x: 1, y: 0, z: 0 },
        sine: { x: 0, y: 1, z: 0 },
      },
      {
        frequency: -2,
        cosine: { x: 2, y: 0, z: 0 },
        sine: { x: 0, y: 2, z: 0 },
      },
      {
        frequency: 3,
        cosine: { x: 0, y: 0, z: 1 },
        sine: { x: 0, y: 0, z: 0 },
      },
    ],
    min: 0,
    max: 2 * Math.PI,
  },
  // A rotation-minimizing band with one strand, its seam left visible.
  frame: {
    kind: "rotation-minimizing",
    reference: { x: 0, y: 0, z: 1 },
    angle: 0,
    twist: 0,
    offset: 0.5,
    width: 0.3,
    strands: 1,
    closure: "seam",
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
  {
    name: "A harmonic trefoil",
    detail: "Two circles turning opposite ways, lifted by a wave",
    config: {
      ...base,
      format: "harmonic",
      length: 0.8,
      lines: 36,
    },
  },
  {
    name: "Tilted ellipses · 1 : 3 : −5",
    detail: "Three generating ellipses in three different planes",
    config: {
      ...base,
      format: "harmonic",
      length: 0.6,
      lines: 30,
      harmonic: {
        center: { x: 0, y: 0, z: 0 },
        terms: [
          {
            frequency: 1,
            cosine: { x: 2, y: 0, z: 0 },
            sine: { x: 0, y: 1.6, z: 0.8 },
          },
          {
            frequency: 3,
            cosine: { x: 0, y: 0.4, z: 0 },
            sine: { x: 0, y: 0, z: 0.4 },
          },
          {
            frequency: -5,
            cosine: { x: 0.1, y: 0, z: 0 },
            sine: { x: 0, y: 0.1, z: 0 },
          },
        ],
        min: 0,
        max: 2 * Math.PI,
      },
    },
  },
  {
    name: "An orbit that never closes",
    detail: "Frequencies 1 and φ: an open arc, not forced shut",
    config: {
      ...base,
      format: "harmonic",
      length: 0.35,
      lines: 48,
      harmonic: {
        center: { x: 0, y: 0, z: 0 },
        terms: [
          {
            frequency: 1,
            cosine: { x: 2, y: 0, z: 0 },
            sine: { x: 0, y: 2, z: 0 },
          },
          {
            frequency: (1 + Math.sqrt(5)) / 2,
            cosine: { x: 0, y: 0, z: 0.8 },
            sine: { x: 0.5, y: 0, z: 0 },
          },
        ],
        min: 0,
        max: 6 * Math.PI,
      },
    },
  },
  {
    name: "A band around the trefoil",
    detail: "A transported frame, its return angle spread along the knot",
    config: {
      ...base,
      construction: "framed",
      lines: 72,
      frame: {
        ...base.frame,
        twist: 2,
        width: 0.35,
        offset: 0.7,
        strands: 2,
        closure: "distribute",
      },
    },
  },
  {
    name: "Strands braided on a helix",
    detail: "Three offset threads turning five times around a staircase",
    config: {
      ...base,
      format: "parametric",
      construction: "framed",
      lines: 48,
      frame: {
        ...base.frame,
        reference: { x: -1, y: 0, z: 0 },
        twist: 5,
        width: 0.12,
        offset: 0.55,
        strands: 3,
      },
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
    name: "The seam of a carried frame",
    detail: "Carried once around a (3, 4) knot, the frame returns turned",
    config: {
      ...base,
      construction: "framed",
      p: 3,
      q: 4,
      tube: 1.1,
      lines: 48,
      frame: { ...base.frame, width: 0.3, strands: 0 },
    },
  },
];
