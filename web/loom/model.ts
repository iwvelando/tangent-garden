import { roundedGenerated } from "../atlas";
import { tiered } from "../help";
import type { Config, Vec } from "../types";
import type { PlotCamera } from "../planar-link";
export type LoomSource = {
  kind: "grid" | "concentric" | "rosette" | "curve";
  count: number;
  xCount: number;
  yCount: number;
  xMin: number;
  xMax: number;
  yMin: number;
  yMax: number;
  radius: number;
  // The path of the frozen curve the loom maps: the curve itself or one of
  // its derived curves (loomPaths), with the base study's pole and offset
  // distance frozen alongside. Absent settings in older links read as the
  // origin and zero; only a path that reads one requires it.
  input: Config["input"];
  curve: Config["curve"];
  pole?: Vec;
  distance?: number;
};
// a, b, c and d of the general Möbius map, each (real, imaginary).
export type LoomCoefficients = { a: Vec; b: Vec; c: Vec; d: Vec };
export type LoomRequest = {
  map:
    | "square"
    | "power"
    | "exp"
    | "exp-power"
    | "mobius"
    | "joukowski"
    | "fractional";
  // The degree n of the power map zⁿ and of the composite exp(zⁿ), a whole
  // number 2–6. Categorical: never animated.
  degree?: number;
  mapParameter?: number;
  exclusionRadius?: number;
  // The general Möbius map's coefficients; other maps keep but ignore them.
  coefficients?: LoomCoefficients;
  source: LoomSource;
  samples: number;
  tolerance: number;
  selected: number;
  parameter: number;
};
export type LoomFraming = { cx: number; cy: number; scale: number };
export type LoomStudy = LoomRequest & {
  framing?: { source: LoomFraming; image: LoomFraming };
  views: { source: PlotCamera; image: PlotCamera };
  duration: number;
  showExclusion?: boolean;
  motion?: { mode: "map"; from: number; to: number };
};
const rationalTraversal =
  "Traversal advances uniformly in the original source parameter, not arc length. Poles and their excluded source disks have no image. Critical images remain drawable, but do not claim regular conformality. Map motion keeps this point fixed while changing the map.";
const fixedDomain =
  "Closed source disk omitted at each actual pole; no pole for identity. Image radius above 100000000 clipped. Finite expression sampling is not certified topology.";
