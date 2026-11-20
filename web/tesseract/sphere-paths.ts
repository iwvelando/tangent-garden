// The base paths of Base sphere and fibers, each one descriptor: its labels,
// help, notes, active fields, motions and base-curve resolution. The weave's
// object descriptor (objects.ts) and the worker read this table, so no
// component branches on a path's name. The mathematics, sampling and pole
// rules belong to Go (engine4/sphere_path.go, docs/tesseracts.md).
import { tiered, type Help } from "../help";
import { maxPolygonVertices } from "../sphere-polygon";
import type { Config, TesseractTarget, Weave } from "./types";

export type SpherePathId = NonNullable<Weave["path"]>;
export type SpherePath = {
  // The Base path option and the base sphere's key entry.
  label: string;
  // As in "one fiber over one <noun> of S²".
  noun: string;
  fibersLabel: string;
  countNote: string;
  // The moving point's readout label.
  parameterLabel: string;
  traceLabel: string;
  traceHelp: Help<string>;
  layerLabel: string;
  colorNote: string;
  explanation: [string, string, string];
  // The fields this path reads besides the shared counts and rotations.
  // The latitude's α and its sweep endpoints are fields of the weave.
  usesAlpha: boolean;
  sweep: boolean;
  phrase: TesseractTarget[];
  // Base-curve segments for N arc samples, as Go draws them.
  segments: (c: Config) => number;
};

export const pathOf = (c: Config): SpherePathId => c.weave?.path ?? "latitude";
// The descriptor of a result's path (correspondence.path, absent for the
// latitude).
export const resultPath = (path: SpherePathId | undefined) =>
  spherePaths[path ?? "latitude"];

const whole = (v: number | undefined, fallback: number) =>
  Number.isInteger(v) ? v! : fallback;
const gcd = (a: number, b: number): number => (b ? gcd(b, a % b) : a);
// Absent spherical Lissajous frequencies (Go's defaultAzimuthal and
// defaultPolar).
export const defaultAzimuthal = 2;
export const defaultPolar = 1;

