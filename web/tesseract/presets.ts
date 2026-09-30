import type { Config, Motion } from "./types";
import { defaultConfig } from "./objects";
const base = defaultConfig;
const diagonal: Config["angles"] = [
  0,
  0,
  0,
  Math.PI / 4,
  Math.asin(1 / Math.sqrt(3)),
  Math.PI / 6,
];
export const tesseractPresets: {
  name: string;
  detail: string;
  config: Config;
  motion: Motion;
}[] = [
  {
    name: "A cube beyond a cube",
    detail: "Sixteen vertices. Thirty-two edges. One extra direction.",
    config: { ...base },
    motion: "double",
  },
  {
    name: "Spherical loom",
    detail: "A face lattice on the 3-sphere, opened into curling threads.",
    config: {
      ...base,
      mode: "stereo",
      angles: [0, 0.2, 0.15, 0.62, 0.3, 0.18],
      grid: 5,
    },
    motion: "double",
  },
  {
    name: "Eight rooms of light",
    detail:
      "Parallel lines on twenty-four squares weave a transparent architecture.",
    config: { ...base, angles: [0.2, 0.15, 0.3, 0.55, 0.38, 0.2], grid: 6 },
    motion: "xw",
  },
  {
    name: "An octahedron within",
    detail:
      "A diagonal slice reveals eight triangular faces at the heart of the cube.",
    config: { ...base, mode: "section", angles: diagonal },
    motion: "slice",
  },
  {
    name: "Section garden",
    detail:
      "Seventeen parallel sections nest into a crystalline contour drawing.",
    config: {
      ...base,
      mode: "section",
      angles: [0.12, 0.3, 0.2, 0.66, 0.51, 0.39],
      count: 17,
    },
    motion: "double",
  },
  {
    name: "An orthogonal shadow",
    detail:
      "Drop the fourth coordinate and watch a double rotation fold the shadow.",
    config: {
      ...base,
      mode: "orthographic",
      angles: [0.3, 0.2, 0.1, 0.7, 0.5, 0.3],
      grid: 2,
    },
    motion: "double",
  },
  {
    name: "A sphere in passing",
    detail:
      "Sections of a 4-ball shrink from a 3-ball to a point, then disappear. Circles illustrate each boundary sphere.",
    config: {
      ...base,
      object: "ball",
      mode: "section",
      count: 5,
      spread: 3.2,
      curves: 3,
    },
    motion: "slice",
  },
  {
    name: "A ring in passing",
    detail:
      "Each outline is a section of one four-dimensional tube. As the slice moves, the tube narrows to its central circle and disappears. The drawing samples its depth; it does not show an infinity of layers.",
    config: {
      ...base,
      object: "tube",
      mode: "section",
      count: 5,
      spread: 1.1,
      curves: 4,
    },
    motion: "slice",
  },
  {
    name: "The missing middle",
    detail:
      "The middle of each thread leaves the reference slice. Its lifted centerline stays attached to both ends.",
    config: {
      ...base,
      object: "lift",
      mode: "reference",
      lift: {
        center: [0, 0, 0],
        support: 2,
        height: 0.32,
        angle: Math.PI / 4,
        from: [-1.5, 0, 0],
        to: [1.5, 0, 0],
        radiusFrom: 0.05,
        radiusTo: 2,
      },
    },
    motion: "drift",
  },
];