export const degreeHelp = tiered(
  "Whole number 2–6; the image multiplies angles about zero by n.",
  "Zero is a critical point, drawn but not conformal. Images beyond radius 10¹⁰⁰ are clipped; every grid and circle family fits inside, so only a selected curve can reach it.",
);
const compositeDegreeHelp = tiered(
  "Whole number 2–6; the power multiplies angles about zero by n before the exponential wraps them.",
  "Zero is a critical point, drawn but not conformal, mapping to 1. Sources are clipped where |Re zⁿ| > 18.42 or |Im zⁿ| > 8π, so higher degrees admit smaller sources: |z| ≤ 5.58 for n = 2, 1.77 for n = 6.",
);
// Each map's labels, help, supported parameter, degree and actual pole.
// Components read these, through mapText for degree-dependent words,
// instead of branching on map names.
export const maps = {
  square: {
    label: "Squaring",
    formula: "w = z²",
    parameterized: false,
    degree: undefined,
    exportDomain: fixedDomain,
    symbol: "",
    range: [0, 0],
    initial: 0,
    note: "Squaring doubles angles about zero. Zero is drawable but critical.",
    imageLabel: "Squared image plane",
    imageHeading: "Image plane · z²",
    imageNoun: "square",
    // Gallery search words for its presets.
    keywords: "",
    traversalHelp:
      "Traversal advances uniformly in the source parameter, not arc length. Rotated circles have center r exp(iα), α = 2πk/N and z(θ) = r exp(iα)(1 + exp(iθ)); θ increases counterclockwise from the outermost point. At θ = π the point is critical, but maps to zero.",
    pole: (_parameter: number): Vec | undefined => undefined,
  },
  // "ⁿ" in these strings becomes the chosen degree (mapText).
  power: {
    label: "Power zⁿ",
    formula: "w = zⁿ",
    parameterized: false,
    degree: { range: [2, 6], initial: 3, help: degreeHelp },
    exportDomain:
      "No pole or excluded disk; zero is critical. Image radius above 1e100 clipped. Finite expression sampling is not certified topology.",
    symbol: "",
    range: [0, 0],
    initial: 0,
    note: "Powers multiply angles about zero by n. Zero is drawable but critical.",
    imageLabel: "zⁿ image plane",
    imageHeading: "Image plane · zⁿ",
    imageNoun: "image",
    keywords: " power powers polynomial cube cubic quintic",
    traversalHelp:
      "Traversal advances uniformly in the source parameter, not arc length. Rotated circles have z(θ) = r exp(iα)(1 + exp(iθ)), α = 2πk/N; θ increases counterclockwise from the outermost point. At θ = π the point is critical, but maps to zero. Images beyond radius 10¹⁰⁰ are clipped.",
    pole: (_parameter: number): Vec | undefined => undefined,
  },
  // No parameter, pole or critical point. Go clips sources outside the
  // declared window and reports each marker's periodic translates.
  exp: {
    label: "Exponential eᶻ",
    formula: "w = eᶻ",
    parameterized: false,
    degree: undefined,
    exportDomain:
      "Source window |Re z| ≤ ln 10⁸ ≈ 18.42, |Im z| ≤ 8π; points beyond it clipped. No pole or critical point; period 2πi. Finite expression sampling is not certified topology.",
    symbol: "",
    range: [0, 0],
    initial: 0,
    note: "Each 2π of height wraps once around zero: vertical lines become rings, horizontal lines rays.",
    imageLabel: "eᶻ image plane",
    imageHeading: "Image plane · eᶻ",
    imageNoun: "image",
    keywords: " exponential exp eᶻ periodic strip rings spiral",
    traversalHelp:
      "Traversal advances uniformly in the source parameter, not arc length. eᶻ repeats every 2πi: hollow markers show the other source points in the window with the same image. It has no critical point. Sources beyond |Re z| ≤ ln 10⁸ ≈ 18.42 or |Im z| ≤ 8π are clipped.",
    // The readout's words for the marker's other source points with its
    // image, which Go reports as translates.
    shared: "in the window, z\u00a0+\u00a02πik,",
    pole: (_parameter: number): Vec | undefined => undefined,
  },
  // The composite exp(zⁿ), evaluated in Go as the exponential of the power
  // map's own value: sources whose zⁿ leaves the exponential's window are
  // clipped, zero is the only critical point, and the marker reports zⁿ and
  // every other source point with its image.
  "exp-power": {
    label: "Composite exp(zⁿ)",
    formula: "w = exp(zⁿ)",
    parameterized: false,
    degree: { range: [2, 6], initial: 2, help: compositeDegreeHelp },
    exportDomain:
      "Power zⁿ, then the exponential. Sources clipped where zⁿ leaves |Re| ≤ ln 10⁸ ≈ 18.42, |Im| ≤ 8π. No pole; zero is critical. Finite expression sampling is not certified topology.",
    symbol: "",
    range: [0, 0],
    initial: 0,
    note: "The power multiplies angles about zero by n; the exponential then wraps the result into rings and rays.",
    imageLabel: "exp(zⁿ) image plane",
    imageHeading: "Image plane · exp(zⁿ)",
    imageNoun: "image",
    keywords: " composite composition exponential power exp shell web",
    traversalHelp:
      "Traversal advances uniformly in the source parameter, not arc length. The readout gives the intermediate point zⁿ. exp(zⁿ) repeats wherever zⁿ moves by 2πi: hollow markers show the other source points with the same image. Zero is critical and maps to 1. Sources whose zⁿ leaves |Re| ≤ 18.42, |Im| ≤ 8π are clipped.",
    shared:
      "with zⁿ in the window, the turns of z and roots of zⁿ\u00a0+\u00a02πik,",
    // The readout's name for the intermediate point Go reports.
    intermediate: "zⁿ",
    pole: (_parameter: number): Vec | undefined => undefined,
  },
  mobius: {
    label: "Möbius",
    formula: "w = (z − b)/(1 − bz)",
    parameterized: true,
    degree: undefined,
    exportDomain: fixedDomain,
    symbol: "b",
    range: [-0.9, 0.9],
    initial: 0.5,
    note: "Circles become circles or lines. The pole is 1/b; b = 0 is identity. The inverse uses −b.",
    imageLabel: "Möbius image plane",
    imageHeading: "Image plane · w",
    imageNoun: "image",
    keywords: "",
    traversalHelp: rationalTraversal,
    // At b = 0 the pole has gone to infinity.
    pole: (b: number): Vec | undefined =>
      b && Number.isFinite(1 / b) ? { x: 1 / b, y: 0 } : undefined,
  },
  joukowski: {
    label: "z + λ/z",
    formula: "w = z + λ/z",
    parameterized: true,
    degree: undefined,
    exportDomain: fixedDomain,
    symbol: "λ",
    range: [0, 1],
    initial: 0.5,
    note: "Zero is a pole when λ > 0; ±√λ are drawable critical points. At λ = 0 the map is identity, including zero.",
    imageLabel: "z + λ/z image plane",
    imageHeading: "Image plane · w",
    imageNoun: "image",
    keywords: "",
    traversalHelp: rationalTraversal,
    pole: (lambda: number): Vec | undefined =>
      lambda ? { x: 0, y: 0 } : undefined,
  },
  // The map parameter s follows the map's own flow Mˢ, computed in Go:
  // identity at 0, the entered map at 1, its inverse at −1. Go reports
  // each frame's pole, so the exclusion circle follows the flow.
  fractional: {
    label: "Möbius (az + b)/(cz + d)",
    formula: "w = (az + b)/(cz + d)",
    parameterized: true,
    degree: undefined,
    exportDomain:
      "Coefficients a, b, c, d scaled exactly; refused when (|a|²+|b|²+|c|²+|d|²)/(2|ad−bc|) exceeds 1000000. Map parameter s follows the map's flow: 0 identity, 1 the map, −1 its inverse. Closed source disk omitted at each frame's pole; none for an affine frame. Image radius above 100000000 clipped. Finite expression sampling is not certified topology.",
    symbol: "s",
    range: [-1, 1],
    initial: 1,
    // Map motion grows the map out of the identity along its flow.
    motionFrom: 0,
    parameterHelp: tiered(
      "−1–1: 1 applies the map, 0 the identity, −1 its inverse.",
      "Between them s follows the map's flow, which keeps its fixed points and turns the shorter way about them: circles through both fixed points carry each point from one toward the other, or around one.",
    ),
    coefficients: {
      a: { x: 2, y: 1 },
      b: { x: 0, y: -1 },
      c: { x: 0, y: -1 },
      d: { x: 2, y: 1 },
    },
    note: "Circles become circles or lines. Scaling a, b, c and d together changes nothing; c = 0 is affine, with no pole.",
    imageLabel: "Möbius image plane",
    imageHeading: "Image plane · w",
    imageNoun: "image",
    keywords:
      " möbius mobius fractional linear affine flow loxodromic elliptic spiral fixed points",
    traversalHelp: rationalTraversal,
    // Go's reported pole of the frame drawn, absent when it is affine.
    pole: (_s: number, result?: { pole?: Vec }): Vec | undefined =>
      result?.pole,
  },
} as const;
export const coefficientHelp = (k: string) =>
  tiered(
    `Real and imaginary parts of ${k}, each within ±1,000,000.`,
    "Scaling all four together changes nothing. Refused when |a|² + |b|² + |c|² + |d|² exceeds 2,000,000 |ad − bc|, which includes ad = bc, a constant map. c = 0 makes the map affine, with no pole.",
  );
