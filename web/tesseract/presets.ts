import type { Config, Motion, Root, View } from "./types";
import { leafTerms, researchRoots } from "./research";
import type { TesseractPhrase } from "./phrase";
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
  // The phrase Play a phrase plays, for a preset that opens with one.
  phrase?: TesseractPhrase;
  // The drawing's and a paired companion's opening cameras, where they
  // differ from initialView. Reset view and Home return to them while the
  // study is this example's.
  view?: View;
  diagramView?: View;
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
  // Opens a seven-petal flower over its bouquet, at the sample halfway round
  // (whose fiber is a clear ellipse), at the views every preset opens with, and plays its phrase as a loop: one
  // fiber traces the whole bouquet, the petals open, the weave turns once in
  // xw while the fibers' view orbits once, and the petals close again. The
  // end is the opening drawing: whole turns of the trace, xw and the camera.
  {
    name: "A bouquet answers its path",
    detail:
      "Trace a flower on the base sphere and one fiber sweeps out its bouquet. Open the petals and every fiber follows; turn in four dimensions and the base point stays put.",
    config: {
      ...objects.weave.defaults(base),
      mode: "paired",
      count: 1,
      curves: 28,
      samples: 128,
      clip: 3,
      angles: [0, 0.2, 0.15, 0.3, 0.2, 0.1],
      weave: {
        family: "fibers",
        alpha: Math.PI / 4,
        spread: 0.66,
        alphaFrom: 0.33,
        alphaTo: Math.PI / 2 - 0.33,
        selected: 14,
        path: "flower",
        amplitude: Math.PI / 7,
        petals: 7,
      },
    },
    motion: "phrase",
    repeat: "loop",
    phrase: {
      target: "weave.trace",
      also: ["weave.amplitude", "xw"],
      phases: [
        { name: "Trace the flower", duration: 6, pace: "steady", key: "1" },
        {
          name: "Open the petals",
          duration: 3,
          pace: "ease",
          keys: { "weave.amplitude": "pi/5" },
        },
        {
          name: "Turn in four dimensions",
          duration: 8,
          pace: "ease",
          keys: { xw: "0.3 + 2*pi" },
          view: {
            yaw: 0.32,
            pitch: 0.35,
            zoom: 1,
            panX: 0,
            panY: 0,
            turns: 1,
          },
        },
        {
          name: "Close the petals",
          duration: 3,
          pace: "ease",
          keys: { "weave.amplitude": "pi/7" },
        },
      ],
    },
  },
  // Opens a great circle tilted 3π/4 from the equator, over the great
  // Clifford torus its 28 fibers fill, sample zero selected, and plays its
  // phrase as a loop: one fiber traces the circle, the circle tilts over
  // both poles to π/4 and the torus leans with it, then it tilts back to
  // the opening drawing.
  {
    name: "A great circle, a leaning torus",
    detail:
      "The fibers over a great circle fill a torus that splits the 3-sphere in half. Trace the circle, then tilt it, and the whole torus leans in four dimensions.",
    config: {
      ...objects.weave.defaults(base),
      mode: "paired",
      count: 1,
      curves: 28,
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
        path: "great-circle",
        tilt: (3 * Math.PI) / 4,
      },
    },
    motion: "phrase",
    repeat: "loop",
    phrase: {
      target: "weave.trace",
      also: ["weave.tilt"],
      phases: [
        {
          name: "Trace the great circle",
          duration: 6,
          pace: "steady",
          key: "1",
        },
        {
          name: "Tilt over the poles",
          duration: 5,
          pace: "ease",
          keys: { "weave.tilt": "pi/4" },
        },
        {
          name: "Tilt back",
          duration: 5,
          pace: "ease",
          keys: { "weave.tilt": "3*pi/4" },
        },
      ],
    },
  },
  // Opens the spherical Lissajous curve m₁ = 2, m₂ = 1 with 32 fibers,
  // sample zero (the north pole) selected, in a rotation that weaves the
  // fibers into one loop around that pole's fiber. Both panes open at their
  // own cameras: the base sphere turned to show both loops of the curve,
  // and the bouquet seen from its side, slightly enlarged and centered on
  // its woven core. It traces the curve once around a seamless loop.
  {
    name: "A Lissajous path, a woven bouquet",
    detail:
      "A point circles the pole twice while it swings once from pole to pole. Each of its points lifts to a whole circle, and the circles of any two different points link.",
    config: {
      ...objects.weave.defaults(base),
      mode: "paired",
      count: 1,
      curves: 32,
      samples: 128,
      clip: 3,
      angles: [0, 0.2, 0.15, 0.3, 0.9, Math.PI / 2],
      weave: {
        family: "fibers",
        alpha: Math.PI / 4,
        spread: 0.66,
        alphaFrom: 0.33,
        alphaTo: Math.PI / 2 - 0.33,
        selected: 0,
        path: "lissajous",
        azimuthal: 2,
        polar: 1,
      },
    },
    view: { yaw: -1.16, pitch: 0.72, zoom: 1.11, panX: -10.8, panY: -6.6 },
    diagramView: { yaw: 0.77, pitch: 0.64, zoom: 1, panX: 0, panY: 0 },
    motion: "trace",
    repeat: "loop",
  },
  // Opens an equilateral triangle with its vertices on the latitude v = π/6,
  // a third of a turn apart, and 30 fibers, ten on each side, so samples 0,
  // 10 and 20 sit on the vertices. The three sides' pieces of great
  // Clifford tori close into one torus whose hole has three corners.
  // Sample zero, vertex 1, is selected, and the trace carries its fiber
  // around all three corners in a seamless loop.
  {
    name: "A spherical triangle, three stitched tori",
    detail:
      "Each side of a triangle on the sphere is part of a great circle, so its fibers lie on one torus. Three tori meet along the fibers over the corners; trace a fiber across each seam.",
    config: {
      ...objects.weave.defaults(base),
      mode: "paired",
      count: 1,
      curves: 30,
      samples: 128,
      clip: 3,
      angles: [0, 0.35, 0.15, 0.15, 0.2, 0.5],
      weave: {
        family: "fibers",
        alpha: Math.PI / 4,
        spread: 0.66,
        alphaFrom: 0.33,
        alphaTo: Math.PI / 2 - 0.33,
        selected: 0,
        path: "polygon",
        vertices: [
          { u: 0, v: Math.PI / 6 },
          { u: (2 * Math.PI) / 3, v: Math.PI / 6 },
          { u: (4 * Math.PI) / 3, v: Math.PI / 6 },
        ],
      },
    },
    view: { yaw: 0.32, pitch: 0.35, zoom: 1.25, panX: 0, panY: 0 },
    motion: "trace",
    repeat: "loop",
  },
  // Opens a five-pointed star {5/2} whose vertices lie on the latitude
  // v = π/10, each joined to the one two places on by a great-circle arc,
  // so the sides cross. 30 fibers put six on each side and one on every
  // vertex. Sample zero is selected, and the trace loops around the star.
  {
    name: "A star on the sphere, a crossing bouquet",
    detail:
      "Five great-circle arcs cross to make a star. The fibers over each arc fill part of one torus, and the five pieces weave through one another as the sides cross.",
    config: {
      ...objects.weave.defaults(base),
      mode: "paired",
      count: 1,
      curves: 30,
      samples: 128,
      clip: 3,
      angles: [0, 0.35, 0.15, 0.15, 0.2, 0.5],
      weave: {
        family: "fibers",
        alpha: Math.PI / 4,
        spread: 0.66,
        alphaFrom: 0.33,
        alphaTo: Math.PI / 2 - 0.33,
        selected: 0,
        path: "polygon",
        vertices: [0, 4, 8, 12, 16].map((k) => ({
          u: (k * Math.PI) / 5,
          v: Math.PI / 10,
        })),
      },
    },
    view: { yaw: 0.32, pitch: 0.35, zoom: 1.25, panX: 0, panY: 0 },
    motion: "trace",
    repeat: "loop",
  },
  // Opens the octant triangle, (1, 0, 0) to (0, 1, 0) to (0, 0, 1), with
  // 24 fibers, eight on each side, and a marked point carried from sample 0
  // at vertex 1, starting half a turn along its fiber (φ₀ = π), where its
  // trail is drawn largest. The sphere is unrotated, so the fiber through
  // the projection's pole lies over the south pole, and every fiber and
  // trail point over the triangle has q_w ≤ 1/√2, inside the window C =
  // 2.5 throughout. The triangle encloses π/2, so each lap returns the
  // point to its fiber turned by π/4; its phrase runs eight laps, a whole
  // turn of phase, and loops without a seam.
  {
    name: "Eight laps, one turn of phase",
    detail:
      "Carry a point around a triangle on the sphere, never turning it about its fiber. Each lap brings it home an eighth of a turn further along: half the area enclosed. Eight laps close the loop.",
    config: {
      ...objects.weave.defaults(base),
      mode: "paired",
      count: 1,
      curves: 24,
      samples: 128,
      clip: 2.5,
      angles: [0, 0, 0, 0, 0, 0],
      weave: {
        family: "fibers",
        alpha: Math.PI / 4,
        spread: 0.66,
        alphaFrom: 0.33,
        alphaTo: Math.PI / 2 - 0.33,
        selected: 0,
        path: "polygon",
        vertices: [
          { u: 0, v: 0 },
          { u: Math.PI / 2, v: 0 },
          { u: 0, v: Math.PI / 2 },
        ],
        transport: true,
        phase: Math.PI,
      },
    },
    view: { yaw: 0.32, pitch: 0.35, zoom: 1.25, panX: 0, panY: 0 },
    motion: "phrase",
    repeat: "loop",
    phrase: {
      target: "weave.trace",
      phases: [1, 2, 3, 4, 5, 6, 7, 8].map((lap) => ({
        name: `Lap ${lap}`,
        duration: 3,
        pace: "steady" as const,
        key: String(lap),
      })),
    },
  },
  // Opens the woven Lissajous bouquet's path m = (2, 1) sampled over a
  // neighborhood: 25 fibers over w = 0.12 of the path, centered on
  // sample 11 of 32 (selected: 10), where the stretch's fibers fan out
  // across the window. Same rotation and cameras as the woven bouquet.
  // Its phrase carries the stretch once around the path, tightening into
  // a ring at each pole, then opens it to the whole path, where its
  // fibers are an even sampling of the full bouquet, and closes it again.
  {
    name: "A short stretch, an opening fan",
    detail:
      "Fibers over a short stretch of a Lissajous path form a fan of linked circles. It twists as the stretch travels the path, then opens into the whole bouquet.",
    config: {
      ...objects.weave.defaults(base),
      mode: "paired",
      count: 1,
      curves: 32,
      samples: 128,
      clip: 3,
      angles: [0, 0.2, 0.15, 0.3, 0.9, Math.PI / 2],
      weave: {
        family: "fibers",
        alpha: Math.PI / 4,
        spread: 0.66,
        alphaFrom: 0.33,
        alphaTo: Math.PI / 2 - 0.33,
        selected: 10,
        path: "lissajous",
        azimuthal: 2,
        polar: 1,
        sampling: "neighborhood",
        width: 0.12,
        nearby: 25,
      },
    },
    view: { yaw: -1.16, pitch: 0.72, zoom: 1.11, panX: -10.8, panY: -6.6 },
    diagramView: { yaw: 0.77, pitch: 0.64, zoom: 1, panX: 0, panY: 0 },
    motion: "phrase",
    repeat: "loop",
    phrase: {
      target: "weave.trace",
      also: ["weave.width"],
      phases: [
        {
          name: "Carry the stretch along the path",
          duration: 10,
          pace: "steady",
          key: "1",
        },
        {
          name: "Open to the whole path",
          duration: 5,
          pace: "ease",
          keys: { "weave.width": "1" },
        },
        {
          name: "Close to a stretch",
          duration: 5,
          pace: "ease",
          keys: { "weave.width": "0.12" },
        },
      ],
    },
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
  // Opens at t = 0 on a circle that still encloses zero, off center: w
  // traces one pinched Cassini oval and needs both circuits to come home.
  // Follow the root loops over the whole 4π journey.
  {
    name: "Around an off-center branch point",
    detail:
      "The circle is off center but still encloses zero, so its square root still needs two circuits to come home, around one pinched oval.",
    config: {
      ...objects.root.defaults(base),
      root: {
        radius: 1.4,
        offset: 0.85,
        direction: 0.6,
        sheet: "plus",
        from: 0,
        to: 4 * Math.PI,
      },
    },
    motion: "trace",
    repeat: "loop",
  },
  // Opens at t = 0 on a circle that just misses zero and crosses the
  // principal cut: w keeps to one of two teardrop ovals and comes home
  // after one circuit, so the second retraces the first; the other sheet's
  // loop is a dashed guide. yw turns the two 4D loops apart. Follow the
  // root loops over 4π.
  {
    name: "A loop that misses zero",
    detail:
      "The circle passes zero by. Its square root comes home after a single circuit, keeping to one of two ovals; the other is never visited.",
    config: {
      ...objects.root.defaults(base),
      angles: [0, 0, -1, 0, 0.8, 0.6],
      root: {
        radius: 1.2,
        offset: 1.1,
        direction: 2.8,
        sheet: "plus",
        from: 0,
        to: 4 * Math.PI,
      },
    },
    motion: "trace",
    repeat: "loop",
  },
  // Opens at t = 0 on a circle that encloses zero, off center, at degree 5:
  // each circuit, in its own ink, carries w on to the next fifth root, and
  // the five join into one five-lobed loop in the w plane and one coiled
  // closed curve in 4D. Follow the root loops over the whole 10π journey.
  {
    name: "Five roots trading places",
    detail:
      "Each circuit of z moves its fifth root on to the next of the five roots. Only after five circuits is it home, and the five stretches close into one flower.",
    config: {
      ...objects.root.defaults(base),
      samples: 2048,
      root: {
        radius: 0.6,
        offset: 0.85,
        direction: 0.4,
        degree: 5,
        sheet: "plus",
        from: 0,
        to: 10 * Math.PI,
      },
    },
    motion: "trace",
    repeat: "loop",
  },
  // Opens at t = 0 on a circle that misses zero at degree 5: w keeps to one
  // of five petals and comes home after every circuit; the other four are
  // dashed guides. Follow the root loops over 10π.
  {
    name: "Five petals, one visited",
    detail:
      "The circle passes zero by, so its fifth root comes home after every circuit, keeping to one of five petals; the other four are never visited.",
    config: {
      ...objects.root.defaults(base),
      samples: 2048,
      angles: [0, 0, -1, 0, 0.8, 0.6],
      root: {
        radius: 0.5,
        offset: 1.08,
        direction: 2.5,
        degree: 5,
        sheet: "plus",
        from: 0,
        to: 10 * Math.PI,
      },
    },
    motion: "trace",
    repeat: "loop",
  },
  // #413 research studies, only under ?research=413: noncircular source
  // paths. Each loops over its whole journey.
  ...(researchRoots() ? researchRootPresets() : []),
];

