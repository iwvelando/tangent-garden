import type { Config } from "./types";
import type { PlanarAnimation } from "./planar-link";
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
    roulette: { roll: "inside", fixedRadius: 5, radius: 2, arm: 3, phase: 0 },
    lissajous: {
      amplitudeX: 1,
      amplitudeY: 1,
      frequencyX: 3,
      frequencyY: 2,
      phase: Math.PI / 2,
    },
    terms: [
      { frequency: 1, radius: 1, phase: 0 },
      { frequency: -4, radius: 0.45, phase: 0 },
      { frequency: 6, radius: 0.2, phase: 0 },
    ],
    // Seven equal-speed pursuers on the unit heptagon.
    pursuit: {
      pursuers: Array.from({ length: 7 }, (_, j) => ({
        x: Math.cos((2 * Math.PI * j) / 7),
        y: Math.sin((2 * Math.PI * j) / 7),
        speed: 1,
      })),
      capture: 0.001,
    },
    // The Van der Pol oscillator, with a as its damping μ: trajectories from
    // near the origin and from far out both wind onto its limit cycle.
    field: {
      x: "y",
      y: "a*(1-x^2)*y-x",
      seeds: [
        { x: 0.1, y: 0 },
        { x: 3, y: 3 },
      ],
      escape: 10,
    },
    // Cassini ovals about foci (±a, 0): points whose distances to the foci
    // multiply to b², for level b⁴. Level a⁴ is the lemniscate.
    implicit: {
      f: "((x-a)^2+y^2)*((x+a)^2+y^2)",
      level: 1,
      family: { enabled: true, from: 0.2, to: 2.6, count: 9 },
      window: { xMin: -2, xMax: 2, yMin: -1.5, yMax: 1.5 },
      cells: 160,
    },
    // The reference Clifford study: its iterates stay within 1 + |c| by
    // 1 + |d|, the window used when nothing is accumulated.
    attractor: {
      map: "clifford",
      a: -1.4,
      b: 1.6,
      c: 1,
      d: 0.7,
      start: { x: 0.1, y: 0.1 },
      discard: 1000,
      iterates: 800000,
      fit: true,
      window: { xMin: -2, xMax: 2, yMin: -1.7, yMax: 1.7 },
      cells: 600,
    },
  },
  source: { kind: "point", position: { x: 1, y: 0 }, angle: -90 },
  nIncident: 1.2,
  pole: { x: 0, y: 0 },
  nTransmitted: 1,
  offset: 0,
  distance: 0,
  stack: { enabled: false, from: -0.5, to: 0.5, count: 6 },
  circles: false,
  rolling: {
    side: "right",
    shape: "circle",
    radius: 0.5,
    arm: 0.5,
    phase: 0,
    // A small ellipse, tracing its focus.
    curve: {
      x: "0.3*cos(t)",
      y: "0.18*sin(t)",
      min: 0,
      max: 2 * Math.PI,
      start: 0,
    },
    point: { x: 0.24, y: 0 },
  },
  // Chords from angle t to angle a·t on the unit circle; circles breathe
  // with a lobes.
  envelope: {
    mode: "chord",
    angle: "2*t+pi/2",
    x: "cos(a*t)",
    y: "sin(a*t)",
    extend: false,
    radius: "1+0.35*sin(a*t)",
  },
  inversion: { center: { x: 0, y: 0 }, radius: 1 },
  input: "curve",
  samples: 1000,
  lines: 48,
};
// A preset may bring its own animation setup, such as a seamless loop;
// others leave the setup as it was and play once, steadily.
export const presets: {
  title: string;
  note: string;
  config: Config;
  animation?: PlanarAnimation;
}[] = [
  {
    title: "Ellipse & its evolute",
    note: "An ellipse's normals, gathered into four cusps",
    config: base,
  },
  {
    title: "Unwinding a circle",
    note: "A taut thread unwound from a circle",
    config: {
      ...base,
      kind: "involute",
      curve: { ...base.curve, x: "cos(t)", y: "sin(t)" },
      lines: 32,
    },
  },
  {
    title: "Light inside a circle",
    note: "A light on the rim, reflected into a cardioid",
    config: {
      ...base,
      kind: "catacaustic",
      curve: { ...base.curve, x: "cos(t)", y: "sin(t)" },
    },
  },
  {
    title: "Through a parabola",
    note: "A point of light, bent at a parabola",
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
    note: "Its evolute, the same cycloid again",
    config: {
      ...base,
      curve: { ...base.curve, x: "2*(t-sin(t))", y: "2*(1+cos(t))" },
    },
  },
  {
    title: "Three-cusped curve",
    note: "Its evolute, the same curve three times larger",
    config: {
      ...base,
      curve: { ...base.curve, x: "cos(t)+cos(2*t)/2", y: "sin(t)-sin(2*t)/2" },
    },
  },
  {
    title: "Spiral, unwound",
    note: "Its involute, the same spiral turned a quarter",
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
  {
    title: "Ellipse & its pedal",
    note: "A pole and its tangent projections",
    config: {
      ...base,
      kind: "pedal",
      curve: { ...base.curve, x: "2*cos(t)", y: "1.1*sin(t)" },
      pole: { x: 1.65, y: 0.3 },
      lines: 64,
    },
  },
  {
    title: "Ellipse & its contrapedal",
    note: "The center projected onto each normal",
    config: {
      ...base,
      kind: "contrapedal",
      curve: { ...base.curve, x: "2*cos(t)", y: "1.1*sin(t)" },
      pole: { x: 0, y: 0 },
      lines: 64,
    },
  },
  {
    title: "Ellipse & its orthotomic",
    note: "A focus reflected onto a circle",
    config: {
      ...base,
      kind: "orthotomic",
      // Foci at (±1, 0): reflecting one across every tangent lands on the
      // circle of radius 2a = 4 about the other.
      curve: { ...base.curve, x: "2*cos(t)", y: "sqrt(3)*sin(t)" },
      pole: { x: 1, y: 0 },
      lines: 64,
    },
  },
  {
    title: "Flower & its offset",
    note: "Every point moved along its normal",
    config: {
      ...base,
      kind: "offset",
      // The petal tips have radius of curvature about 0.245, so moving 0.4
      // inward folds each tip into a swallowtail with cusps on the evolute.
      curve: { ...base.curve, format: "polar", r: "1+0.18*cos(5*t)" },
      distance: 0.4,
      lines: 120,
    },
  },
  {
    title: "Flower & its offset stack",
    note: "Eighteen parallel curves, 0.105 apart",
    config: {
      ...base,
      kind: "offset",
      curve: { ...base.curve, format: "polar", r: "1+0.18*cos(5*t)" },
      // d = 0.105k for k = −9…8. The inner members fold at the petal tips
      // and the outer ones at the waists, where the curve is concave.
      stack: { enabled: true, from: -0.945, to: 0.84, count: 18 },
      lines: 60,
    },
  },
  {
    title: "Circles & their envelope",
    note: "Rolling a coin around an ellipse",
    config: {
      ...base,
      kind: "offset",
      curve: { ...base.curve, x: "2*cos(t)", y: "1.1*sin(t)" },
      // Radius 0.5 is below the least radius of curvature 1.1²/2 = 0.605, so
      // both envelope branches, the offsets ±0.5, stay smooth.
      stack: { enabled: true, from: -0.5, to: 0.5, count: 2 },
      circles: true,
    },
  },
  {
    title: "Hypotrochoid & its evolute",
    note: "A circle rolling inside a circle",
    config: {
      ...base,
      kind: "evolute",
      // The reference study: R=5, r=2, d=3 closes after two turns, t∈[0,4π].
      // Its evolute is a five-pointed star.
      curve: { ...base.curve, format: "roulette", min: 0, max: 4 * Math.PI },
      samples: 2000,
      lines: 40,
    },
  },
  {
    title: "Flower & a rolling circle",
    note: "A circle rolling inside a flower",
    config: {
      ...base,
      kind: "rolling",
      curve: { ...base.curve, format: "polar", r: "1+0.18*cos(5*t)" },
      // The flower's length is about 7.41469 = 10 · 2π · 0.11800838, so ten
      // turns of this rim point nearly complete one lap: its ten cusps touch
      // the petal tips and waists. The ratio is not forced to close.
      rolling: {
        ...base.rolling,
        side: "left",
        radius: 0.118,
        arm: 0.118,
        phase: 0,
      },
      samples: 2000,
      lines: 60,
    },
  },
  {
    title: "Ellipse rolling on an ellipse",
    note: "A focus, rolled around its twin",
    config: {
      ...base,
      kind: "rolling",
      curve: { ...base.curve, x: "2*cos(t)", y: "1.2*sin(t)" },
      // Congruent ellipses rolling from matching vertices stay mirror images
      // across the common tangent, so the rolling focus (1.6, 0) stays
      // 2a = 4 from the fixed far focus (−1.6, 0): it traces a circle.
      rolling: {
        ...base.rolling,
        side: "right",
        shape: "curve",
        curve: {
          x: "2*cos(t)",
          y: "1.2*sin(t)",
          min: 0,
          max: 2 * Math.PI,
          start: 0,
        },
        point: { x: 1.6, y: 0 },
      },
      samples: 2000,
      lines: 48,
    },
  },
  {
    title: "Ellipse rolling in a flower",
    note: "An ellipse's vertex, rolled inside a flower",
    config: {
      ...base,
      kind: "rolling",
      curve: { ...base.curve, format: "polar", r: "1+0.18*cos(5*t)" },
      // The ellipse's perimeter, 1.48294, is a fifth of the flower's length
      // 7.41469 to within 1e-6, so its vertex returns to the curve at each
      // petal tip: the five cusps close a star. Closure is not forced.
      rolling: {
        ...base.rolling,
        side: "left",
        shape: "curve",
        curve: {
          x: "0.3*cos(t)",
          y: "0.1616*sin(t)",
          min: 0,
          max: 2 * Math.PI,
          start: 0,
        },
        point: { x: 0.3, y: 0 },
      },
      samples: 2000,
      lines: 60,
    },
  },
  {
    title: "Chords & a cardioid",
    note: "Angle t joined to angle 2t",
    config: {
      ...base,
      kind: "envelope",
      // Each chord touches the cardioid (2e^{it} + e^{2it})/3 a third of
      // the way along. Animate a for the other multiplication tables.
      curve: { ...base.curve, x: "cos(t)", y: "sin(t)", a: 2 },
      samples: 2401,
      lines: 121,
    },
  },
  {
    title: "Chords of four",
    note: "Angle t joined to angle 4t, 200 chords",
    config: {
      ...base,
      kind: "envelope",
      // The reference study: 200 evenly spaced phases. The chords envelope
      // the three-cusped epicycloid (4e^{it} + e^{4it})/5.
      curve: { ...base.curve, x: "cos(t)", y: "sin(t)", a: 4 },
      samples: 2001,
      lines: 201,
    },
  },
  {
    title: "Folding a parabola",
    note: "Creases folding a point onto a line",
    config: {
      ...base,
      kind: "envelope",
      // Folding the focus (0, 1) onto the axis point (t, 0) creases along
      // the line through it perpendicular to (t, −1): direction atan(t).
      // The creases envelope the parabola x² = 4y.
      curve: {
        ...base.curve,
        format: "cartesian",
        y: "0",
        min: -4,
        max: 4,
      },
      envelope: { ...base.envelope, mode: "angle", angle: "atan(x)" },
      lines: 41,
    },
  },
  {
    title: "Circles through a focus",
    note: "Centered on a parabola, touching its directrix",
    config: {
      ...base,
      kind: "envelope",
      // Each circle centered on 4y = x² passes through the focus (0, 1) and
      // touches the directrix y = −1: the right branch is the directrix, the
      // left collapses to the focus.
      curve: { ...base.curve, x: "t", y: "t^2/4", min: -3, max: 3 },
      envelope: { ...base.envelope, mode: "circle", radius: "t^2/4+1" },
      samples: 1201,
      lines: 25,
    },
  },
  {
    title: "Breathing circles",
    note: "Radius 1 + 0.35 sin(at) around a circle",
    config: {
      ...base,
      kind: "envelope",
      // |R′| ≤ 0.35a stays below the center's speed 2 up to a = 40/7, so
      // both branches are real; animate a past it to open gaps.
      curve: { ...base.curve, x: "2*cos(t)", y: "2*sin(t)", a: 5 },
      envelope: { ...base.envelope, mode: "circle" },
      samples: 1801,
      lines: 61,
    },
  },
  {
    title: "Swelling circles",
    note: "A radius that outruns its center",
    config: {
      ...base,
      kind: "envelope",
      // Where |R′| = 1.2|cos t| exceeds the unit speed of the center, the
      // circles nest and the envelope has gaps; the branches meet at their
      // ends, where |R′| = 1.
      curve: {
        ...base.curve,
        format: "cartesian",
        y: "0",
        min: -2 * Math.PI,
        max: 2 * Math.PI,
      },
      envelope: { ...base.envelope, mode: "circle", radius: "1.6+1.2*sin(t)" },
      samples: 2001,
      lines: 41,
    },
  },
  {
    title: "Hyperbola into a lemniscate",
    note: "Inverted about its center",
    config: {
      ...base,
      kind: "inversion",
      // Both branches of x² − y² = 1. Where the hyperbola runs off to
      // infinity its image passes through O: Bernoulli's lemniscate, reaching
      // R² = 4 along the x-axis.
      curve: { ...base.curve, x: "1/cos(t)", y: "tan(t)" },
      inversion: { ...base.inversion, radius: 2 },
      samples: 1201,
      lines: 48,
    },
  },
  {
    title: "Hypotrochoid, turned inside out",
    note: "A roulette inverted about its center",
    config: {
      ...base,
      kind: "inversion",
      // The loops nearest the center become the outermost petals.
      curve: {
        ...base.curve,
        format: "roulette",
        min: 0,
        max: 4 * Math.PI,
        roulette: { ...base.curve.roulette, arm: 2.2 },
      },
      inversion: { ...base.inversion, radius: 2 },
      samples: 2000,
      lines: 60,
    },
  },
  {
    title: "An ellipse's pedal, inverted",
    note: "The polar reciprocal, an ellipse",
    config: {
      ...base,
      kind: "inversion",
      // Inverting a pedal about its pole in the unit circle gives the polar
      // reciprocal of the curve: here the ellipse 4x² + 1.21y² = 1.
      curve: { ...base.curve, x: "2*cos(t)", y: "1.1*sin(t)" },
      input: "pedal",
      lines: 48,
    },
  },
  {
    title: "Lissajous 3 : 2 & its pedal",
    note: "Two perpendicular oscillations",
    config: {
      ...base,
      kind: "pedal",
      // x = sin(3t + π/2), y = sin(2t) closes after t spans 2π; its pedal
      // about the center is a four-petalled flower.
      curve: { ...base.curve, format: "lissajous" },
      samples: 2000,
      lines: 48,
    },
  },
  {
    title: "Epicycles, turned inside out",
    note: "Three rotating circles, inverted",
    config: {
      ...base,
      kind: "inversion",
      // e^{it} + 0.45e^{−4it} + 0.2e^{6it}: every frequency is 1 more than a
      // multiple of 5, so the curve has five-fold symmetry. Its inverse in
      // the unit circle turns the star's arms into petals.
      curve: { ...base.curve, format: "fourier" },
      samples: 2000,
      lines: 40,
    },
  },
  {
    title: "Lissajous √2 : 1, never closing",
    note: "An incommensurate ratio and its pedal",
    config: {
      ...base,
      kind: "pedal",
      // The frequencies have no whole-number ratio, so the figure fills its
      // box without ever repeating, and so does its pedal about the center.
      curve: {
        ...base.curve,
        format: "lissajous",
        min: 0,
        max: 12 * Math.PI,
        lissajous: {
          ...base.curve.lissajous,
          frequencyX: Math.SQRT2,
          frequencyY: 1,
          phase: 0,
        },
      },
      // The pedal turns fast where the figure turns at the edges of its box.
      samples: 12000,
      lines: 40,
    },
  },
  {
    title: "Seven pursuers & an evolute",
    note: "Cyclic pursuit from a heptagon",
    config: {
      ...base,
      kind: "evolute",
      // Each pursuer runs at unit speed straight at the next, so the heptagon
      // turns and shrinks, r = 1 − t sin(π/7), and every path is the
      // logarithmic spiral r = exp(−tan(π/7)θ). Neighbors come within the
      // capture distance just before t = 1/sin(π/7) ≈ 2.3048. The evolute
      // of the first path is the same spiral scaled by tan(π/7).
      curve: { ...base.curve, format: "pursuit", min: 0, max: 2.31 },
      samples: 4000,
      lines: 40,
    },
  },
  {
    title: "Four chasers at unequal speeds",
    note: "The first capture ends the chase",
    config: {
      ...base,
      kind: "pedal",
      // From the corners of a square, the second pursuer runs a quarter
      // faster and the fourth a fifth slower. The square skews as it turns,
      // and the third catches the slow fourth at t ≈ 1.96, while the others
      // are still apart: the chase stops there. The pedal is of the first
      // pursuer's path about the square's center.
      curve: {
        ...base.curve,
        format: "pursuit",
        min: 0,
        max: 2,
        pursuit: {
          pursuers: [
            { x: 1, y: 1, speed: 1 },
            { x: -1, y: 1, speed: 1.25 },
            { x: -1, y: -1, speed: 1 },
            { x: 1, y: -1, speed: 0.8 },
          ],
          capture: 0.01,
        },
      },
      samples: 4000,
      lines: 36,
    },
  },
  {
    title: "Van der Pol limit cycle",
    note: "Two trajectories, one closed orbit",
    config: {
      ...base,
      kind: "offset",
      // ẋ = y, ẏ = a(1 − x²)y − x with damping a = 1. The origin repels and
      // far points fall inward, so a trajectory from near the origin and one
      // from far out both wind onto the same closed orbit, whose period is
      // about 6.66. Parallel curves on both sides of the first trajectory
      // wind on with it.
      stack: { enabled: true, from: -0.3, to: 0.3, count: 7 },
      curve: { ...base.curve, format: "field", min: 0, max: 30 },
      samples: 6000,
      lines: 40,
    },
  },
  {
    title: "Pendulum phase portrait",
    note: "Swings, a separatrix, and escapes",
    config: {
      ...base,
      kind: "evolute",
      // ẋ = y, ẏ = −sin x: angle and angular velocity of a pendulum. Seeds
      // below the separatrix, where the speed at the bottom is 2, swing back
      // and forth on closed orbits, the widest in a period of about 9.1;
      // those above it go over the top and keep turning, until they leave
      // the escape circle. The evolute is of the first swing.
      curve: {
        ...base.curve,
        format: "field",
        min: 0,
        max: 9.2,
        field: {
          x: "y",
          y: "-sin(x)",
          seeds: [
            { x: 0, y: 1.2 },
            { x: 0, y: 0.6 },
            { x: 0, y: 1.8 },
            { x: 0, y: 2.2 },
            { x: 0, y: -2.2 },
            { x: 0, y: 2.8 },
            { x: 0, y: -2.8 },
          ],
          escape: 7,
        },
      },
      samples: 6000,
      lines: 24,
    },
  },
  {
    title: "Cassini ovals & the lemniscate",
    note: "One level set, split and joined",
    config: {
      ...base,
      // The lemniscate b = a among ovals on both sides of it: two apiece
      // below, one above. The saddle at the origin is a grid point, so the
      // lemniscate's two loops meet there.
      curve: { ...base.curve, format: "implicit" },
    },
  },
  {
    title: "Circles through two points",
    note: "Level sets beside a pole",
    config: {
      ...base,
      // y/(x² + y² − a²) = c is the circle through (±a, 0) about
      // (0, 1/(2c)); c = 0 is the x-axis. F has a pole along the circle of
      // radius a, where it changes sign without passing through any level,
      // and is undefined at (±a, 0), where every circle meets.
      curve: {
        ...base.curve,
        format: "implicit",
        implicit: {
          f: "y/(x^2+y^2-a^2)",
          level: 1,
          family: { enabled: true, from: -2, to: 2, count: 9 },
          window: { xMin: -2.5, xMax: 2.5, yMin: -2, yMax: 2 },
          cells: 200,
        },
      },
      lines: 40,
    },
  },
  {
    title: "Clifford attractor",
    note: "The visits of 800,000 iterates",
    config: {
      ...base,
      // (a, b, c, d) = (−1.4, 1.6, 1, 0.7) from (0.1, 0.1): 1,000 iterates
      // discarded, the next 800,000 counted. An illustration of an iterated
      // map, not a proof of chaos.
      curve: { ...base.curve, format: "attractor" },
      lines: 40,
    },
  },
  {
    title: "De Jong attractor",
    note: "An iterated map of sines and cosines",
    config: {
      ...base,
      curve: {
        ...base.curve,
        format: "attractor",
        attractor: {
          ...base.curve.attractor,
          map: "dejong",
          a: 1.4,
          b: -2.3,
          c: 2.4,
          d: -2.1,
          window: { xMin: -2, xMax: 2, yMin: -2, yMax: 2 },
        },
      },
      lines: 40,
    },
  },
  {
    title: "Hénon map",
    note: "Folded layers of a quadratic map",
    config: {
      ...base,
      // Hénon's (a, b) = (1.4, 0.3) from the origin. Starts farther out,
      // such as (2, 0), leave any bound within a few iterates.
      curve: {
        ...base.curve,
        format: "attractor",
        attractor: {
          ...base.curve.attractor,
          map: "henon",
          a: 1.4,
          b: 0.3,
          c: 0,
          d: 0,
          start: { x: 0, y: 0 },
          discard: 100,
          iterates: 400000,
          window: { xMin: -1.5, xMax: 1.5, yMin: -0.5, yMax: 0.5 },
          cells: 800,
        },
      },
      lines: 40,
    },
  },
  {
    title: "Cayley's sextic, a second pedal",
    note: "The pedal of a circle's pedal",
    config: {
      ...base,
      kind: "pedal",
      // About a point on a circle its pedal is a cardioid, and the
      // cardioid's pedal about its cusp is Cayley's sextic.
      input: "pedal",
      curve: {
        ...base.curve,
        x: "1+cos(t)",
        y: "sin(t)",
        min: -Math.PI,
        max: Math.PI,
      },
      samples: 2000,
      lines: 48,
    },
  },
  {
    title: "Unwinding an evolute",
    note: "The involute of an evolute is the curve",
    config: {
      ...base,
      kind: "involute",
      // The evolute of a logarithmic spiral is the same spiral turned. A
      // string as long as the radius of curvature at t = 0, √(1 + 0.15²),
      // unwound from it retraces the spiral.
      input: "evolute",
      curve: {
        ...base.curve,
        x: "exp(0.15*t)*cos(t)",
        y: "exp(0.15*t)*sin(t)",
        min: 0,
        max: 4 * Math.PI,
      },
      offset: Math.sqrt(1.0225),
      samples: 2000,
      lines: 40,
    },
  },
  {
    title: "Rolling on an ellipse's pedal",
    note: "A rolling circle on a derived curve",
    config: {
      ...base,
      kind: "rolling",
      // The pedal about the center is about 10.7411 long, so a circle of
      // this radius turns 14 times around it and closes.
      input: "pedal",
      curve: { ...base.curve, x: "2*cos(t)", y: "1.1*sin(t)" },
      rolling: { ...base.rolling, side: "right", radius: 0.1221066, arm: 0.3 },
      samples: 4000,
      lines: 60,
    },
  },
  {
    title: "Offsets of an evolute",
    note: "Parallels of an ellipse's evolute",
    config: {
      ...base,
      kind: "offset",
      input: "evolute",
      curve: { ...base.curve, x: "2*cos(t)", y: "1.1*sin(t)" },
      stack: { enabled: true, from: -0.6, to: 0.6, count: 9 },
      samples: 2000,
      lines: 48,
    },
  },
  {
    title: "A lamp circling a mirror",
    note: "A lamp makes one turn inside an elliptical mirror; its caustic reshapes and returns, looping without a seam",
    config: {
      ...base,
      kind: "catacaustic",
      curve: { ...base.curve, x: "1.4*cos(t)", y: "sin(t)" },
      source: {
        kind: "point",
        coordinates: "polar",
        radius: 0.55,
        theta: 0,
        position: { x: 0.55, y: 0 },
        angle: -90,
      },
      samples: 1600,
      lines: 72,
    },
    animation: {
      mode: "parameters",
      camera: "hold",
      duration: 14,
      tracks: [{ target: "sourceTheta", from: "0", to: "2*pi" }],
      repeat: "loop",
      pace: "steady",
    },
  },
];