export const mapHelp = tiered(
  "Squaring and zⁿ multiply angles, eᶻ wraps strips into rings, exp(zⁿ) does both, Möbius keeps circles, z+λ/z makes ellipses.",
  "z², zⁿ and exp(zⁿ), n = 2–6, are critical at zero. eᶻ repeats every 2πi and clips sources beyond |Re z| ≤ 18.42 or |Im z| ≤ 8π; exp(zⁿ) clips where zⁿ does. Möbius (z−b)/(1−bz), −0.9≤b≤0.9, has pole 1/b; z+λ/z, 0≤λ≤1, pole 0 and critical ±√λ; (az+b)/(cz+d), pole −d/c. All three are identity at zero. Poles exclude source disks.",
);
const superscripts = "⁰¹²³⁴⁵⁶⁷⁸⁹";
// A map's words with its degree in place of n: z³ for a cubic.
export function mapText(q: Pick<LoomRequest, "map" | "degree">) {
  const m = maps[q.map];
  const n =
    m.degree && Number.isInteger(q.degree) ? superscripts[q.degree!] : "ⁿ";
  const fill = (text: string) => text.replaceAll("zⁿ", `z${n}`);
  return {
    label: m.label,
    formula: fill(m.formula),
    imageLabel: fill(m.imageLabel),
    imageHeading: fill(m.imageHeading),
    imageNoun: m.imageNoun,
    // Distinguishes degrees in file names: complex-power-3.
    kind: m.degree ? `${q.map}-${q.degree}` : q.map,
    // Readout words for the marker's other source points with its image,
    // and the name of the composite's intermediate point.
    shared: "shared" in m ? fill(m.shared) : undefined,
    intermediate: "intermediate" in m ? fill(m.intermediate) : undefined,
  };
}

export function replaceMap(
  s: LoomStudy,
  map: LoomRequest["map"],
  curveSize = 1,
): LoomStudy {
  if (map === s.map) return s;
  const { motion: _motion, ...rest } = s;
  const degree = maps[map].degree;
  // A retained valid degree survives map changes, as the radius does.
  if (degree)
    return {
      ...rest,
      map,
      degree:
        Number.isInteger(s.degree) &&
        s.degree! >= degree.range[0] &&
        s.degree! <= degree.range[1]
          ? s.degree
          : degree.initial,
    };
  if (!maps[map].parameterized) return { ...rest, map };
  const info = maps[map];
  // Valid retained coefficients survive map changes, as the degree does.
  const coefficients =
    "coefficients" in info &&
    !(
      s.coefficients &&
      Object.values(s.coefficients).every(
        (v) =>
          Number.isFinite(v.x) &&
          Number.isFinite(v.y) &&
          Math.abs(v.x) <= 1e6 &&
          Math.abs(v.y) <= 1e6,
      )
    )
      ? structuredClone(info.coefficients)
      : undefined;
  const size =
    s.source.kind === "grid"
      ? Math.max(s.source.xMax - s.source.xMin, s.source.yMax - s.source.yMin) /
        2
      : s.source.kind === "curve"
        ? curveSize
        : s.source.radius;
  return {
    ...rest,
    map,
    ...(coefficients && { coefficients }),
    mapParameter: maps[map].initial,
    exclusionRadius:
      s.exclusionRadius &&
      Number.isFinite(s.exclusionRadius) &&
      s.exclusionRadius >= 1e-6 &&
      s.exclusionRadius <= 1e6
        ? s.exclusionRadius
        : Math.max(
            1e-6,
            Math.min(
              1e6,
              roundedGenerated(
                0.025 * (Number.isFinite(size) && size > 0 ? size : 1),
                0.025 * Math.abs(size),
              ),
            ),
          ),
    showExclusion: s.showExclusion ?? true,
  };
}

