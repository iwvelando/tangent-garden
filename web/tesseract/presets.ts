import type { Config, Motion } from "./types";
const base: Config = {
  mode: "perspective",
  angles: [0, 0, 0, 0, 0, 0],
  distance: 4,
  slice: 0,
  spread: 3.4,
  count: 1,
  grid: 0,
  samples: 64,
  clip: 4,
};
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
];
