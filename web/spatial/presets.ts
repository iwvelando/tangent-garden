import type { Cut } from "./cut";
import type { Sight } from "./sight";
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
  // Chords of the curve itself, one radian of parameter ahead; the thread
  // is a ring above the trefoil, used when the partner is switched to it.
  ruled: {
    partner: "chord",
    thread: { x: "2.4*cos(t)", y: "2.4*sin(t)", z: "1.6" },
    rate: 1,
    shift: 1,
  },
  // A tube of constant radius, with four meridians.
  canal: { radius: 0.35, profile: "1", meridians: 4 },
  // The rising vortex V = (−y, x, a): each seed on the unit ring climbs a
  // helix of pitch 2πa.
  field: {
    x: "-y",
    y: "x",
    z: "a",
    seeds: [
      { x: 1, y: 0, z: 0 },
      { x: 0, y: 1, z: 0 },
      { x: -1, y: 0, z: 0 },
      { x: 0, y: -1, z: 0 },
    ],
    escape: 20,
    min: 0,
    max: 4 * Math.PI,
    a: 0.25,
  },
  // Four equal pursuers from a regular tetrahedron, in turn: a quarter turn
  // with a reflection carries each to the next, and they spiral down a
  // paraboloid to a capture near t = 1.62.
  pursuit: {
    pursuers: [
      { x: 1, y: 0, z: Math.SQRT1_2, speed: 1 },
      { x: 0, y: 1, z: -Math.SQRT1_2, speed: 1 },
      { x: -1, y: 0, z: Math.SQRT1_2, speed: 1 },
      { x: 0, y: -1, z: -Math.SQRT1_2, speed: 1 },
    ],
    capture: 0.005,
    min: 0,
    max: 1.75,
  },
  // A whole torus with short normal lines and no offset.
  surface: {
    kind: "torus",
    a: 2,
    b: 0.8,
    c: 0,
    uMin: 0,
    uMax: 2 * Math.PI,
    vMin: 0,
    vMax: 2 * Math.PI,
    uSamples: 72,
    vSamples: 36,
    curves: 12,
    reverse: false,
    offset: 0,
    reach: 0.5,
  },
  // Light falling straight down, or from a lamp above the origin, onto a
  // mirror, or through air into glass; no receiver.
  rays: {
    interaction: "reflect",
    n1: 1,
    n2: 1.5,
    light: "parallel",
    azimuth: 0,
    elevation: -90,
    source: { x: 0, y: 0, z: 3 },
    length: 2,
    receiver: { plane: "none", at: 0, c1: 0, c2: 0, size: 3, bins: 96 },
  },
  // The unit sphere in a slightly larger box, with five circles of latitude.
  implicit: {
    f: "x^2 + y^2 + z^2",
    a: 1,
    level: 1,
    box: {
      xMin: -1.3,
      xMax: 1.3,
      yMin: -1.3,
      yMax: 1.3,
      zMin: -1.3,
      zMax: 1.3,
    },
    cells: 48,
    refine: 0,
    sections: { normal: { x: 0, y: 0, z: 1 }, from: -0.8, to: 0.8, count: 5 },
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
// A preset may open with its own cut (see cut.ts) and its own sight (see
// sight.ts); choosing one without turns them off.
export const spatialPresets: {
  name: string;
  detail: string;
  config: SpatialConfig;
  cut?: Cut;
  sight?: Sight;
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
  {
    name: "A harmonic loom",
    detail:
      "Two rippling rings, joined across a phase shift by straight threads",
    config: {
      ...base,
      format: "harmonic",
      construction: "ruled",
      lines: 120,
      harmonic: {
        center: { x: 0, y: 0, z: -0.9 },
        terms: [
          {
            frequency: 1,
            cosine: { x: 2, y: 0, z: 0 },
            sine: { x: 0, y: 2, z: 0 },
          },
          {
            frequency: 5,
            cosine: { x: 0, y: 0, z: 0.25 },
            sine: { x: 0, y: 0, z: 0 },
          },
        ],
        min: 0,
        max: 2 * Math.PI,
      },
      ruled: {
        partner: "thread",
        thread: { x: "2*cos(t)", y: "2*sin(t)", z: "0.9+0.25*sin(4*t)" },
        rate: 1,
        shift: 2.4,
      },
    },
  },
  {
    name: "Chords across the trefoil",
    detail: "Each point joined to the point a third of the knot ahead",
    config: {
      ...base,
      construction: "ruled",
      lines: 120,
      ruled: { ...base.ruled, shift: (2 * Math.PI) / 3 },
    },
  },
  {
    name: "Chords of a rising helix",
    detail: "Half-turn chords through the axis, stopping where the helix ends",
    config: {
      ...base,
      format: "parametric",
      construction: "ruled",
      lines: 96,
      ruled: { ...base.ruled, shift: Math.PI },
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
    name: "A tube around the trefoil",
    detail:
      "Circles of one radius around the knot, their meridians returning turned",
    config: {
      ...base,
      construction: "canal",
      lines: 48,
      canal: { radius: 0.32, profile: "1", meridians: 4 },
    },
  },
  {
    name: "A necklace of spheres",
    detail:
      "A swelling radius on a helix, each sphere touching along a tilted circle",
    config: {
      ...base,
      format: "parametric",
      construction: "canal",
      lines: 60,
      canal: { radius: 0.5, profile: "1+0.45*sin(4*t)", meridians: 0 },
      frame: { ...base.frame, reference: { x: -1, y: 0, z: 0 } },
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
    name: "Beads that lose their envelope",
    detail:
      "Where the radius grows faster than the centre moves, the spheres have no envelope",
    config: {
      ...base,
      format: "parametric",
      construction: "canal",
      lines: 72,
      canal: { radius: 0.7, profile: "1+0.8*sin(2*t)", meridians: 0 },
      frame: { ...base.frame, reference: { x: 0, y: 0, z: 1 } },
      curve: {
        x: "t",
        y: "0",
        z: "0",
        a: 1,
        min: -2 * Math.PI,
        max: 2 * Math.PI,
      },
    },
  },
  {
    name: "A rising vortex",
    detail:
      "Four seeds on a ring climb one field as helices, one with its tangent ribbon",
    config: {
      ...base,
      format: "field",
      construction: "developable",
      length: 0.7,
      lines: 72,
    },
  },
  {
    name: "Lorenz's two wings",
    detail:
      "Two seeds a thousandth apart, folded around two unstable equilibria",
    config: {
      ...base,
      format: "field",
      construction: "none",
      samples: 2400,
      lines: 60,
      field: {
        // σ = 10, ρ = a = 28, β = 8/3.
        x: "10*(y-x)",
        y: "x*(a-z)-y",
        z: "x*y-8/3*z",
        seeds: [
          { x: 1, y: 1, z: 20 },
          { x: 1.001, y: 1, z: 20 },
        ],
        escape: 200,
        min: 0,
        max: 30,
        a: 28,
      },
    },
  },
  {
    name: "A ribbon along Rössler's band",
    detail: "One trajectory spiralling out and folding back, carried by a band",
    config: {
      ...base,
      format: "field",
      construction: "framed",
      samples: 2400,
      lines: 120,
      frame: {
        ...base.frame,
        reference: { x: 0, y: 0, z: 1 },
        offset: 0,
        width: 0.35,
        strands: 0,
      },
      field: {
        // a = 0.2, b = 0.2, c = 5.7.
        x: "-y-z",
        y: "x+a*y",
        z: "0.2+z*(x-5.7)",
        seeds: [{ x: 1, y: 1, z: 0 }],
        escape: 100,
        min: 0,
        max: 60,
        a: 0.2,
      },
    },
  },
  {
    name: "Four pursuers on a tetrahedron",
    detail:
      "Each spirals down a paraboloid, a quarter turn and a reflection from the next",
    config: {
      ...base,
      format: "pursuit",
      construction: "none",
      samples: 1200,
      lines: 16,
    },
  },
  {
    name: "A chase untangling a trefoil",
    detail: "Nine equal pursuers start around a knot and close in on a point",
    config: {
      ...base,
      format: "pursuit",
      construction: "none",
      samples: 1600,
      lines: 16,
      pursuit: {
        // Nine points along the (2, 3) torus knot, in order, rounded.
        pursuers: [
          { x: 3, y: 0, z: 0, speed: 1 },
          { x: 0.26, y: 1.477, z: 0.866, speed: 1 },
          { x: -1.41, y: 0.513, z: -0.866, speed: 1 },
          { x: -1.5, y: -2.598, z: 0, speed: 1 },
          { x: 1.149, y: -0.964, z: 0.866, speed: 1 },
          { x: 1.149, y: 0.964, z: -0.866, speed: 1 },
          { x: -1.5, y: 2.598, z: 0, speed: 1 },
          { x: -1.41, y: -0.513, z: 0.866, speed: 1 },
          { x: 0.26, y: -1.477, z: -0.866, speed: 1 },
        ],
        capture: 0.005,
        min: 0,
        max: 4,
      },
    },
  },
  {
    name: "A crown of six with a tangent ribbon",
    detail:
      "Six pursuers on a zigzag crown; each tangent points at the one being chased",
    config: {
      ...base,
      format: "pursuit",
      construction: "developable",
      length: 0.25,
      samples: 1200,
      lines: 24,
      pursuit: {
        // A regular hexagon's corners, alternately raised and lowered.
        pursuers: [
          { x: 1, y: 0, z: 0.6, speed: 1 },
          { x: 0.5, y: 0.866, z: -0.6, speed: 1 },
          { x: -0.5, y: 0.866, z: 0.6, speed: 1 },
          { x: -1, y: 0, z: -0.6, speed: 1 },
          { x: -0.5, y: -0.866, z: 0.6, speed: 1 },
          { x: 0.5, y: -0.866, z: -0.6, speed: 1 },
        ],
        capture: 0.005,
        min: 0,
        max: 2.2,
      },
    },
  },
  {
    name: "A torus revealing its centers",
    detail:
      "Inward normals cross the core circle and meet the axis: both focal sheets collapse",
    config: {
      ...base,
      format: "surface",
      surface: {
        ...base.surface,
        // The outer band, so the core circle shows through the gap.
        vMin: -Math.PI / 3,
        vMax: Math.PI / 3,
        vSamples: 24,
        curves: 13,
        reach: -2.8,
      },
    },
  },
  {
    name: "A sphere collapsing to one focus",
    detail: "Every normal runs to the centre, both focal sheets with them",
    config: {
      ...base,
      format: "surface",
      surface: {
        ...base.surface,
        kind: "ellipsoid",
        a: 1.2,
        b: 1.2,
        c: 1.2,
        // Open towards the default view.
        uMin: (4 * Math.PI) / 5,
        uMax: (23 * Math.PI) / 10,
        vMin: -Math.PI / 2,
        vMax: Math.PI / 2,
        uSamples: 54,
        vSamples: 36,
        curves: 10,
        offset: -0.5,
        reach: -1.2,
      },
    },
  },
  {
    name: "The focal sheets of an ellipsoid",
    detail: "Two sheets of centres, folded along cuspidal edges",
    config: {
      ...base,
      format: "surface",
      surface: {
        ...base.surface,
        kind: "ellipsoid",
        a: 1.5,
        b: 1,
        c: 0.7,
        // The far half, open towards the default view.
        uMin: (11 * Math.PI) / 10,
        uMax: (21 * Math.PI) / 10,
        vMin: -Math.PI / 2,
        vMax: Math.PI / 2,
        uSamples: 96,
        vSamples: 96,
        curves: 12,
        reach: 0,
      },
    },
  },
  {
    name: "An elliptic cylinder and its evolute",
    detail:
      "The centres of curvature sweep the ellipse's evolute along the axis",
    config: {
      ...base,
      format: "surface",
      surface: {
        ...base.surface,
        kind: "cylinder",
        a: 1.4,
        b: 0.8,
        c: 0,
        uMin: (4 * Math.PI) / 5,
        uMax: (23 * Math.PI) / 10,
        vMin: -1,
        vMax: 1,
        uSamples: 96,
        vSamples: 16,
        curves: 13,
        reach: 0,
      },
    },
  },
  {
    name: "A paraboloid gathering light",
    detail:
      "Light along the axis reflects through one focus: both caustics collapse to it",
    config: {
      ...base,
      format: "rays",
      surface: {
        ...base.surface,
        kind: "paraboloid",
        a: 0.5,
        b: 0.5,
        c: 0,
        uMin: -1.6,
        uMax: 1.6,
        vMin: -1.6,
        vMax: 1.6,
        uSamples: 48,
        vSamples: 48,
        curves: 9,
      },
      rays: { ...base.rays, length: 2.4 },
    },
  },
  {
    name: "A tilted beam folding into coma",
    detail: "Off the axis the focus spreads into two cusped caustic sheets",
    config: {
      ...base,
      format: "rays",
      surface: {
        ...base.surface,
        kind: "paraboloid",
        a: 0.5,
        b: 0.5,
        c: 0,
        uMin: -1.6,
        uMax: 1.6,
        vMin: -1.6,
        vMax: 1.6,
        uSamples: 96,
        vSamples: 96,
        curves: 9,
      },
      rays: { ...base.rays, azimuth: 0, elevation: -70, length: 2.4 },
    },
  },
  {
    name: "A spherical bowl's cusped caustic",
    detail:
      "A sphere folds parallel light into a nephroid sheet and a line on its axis",
    config: {
      ...base,
      format: "rays",
      surface: {
        ...base.surface,
        kind: "ellipsoid",
        a: 1.5,
        b: 1.5,
        c: 1.5,
        reverse: true,
        // The far quarter of a sphere, below 70° from its lowest point, so
        // the caustic's cusped profile shows at the cut.
        uMin: Math.PI,
        uMax: 2 * Math.PI,
        vMin: -Math.PI / 2,
        vMax: -Math.PI / 9,
        uSamples: 96,
        vSamples: 48,
        curves: 12,
      },
      rays: { ...base.rays, length: 1.4 },
    },
  },
  {
    name: "An ellipsoid refocusing its lamp",
    detail: "Light from one focus of a spheroid meets again at the other",
    config: {
      ...base,
      format: "rays",
      surface: {
        ...base.surface,
        kind: "ellipsoid",
        a: 1.25,
        b: 0.75,
        c: 0.75,
        reverse: true,
        // The far half, open towards the default view.
        uMin: Math.PI,
        uMax: 2 * Math.PI,
        vMin: -Math.PI / 2,
        vMax: Math.PI / 2,
        uSamples: 72,
        vSamples: 48,
        curves: 9,
      },
      rays: {
        ...base.rays,
        light: "point",
        source: { x: -1, y: 0, z: 0 },
        length: 0.8,
      },
    },
  },
  {
    name: "A cup's nephroid",
    detail: "Slanting light inside a cylinder folds along a sheet of nephroids",
    config: {
      ...base,
      format: "rays",
      surface: {
        ...base.surface,
        kind: "cylinder",
        a: 1.5,
        b: 1.5,
        c: 0,
        reverse: true,
        uMin: Math.PI,
        uMax: 2 * Math.PI,
        vMin: -0.5,
        vMax: 0.5,
        uSamples: 120,
        vSamples: 12,
        curves: 13,
      },
      rays: { ...base.rays, azimuth: -90, elevation: -25, length: 1.5 },
    },
  },
  {
    name: "A glass ellipsoid focusing a beam",
    detail:
      "An ellipsoid of eccentricity 1/n refracts a parallel beam exactly through its far focus",
    config: {
      ...base,
      format: "rays",
      surface: {
        ...base.surface,
        kind: "ellipsoid",
        // Semi-axes c√(1 − 1/n²) across and c along the axis, n = 1.5: the
        // far focus is c/n below the centre.
        a: 1.5 * Math.sqrt(5 / 9),
        b: 1.5 * Math.sqrt(5 / 9),
        c: 1.5,
        // The far half of the upper cap, open towards the default view.
        uMin: Math.PI,
        uMax: 2 * Math.PI,
        vMin: 0.1,
        vMax: Math.PI / 2,
        uSamples: 72,
        vSamples: 36,
        curves: 9,
      },
      rays: { ...base.rays, interaction: "refract", length: 2.9 },
    },
  },
  {
    name: "A glass dome's ring of light",
    detail:
      "A spherical cap focuses its rim short of its centre; a plane across the caustic catches a bright ring",
    config: {
      ...base,
      format: "rays",
      surface: {
        ...base.surface,
        kind: "ellipsoid",
        a: 1.5,
        b: 1.5,
        c: 1.5,
        // A cap 55° about the pole.
        uMin: 0,
        uMax: 2 * Math.PI,
        vMin: 0.6,
        vMax: Math.PI / 2,
        uSamples: 120,
        vSamples: 60,
        curves: 9,
      },
      rays: {
        ...base.rays,
        interaction: "refract",
        length: 3.2,
        // Between the rim's focus and the paraxial focus, 3 below the
        // pole: the tangential caustic crosses it in a ring.
        receiver: { plane: "z", at: -1.9, c1: 0, c2: 0, size: 0.5, bins: 100 },
      },
    },
  },
  {
    name: "A lamp in water over air",
    detail:
      "Only a cone of the lamp's light escapes the water; the rest is totally reflected, and what escapes seems to leave a smeared virtual lamp",
    config: {
      ...base,
      format: "rays",
      surface: {
        ...base.surface,
        // The plane z = 0, water (n₁ = 1.33) above, where its normal points,
        // and air (n₂ = 1) beneath.
        kind: "paraboloid",
        a: 0,
        b: 0,
        c: 0,
        uMin: -1.8,
        uMax: 1.8,
        vMin: -1.8,
        vMax: 1.8,
        uSamples: 96,
        vSamples: 96,
        curves: 9,
      },
      rays: {
        ...base.rays,
        interaction: "refract",
        n1: 1.33,
        n2: 1,
        light: "point",
        source: { x: 0, y: 0, z: 1 },
        length: 1.2,
      },
    },
  },
  {
    name: "A cup's nephroid on its floor",
    detail:
      "The light a cup's wall reflects gathers on the floor in a bright cusped curve",
    config: {
      ...base,
      format: "rays",
      surface: {
        ...base.surface,
        kind: "cylinder",
        a: 1.5,
        b: 1.5,
        c: 0,
        reverse: true,
        uMin: Math.PI,
        uMax: 2 * Math.PI,
        vMin: -0.5,
        vMax: 0.5,
        uSamples: 120,
        vSamples: 12,
        curves: 13,
      },
      rays: {
        ...base.rays,
        azimuth: -90,
        elevation: -25,
        length: 1.5,
        receiver: { plane: "z", at: -0.5, c1: 0, c2: 0, size: 3.2, bins: 160 },
      },
    },
  },
  {
    name: "A sphere and its latitudes",
    detail:
      "The level set x² + y² + z² = 1, meshed on a grid, cut by seven parallel planes in circles of latitude",
    config: {
      ...base,
      format: "implicit",
      implicit: {
        ...base.implicit,
        sections: {
          normal: { x: 0, y: 0, z: 1 },
          from: -0.9,
          to: 0.9,
          count: 7,
        },
      },
    },
  },
  {
    name: "The spiric sections of Perseus",
    detail:
      "Planes parallel to a torus's axis cut it in two circles, two ovals, a lemniscate of Bernoulli, a peanut and an oval",
    config: {
      ...base,
      format: "implicit",
      // A torus of radii R = a = 1 and r = 0.5 (c = r²). The plane x = d
      // touches its inner equator at d = R − r, where, since R = 2r, the
      // section is Bernoulli's lemniscate; it misses the torus past 1.5.
      implicit: {
        f: "(sqrt(x^2 + y^2) - a)^2 + z^2",
        a: 1,
        level: 0.25,
        box: {
          xMin: -1.6,
          xMax: 1.6,
          yMin: -1.6,
          yMax: 1.6,
          zMin: -0.6,
          zMax: 0.6,
        },
        cells: 64,
        refine: 0,
        sections: {
          normal: { x: 1, y: 0, z: 0 },
          from: 0,
          to: 1.25,
          count: 6,
        },
      },
    },
  },
  {
    name: "Villarceau circles",
    detail:
      "A plane tangent to a torus at two points cuts it in two circles, each as wide as the torus's core",
    config: {
      ...base,
      format: "implicit",
      // The bitangent plane through the centre, tilted by asin(r/R) = 30°:
      // two circles of radius R = 1 about (0, ±r, 0).
      implicit: {
        f: "(sqrt(x^2 + y^2) - a)^2 + z^2",
        a: 1,
        level: 0.25,
        box: {
          xMin: -1.6,
          xMax: 1.6,
          yMin: -1.6,
          yMax: 1.6,
          zMin: -0.6,
          zMax: 0.6,
        },
        cells: 64,
        refine: 0,
        sections: {
          normal: { x: -0.5, y: 0, z: Math.sqrt(3) / 2 },
          from: 0,
          to: 0,
          count: 1,
        },
      },
    },
  },
  {
    name: "Two drops meeting",
    detail:
      "Points whose distances to two foci multiply to a constant: two drops that join through a saddle as the constant grows",
    config: {
      ...base,
      format: "implicit",
      // Foci at (±a, 0, 0); the drops touch at the origin when c = a⁴, and
      // the plane z = 0 cuts them in Cassini ovals.
      implicit: {
        f: "((x - a)^2 + y^2 + z^2) * ((x + a)^2 + y^2 + z^2)",
        a: 1,
        level: 0.9,
        // Wide enough for the joined drop up to c = 1.4, which reaches
        // |x| ≈ 1.48 and |y|, |z| ≈ 0.59.
        box: {
          xMin: -1.6,
          xMax: 1.6,
          yMin: -0.8,
          yMax: 0.8,
          zMin: -0.8,
          zMax: 0.8,
        },
        cells: 64,
        refine: 0,
        sections: {
          normal: { x: 0, y: 0, z: 1 },
          from: 0,
          to: 0.4,
          count: 3,
        },
      },
    },
  },
  {
    name: "A double torus",
    detail:
      "A thickened figure eight: a closed surface of genus two, cut through its middle to show both holes",
    config: {
      ...base,
      format: "implicit",
      // Points within √c of the lemniscate (x² + y²)² = x² − y², in the
      // sense of G² + z² = c.
      implicit: {
        f: "((x^2 + y^2)^2 - x^2 + y^2)^2 + z^2",
        a: 1,
        level: 0.02,
        box: {
          xMin: -1.3,
          xMax: 1.3,
          yMin: -0.7,
          yMax: 0.7,
          zMin: -0.3,
          zMax: 0.3,
        },
        cells: 96,
        refine: 0,
        sections: {
          normal: { x: 0, y: 0, z: 1 },
          from: 0,
          to: 0,
          count: 1,
        },
      },
    },
  },
  {
    name: "The tanglecube",
    detail:
      "x⁴ − 5x² + y⁴ − 5y² + z⁴ − 5z² = −11.8: a closed cage of genus five, cut by planes across its diagonal",
    config: {
      ...base,
      format: "implicit",
      // Each term has minimum −6.25; the eight drops around the minima join
      // along the cube's twelve edges once c passes −12.5, so genus 12 − 8 + 1.
      implicit: {
        f: "x^4 - 5*x^2 + y^4 - 5*y^2 + z^4 - 5*z^2",
        a: 1,
        level: -11.8,
        box: {
          xMin: -2.6,
          xMax: 2.6,
          yMin: -2.6,
          yMax: 2.6,
          zMin: -2.6,
          zMax: 2.6,
        },
        cells: 48,
        refine: 0,
        sections: {
          normal: { x: 1, y: 1, z: 1 },
          from: -2,
          to: 2,
          count: 5,
        },
      },
    },
  },
  {
    name: "A gyroid, cut open",
    detail:
      "sin x cos y + sin y cos z + sin z cos x = 0 over one period: a surface that fills space, cut open by its box and by a diagonal plane",
    config: {
      ...base,
      format: "implicit",
      implicit: {
        f: "sin(x)*cos(y) + sin(y)*cos(z) + sin(z)*cos(x)",
        a: 1,
        level: 0,
        box: {
          xMin: -Math.PI,
          xMax: Math.PI,
          yMin: -Math.PI,
          yMax: Math.PI,
          zMin: -Math.PI,
          zMax: Math.PI,
        },
        cells: 48,
        refine: 0,
        sections: {
          normal: { x: 1, y: 1, z: 1 },
          from: 0,
          to: 0,
          count: 1,
        },
      },
    },
  },
  {
    name: "A thread between two drops",
    detail:
      "Just past c = 1 the Cassini drops join by a waist thinner than a cell: the grid alone sees two drops, and refinement finds the thread",
    config: {
      ...base,
      format: "implicit",
      // The waist has radius √(√c − 1) ≈ 0.07, and no point of the 20-cell
      // grid, whose box is set off the axes, lies inside it. The section at
      // x = 0 finds it on its own finer grid.
      implicit: {
        f: "((x - a)^2 + y^2 + z^2) * ((x + a)^2 + y^2 + z^2)",
        a: 1,
        level: 1.01,
        box: {
          xMin: -1.75,
          xMax: 1.85,
          yMin: -1.18,
          yMax: 1.22,
          zMin: -1.19,
          zMax: 1.21,
        },
        cells: 20,
        refine: 3,
        sections: {
          normal: { x: 1, y: 0, z: 0 },
          from: -0.6,
          to: 0.6,
          count: 3,
        },
      },
    },
  },
  {
    name: "An ellipsoid hiding its centers",
    detail:
      "The whole focal surface lies inside the shell; a cut plane opens the shell to show it",
    config: {
      ...base,
      format: "surface",
      surface: {
        ...base.surface,
        kind: "ellipsoid",
        // a² < 2c²: every center of curvature lies inside the ellipsoid,
        // within 0.61 of its quadratic form at the 96 × 96 grid. The whole
        // shell is drawn; the cut, not the domain, opens it.
        a: 1.2,
        b: 1,
        c: 0.9,
        uMin: 0,
        uMax: 2 * Math.PI,
        vMin: -Math.PI / 2,
        vMax: Math.PI / 2,
        uSamples: 96,
        vSamples: 96,
        curves: 12,
        reach: 0,
      },
    },
    // Through the center, slanting across the default view, so the section
    // shows as an ellipse: the shell's near right half is cut away, its
    // parameter curves left standing, and the focal sheets are whole.
    cut: {
      enabled: true,
      normal: { x: 0.66, y: 0.39, z: 0.64 },
      offset: 0,
      cuts: "surface",
      edge: true,
    },
  },
  {
    name: "A lamp sealed in an ellipsoid",
    detail:
      "The whole spheroidal mirror, cut open: every ray from one focus meets again at the other",
    config: {
      ...base,
      format: "rays",
      surface: {
        ...base.surface,
        kind: "ellipsoid",
        // Foci at x = ±√(a² − b²) = ±1.
        a: 1.25,
        b: 0.75,
        c: 0.75,
        reverse: true,
        uMin: 0,
        uMax: 2 * Math.PI,
        vMin: -Math.PI / 2,
        vMax: Math.PI / 2,
        uSamples: 72,
        vSamples: 48,
        curves: 9,
      },
      rays: {
        ...base.rays,
        light: "point",
        source: { x: -1, y: 0, z: 0 },
        length: 0.8,
      },
    },
    // Lengthwise through both foci, slanting towards the default view.
    cut: {
      enabled: true,
      normal: { x: 0.3, y: 0.5, z: 1 },
      offset: 0,
      cuts: "surface",
      edge: true,
    },
  },
  {
    name: "A Klein bottle passing through itself",
    detail:
      "Seen through, the neck turns back, pierces its own wall and opens into the body; drawn opaque, only the outside shows",
    config: {
      ...base,
      format: "implicit",
      implicit: {
        // The usual immersion of the Klein bottle (Stewart 1991, as given
        // by MathWorld), with x and y exchanged so that the default view
        // looks along the neck. It meets itself along a curve, where ∇F
        // vanishes.
        f: "(x^2 + y^2 + z^2 + 2*x - 1)*((x^2 + y^2 + z^2 - 2*x - 1)^2 - 8*z^2) + 16*y*z*(x^2 + y^2 + z^2 - 2*x - 1)",
        a: 1,
        level: 0,
        // The surface spans x ∈ [−2.45, 3.05], y ∈ [−2.9, 2.9] and
        // z ∈ [−3.7, 3.7], so the box does not cut it.
        box: {
          xMin: -2.7,
          xMax: 3.3,
          yMin: -3.1,
          yMax: 3.1,
          zMin: -3.9,
          zMax: 3.9,
        },
        // One refinement level closes the slits along the self-intersection
        // as well as finer cells would, at about a third of their time.
        cells: 48,
        refine: 1,
        // Across the bottle's axis: where the neck is inside the body, a
        // plane meets both, one curve within the other.
        sections: {
          normal: { x: 1, y: 0, z: 0 },
          from: -2.1,
          to: 2.7,
          count: 9,
        },
      },
    },
    sight: { sheets: "through", opacity: 0.3, hidden: "dashed" },
  },
];