// The value at progress p between two entered endpoints, exact at both. An
// interior value is generated arithmetic shown in an editable field, so a
// rounding tail is dropped when a shorter decimal lies within the
// interpolation's own rounding, scaled by the larger endpoint (Generated
// numeric defaults in docs/contributing.md): 0.44, not 0.44000000000000017.
// Only decimals of at most 15 significant digits qualify, so a sample that
// is a meaningful double, such as π/2 a quarter of the way around a circle,
// is kept exactly.
function between(a: number, b: number, p: number) {
  if (p <= 0) return a;
  if (p >= 1) return b;
  return roundedGenerated(
    a + (b - a) * p,
    Math.max(Math.abs(a), Math.abs(b)),
    15,
  );
}
// One absolute-time sampler for direct seek, playback and movie export.
// Point traversal leaves geometry stationary; map motion recomputes it.
export function loomFrame(s: LoomStudy, progress: number): LoomRequest {
  if (!s.motion) return traversal(s, progress);
  const { from, to } = s.motion;
  return { ...loomRequest(s), mapParameter: between(from, to, progress) };
}
// The frame's result supplies the pole where Go computes it.
export function poleExclusion(
  q: LoomRequest,
  visible = true,
  result?: { pole?: Vec },
) {
  const center =
    visible && q.exclusionRadius && q.mapParameter !== undefined
      ? maps[q.map].pole(q.mapParameter, result)
      : undefined;
  return center && { center, radius: q.exclusionRadius! };
}
export type LoomMarker = {
  member: number;
  parameter: number;
  source: Vec | null;
  image: Vec | null;
  critical: boolean;
  // The other source points with this image that the exponential's period
  // creates: z + 2πik under eᶻ; under exp(zⁿ), the turns of z and the n-th
  // roots of zⁿ + 2πik.
  translates?: Vec[];
  // The composite exp(zⁿ)'s intermediate point zⁿ, even where it is clipped.
  intermediate?: Vec;
  // A derived path's base point r(t), at the same base parameter.
  base?: Vec | null;
};
export type LoomMember = {
  id: number;
  name: string;
  min: number;
  max: number;
  at: number[];
  source: (Vec | null)[];
  image: (Vec | null)[];
  critical: boolean[];
  intervals: { from: number; to: number; reason: string }[];
};
export type LoomResult = {
  members: LoomMember[];
  // The general Möbius frame's pole, when it has one.
  pole?: Vec;
  // A derived path's base curve in the source plane, unmapped; null breaks.
  base?: { at: number[]; points: (Vec | null)[] };
  marker: LoomMarker;
  points: number;
  evaluations: number;
  numericEntries: number;
  exhausted: boolean;
};
export const sourceChoices = {
  rosette: "Circles opening into a rosette",
  grid: "A square grid, curved",
  concentric: "Concentric circles",
  curve: "Curve from your base study",
} as const;
// The authored families, offered in the 2D examples gallery. Each opens the
// loom over the notebook's study without replacing it; the notebook's curve
// remains the loom's curve source.
export const loomPresets = [
  {
    title: sourceChoices.rosette,
    note: "Circles through the origin square into a rosette of cardioids",
    kind: "rosette",
  },
  {
    title: sourceChoices.grid,
    note: "A grid's lines square into two families of parabolas",
    kind: "grid",
  },
  {
    title: sourceChoices.concentric,
    note: "Each circle squares to a circle, wound around twice",
    kind: "concentric",
  },
  // Opens at b=.65; moving to −.65 takes the pole through the circles,
  // out to infinity at identity and back on the opposite side.
  {
    title: "Circles through infinity",
    note: "A moving Möbius pole opens circles into lines and closes them again",
    kind: "concentric",
    map: "mobius",
    motion: { from: 0.65, to: -0.65 },
  },
  // Opens at λ=.5; each concentric circle becomes an ellipse, flattened
  // to a doubly traced segment when its radius is √λ.
  {
    title: "Circles folded into ellipses",
    note: "The map z + λ/z folds nested circles through critical line segments",
    kind: "concentric",
    map: "joukowski",
    motion: { from: 0.5, to: 1 },
  },
  // Opens at n = 5 on the twelve rotated circles. Each circle's fifth
  // power, (2r cos(θ/2))⁵ exp(5i(α + θ/2)), winds two and a half turns into
  // a curled loop; twelve is prime to five, so all twelve stay distinct.
  {
    title: "A quintic rosette",
    note: "The fifth power curls circles through the origin into a lace of spirals",
    kind: "rosette",
    map: "power",
    degree: 5,
  },
  // Opens at n = 3 on a 9 × 9 grid over the unit square, selecting the line
  // x = 1/4, whose cube loops once around the critical zero. Odd powers open
  // the centered grid into a four-pointed star; even ones fold it onto itself.
  {
    title: "A grid cubed into a star",
    note: "Cubing a square grid opens it into a four-pointed star around a laced core",
    kind: "grid",
    map: "power",
    degree: 3,
    lines: 9,
    extent: 1,
    selected: 5,
  },
  // Opens on a strip one period tall, −3 ≤ Re z ≤ 1/2, −π ≤ Im z ≤ π,
  // selecting the line Re z = 0, whose image is Euler's e^{iy} on the unit
  // circle. Vertical lines wrap into rings of radius e^x, crowding toward
  // zero like a well, and horizontal lines open into rays; the strip's top
  // and bottom edges share one ray.
  {
    title: "A strip wrapped into rings",
    note: "The exponential wraps a strip around zero: lines become rings and rays",
    kind: "grid",
    map: "exp",
    lines: 15,
    yLines: 25,
    xRange: [-3, 0.5],
    yRange: [-Math.PI, Math.PI],
    selected: 12,
  },
  // Opens on 32 concentric circles out to radius 6, selecting the
  // outermost. exp(R e^{iθ}) runs from e^R out at θ = 0 to e^−R at θ = π,
  // winding R sin θ / 2π times about zero, so circles beyond radius π
  // cross themselves and curl into a shell.
  {
    title: "Circles curled into a nautilus",
    note: "The exponential curls nested circles into a spiraling shell",
    kind: "concentric",
    map: "exp",
    count: 32,
    radius: 6,
    selected: 31,
  },
  // Opens at s = −1, the inverse, on 24 concentric circles to radius 2.4.
  // The map is loxodromic, (w − 1)/(w + 1) = 2i (z − 1)/(z + 1): fixed
  // points ±1, multiplier 2i. Its flow turns each circle about the fixed
  // points as it carries it from one toward the other; the moving pole
  // opens circles into lines on the way through the identity at s = 0.
  {
    title: "Circles whirled between two fixed points",
    note: "A loxodromic Möbius flow swirls nested circles from one fixed point toward the other",
    kind: "concentric",
    map: "fractional",
    count: 24,
    radius: 2.4,
    selected: 5,
    coefficients: {
      a: { x: 1, y: 2 },
      b: { x: 1, y: -2 },
      c: { x: 1, y: -2 },
      d: { x: 1, y: 2 },
    },
    motion: { from: -1, to: 1 },
  },
  // Opens at s = −1 on a 17 × 17 grid over [−2, 2]². (1 + z)/(1 − z) is
  // elliptic: a quarter turn about its fixed points ±i. Its flow turns the
  // grid a quarter turn back and forth through the identity; every line
  // becomes a circle, and the line through each frame's pole a line.
  // Opens on the inward offset, d = 1/4, of the five-lobed star
  // r = 1 + 0.3 cos 5θ, raised to the fourth power. The offset runs back
  // through a swallowtail at each lobe, where 1 − dκ < 0; five is prime to
  // four, so the image keeps five petals, each tipped by its swallowtail.
  {
    title: "A star's offset raised to the fourth power",
    note: "A star's inner parallel curve, with swallowtails at its points, opens into five petals under z⁴",
    kind: "curve",
    map: "power",
    degree: 4,
    path: {
      input: "offset",
      distance: 0.25,
      curve: { format: "polar", r: "1+0.3*cos(5*t)", min: 0, max: 2 * Math.PI },
    },
  },
  // Opens on the evolute of the five-cusped hypocycloid (fixed radius 5,
  // rolling radius 1), a larger hypocycloid turned a tenth of a turn,
  // squared. It starts at the vertex θ = π/5, since every derived path is
  // undefined at the base's cusps, where it breaks.
  {
    title: "A hypocycloid's evolute squared into a star",
    note: "The centers of curvature of a five-cusped hypocycloid square into a crossed five-pointed star",
    kind: "curve",
    map: "square",
    path: {
      input: "evolute",
      curve: {
        format: "roulette",
        roulette: {
          roll: "inside",
          fixedRadius: 5,
          radius: 1,
          arm: 1,
          phase: 0,
        },
        min: Math.PI / 5,
        max: Math.PI / 5 + 2 * Math.PI,
      },
    },
  },
  // Opens at λ = 1 on the same star's offset, folded by z + λ/z about the
  // critical circle |z| = √λ that it crosses: its lobes and swallowtails
  // interlace into lace. Map motion unfolds it to λ = 0, the identity,
  // where the image is the offset itself, with fixed reference framing.
  {
    title: "A star's offset folded into lace",
    note: "z + λ/z folds a star's parallel curve across its critical circle into interlaced loops",
    kind: "curve",
    map: "joukowski",
    motion: { from: 1, to: 0 },
    // The source stands still, so it is framed larger than the image.
    scale: { source: 260, image: 150 },
    path: {
      input: "offset",
      distance: 0.25,
      curve: { format: "polar", r: "1+0.3*cos(5*t)", min: 0, max: 2 * Math.PI },
    },
  },
  {
    title: "A grid turned about two fixed points",
    note: "An elliptic Möbius flow turns a square grid into circles about two fixed points",
    kind: "grid",
    map: "fractional",
    lines: 17,
    extent: 2,
    selected: 12,
    coefficients: {
      a: { x: 1, y: 0 },
      b: { x: 1, y: 0 },
      c: { x: -1, y: 0 },
      d: { x: 1, y: 0 },
    },
    motion: { from: -1, to: 1 },
  },
  // Opens on 24 circles through the origin, radius 0.6, under exp(z⁵). The
  // fifth power curls each into a loop reaching |z⁵| ≤ 1.2⁵ ≈ 2.5, and the
  // exponential wraps those loops around 1 into an interlaced shell; 24 is
  // prime to 5, so all 24 images stay distinct.
  {
    title: "A quintic rosette wrapped into a shell",
    note: "Raised to the fifth power, then wrapped by the exponential, circles through the origin interlace into a shell",
    kind: "rosette",
    map: "exp-power",
    degree: 5,
    count: 24,
    radius: 0.6,
  },
  // Opens on a 17 × 17 grid over [−1.25, 1.25]² under exp(z²): squaring
  // bends the lines into parabolas, and the exponential wraps them into a
  // web of rings and spokes around 1. Selects the edge x = 5/4, whose
  // square 25/16 − t² + 5it/2 wraps into the web's rim, out to e^{25/16}
  // at t = 0 and back to the unit circle at both ends.
  {
    title: "A squared grid wrapped into a web",
    note: "Squared into parabolas, then wrapped by the exponential, a square grid becomes a web of rings and spokes",
    kind: "grid",
    map: "exp-power",
    degree: 2,
    lines: 17,
    extent: 1.25,
    selected: 16,
  },
] as const satisfies readonly {
  title: string;
  note: string;
  kind: LoomSource["kind"];
  map?: LoomRequest["map"];
  degree?: number;
  lines?: number;
  yLines?: number;
  extent?: number;
  xRange?: readonly [number, number];
  yRange?: readonly [number, number];
  count?: number;
  radius?: number;
  selected?: number;
  coefficients?: LoomCoefficients;
  motion?: { from: number; to: number };
  // A derived path of the preset's own frozen curve, and for a derived
  // performance each pane's fixed reference scale.
  path?: PresetPath;
  scale?: { source: number; image: number };
}[];
type PresetPath = {
  input: LoomSource["input"];
  curve: Partial<Config["curve"]>;
  pole?: Vec;
  distance?: number;
};
export function presetLoom(index: number, config: Config): LoomStudy {
  const study = defaultLoom(config);
  const definition = loomPresets[index];
  const path: PresetPath | undefined =
    "path" in definition ? definition.path : undefined;
  const source = {
    ...study.source,
    kind: definition.kind,
    // A derived preset carries its own curve and path, frozen like the
    // notebook's; the notebook's other curve fields ride along unused.
    ...(path && {
      input: path.input,
      curve: { ...study.source.curve, ...path.curve },
      ...(path.pole && { pole: { ...path.pole } }),
      ...(path.distance !== undefined && { distance: path.distance }),
    }),
    ...("lines" in definition && {
      xCount: definition.lines,
      yCount: "yLines" in definition ? definition.yLines : definition.lines,
      ...("extent" in definition
        ? {
            xMin: -definition.extent,
            xMax: definition.extent,
            yMin: -definition.extent,
            yMax: definition.extent,
          }
        : {
            xMin: definition.xRange[0],
            xMax: definition.xRange[1],
            yMin: definition.yRange[0],
            yMax: definition.yRange[1],
          }),
    }),
    ...("count" in definition && {
      count: definition.count,
      radius: definition.radius,
    }),
  };
  // A derived performance opens on its own path at its motion's start,
  // with fixed reference framing so the map's change of scale shows.
  if (path && "motion" in definition) {
    const scale =
      "scale" in definition ? definition.scale : { source: 120, image: 120 };
    return {
      ...replaceMap(study, definition.map),
      source,
      selected: 0,
      parameter: memberInterval(source, 0)[0],
      mapParameter: definition.motion.from,
      exclusionRadius: 0.04,
      motion: { mode: "map" as const, ...definition.motion },
      framing: {
        source: { cx: 0, cy: 0, scale: scale.source },
        image: { cx: 0, cy: 0, scale: scale.image },
      },
    };
  }
  // A general Möbius preset opens on its own family at the start of its
  // flow, with the rational presets' reference framing and exclusion.
  if ("coefficients" in definition) {
    return {
      ...replaceMap(study, definition.map),
      coefficients: structuredClone(definition.coefficients),
      source,
      selected: definition.selected,
      parameter: memberInterval(source, definition.selected)[0],
      mapParameter: definition.motion.from,
      exclusionRadius: 0.04,
      motion: { mode: "map" as const, ...definition.motion },
      framing: {
        source: { cx: 0, cy: 0, scale: 120 },
        image: { cx: 0, cy: 0, scale: 120 },
      },
    };
  }
  // Maps without a parameter open at a point, without map motion.
  if ("map" in definition && !("motion" in definition)) {
    const selected = "selected" in definition ? definition.selected : 0;
    return {
      ...replaceMap(study, definition.map),
      ...("degree" in definition && { degree: definition.degree }),
      source,
      selected,
      parameter: memberInterval(source, selected)[0],
    };
  }
  const rational = "map" in definition;
  const mapped = rational ? replaceMap(study, definition.map) : study;
  return {
    ...mapped,
    source: rational ? { ...source, radius: 2.4 } : source,
    ...(rational && {
      selected: 5,
      mapParameter: definition.motion.from,
      exclusionRadius: 0.06,
      motion: { mode: "map" as const, ...definition.motion },
    }),
    ...(rational && {
      framing: {
        source: { cx: 0, cy: 0, scale: 120 },
        image: { cx: 0, cy: 0, scale: 120 },
      },
    }),
    parameter: memberInterval(source, 0)[0],
  };
}
// What a preset draws, without the notebook's curve, pole and distance it
// carries; a derived preset draws its own curve and path.
export function presetDefinition(index: number) {
  const { source, ...rest } = presetLoom(index, {
    input: "curve",
    curve: {},
  } as unknown as Config);
  const {
    input: _input,
    curve: _curve,
    pole: _pole,
    distance: _distance,
    ...family
  } = source;
  const definition = loomPresets[index];
  return {
    ...rest,
    source: "path" in definition ? { ...family, ...definition.path } : family,
  };
}
export const supportedFormats = [
  "parametric",
  "cartesian",
  "polar",
  "roulette",
  "lissajous",
  "fourier",
] as const;
// The loom on the notebook's own curve, which must be supported, on the
// path the study's construction acts on: the curve itself, as the loom
// always opened, or a derived input. Path reaches the others.
export function curveLoom(config: Config): LoomStudy {
  const study = defaultLoom(config);
  return {
    ...study,
    source: { ...study.source, kind: "curve" },
    parameter: config.curve.min,
  };
}
export function defaultLoom(config: Config): LoomStudy {
  return {
    map: "square",
    source: {
      kind: "rosette",
      count: 12,
      xCount: 13,
      yCount: 13,
      xMin: -2,
      xMax: 2,
      yMin: -2,
      yMax: 2,
      radius: 1,
      input: config.input,
      curve: structuredClone(config.curve),
      pole: { ...config.pole },
      distance: config.distance,
    },
    samples: 32,
    tolerance: 0.0005,
    selected: 0,
    parameter: 0,
    views: { source: { x: 0, y: 0, zoom: 1 }, image: { x: 0, y: 0, zoom: 1 } },
    duration: 10,
  };
}
export const supportedSource = (s: Pick<LoomSource, "input" | "curve">) =>
  Object.hasOwn(loomPaths, s.input) &&
  (supportedFormats as readonly string[]).includes(s.curve.format);