export const spherePaths: Record<SpherePathId, SpherePath> = {
  latitude: {
    label: "Latitude",
    noun: "latitude",
    fibersLabel: "Fibers on the latitude",
    countNote:
      "Fibers sit at evenly spaced points of the latitude. Arc samples divide each circle, on the sphere and in space.",
    parameterLabel: "Moving point δ",
    traceLabel: "Trace the latitude",
    traceHelp: tiered(
      "Moves a point once around the latitude from the selected fiber, carrying its whole fiber.",
      "It meets each sampled fiber exactly and returns to the start, so it can loop. α and rotation stay fixed.",
    ),
    layerLabel: "Latitude, points and fibers",
    colorNote:
      "The latitude, its points and their fibers share the latitude's color; the selected fiber is drawn stronger, and the moving point and its fiber take the accent color. The base sphere shows each fiber's point before the 4D rotation. Open ends mark the projection window, not broken curves.",
    explanation: [
      "One point, one circle",
      "Each point p of the sphere S² has a whole great circle of the 3-sphere over it: its Hopf fiber, every q with H(q) = p. Points along one latitude give linked circles on one torus. Move the point and its fiber sweeps through the bouquet, meeting each sampled fiber exactly. The declared 4D rotation turns the fibers before projection; the base sphere still shows where each unrotated fiber maps.",
      "H(z₁, z₂) = (2 Re z₁z̄₂, 2 Im z₁z̄₂, |z₁|² − |z₂|²),   p(δ) = (sin 2α cos δ, sin 2α sin δ, cos 2α)",
    ],
    usesAlpha: true,
    sweep: true,
    phrase: [],
    segments: (c) => c.samples,
  },
  flower: {
    label: "Spherical flower",
    noun: "flower",
    fibersLabel: "Fibers on the flower",
    countNote:
      "Samples are even in parameter t, not spherical arc length. Arc samples divide each fiber; nonconstant flowers use at least 16 base segments per petal.",
    parameterLabel: "Moving point δ",
    traceLabel: "Trace the flower",
    traceHelp: tiered(
      "Moves a point once around the flower from the selected fiber, carrying its whole fiber.",
      "It meets each sampled fiber exactly and returns to the start, so it can loop. Path settings and rotation stay fixed.",
    ),
    layerLabel: "Flower, points and fibers",
    colorNote:
      "The flower, its points and their fibers share one color. The selected fiber is stronger; the moving point and fiber take the accent color. The base sphere shows the unrotated correspondence. Open ends mark the projection window.",
    explanation: [
      "A flower, a bouquet",
      "A smooth path wanders north and south on the sphere. Each sampled point owns a whole Hopf fiber; together they form a linked bouquet. Tracing carries one complete fiber around the flower. Changing coordinate charts only shifts a fiber's parameter origin: it never cuts the circle. The 4D rotation turns the fibers before projection; the base still shows their unrotated points.",
      "α(t) = α₀ + A cos(kt),   p(t) = (sin 2α cos t, sin 2α sin t, cos 2α)",
    ],
    usesAlpha: true,
    sweep: false,
    phrase: ["weave.amplitude"],
    segments: (c) =>
      (c.weave!.amplitude ?? 0) > 0
        ? Math.max(c.samples, 16 * whole(c.weave!.petals, 5))
        : c.samples,
  },
  "great-circle": {
    label: "Great circle",
    noun: "great circle",
    fibersLabel: "Fibers on the great circle",
    countNote:
      "Fibers sit at evenly spaced points of the great circle, which are even in arc length too. Arc samples divide each circle, on the sphere and in space.",
    parameterLabel: "Moving point t",
    traceLabel: "Trace the great circle",
    traceHelp: tiered(
      "Moves a point once around the great circle from the selected fiber, carrying its whole fiber.",
      "It meets each sampled fiber exactly and returns to the start, so it can loop. Tilt and rotation stay fixed.",
    ),
    layerLabel: "Great circle, points and fibers",
    colorNote:
      "The great circle, its points and their fibers share one color. The selected fiber is stronger; the moving point and fiber take the accent color. The base sphere shows the unrotated correspondence. Open ends mark the projection window.",
    explanation: [
      "A great circle, a great torus",
      "The fibers over any great circle of S² fill a Clifford torus that divides the 3-sphere into two equal solid tori. Tilting the circle turns that torus in four dimensions, so in space it swells and leans into a different ring. At tilt 0 it is the equator; at π/2 it passes over both poles, whose fibers are the xy and zw circles.",
      "p(t) = (cos t, cos β sin t, sin β sin t)",
    ],
    usesAlpha: false,
    sweep: false,
    phrase: ["weave.tilt"],
    segments: (c) => c.samples,
  },
  lissajous: {
    label: "Spherical Lissajous",
    noun: "Lissajous curve",
    fibersLabel: "Fibers on the Lissajous curve",
    countNote:
      "Samples are even in parameter t, not spherical arc length. Arc samples divide each fiber; the curve uses at least 16(m₁ + m₂)/g base segments, g the frequencies' common factor.",
    parameterLabel: "Moving point t",
    traceLabel: "Trace the Lissajous curve",
    traceHelp: tiered(
      "Moves a point once around the Lissajous curve from the selected fiber, carrying its whole fiber.",
      "It meets each sampled fiber exactly and returns to the start, so it can loop. Frequencies and rotation stay fixed.",
    ),
    layerLabel: "Lissajous curve, points and fibers",
    colorNote:
      "The curve, its points and their fibers share one color. The selected fiber is stronger; the moving point and fiber take the accent color. The base sphere shows the unrotated correspondence. Open ends mark the projection window.",
    explanation: [
      "A Lissajous curve, a braided bouquet",
      "The point turns m₁ times around the polar axis while it swings m₂ times from pole to pole, so the path passes over both poles. Every sampled point still owns one whole fiber, and any two distinct fibers link once. Passages over the same pole share one fiber, drawn once.",
      "p(t) = (sin(m₂t) cos(m₁t), sin(m₂t) sin(m₁t), cos(m₂t))",
    ],
    usesAlpha: false,
    sweep: false,
    phrase: [],
    segments: (c) => {
      const m1 = whole(c.weave!.azimuthal, defaultAzimuthal);
      const m2 = whole(c.weave!.polar, defaultPolar);
      return m1 >= 1 && m2 >= 1
        ? Math.max(c.samples, (16 * (m1 + m2)) / gcd(m1, m2))
        : c.samples;
    },
  },
  polygon: {
    label: "Geodesic polygon",
    noun: "polygon",
    fibersLabel: "Fibers on the polygon",
    countNote:
      "Fibers sit at points evenly spaced in arc length around the polygon. Arc samples divide each fiber and the polygon, whose corners are drawn exactly.",
    parameterLabel: "Moving point t",
    traceLabel: "Trace the polygon",
    traceHelp: tiered(
      "Moves a point once around the polygon from the selected fiber, carrying its whole fiber.",
      "It turns each corner without a jump, meets each sampled fiber exactly and returns to the start, so it can loop. Vertices and rotation stay fixed.",
    ),
    layerLabel: "Polygon, points and fibers",
    colorNote:
      "The polygon, its points and their fibers share one color. The selected fiber is stronger; the moving point and fiber take the accent color. The base sphere shows the unrotated correspondence. Open ends mark the projection window.",
    explanation: [
      "Corners, seams between tori",
      "Each side of the polygon is an arc of a great circle, and the fibers over a great circle fill a Clifford torus that halves the 3-sphere. So the bouquet is a ring of torus pieces, one for each side, stitched together along the fibers over the corners. Tracing carries one fiber across each seam without a jump; only the direction it sweeps in turns.",
      "p(t) = pᵢ cos(t − sᵢ) + (Bᵢ × pᵢ) sin(t − sᵢ),   pᵢ = (cos v cos u, cos v sin u, sin v)",
    ],
    usesAlpha: false,
    sweep: false,
    phrase: [],
    // The arc samples and at most one inserted corner for each vertex
    // after the first (Go inserts those no uniform point already meets).
    segments: (c) =>
      c.samples +
      Math.max(
        0,
        Math.min(maxPolygonVertices, c.weave!.vertices?.length ?? 0) - 1,
      ),
  },
};
