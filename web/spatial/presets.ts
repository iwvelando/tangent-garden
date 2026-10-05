import type { Pace, Repeat } from "../timing";
import type { Cut } from "./cut";
import type { Sight } from "./sight";
import type { CameraPath } from "./path";
import type { Ride } from "./ride";
import type { AnimationMode, CameraMode, Track } from "./animation";
import type { SpatialConfig } from "./types";
import { initialView, type Layers, type Projection } from "./scene";
import type { SpatialCamera } from "./link";
import { turnTo } from "../named-views";
import type { Probe, ProbeMotion } from "./probe";
const base: SpatialConfig = {
  format: "torus",
  construction: "developable",
  pole: { x: 1.5, y: 0, z: 1 },
  input: "base",
  unwinding: { anchor: 0, offset: 1 },
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
  adaptive: false,
  curve: {
    x: "(2.4+0.85*cos(3*t))*cos(2*t)",
    y: "(2.4+0.85*cos(3*t))*sin(2*t)",
    z: "0.85*sin(3*t)",
    min: 0,
    max: 2 * Math.PI,
    a: 1,
  },
};
// A helix six turns long about y, with a narrow tangent ribbon and every
// ruling the developable allows.
const stairwell: SpatialConfig = {
  ...base,
  format: "parametric",
  length: 0.9,
  lines: 240,
  samples: 1800,
  curve: {
    x: "2*cos(t)",
    y: "a*t/3",
    z: "2*sin(t)",
    a: 1,
    min: -6 * Math.PI,
    max: 6 * Math.PI,
  },
};
// A preset's camera path and duration (see path.ts). Without `animate` it
// is flown with the geometry fixed; with it, as the animation camera of
// that mode, moving the geometry by its tracks.
export type Flight = {
  path: CameraPath;
  duration: number;
  animate?: {
    mode: Exclude<AnimationMode, "orbit" | "path">;
    tracks?: Track[];
    // How the probe moves while parameters vary, when the preset turns it
    // on: it stays unless given.
    probe?: ProbeMotion;
  };
  // A ray to ride while light is traced, in place of flying the path.
  ride?: Ride;
  // The animation camera while the geometry moves, in place of flying the
  // path (whose views are then none).
  camera?: Exclude<CameraMode, "path" | "ride">;
  // How the duration is spent (see timing.ts): once and steady unless
  // given.
  repeat?: Repeat;
  pace?: Pace;
};
// A preset may open with its own cut (see cut.ts), its own sight (see
// sight.ts), its own camera path to fly (see Flight), and its own
// projection and manual view (see scene.ts), its own layers, and its own
// probe (see probe.ts); choosing one without turns them off, orthographic
// from the default view with every layer shown, but keeps the probe on or
// off.
export const spatialPresets: {
  name: string;
  detail: string;
  config: SpatialConfig;
  cut?: Cut;
  sight?: Sight;
  flight?: Flight;
  projection?: Projection;
  view?: SpatialCamera;
  // Only the layers it hides, or shows against the default.
  layers?: Partial<Layers>;
  // A preset may open with the probe on at its own point; one without
  // keeps the probe as it was, returning it to the middle of the curve.
  probe?: Probe;
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
    sight: {
      sheets: "through",
      opacity: 0.3,
      hidden: "dashed",
      weight: "regular",
    },
  },
  {
    name: "Viviani's curve, from every side",
    detail:
      "One curve on a sphere: end-on a circle, side-on a figure-eight, from above a parabola traced twice; then around the point where it crosses itself",
    config: {
      ...base,
      format: "parametric",
      construction: "canal",
      lines: 48,
      canal: { radius: 0.12, profile: "1", meridians: 0 },
      // Viviani's curve (1692): where the sphere x² + y² + z² = 4a² meets
      // the cylinder (x − a)² + y² = a², which touches it inside at
      // (2a, 0, 0). There the curve crosses itself at right angles. Seen
      // along z it is the cylinder's circle; along x, the figure-eight
      // (a lemniscate of Gerono) y² = z²(1 − (z / 2a)²); along y, the
      // parabola x = 2a − z² / 2a, traced there and back.
      curve: {
        x: "a*(1+cos(t))",
        y: "a*sin(t)",
        z: "2*a*sin(t/2)",
        a: 1.5,
        min: -2 * Math.PI,
        max: 2 * Math.PI,
      },
    },
    // The camera's turntable axis is y, so the circle and the figure-eight
    // are seen exactly, level; the parabola needs a view straight down,
    // which the camera stops 4° short of. The crossing at (3, 0, 0) lies on
    // the plane through the study's center (1.5, 0, 0) facing a camera at
    // yaw 0, so panned to the middle there, the camera turns about it.
    flight: {
      duration: 30,
      path: {
        style: "smooth",
        keys: [
          {
            name: "Oblique",
            yaw: 0.6,
            pitch: 0.45,
            zoom: 1.1,
            panX: 0,
            panY: 0,
            turns: 0,
          },
          {
            name: "End-on: a circle",
            yaw: 0,
            pitch: 0,
            zoom: 1.6,
            panX: 0,
            panY: 0,
            turns: 0,
          },
          {
            name: "Side-on: a figure-eight",
            yaw: Math.PI / 2,
            pitch: 0,
            zoom: 1.3,
            panX: 0,
            panY: 0,
            turns: 0,
          },
          {
            name: "Nearly above: a parabola, twice",
            yaw: Math.PI / 2,
            pitch: 1.5,
            zoom: 1.3,
            panX: 0,
            panY: 0,
            turns: 0,
          },
          {
            name: "The crossing",
            yaw: 0,
            pitch: 0.35,
            zoom: 3,
            panX: -1.5,
            panY: 0,
            turns: 0,
          },
          {
            name: "Around the crossing",
            yaw: 0,
            pitch: 0.35,
            zoom: 3,
            panX: -1.5,
            panY: 0,
            turns: 1,
          },
          {
            name: "Oblique again",
            yaw: 0.6,
            pitch: 0.45,
            zoom: 1.1,
            panX: 0,
            panY: 0,
            turns: 0,
          },
        ],
      },
    },
  },
  // Constructions built on a derived curve. A curve through its own pole
  // has a tangent-foot curve with a cusp there (the foot of a perpendicular
  // onto a tangent through the pole is the pole itself, and it stops): on
  // this saddle loop (a closed harmonic curve, so its ends meet at the
  // pole), a cardioid lifted into space, unwound by a family of strings
  // that stop at the cusp from either side.
  {
    name: "Filaments off a cusp",
    detail:
      "The pole sits on the curve, so its perpendicular feet stop in a cusp",
    config: {
      ...base,
      format: "harmonic",
      construction: "involute",
      input: "tangent-foot",
      pole: { x: -1, y: 0, z: 0 },
      harmonic: {
        center: { x: 0, y: 0, z: 0 },
        terms: [
          {
            frequency: 1,
            cosine: { x: 1, y: 0, z: 0 },
            sine: { x: 0, y: 1, z: 0 },
          },
          {
            frequency: 2,
            cosine: { x: 0, y: 0, z: 0 },
            sine: { x: 0, y: 0, z: 0.35 },
          },
        ],
        min: -Math.PI,
        max: Math.PI,
      },
      involute: {
        anchor: 0,
        offset: 0,
        family: { enabled: true, from: -4, to: 4, count: 9 },
      },
      samples: 1200,
      lines: 48,
    },
  },
  // The helix's tangent-foot curve from a point on its axis: the feet lean
  // outward as the tangent climbs, H = r − (b²t/w²)W, so a tube around them
  // flares like a horn while the helix itself stays inside.
  {
    name: "A horn of perpendicular feet",
    detail:
      "A tube around the helix's tangent-foot curve, flaring as it climbs",
    config: {
      ...base,
      format: "parametric",
      construction: "canal",
      input: "tangent-foot",
      pole: { x: 0, y: 0, z: 0 },
      curve: {
        x: "2*cos(t)",
        y: "2*sin(t)",
        z: "t/2",
        min: -4 * Math.PI,
        max: 4 * Math.PI,
        a: 1,
      },
      canal: { radius: 0.22, profile: "1", meridians: 4 },
      samples: 1200,
      lines: 64,
    },
  },
  // Reflect the knot's center in every tangent line of the cinquefoil, then
  // string chords one radian ahead along that reflected curve.
  {
    name: "Chords across a knot's reflection",
    detail: "Chords strung along the cinquefoil's orthotomic from its center",
    config: {
      ...base,
      construction: "ruled",
      input: "orthotomic",
      q: 5,
      pole: { x: 0, y: 0, z: 0 },
    },
  },
  // Constructions built on an involute. A string unwound from the helix
  // (cos t, t, sin t) runs back along each tangent and drops exactly as far
  // as it is long times the climb per unit length, so every string from
  // t₀ = 0 with c = 0 ends on the floor y = 0: the helix's involute is a
  // circle's involute lying flat, threaded here with a thin tube.
  {
    name: "Where a helix's tangents land",
    detail: "Every string unwound from the helix ends on one flat spiral",
    config: {
      ...base,
      format: "parametric",
      construction: "canal",
      input: "involute",
      unwinding: { anchor: 0, offset: 0 },
      curve: {
        x: "cos(t)",
        y: "t",
        z: "sin(t)",
        min: 0,
        max: 2 * Math.PI,
        a: 1,
      },
      canal: { radius: 0.06, profile: "1", meridians: 4 },
      samples: 1200,
      lines: 48,
    },
  },
  // The whole trefoil unwound from t₀ = 0: the string grows to the knot's
  // full length, so its involute spirals out around the knot, and the tube
  // follows it.
  {
    name: "A trefoil's string, unwound",
    detail: "A tube around the involute of the whole knot, spiraling outward",
    config: {
      ...base,
      construction: "canal",
      input: "involute",
      unwinding: { anchor: 0, offset: 0 },
      canal: { radius: 0.3, profile: "1", meridians: 4 },
      samples: 1200,
      lines: 48,
    },
  },
  // Viviani's curve, where a cylinder meets a sphere, unwound both ways from
  // t₀ = 2π. An involute's tangent is the base's principal normal, so the
  // tangent developable built on it is ruled along Viviani's normals, with
  // a cusp at the anchor where the string vanishes.
  {
    name: "A sheet of Viviani's normals",
    detail: "A developable on an involute, ruled along the curve's normals",
    config: {
      ...base,
      format: "parametric",
      construction: "developable",
      length: 1,
      input: "involute",
      unwinding: { anchor: 2 * Math.PI, offset: 0 },
      curve: {
        x: "1+cos(t)",
        y: "sin(t)",
        z: "2*sin(t/2)",
        min: 0,
        max: 4 * Math.PI,
        a: 1,
      },
      samples: 1200,
      lines: 48,
    },
  },
  // A helix x = R cos t, y = ht, z = R sin t, with speed v = √(R² + h²),
  // unwound from t₀ = 0. Its tangent rises at the constant slope h/v and
  // the string runs out at the cusp, s = c, so every point of the involute
  // I_c = r + (c − s)T lies at the cusp's height y = hc/v: the involute is
  // level, the involute of the circle below it. As c runs from −πv to πv
  // its plane climbs the helix from end to end. A level camera sees it
  // edge-on, a line, from every side; the camera turns at that level, then
  // rises to look down on the circle's involute. The turntable's axis is y,
  // the helix's axis, so the edge-on views are exact; the view from above
  // stops 4° short of straight down. Every view frames the axis, panned
  // from the study's center (2.51, 0, 2.51), drawn with c = −πv.
  {
    name: "A helix's string, always level",
    detail:
      "As the string lengthens, its involute climbs the helix in a level plane: edge-on a line from every side, from above a circle's involute",
    config: {
      ...base,
      format: "parametric",
      construction: "involute",
      involute: {
        anchor: 0,
        offset: -Math.PI * Math.sqrt(2.81),
        family: { enabled: false, from: -2, to: 2, count: 5 },
      },
      lines: 40,
      samples: 900,
      curve: {
        x: "1.6*cos(t)",
        y: "a*t/2",
        z: "1.6*sin(t)",
        a: 1,
        min: -Math.PI,
        max: Math.PI,
      },
    },
    flight: {
      duration: 24,
      animate: {
        mode: "parameters",
        tracks: [
          { target: "offset", from: "-pi*sqrt(2.81)", to: "pi*sqrt(2.81)" },
        ],
      },
      path: {
        style: "smooth",
        keys: [
          {
            name: "Edge-on: a level line",
            yaw: 0,
            pitch: 0,
            zoom: 1.4,
            panX: 2.51,
            panY: 0,
            turns: 0,
          },
          {
            name: "Still level from another side",
            yaw: 2.2,
            pitch: 0,
            zoom: 1.4,
            panX: 0.55,
            panY: 0,
            turns: 0,
          },
          {
            name: "From above: a circle's involute",
            yaw: 2.2,
            pitch: 1.5,
            zoom: 1,
            panX: 0.55,
            panY: 3.5,
            turns: 0,
          },
          {
            name: "Oblique",
            yaw: 3,
            pitch: 0.5,
            zoom: 1.1,
            panX: -2.13,
            panY: 1.36,
            turns: 0,
          },
        ],
      },
    },
  },
  // A trough: half a circular cylinder of radius R = 1.5 about z, lit
  // straight down. Every section across the axis is a semicircular mirror
  // under parallel light, so the caustic sheet is a nephroid extruded along
  // the trough, and end-on (along z, the level camera at yaw 0) it is
  // exactly the nephroid, its cusp at the paraxial focus R/2 above the
  // lowest line. The cylinder's other focal branch, along its straight
  // rulings, is at infinity. Traced, light reaches the caustic first near
  // the rims, where it reflects soonest, and last at the cusp. The flight
  // falls into the trough with the light, holds end-on while the nephroid
  // closes, and ends looking down onto the cusp line as the last light
  // arrives. Pans
  // frame the cusp line's middle (0, −0.75, 0) from the study's center
  // (0, −0.944, 0).
  {
    name: "Following light into a trough",
    detail:
      "Light falls into a half-cylinder and folds into a nephroid sheet; the camera follows it in and ends beside the cusp as the last rays arrive",
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
        vMin: -1.2,
        vMax: 1.2,
        uSamples: 120,
        vSamples: 16,
        curves: 13,
      },
      rays: { ...base.rays, azimuth: -90, elevation: 0, length: 1.5 },
    },
    flight: {
      duration: 24,
      animate: { mode: "trace" },
      path: {
        style: "smooth",
        keys: [
          {
            name: "Over the trough",
            yaw: 0.7,
            pitch: 0.45,
            zoom: 1,
            panX: 0,
            panY: 0,
            turns: 0,
          },
          {
            name: "End-on: light falling",
            yaw: 0,
            pitch: 0,
            zoom: 1.4,
            panX: 0,
            panY: 0,
            turns: 0,
          },
          {
            name: "End-on: the nephroid closing",
            yaw: 0,
            pitch: 0,
            zoom: 1.4,
            panX: 0,
            panY: 0,
            turns: 0,
          },
          {
            name: "Down onto the cusp",
            yaw: 0.5,
            pitch: 0.8,
            zoom: 2.6,
            panX: 0,
            panY: -0.14,
            turns: 0,
          },
        ],
      },
    },
  },
  // The coma of the tilted beam above, ridden. Light 20° off the
  // paraboloid's axis meets it at u = 0.8, v = 0, in the plane of the tilt
  // (sample (72, 48), a crossing of its curves), and reflects through its
  // two caustic points, where the ray touches each caustic sheet. The camera
  // falls with the light, turns over the mirror and passes both points,
  // about 1.08 and 1.25 along. The rays are drawn 2 long, so with the
  // framing radius 4.36 the camera rests about 1.56 along, just past them.
  {
    name: "Riding a ray through coma",
    detail:
      "Fall with one ray of a tilted beam into a paraboloid, turn at the mirror, and pass through both of its caustic points",
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
      rays: { ...base.rays, azimuth: 0, elevation: -70, length: 2 },
    },
    flight: {
      duration: 20,
      animate: { mode: "trace" },
      path: { style: "steady", keys: [] },
      ride: { i: 72, j: 48, follow: 0.1, turn: 0.2 },
    },
  },
  // A harmonic trefoil carrying a small coil of frequency 233. At 240
  // samples a period each sample lands 7/240 of a turn behind the last on
  // the coil, so the even samples alias it into a slow, smooth seven-fold
  // wave that is not there. Refining between samples finds the coil. Twelve
  // vector sums keep the generating vectors from hiding it.
  {
    name: "A coil hidden between samples",
    detail: "A trefoil wound 233 times, unseen by its even samples",
    config: {
      ...base,
      format: "harmonic",
      construction: "none",
      samples: 240,
      lines: 12,
      adaptive: true,
      harmonic: {
        ...base.harmonic,
        terms: [
          ...base.harmonic.terms,
          {
            frequency: 233,
            cosine: { x: 0, y: 0, z: 0.12 },
            sine: { x: 0.12, y: 0, z: 0 },
          },
        ],
      },
    },
  },
  // Five petals that pass 0.2 to 0.29 above the center of inversion,
  // at t = π/10, 3π/10, π/2, 7π/10 and 9π/10. Each near miss at distance δ
  // throws out a loop about R²/δ across, which the even samples cut with a
  // few long chords and refining draws round.
  {
    name: "A rose that misses the center",
    detail: "Five near misses throw out five loops, drawn round",
    config: {
      ...base,
      format: "parametric",
      construction: "inversion",
      samples: 240,
      lines: 30,
      adaptive: true,
      inversion: {
        center: { x: 0, y: 0, z: 0 },
        radius: 0.6,
        input: "base",
      },
      curve: {
        x: "cos(5*t)*cos(t)",
        y: "cos(5*t)*sin(t)",
        z: "a*(1+0.8*sin(t))",
        a: 0.16,
        min: 0,
        max: Math.PI,
      },
    },
  },
  // The trefoil run on by a, c(t + a), carrying spheres of radius
  // R·ρ(t) = 0.26(1 + 0.85 sin 9t), fixed in t: nine swellings travel the
  // knot, changing shape with its speed. The envelope exists everywhere,
  // since |R′| ≤ 0.26 · 0.85 · 9 ≈ 2 is below the knot's least speed √13.
  // As a runs once around, 0 to 2π, every sphere returns to its place,
  // sample for sample, while the camera circles once through three views
  // and returns to the first: both motions close, so the animation loops.
  {
    name: "Beads running around a trefoil",
    detail:
      "Nine swellings travel the knot and come back to their places as the camera circles once: a seamless loop",
    config: {
      ...base,
      format: "parametric",
      construction: "canal",
      samples: 720,
      lines: 108,
      canal: { radius: 0.26, profile: "1+0.85*sin(9*t)", meridians: 0 },
      curve: {
        x: "(2+cos(3*(t+a)))*cos(2*(t+a))",
        y: "(2+cos(3*(t+a)))*sin(2*(t+a))",
        z: "sin(3*(t+a))",
        a: 0,
        min: 0,
        max: 2 * Math.PI,
      },
    },
    flight: {
      duration: 16,
      repeat: "loop",
      animate: {
        mode: "parameters",
        tracks: [{ target: "a", from: "0", to: "2*pi" }],
      },
      path: {
        style: "smooth",
        keys: [
          {
            name: "Above",
            yaw: 0.3,
            pitch: 0.75,
            zoom: 1.05,
            panX: 0,
            panY: 0,
            turns: 0,
          },
          {
            name: "Low, a third around",
            yaw: 2.4,
            pitch: 0.25,
            zoom: 1.25,
            panX: 0,
            panY: 0,
            turns: 0,
          },
          {
            name: "Two thirds around",
            yaw: 4.5 - 2 * Math.PI,
            pitch: 0.5,
            zoom: 1.1,
            panX: 0,
            panY: 0,
            turns: 0,
          },
          {
            name: "Above",
            yaw: 0.3,
            pitch: 0.75,
            zoom: 1.05,
            panX: 0,
            panY: 0,
            turns: 0,
          },
        ],
      },
    },
  },
  // Schwarz's P surface cos x + cos y + cos z = 0 sits at the middle of a
  // family of levels. Here the level is −1.6 cos a: at a = 0, caps around
  // the box's corners; at a = π/2 the P surface itself, a labyrinth of two
  // equal halves; at a = π a single drop at the center; then back. The
  // pieces pinch apart where the level passes ±1. cos(2π) rounds to exactly
  // 1, so the last frame is the first, bit for bit, and the animation loops.
  {
    name: "A Schwarz surface breathing",
    detail:
      "cos x + cos y + cos z = −1.6 cos a: corner caps open into Schwarz's labyrinth, close to a drop and return, looping",
    config: {
      ...base,
      format: "implicit",
      implicit: {
        f: "cos(x) + cos(y) + cos(z) + 1.6*cos(a)",
        a: 0,
        level: 0,
        box: {
          xMin: -Math.PI,
          xMax: Math.PI,
          yMin: -Math.PI,
          yMax: Math.PI,
          zMin: -Math.PI,
          zMax: Math.PI,
        },
        cells: 40,
        refine: 0,
        sections: {
          normal: { x: 0, y: 0, z: 1 },
          from: -2.4,
          to: 2.4,
          count: 5,
        },
      },
    },
    flight: {
      duration: 12,
      repeat: "loop",
      camera: "hold",
      animate: {
        mode: "parameters",
        tracks: [{ target: "implicitA", from: "0", to: "2*pi" }],
      },
      path: { style: "steady", keys: [] },
    },
  },
  // The gyroid of "A gyroid, cut open", without its section, and a cut
  // across the cube's diagonal. A peel starts with everything shown and
  // ends with everything hidden, so it cannot loop; back and forth plays
  // it out and back, easing at each end, so it repeats without a jump.
  {
    name: "A gyroid peeled and regrown",
    detail:
      "A diagonal cut peels the gyroid away and lets it grow back, easing at each end: back and forth repeats what cannot loop",
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
          count: 0,
        },
      },
    },
    cut: {
      enabled: true,
      normal: { x: 1, y: 1, z: 1 },
      offset: 0,
      cuts: "sheets",
      edge: true,
    },
    flight: {
      duration: 10,
      repeat: "back-and-forth",
      pace: "ease",
      camera: "hold",
      animate: { mode: "cut" },
      path: { style: "steady", keys: [] },
    },
  },
  // The tangent ribbon of a helix six turns long about y, the turntable's
  // own axis, seen from 4° short of straight down its axis. Orthographic, the
  // turns lie on one another as a single ring; through the wide lens each
  // turn is drawn smaller in proportion to its distance from the eye, so the
  // stair falls away to a vanishing point. Choose Orthographic to compare.
  {
    name: "A spiral stair, down its well",
    detail:
      "A helix's tangent ribbon through a wide lens: orthographic, one ring; in perspective, every turn falls away to a vanishing point",
    config: stairwell,
    projection: "wide",
    view: { yaw: 0.3, pitch: 1.5, zoom: 1.2, panX: 0, panY: 0 },
  },
  // The same stair through the normal lens, flown by a camera path. Zoom
  // moves a perspective camera's eye (scene.ts): from outside, over the top
  // and down inside the helix, then tilting to look across its inner wall,
  // the eye 2.11 from the middle and 0.77 from the axis, inside the turns of
  // radius 2; then back out.
  {
    name: "Diving down the stairwell",
    detail:
      "A camera path in perspective: zoom moves the eye, so the flight passes over the stair and down inside it, and back",
    config: stairwell,
    projection: "normal",
    view: { yaw: 0.3, pitch: 0.35, zoom: 0.9, panX: 0, panY: 0 },
    flight: {
      duration: 20,
      repeat: "back-and-forth",
      pace: "ease",
      path: {
        style: "smooth",
        keys: [
          {
            name: "Outside the stair",
            yaw: 0.3,
            pitch: 0.35,
            zoom: 0.9,
            panX: 0,
            panY: 0,
            turns: 0,
          },
          {
            name: "Over the top",
            yaw: 1.3,
            pitch: 1.5,
            zoom: 1.6,
            panX: 0,
            panY: 0,
            turns: 0,
          },
          {
            name: "Inside the top turns",
            yaw: 2.3,
            pitch: 1.5,
            zoom: 4.5,
            panX: 0,
            panY: 0,
            turns: 0,
          },
          {
            name: "Across the inner wall",
            yaw: 3.3,
            pitch: 1.2,
            zoom: 8,
            panX: 0,
            panY: 0,
            turns: 0,
          },
        ],
      },
    },
  },
  // The trefoil's tube with y as the knot's axis, seen through the wide lens
  // from inside its central hole: the eye is 1.16 radius / zoom = 1.46 from
  // the middle, inside the knot's least distance from its axis, 2.4 − 0.85.
  // A steady leg of one whole turn turns the camera about the axis, and its
  // last frame is its first, so it loops.
  {
    name: "Inside a trefoil's tube",
    detail:
      "A wide lens in the knot's central hole, turning once about its axis: the tube passes overhead, beside and far away",
    config: {
      ...base,
      format: "parametric",
      construction: "canal",
      lines: 48,
      canal: { radius: 0.32, profile: "1", meridians: 4 },
      curve: {
        x: "(2.4+0.85*cos(3*t))*cos(2*t)",
        y: "0.85*sin(3*t)",
        z: "(2.4+0.85*cos(3*t))*sin(2*t)",
        a: 1,
        min: 0,
        max: 2 * Math.PI,
      },
    },
    projection: "wide",
    view: { yaw: 1.2, pitch: 0.3, zoom: 3, panX: 0, panY: 0 },
    flight: {
      duration: 30,
      repeat: "loop",
      path: {
        style: "steady",
        keys: [
          {
            name: "In the hole",
            yaw: 1.2,
            pitch: 0.3,
            zoom: 3,
            panX: 0,
            panY: 0,
            turns: 0,
          },
          {
            name: "Once around",
            yaw: 1.2,
            pitch: 0.3,
            zoom: 3,
            panX: 0,
            panY: 0,
            turns: 1,
          },
        ],
      },
    },
  },
  // The probe while parameters vary. A helix (cos t, at, sin t) about the
  // drawing's vertical has κ = 1/(1 + a²) and τ = −a/(1 + a²) everywhere
  // (its hand reverses with a): as a runs from −0.35 to 0.35 its three
  // turns each way press flat into one circle, where the osculating circle
  // is the curve and τ = 0, and rise with the other hand. The probe stays
  // at t = 0.
  {
    name: "A helix pressed through its circle",
    detail:
      "The pitch reverses: the coils press into one circle, which the osculating circle becomes, as the torsion passes through zero",
    config: {
      ...base,
      format: "parametric",
      length: 0.9,
      curve: {
        x: "cos(t)",
        y: "a*t",
        z: "sin(t)",
        a: -0.35,
        min: -3 * Math.PI,
        max: 3 * Math.PI,
      },
    },
    probe: { enabled: true, position: 0.5, target: "curve", across: 0.5 },
    flight: {
      duration: 12,
      repeat: "back-and-forth",
      pace: "ease",
      camera: "hold",
      animate: {
        mode: "parameters",
        tracks: [{ target: "a", from: "-0.35", to: "0.35" }],
        probe: "stays",
      },
      path: { style: "steady", keys: [] },
    },
  },
  // (t, at², t³) at t = 0 has r′ = (1, 0, 0), r″ = (0, 2a, 0) and
  // r‴ = (0, 0, 6), so κ = 2|a| and τ = 3/a there: as the bend flattens the
  // torsion runs off to infinity while it falls to zero elsewhere, and at
  // a = 0 the curve is planar with an inflection where the probe stands,
  // flat, its frame undefined. N flips from +y to −y as a changes sign.
  {
    name: "A twisted cubic losing its bend",
    detail:
      "As the bend at its middle fades, the torsion there races off to infinity, the frame whips over, and at the turn it is flat",
    config: {
      ...base,
      format: "parametric",
      length: 0.7,
      curve: {
        x: "t",
        y: "a*t^2",
        z: "t^3",
        a: 1,
        min: -1,
        max: 1,
      },
    },
    probe: { enabled: true, position: 0.5, target: "curve", across: 0.5 },
    flight: {
      duration: 14,
      repeat: "back-and-forth",
      pace: "ease",
      camera: "hold",
      animate: {
        mode: "parameters",
        tracks: [{ target: "a", from: "1", to: "-1" }],
        probe: "stays",
      },
      path: { style: "steady", keys: [] },
    },
  },
  // The base trefoil's tube swells while the probe rides the knot from
  // start to end and back, its frame and circle reading each frame.
  {
    name: "A trefoil breathing under a moving probe",
    detail:
      "The tube radius swells while the probe rides the knot out and back, its frame and osculating circle reshaped as it goes",
    config: { ...base, tube: 0.5, length: 1.6 },
    probe: { enabled: true, position: 0, target: "curve", across: 0.5 },
    flight: {
      duration: 16,
      repeat: "back-and-forth",
      pace: "ease",
      camera: "hold",
      animate: {
        mode: "parameters",
        tracks: [{ target: "tube", from: "0.5", to: "1.3" }],
        probe: "along",
      },
      path: { style: "steady", keys: [] },
    },
  },
  // One trefoil, reparameterized: s = t + ½ sin t sin a is increasing in t
  // (ds/dt ≥ ½), fixes s at 0 and 2π, and returns at a = 2π, so the knot
  // never moves while its samples, and the rulings at them, flow along it.
  // Keeping its share of the length, the probe stays at one point of the
  // knot with steady κ and τ while its t wanders; it loops.
  {
    name: "A knot reparameterized in place",
    detail:
      "Only the parameterization moves: rulings flow along a fixed trefoil while the probe, held by its share of the length, stays put",
    config: {
      ...base,
      format: "parametric",
      length: 1.4,
      lines: 72,
      curve: {
        x: "sin(t+0.5*sin(t)*sin(a))+2*sin(2*(t+0.5*sin(t)*sin(a)))",
        y: "cos(t+0.5*sin(t)*sin(a))-2*cos(2*(t+0.5*sin(t)*sin(a)))",
        z: "-sin(3*(t+0.5*sin(t)*sin(a)))",
        a: 0,
        min: 0,
        max: 2 * Math.PI,
      },
    },
    probe: { enabled: true, position: 0.3, target: "curve", across: 0.5 },
    flight: {
      duration: 12,
      repeat: "loop",
      camera: "hold",
      animate: {
        mode: "parameters",
        tracks: [{ target: "a", from: "0", to: "2*pi" }],
        probe: "length",
      },
      path: { style: "steady", keys: [] },
    },
  },
  // Line weights (see sight.ts): studies whose many lines hairlines blur
  // into one tone or lose at export size. Each opens with the probe off, so
  // it draws as its picture whatever was chosen before.
  {
    name: "A cinquefoil strung to its center",
    detail:
      "Two hundred forty perpendiculars from the knot's tangent lines to one pole, a fan of fine strokes under the knot",
    config: {
      ...base,
      q: 5,
      tube: 0.7,
      construction: "tangent-foot",
      pole: { x: 0, y: 0, z: 0 },
      lines: 240,
    },
    sight: { sheets: "opaque", opacity: 0.35, hidden: "hide", weight: "fine" },
    probe: { enabled: false, position: 0.5, target: "curve", across: 0.5 },
  },
  {
    name: "An engraved trefoil tube",
    detail:
      "A hundred fifty contact circles in bold strokes, their far halves and the knot inside dashed through the tube",
    config: {
      ...base,
      construction: "canal",
      lines: 150,
      canal: { radius: 0.32, profile: "1", meridians: 8 },
    },
    sight: {
      sheets: "opaque",
      opacity: 0.35,
      hidden: "dashed",
      weight: "bold",
    },
    probe: { enabled: false, position: 0.5, target: "curve", across: 0.5 },
  },
  {
    name: "A helix unwound into a veil",
    detail:
      "Five involutes peeled off a rising helix by two hundred forty taut strings, heavier filaments over a fine veil",
    config: {
      ...base,
      format: "parametric",
      construction: "involute",
      involute: {
        anchor: 0,
        offset: 0,
        family: { enabled: true, from: -3, to: 3, count: 5 },
      },
      lines: 240,
      curve: {
        x: "2*cos(t)",
        y: "2*sin(t)",
        z: "0.6*t",
        a: 1,
        min: -2 * Math.PI,
        max: 2 * Math.PI,
      },
    },
    sight: { sheets: "opaque", opacity: 0.35, hidden: "hide", weight: "fine" },
    probe: { enabled: false, position: 0.5, target: "curve", across: 0.5 },
  },
  // A deltoid, (2 cos t + cos 2t, 2 sin t − sin 2t), lifted into a
  // three-cornered hat by z = 0.06 sin 3t + 0.6 cos 3t: its corners rise
  // to z = 0.6 and stay regular, since z′ = 0.18 there, but the tangent
  // turns through half a turn within a few samples of each. The free end of
  // every string swings round a half circle of radius |c − s| there, and
  // refining between samples draws each swing round. Four strings of 1 to 5
  // are unwound from t₀ = 1, on the brim between two corners.
  {
    name: "Strings swung round a three-cornered hat",
    detail:
      "Four involutes unwound from a lifted deltoid, each swinging a half circle round every sharp corner",
    config: {
      ...base,
      format: "parametric",
      construction: "involute",
      samples: 240,
      lines: 48,
      adaptive: true,
      involute: {
        anchor: 1,
        offset: 0,
        family: { enabled: true, from: 1, to: 5, count: 4 },
      },
      curve: {
        x: "2*cos(t)+cos(2*t)",
        y: "2*sin(t)-sin(2*t)",
        z: "0.06*sin(3*t)+0.6*cos(3*t)",
        a: 1,
        min: 0,
        max: 2 * Math.PI,
      },
    },
    view: { yaw: 0.5, pitch: 0.75, zoom: 1, panX: 0, panY: 0 },
  },
  // An astroid, (3 cos t + cos 3t, 3 sin t − sin 3t), lifted into a
  // four-cornered crown by z = 0.08 sin 4t + 0.5 cos 4t, regular at its
  // raised corners (z′ = 0.32). One string unwound from t₀ = 0.3 is
  // lengthened from −8 to 8 and back: its involute sweeps across the crown,
  // and at every corner its end swings a half circle, drawn round in every
  // frame.
  {
    name: "A string swept across a four-cornered crown",
    detail:
      "As the string lengthens, its involute sweeps across a lifted astroid, swinging round each raised corner",
    config: {
      ...base,
      format: "parametric",
      construction: "involute",
      samples: 240,
      lines: 40,
      adaptive: true,
      involute: {
        anchor: 0.3,
        offset: -8,
        family: { enabled: false, from: -8, to: 8, count: 5 },
      },
      curve: {
        x: "3*cos(t)+cos(3*t)",
        y: "3*sin(t)-sin(3*t)",
        z: "0.08*sin(4*t)+0.5*cos(4*t)",
        a: 1,
        min: 0,
        max: 2 * Math.PI,
      },
    },
    view: { yaw: 0.4, pitch: 0.8, zoom: 1, panX: 0, panY: 0 },
    flight: {
      duration: 16,
      repeat: "back-and-forth",
      pace: "ease",
      camera: "hold",
      animate: {
        mode: "parameters",
        tracks: [{ target: "offset", from: "-8", to: "8" }],
      },
      path: { style: "steady", keys: [] },
    },
  },
  // A Lissajous knot (Bogle, Hearst, Jones and Stoilov, 1994): each
  // coordinate a cosine of its own whole frequency, here 3, 2 and 7 with
  // phases 0.7, 0.2 and 0. Seen along each axis, as the Front, Side and Top
  // named views see it, it is a Lissajous figure: x against y at 3 : 2,
  // z against y at 7 : 2, and x against z at 3 : 7 (Top stops 4° short of
  // overhead, so that one is seen very slightly foreshortened). It opens
  // in the isometric view, at equal angles to all three.
  {
    name: "A Lissajous knot, seen from three sides",
    detail:
      "A tube on a 3 : 2 : 7 Lissajous knot; from the front, the side and the top, three Lissajous figures",
    config: {
      ...base,
      format: "parametric",
      construction: "canal",
      samples: 1200,
      lines: 36,
      canal: { radius: 0.1, profile: "1", meridians: 0 },
      curve: {
        x: "2*cos(3*t+0.7)",
        y: "2*cos(2*t+0.2)",
        z: "2*cos(7*t)",
        a: 1,
        min: 0,
        max: 2 * Math.PI,
      },
    },
    view: { ...turnTo(initialView, "isometric"), zoom: 1.1 },
  },
  // Six strands laid round the trefoil at a distance of 0.32, carried by
  // its rotation-minimizing frame, its return angle spread along the knot
  // so the rope closes. Each strand turns 40 times about the knot, about
  // six samples a turn; refining between samples draws every turn round.
  {
    name: "A six-stranded rope round a trefoil",
    detail:
      "Six strands twisted forty times about a carried frame, laid into a closed rope",
    config: {
      ...base,
      construction: "framed",
      samples: 240,
      lines: 24,
      adaptive: true,
      frame: {
        ...base.frame,
        twist: 40,
        width: 0,
        offset: 0.32,
        strands: 6,
        closure: "distribute",
      },
    },
  },
  // Four strands round a (2, 5) knot, each turning 36 times about it,
  // about seven samples a turn, swelling from 0.12 to 0.45 away from the
  // knot and back. The twist is a whole number of turns, so every strand
  // closes in every frame; refining between samples keeps every coil round
  // as it widens.
  {
    name: "Four strands wound round a cinquefoil",
    detail:
      "Offset strands coiled thirty-six times about the knot, swelling away from it and back",
    config: {
      ...base,
      construction: "framed",
      q: 5,
      tube: 0.6,
      samples: 240,
      lines: 24,
      adaptive: true,
      frame: {
        ...base.frame,
        twist: 36,
        width: 0,
        offset: 0.12,
        strands: 4,
        closure: "distribute",
      },
    },
    flight: {
      duration: 16,
      repeat: "back-and-forth",
      pace: "ease",
      camera: "hold",
      animate: {
        mode: "parameters",
        tracks: [{ target: "distance", from: "0.12", to: "0.45" }],
      },
      path: { style: "steady", keys: [] },
    },
  },
  // A screw band bent into a ring: straight treads join the core circle of
  // radius 2 to a partner thread that coils 24 times round it at a distance
  // of 0.7, so the band turns once per coil. Ten samples a coil; refining
  // between samples draws every coil of the thread round.
  {
    name: "A screw band coiled round a ring",
    detail:
      "Straight treads from a circle to a thread coiling twenty-four times round it",
    config: {
      ...base,
      format: "parametric",
      construction: "ruled",
      samples: 240,
      lines: 121,
      adaptive: true,
      curve: {
        x: "2*cos(t)",
        y: "2*sin(t)",
        z: "0",
        a: 1,
        min: 0,
        max: 2 * Math.PI,
      },
      ruled: {
        partner: "thread",
        thread: {
          x: "(2+0.7*cos(24*t))*cos(t)",
          y: "(2+0.7*cos(24*t))*sin(t)",
          z: "0.7*sin(24*t)",
        },
        rate: 1,
        shift: 0,
      },
    },
    view: { ...turnTo(initialView, "isometric"), zoom: 1.1 },
  },
  // The same kind of band with thirty coils, eight samples a coil. Its
  // treads reach ahead along the thread by the shift δ, from straight
  // spokes at δ = 0 to a whole coil ahead at δ = π/15, where each tread
  // sweeps a cone; the thread is the same in every frame, and refining
  // between samples keeps it round throughout.
  {
    name: "Treads folding into cones round a ring",
    detail:
      "A coiled thread's treads reaching one coil ahead along it and back",
    config: {
      ...base,
      format: "parametric",
      construction: "ruled",
      samples: 240,
      lines: 121,
      adaptive: true,
      curve: {
        x: "2*cos(t)",
        y: "2*sin(t)",
        z: "0",
        a: 1,
        min: 0,
        max: 2 * Math.PI,
      },
      ruled: {
        partner: "thread",
        thread: {
          x: "(2+0.6*cos(30*t))*cos(t)",
          y: "(2+0.6*cos(30*t))*sin(t)",
          z: "0.6*sin(30*t)",
        },
        rate: 1,
        shift: 0,
      },
    },
    view: { ...turnTo(initialView, "isometric"), zoom: 1.1 },
    flight: {
      duration: 12,
      repeat: "back-and-forth",
      pace: "ease",
      camera: "hold",
      animate: {
        mode: "parameters",
        tracks: [{ target: "shift", from: "0", to: "pi/15" }],
      },
      path: { style: "steady", keys: [] },
    },
  }, // A tube round the trefoil swelling into nine beads, R = 0.3(1 +
  // 0.35 sin 9t), with twelve meridians wound 30 times about the knot, the
  // frame's return angle spread along it so every stripe closes. About
  // eight samples a turn; refining between samples draws every stripe as a
  // smooth spiral over the beads.
  {
    name: "A beaded trefoil wound with spiral stripes",
    detail:
      "Twelve meridians wound thirty times about a tube that swells into nine beads",
    config: {
      ...base,
      construction: "canal",
      samples: 240,
      lines: 12,
      adaptive: true,
      canal: { radius: 0.3, profile: "1+0.35*sin(9*t)", meridians: 12 },
      frame: { ...base.frame, twist: 30, closure: "distribute" },
    },
  },
  // A tube of radius R = 0.3(1 + 0.2 sin 5t) round a helix that coils five
  // times about the vertical, about 51 long. Its six meridians twist 30
  // times along it, eight samples a turn, steep as a cord's strands, and
  // unwind until they follow the carried frame and back; the helix is
  // open, so every frame ends without a seam, and refining between samples
  // keeps each strand smooth.
  {
    name: "A cord twisted round a spring",
    detail:
      "Six meridians twisted thirty times along a tube coiled five times, unwinding and back",
    config: {
      ...base,
      format: "parametric",
      construction: "canal",
      samples: 240,
      lines: 12,
      adaptive: true,
      canal: { radius: 0.3, profile: "1+0.2*sin(5*t)", meridians: 6 },
      frame: { ...base.frame, reference: { x: 0, y: 1, z: 0 }, twist: 30 },
      curve: {
        x: "1.6*cos(t)",
        y: "0.3*t",
        z: "1.6*sin(t)",
        a: 1,
        min: -5 * Math.PI,
        max: 5 * Math.PI,
      },
    },
    view: { ...turnTo(initialView, "front"), pitch: 0.3, zoom: 1.1 },
    flight: {
      duration: 14,
      repeat: "back-and-forth",
      pace: "ease",
      camera: "hold",
      animate: {
        mode: "parameters",
        tracks: [{ target: "twist", from: "30", to: "0" }],
      },
      path: { style: "steady", keys: [] },
    },
  },
  // The ellipsoid of "The focal sheets of an ellipsoid", whole, with its
  // shell and parameter curves hidden so that both sheets show entire. The
  // ellipsoid's four umbilics, where κ₁ = κ₂, lie in its xz-plane, and
  // the two sheets meet at their centers; each sheet folds along cuspidal
  // edges in the planes of symmetry.
  {
    name: "The whole focal surface of an ellipsoid",
    detail:
      "Its shell hidden: two sheets of centers, meeting at the centers of its four umbilics",
    config: {
      ...base,
      format: "surface",
      surface: {
        ...base.surface,
        kind: "ellipsoid",
        a: 1.5,
        b: 1,
        c: 0.7,
        uMin: 0,
        uMax: 2 * Math.PI,
        vMin: -Math.PI / 2,
        vMax: Math.PI / 2,
        uSamples: 120,
        vSamples: 120,
        curves: 12,
        reach: 0,
      },
    },
    layers: { surface: false, curves: false },
  },
  // The (3, 4) torus knot's tube, drawn by its contact circles and
  // meridians alone. The distributed seam closes every meridian.
  {
    name: "A cage of rings round a (3, 4) knot",
    detail: "A tube's contact circles and meridians, its skin left off",
    config: {
      ...base,
      p: 3,
      q: 4,
      tube: 1.1,
      construction: "canal",
      lines: 120,
      canal: { radius: 0.3, profile: "1", meridians: 6 },
      frame: { ...base.frame, closure: "distribute" },
    },
    layers: { surface: false, frames: false },
  },
  // The Klein bottle of "A Klein bottle passing through itself", drawn by
  // its sections alone, across its axis and seen from the isometric side.
  // Where the neck has passed inside the body, a plane meets both, and one
  // curve lies within the other.
  {
    name: "A Klein bottle in twenty-four slices",
    detail:
      "Its sections alone: where the neck runs inside the body, one curve lies within another",
    config: {
      ...base,
      format: "implicit",
      implicit: {
        f: "(x^2 + y^2 + z^2 + 2*x - 1)*((x^2 + y^2 + z^2 - 2*x - 1)^2 - 8*z^2) + 16*y*z*(x^2 + y^2 + z^2 - 2*x - 1)",
        a: 1,
        level: 0,
        box: {
          xMin: -2.7,
          xMax: 3.3,
          yMin: -3.1,
          yMax: 3.1,
          zMin: -3.9,
          zMax: 3.9,
        },
        cells: 48,
        refine: 1,
        sections: {
          normal: { x: 1, y: 0, z: 0 },
          from: -2.3,
          to: 2.9,
          count: 24,
        },
      },
    },
    layers: { surface: false, planes: false, box: false },
    view: turnTo(initialView, "isometric"),
  },
];