type Segment = [Vec, Vec];
// A path's representative construction at one point: solid and dashed
// segments, and the points they start from, marked.
export type Construction = (
  r: Vec,
  g: Vec,
  pole: Vec,
) => { solid: Segment[]; dashed: Segment[]; points: Vec[] };
const midpoint = (a: Vec, b: Vec) => ({
  x: (a.x + b.x) / 2,
  y: (a.y + b.y) / 2,
});
// From the base point r alone, as for the evolute and the offset.
const fromBase: Construction = (r, g) => ({
  solid: [[r, g]],
  dashed: [],
  points: [r],
});
// From r along the tangent or normal line, and from the pole P across it.
const fromPole: Construction = (r, g, pole) => ({
  solid: [
    [r, g],
    [pole, g],
  ],
  dashed: [],
  points: [r, pole],
});
// The paths of the frozen curve the loom can map. Go evaluates each at the
// base parameter t with the notebook's own derived-input evaluator, so a
// path's parameter is the base curve's. `construction` is the notebook's
// representative construction at the selected point, from the base point r
// and the pole P to the path's point g; components draw it without naming
// the path. `setting` names the frozen value a path reads.
export const loomPaths = {
  curve: {
    label: "The curve itself",
    noun: "curve",
    setting: undefined,
    construction: undefined,
  },
  // The radius of curvature, from r to the center.
  evolute: {
    label: "Its evolute",
    noun: "evolute",
    setting: undefined,
    construction: fromBase,
  },
  pedal: {
    label: "Its pedal curve",
    noun: "pedal curve",
    setting: "pole",
    construction: fromPole,
  },
  contrapedal: {
    label: "Its contrapedal",
    noun: "contrapedal",
    setting: "pole",
    construction: fromPole,
  },
  // P reflected across the tangent: the foot H = (P + Q)/2 lies on it,
  // and the reflected half H→Q is dashed, as in the notebook.
  orthotomic: {
    label: "Its orthotomic",
    noun: "orthotomic",
    setting: "pole",
    construction: (r, g, pole) => {
      const h = midpoint(pole, g);
      return {
        solid: [
          [r, h],
          [pole, h],
        ],
        dashed: [[h, g]],
        points: [r, pole],
      };
    },
  },
  // The normal segment of length |d|.
  offset: {
    label: "Its offset",
    noun: "offset",
    setting: "distance",
    construction: fromBase,
  },
} as const satisfies Record<
  LoomSource["input"],
  {
    label: string;
    noun: string;
    setting: "pole" | "distance" | undefined;
    construction: Construction | undefined;
  }
