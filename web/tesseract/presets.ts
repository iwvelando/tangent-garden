import type { Config, Motion } from "./types";
import type { Pace, Repeat } from "../timing";
import { defaultConfig, objects } from "./objects";
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
  // Once and steady unless given (../timing.ts).
  repeat?: Repeat;
  pace?: Pace;
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
  {
    name: "Beside the wall",
    detail:
      "Leave the reference slice, pass beside an embedded shell, and return inside. The shadow crosses the wall; the four-dimensional route is clear.",
    config: objects.bypass.defaults(base),
    motion: "route",
  },
  {
    name: "Rings from a sphere",
    detail:
      "These curves lie on a sphere in four dimensions. Stereographic projection turns them into a weave of circles and open arcs. Open ends mark the drawing's finite window, not broken connections.",
    config: objects.weave.defaults(base),
    motion: "double",
  },
  {
    name: "Tori between two circles",
    detail:
      "Nested tori on the 3-sphere, each drawn by two families of circles. Sweep the latitudes and an end torus collapses to a single circle.",
    config: {
      ...objects.weave.defaults(base),
      count: 3,
      curves: 12,
      samples: 96,
      clip: 5,
      weave: {
        family: "tori",
        alpha: Math.PI / 4,
        spread: 1,
        alphaFrom: 0.5,
        alphaTo: Math.PI / 2 - 0.5,
      },
    },
    motion: "latitude",
  },
  {
    name: "Hopf circles, flowing forever",
    detail:
      "Linked great circles of the 3-sphere turn through two planes at once. Each passes through the projection's pole and opens into a line, then closes again; after one whole turn every circle is back, so the motion loops without a seam.",
    config: {
      ...objects.weave.defaults(base),
      count: 3,
      curves: 12,
      samples: 192,
      clip: 5,
      angles: [0, 0.35, 0.2, 0, 0.4, 0.25],
      weave: {
        family: "fibers",
        alpha: 0.72,
        spread: 0.5,
        alphaFrom: 0.33,
        alphaTo: Math.PI / 2 - 0.33,
      },
    },
    motion: "double",
    repeat: "loop",
  },
  // Opens Base sphere and fibers on one latitude, the first sample
  // selected, and traces the latitude in a loop.
  {
    name: "A circle over every point",
    detail:
      "Each point of a latitude on the sphere owns one great circle of the 3-sphere. Move the point and its circle sweeps through the linked bouquet.",
    config: {
      ...objects.weave.defaults(base),
      mode: "paired",
      count: 1,
      curves: 12,
      samples: 128,
      clip: 3,
      angles: [0, 0.2, 0.15, 0.3, 0.2, 0.1],
      weave: {
        family: "fibers",
        alpha: 0.5,
        spread: 0.66,
        alphaFrom: 0.33,
        alphaTo: Math.PI / 2 - 0.33,
        selected: 0,
      },
    },
    motion: "trace",
    repeat: "loop",
  },
  // Opens the five-petal spherical flower, sample zero selected, and
  // traces its corresponding fiber once around a seamless loop.
  {
    name: "A flower below, a bouquet above",
    detail:
      "A flower winds across the base sphere. Each sampled point lifts to a linked circle; trace the flower and one whole fiber moves through the bouquet.",
    config: {
      ...objects.weave.defaults(base),
      mode: "paired",
      count: 1,
      curves: 20,
      samples: 128,
      clip: 3,
      angles: [0, 0.2, 0.15, 0.3, 0.2, 0.1],
      weave: {
        family: "fibers",
        alpha: Math.PI / 4,
        spread: 0.66,
        alphaFrom: 0.33,
        alphaTo: Math.PI / 2 - 0.33,
        selected: 0,
        path: "flower",
        amplitude: Math.PI / 8,
        petals: 5,
      },
    },
    motion: "trace",
    repeat: "loop",
  },
  // Opens one cell of the 24-cell, its center and the dual edges from it,
  // turning in a seamless double rotation.
  {
    name: "The heart of a cell",
    detail:
      "One octahedral cell of the 24-cell. Its three diagonals cross at a vertex of the dual 24-cell: the companion sits at the cell's center, and its edges reach the centers of the eight cells beside it.",
    config: objects.cell24.defaults(base),
    motion: "double",
    repeat: "loop",
  },
  // Opens both whole crystals around the same selected cell.
  {
    name: "A crystal and its companion",
    detail:
      "The 24-cell and its polar dual together, one cell and its center picked out. Every cell of one holds a vertex of the other.",
    config: {
      ...objects.cell24.defaults(base),
      cell24: { selected: 0, view: "crystal" },
    },
    motion: "double",
    repeat: "loop",
  },
  // Opens both whole crystals in perspective from an eye just beyond cell
  // 12 (the cell centered on +e_w), turned slightly in xw so its center
  // sits off its diagonals' midpoints. That nearest cell surrounds the rest;
  // a seamless double rotation turns the crystal inside out at a fixed
  // framing radius.
  {
    name: "Into the crystal",
    detail:
      "The 24-cell and its dual in perspective, seen from just beyond one cell: that octahedron surrounds all the others. Its diagonals still meet at its center, a dual vertex, though no longer halfway.",
    config: {
      ...objects.cell24.defaults(base),
      mode: "perspective",
      angles: [0, 0, 0, 0.25, 0, 0],
      distance: 2.2,
      cell24: { selected: 11, view: "crystal" },
    },
    motion: "double",
    repeat: "loop",
  },
  // Static central section; Play deliberately cuts to an empty plane,
  // then passes through both fixed crystals while their inks alternate.
  {
    name: "A crystal meeting its own dual",
    detail:
      "One plane reveals both crystals. A selected cell and the edges from its dual vertex stay accented.",
    config: {
      ...objects.cell24.defaults(base),
      mode: "section",
      slice: 0,
      cell24: { selected: 2, view: "crystal" },
    },
    motion: "crystal",
    repeat: "loop",
    pace: "ease",
  },
  // Opens one cube of the tesseract, its four diagonals crossing at its
  // center, a 16-cell vertex, and the 16-cell edges to the six cubes
  // beside it, turning in a seamless double rotation.
  {
    name: "Eight cubes, eight centers",
    detail:
      "One cube of the tesseract. Its four diagonals cross at a vertex of the 16-cell, the tesseract's dual, whose edges reach the centers of the six cubes sharing a square with it.",
    config: objects.cell16.defaults(base),
    motion: "double",
    repeat: "loop",
  },
  // Opens both whole polytopes in perspective from an eye just beyond cube
  // 4 (the cube centered on +e_w), turned slightly in xw: the cube within a
  // cube, threaded by the 16-cell through the cube centers. A seamless
  // double rotation turns it inside out at a fixed framing radius.
  {
    name: "Cube within a cube, and its dual",
    detail:
      "The tesseract and its polar 16-cell in perspective. Every cube of one holds a vertex of the other; the other's tetrahedral cells match the tesseract's corners.",
    config: {
      ...objects.cell16.defaults(base),
      mode: "perspective",
      angles: [0, 0, 0, 0.25, 0, 0],
      distance: 2.5,
      cell16: { selected: 3, view: "crystal" },
    },
    motion: "double",
    repeat: "loop",
  },
  // A static central section, corner first: w is turned onto the
  // tesseract's diagonal (½, ½, ½, ½) by xw π/4, yw asin(1/√3) and zw π/6.
  // Play cuts to an empty plane, then passes through both fixed polytopes
  // while their inks alternate.
  {
    name: "A tesseract meeting its dual",
    detail:
      "One plane cuts the tesseract corner first: an octahedron. Its dual 16-cell gives a cuboctahedron, not the octahedron's dual cube.",
    config: {
      ...objects.cell16.defaults(base),
      mode: "section",
      angles: [0, 0, 0, Math.PI / 4, Math.asin(1 / Math.sqrt(3)), Math.PI / 6],
      slice: 0,
      cell16: { selected: 0, view: "crystal" },
    },
    motion: "crystal",
    repeat: "loop",
    pace: "ease",
  },
  // Opens at t = 0 with both whole circuits and the trace of the second,
  // the circuit that has just brought w home; Follow the root loops over
  // the whole 4π journey.
  {
    name: "The second time around",
    detail:
      "A point circles the origin twice. Its square root goes only halfway around on the first circuit, and comes home on the second. In four dimensions the two circuits are one closed curve.",
    config: objects.root.defaults(base),
    motion: "trace",
    repeat: "loop",
  },
];