function researchRootPresets(): typeof tesseractPresets {
  const study = (
    name: string,
    detail: string,
    root: Partial<Root>,
    samples = 2048,
  ) => ({
    name: `Research: ${name}`,
    detail,
    config: {
      ...objects.root.defaults(base),
      samples,
      root: {
        radius: 1,
        sheet: "plus" as const,
        from: 0,
        to: 2 * Math.PI * (root.degree ?? 2),
        ...root,
      },
    },
    motion: "trace" as const,
    repeat: "loop" as const,
  });
  return [
    study(
      "twice around zero",
      "A ripple winds z twice about zero each circuit, so its cube root skips a root every circuit and still needs all three to come home.",
      { path: "ripple", radius: 0.8, ripple: 2, frequency: 2, degree: 3 },
    ),
    study(
      "roots in star order",
      "z winds backward twice each circuit, so the five fifth roots are visited in star order, two steps back at a time.",
      {
        path: "ripple",
        radius: 0.7,
        ripple: 1.4,
        frequency: -2,
        degree: 5,
        direction: 0.3,
      },
    ),
    study(
      "twelve ripples",
      "Twelve ripples on a circle that encloses zero: the path curls into small loops, and the cube root follows every one.",
      {
        path: "ripple",
        radius: 1,
        offset: 0.3,
        ripple: 0.3,
        frequency: 12,
        degree: 3,
      },
    ),
    study(
      "the example leaf around zero",
      "Draw a loop's example leaf, drawn clockwise about zero: the cube roots trade places backward.",
      { path: "fourier", radius: 1, terms: leafTerms, degree: 3 },
    ),
    study(
      "a ripple that grazes zero",
      "Six ripples, one passing just outside the clearance from zero, where the cube root turns fastest. Raise Ripple a past 0.7 and the path crosses zero: then it winds twice.",
      {
        path: "ripple",
        radius: 1,
        offset: 0.3,
        ripple: 0.64,
        frequency: 6,
        direction: 0.5,
        degree: 3,
      },
    ),
    study(
      "a ripple through zero (refused)",
      "This ripple passes through zero, where no root can be followed: refused under Center offset.",
      { path: "ripple", radius: 1, ripple: 1, frequency: 2 },
      1024,
    ),
  ];
}