>;
// Whether two curve definitions are the same, whatever their key order: a
// loom's frozen curve is the base study's own unless an example brought it.
export function sameCurve(a: Config["curve"], b: Config["curve"]) {
  const canonical = (v: unknown): unknown =>
    Array.isArray(v)
      ? v.map(canonical)
      : v && typeof v === "object"
        ? Object.fromEntries(
            Object.keys(v)
              .sort()
              .map((k) => [k, canonical((v as Record<string, unknown>)[k])]),
          )
        : v;
  return JSON.stringify(canonical(a)) === JSON.stringify(canonical(b));
}
// The frozen path in words, for the curve source's note: of the base
// study's own curve, or of the curve an example brought.
export function pathNote(s: LoomSource, own: boolean) {
  const path = loomPaths[s.input];
  const n = (v: number) => String(+v.toPrecision(6));
  const setting =
    path.setting === "pole" && s.pole
      ? ` about the pole (${n(s.pole.x)}, ${n(s.pole.y)})`
      : path.setting === "distance" && s.distance !== undefined
        ? ` at distance ${n(s.distance)}`
        : "";
  const curve = own
    ? `a frozen copy of your base study’s ${s.curve.format} curve`
    : `the example’s own ${s.curve.format} curve`;
  return path.construction
    ? `The loom maps the ${path.noun}${setting} of ${curve}, drawn faintly beneath it.`
    : `This is ${curve}.`;
}
export function memberInterval(s: LoomSource, id: number): [number, number] {
  return s.kind === "curve"
    ? [s.curve.min, s.curve.max]
    : s.kind === "grid"
      ? id < s.xCount
        ? [s.yMin, s.yMax]
        : [s.xMin, s.xMax]
      : [0, 2 * Math.PI];
}
export const memberCount = (s: LoomSource) =>
  s.kind === "curve" ? 1 : s.kind === "grid" ? s.xCount + s.yCount : s.count;
