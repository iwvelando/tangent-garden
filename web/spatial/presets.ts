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
  // Light falling straight down, or from a lamp above the origin.
  rays: {
    light: "parallel",
    azimuth: 0,
    elevation: -90,
    source: { x: 0, y: 0, z: 3 },
    length: 2,
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
];
