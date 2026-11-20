// A geodesic polygon on a sphere, as both notebooks edit one: the 3D
// notebook's carried arrow (spatial/geodesics.tsx) and the 4D notebook's
// Hopf base path (tesseract/objects.ts). Vertex k is the chart point
// (cos v cos u, cos v sin u, sin v) at longitude u and latitude v; Go joins
// neighbors by shorter great-circle arcs (engine3/transport.go,
// engine4/sphere_path.go). Nothing here is mathematics the engines rely on:
// these are the controls' defaults and labels.
import { roundedGenerated } from "./atlas-queue";

export type PolygonVertex = { u: number; v: number };
export const minPolygonVertices = 3;
export const maxPolygonVertices = 12;

export const vertexLabel = (n: number, c: "u" | "v") => `Vertex ${n} ${c}`;

// A polygon starts as the octant triangle's corners, (1, 0, 0), (0, 1, 0)
// and (0, 0, 1) on the unit sphere.
export const polygonDefaults = (): PolygonVertex[] => [
  { u: 0, v: 0 },
  { u: Math.PI / 2, v: 0 },
  { u: 0, v: Math.PI / 2 },
];

// The vertex an added one follows: the middle of the closing side, from
// the last vertex back to the first, so the path keeps its shape. Its
// coordinates are generated angles (see generatedAngle); a pole keeps the
// longitude it was entered with.
export function nextVertex(vs: PolygonVertex[]): PolygonVertex {
  // A link may leave a polygon short of three: fill in the octant's next
  // corner.
  if (vs.length < 3) return polygonDefaults()[vs.length];
  const point = ({ u, v }: PolygonVertex) => [
    Math.cos(v) * Math.cos(u),
    Math.cos(v) * Math.sin(u),
    Math.sin(v),
  ];
  const a = point(vs[vs.length - 1]),
    b = point(vs[0]);
  const m = a.map((x, k) => x + b[k]);
  const size = Math.hypot(...m);
  if (!(size > 1e-9)) return { ...vs[vs.length - 1] };
  const v = Math.asin(Math.max(-1, Math.min(1, m[2] / size)));
  const u =
    Math.hypot(m[0], m[1]) > 1e-12 * size
      ? Math.atan2(m[1], m[0])
      : vs[vs.length - 1].u;
  return { u: generatedAngle(u), v: generatedAngle(v) };
}

// A generated angle in radians: a simple fraction of π (denominators up to
// 12, as the fields show them) when it lies within its rounding budget of
// one, and otherwise the value with any rounding tail removed. Both are
// meaningful doubles, so candidates keep at most 15 digits.
function generatedAngle(x: number) {
  const budget = Number.EPSILON * Math.max(Math.abs(x), Math.PI);
  for (let q = 1; q <= 12; q++) {
    const exact = (Math.round((x * q) / Math.PI) * Math.PI) / q;
    if (Math.abs(exact - x) <= budget) return exact;
  }
  return roundedGenerated(x, Math.PI, 15);
}