export function loomRequest(s: LoomStudy): LoomRequest {
  return {
    map: s.map,
    // Squaring and the rational maps keep their previous request.
    ...(maps[s.map].degree && { degree: s.degree }),
    // Only the general Möbius map sends its coefficients.
    ...("coefficients" in maps[s.map] && { coefficients: s.coefficients }),
    ...(s.mapParameter !== undefined && { mapParameter: s.mapParameter }),
    ...(s.exclusionRadius !== undefined && {
      exclusionRadius: s.exclusionRadius,
    }),
    source: s.source,
    samples: s.samples,
    tolerance: s.tolerance,
    selected: s.selected,
    parameter: s.parameter,
  };
}
// Uniform absolute source parameter, independent of sampling density or speed.
export function traversal(s: LoomStudy, progress: number): LoomRequest {
  const [a, b] = memberInterval(s.source, s.selected);
  return { ...loomRequest(s), parameter: between(a, b, progress) };
}

// An explicit family replacement starts invalid family fields from valid
// defaults; valid edits and the frozen ordinary definition stay intact.
export function replaceSource(
  s: LoomSource,
  kind: LoomSource["kind"],
): LoomSource {
  const out = { ...s, kind };
  for (const k of ["xMin", "yMin"] as const)
    if (!Number.isFinite(out[k])) out[k] = -2;
  for (const k of ["xMax", "yMax"] as const)
    if (!Number.isFinite(out[k])) out[k] = 2;
  if (!Number.isFinite(out.radius) || out.radius <= 0 || out.radius > 1e6)
    out.radius = 1;
  for (const [k, fallback] of [
    ["count", 12],
    ["xCount", 13],
    ["yCount", 13],
  ] as const)
    if (!Number.isInteger(out[k]) || out[k] < 1 || out[k] > 32)
      out[k] = fallback;
  if (kind === "grid")
    for (const [a, b] of [
      ["xMin", "xMax"],
      ["yMin", "yMax"],
    ] as const)
      if (
        Math.abs(out[a]) > 1e6 ||
        Math.abs(out[b]) > 1e6 ||
        out[b] - out[a] < 1e-6 ||
        out[b] - out[a] > 1e5
      ) {
        out[a] = -2;
        out[b] = 2;
      }
  return out;
}
