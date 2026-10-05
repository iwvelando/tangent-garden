import type {
  RefinedPath,
  SpatialResult,
  SurfaceSheet,
  Vec3,
  Bounds3,
  ReceiverResult,
  ImplicitResult,
} from "./types";
import type { Basis } from "../named-views";

export type View = Bounds3 & {
  yaw: number;
  pitch: number;
  zoom: number;
  panX: number;
  panY: number;
  // A perspective camera in place of the orthographic turntable, when
  // present: only the camera that rides a ray (see ride.ts) draws with one.
  lens?: Lens;
  // The turntable's projection, orthographic when absent (see camera).
  projection?: Projection;
};
// The manual camera's projections: orthographic, or a pinhole through a
// lens whose angle in degrees spans the page's shorter side.
export type Projection = "orthographic" | "narrow" | "normal" | "wide";
export const projections: Record<Projection, { label: string; fov?: number }> =
  {
    orthographic: { label: "Orthographic" },
    narrow: { label: "Perspective · narrow, 30°", fov: 30 },
    normal: { label: "Perspective · normal, 50°", fov: 50 },
    wide: { label: "Perspective · wide, 90°", fov: 90 },
  };
// A pinhole camera at eye looking along forward, with up toward the top of
// the page (made perpendicular to forward). fov is the angle in degrees
// across the page's shorter side; near and far are distances from the eye
// along forward, the clip volume's depth.
export type Lens = {
  projection: "perspective";
  eye: Vec3;
  forward: Vec3;
  up: Vec3;
  fov: number;
  near: number;
  far: number;
};
export const initialView = { yaw: 0.3, pitch: 0.75, zoom: 1, panX: 0, panY: 0 };
// Surface, rulings, and edges belong to the tangent developable; filaments
// and strings to the involute; projection, connectors and pole to tangent
// projections; inverse, correspondences, sphere and source to sphere
// inversion; vectors and ellipses to a harmonic curve under any
// construction; strands, frames and seam to the framed construction, whose
// ribbon reuses surface, rulings and edges; the ruled construction reuses
// surface, rulings and edges, its partner thread drawn as the edge; and the
// canal construction reuses surface, frames and seam, with its own contact
// circles and meridians; trajectories, arrows and seeds to a vector field
// under any construction, and trajectories, polygons and seeds to a pursuit,
// whose other paths and starts they draw. A surface study draws its patch
// as the surface, with its parameter curves, normal lines, offset, and each
// focal sheet (its faces, its parameter curves, and a cross when it is a
// point) as their own layers. A ray study draws its mirror or interface as
// the surface, with its parameter curves; each caustic branch's real part
// as a focal sheet; its incident rays (with the source), outgoing rays
// (reflected, transmitted, or totally reflected), and virtual rays with the
// caustics' virtual parts, as lines; and its receiver's irradiance, each
// as their own layers. An implicit surface draws its level set as the
// surface; its section curves, the planes they lie on, and the box with the
// edges where the box cuts the surface open and where it stops beside cells
// left out (with crosses at poles and jumps) as their own layers. The base
// curve is always drawn. When a construction is built on a derived input
// curve, that curve is drawn as the base, and the base curve itself is the
// parent, with the projection's connectors and pole, or an involute's
// strings as its connectors.
export type Layers = {
  surface: boolean;
  rulings: boolean;
  edges: boolean;
  filaments: boolean;
  strings: boolean;
  projection: boolean;
  parent: boolean;
  connectors: boolean;
  pole: boolean;
  inverse: boolean;
  correspondences: boolean;
  sphere: boolean;
  source: boolean;
  vectors: boolean;
  ellipses: boolean;
  strands: boolean;
  frames: boolean;
  seam: boolean;
  circles: boolean;
  meridians: boolean;
  trajectories: boolean;
  arrows: boolean;
  seeds: boolean;
  polygons: boolean;
  curves: boolean;
  normals: boolean;
  offset: boolean;
  focal1: boolean;
  focal2: boolean;
  incident: boolean;
  reflected: boolean;
  virtual: boolean;
  receiver: boolean;
  sections: boolean;
  planes: boolean;
  box: boolean;
};
export const defaultLayers: Layers = {
  surface: true,
  rulings: true,
  edges: true,
  filaments: true,
  strings: true,
  projection: true,
  parent: true,
  connectors: true,
  pole: true,
  inverse: true,
  correspondences: true,
  sphere: true,
  source: true,
  vectors: true,
  ellipses: true,
  strands: true,
  frames: true,
  seam: true,
  circles: true,
  meridians: true,
  trajectories: true,
  arrows: true,
  seeds: true,
  polygons: true,
  curves: true,
  normals: true,
  offset: true,
  focal1: true,
  focal2: true,
  incident: true,
  reflected: true,
  virtual: true,
  receiver: true,
  sections: true,
  planes: true,
  box: true,
};

// Each receiver bin as two flat triangles whose phase is its shade: the
// irradiance's log over three decades below the peak, from 0 to 1, or −1
// where no light lands.
export function receiverShade(e: number, peak: number) {
  return e > 0 && peak > 0
    ? Math.max(0, Math.min(1, 1 + Math.log10(e / peak) / 3))
    : -1;
}
function receiverVertices(g: ReceiverResult | null | undefined) {
  if (!g) return [];
  const n = g.irradiance.length,
    [o, a, , b] = g.corners;
  const at = (s: number, t: number) => ({
    x: o.x + (s * (a.x - o.x) + t * (b.x - o.x)) / n,
    y: o.y + (s * (a.y - o.y) + t * (b.y - o.y)) / n,
    z: o.z + (s * (a.z - o.z) + t * (b.z - o.z)) / n,
  });
  const out: number[] = [];
  g.irradiance.forEach((column, i) =>
    column.forEach((e, j) => {
      const shade = receiverShade(e, g.peak);
      for (const [s, t] of [
        [i, j],
        [i + 1, j],
        [i + 1, j + 1],
        [i, j],
        [i + 1, j + 1],
        [i, j + 1],
      ]) {
        const p = at(s, t);
        out.push(p.x, p.y, p.z, 0, 0, 1, shade);
      }
    }),
  );
  return out;
}

// An implicit surface as the engine's shared vertices, each with its normal
// and phase, and three indices per triangle. A corner whose vertex has no
// normal (∇F gave none) takes the triangle's own, as a copy of the vertex;
// a triangle without area is left out. The phase is the height in the box
// (decorative, not a measured quantity).
export function implicitMesh(m: ImplicitResult | undefined) {
  if (!m) return { vertices: new Float32Array(), indices: new Uint32Array() };
  const p = m.positions,
    n = m.normals,
    t = m.triangles;
  const low = m.box.zMin,
    span = m.box.zMax - m.box.zMin;
  const count = p.length / 3;
  const own = (v: number) => n[v] !== 0 || n[v + 1] !== 0 || n[v + 2] !== 0;
  let copies = 0;
  for (let k = 0; k < t.length; k++) if (!own(3 * t[k])) copies++;
  const vertices = new Float32Array(7 * (count + copies));
  const put = (i: number, v: number, a: number, b: number, c: number) => {
    const o = 7 * i;
    vertices[o] = p[v];
    vertices[o + 1] = p[v + 1];
    vertices[o + 2] = p[v + 2];
    vertices[o + 3] = a;
    vertices[o + 4] = b;
    vertices[o + 5] = c;
    vertices[o + 6] = (p[v + 2] - low) / span;
  };
  for (let i = 0; i < count; i++)
    put(i, 3 * i, n[3 * i], n[3 * i + 1], n[3 * i + 2]);
  const indices = new Uint32Array(t.length);
  let used = 0,
    next = count;
  for (let k = 0; k < t.length; k += 3) {
    const a = 3 * t[k],
      b = 3 * t[k + 1],
      c = 3 * t[k + 2];
    const e0 = p[b] - p[a],
      e1 = p[b + 1] - p[a + 1],
      e2 = p[b + 2] - p[a + 2],
      f0 = p[c] - p[a],
      f1 = p[c + 1] - p[a + 1],
      f2 = p[c + 2] - p[a + 2];
    const x = e1 * f2 - e2 * f1,
      y = e2 * f0 - e0 * f2,
      z = e0 * f1 - e1 * f0;
    const size = Math.hypot(x, y, z);
    if (!(size > 0)) continue;
    for (const v of [a, b, c]) {
      if (own(v)) indices[used++] = v / 3;
      else {
        put(next, v, x / size, y / size, z / size);
        indices[used++] = next++;
      }
    }
  }
  return {
    vertices: vertices.slice(0, 7 * next),
    indices: indices.slice(0, used),
  };
}
// The box's twelve edges.
function boxEdges(m: ImplicitResult | undefined): Vec3[] {
  if (!m) return [];
  const b = m.box;
  const corner = (c: number) => ({
    x: c & 1 ? b.xMax : b.xMin,
    y: c & 2 ? b.yMax : b.yMin,
    z: c & 4 ? b.zMax : b.zMin,
  });
  const out: Vec3[] = [];
  for (let c = 0; c < 8; c++)
    for (const bit of [1, 2, 4])
      if (!(c & bit)) out.push(corner(c), corner(c | bit));
  return out;
}
// Pairs of vertex indices as segments.
function indexed(m: ImplicitResult | undefined, pairs: Int32Array | undefined) {
  if (!m || !pairs) return [];
  return Array.from(pairs, (v) => ({
    x: m.positions[3 * v],
    y: m.positions[3 * v + 1],
    z: m.positions[3 * v + 2],
  }));
}

// Geometry ready to draw: world positions, each vertex with a normal and a
// phase (7 floats), as line pairs or triangles, with the ink that colors
// them. An indexed batch draws its triangles by index. A line batch may
// carry its own regular weight in page pixels, in place of its ink's (see
// sight.ts).
export type Batch = {
  mode: "lines" | "triangles";
  data: Float32Array;
  ink: number;
  indices?: Uint32Array;
  weight?: number;
};

// Everything the drawing shows of a result, built once per result. The
// WebGL renderer uploads it, and vector linework projects its lines.
export function buildScene(result: SpatialResult) {
  function batch(
    data: number[] | Float32Array,
    mode: Batch["mode"],
    ink: number,
    weight?: number,
  ): Batch {
    return {
      mode,
      data: data instanceof Float32Array ? data : new Float32Array(data),
      ink,
      ...(weight !== undefined && { weight }),
    };
  }
  function meshBatch(m: ImplicitResult | undefined, ink: number): Batch {
    const { vertices, indices } = implicitMesh(m);
    return { mode: "triangles", data: vertices, ink, indices };
  }
  function pairs(points: (Vec3 | null)[], breaks: boolean[]) {
    const out: Vec3[] = [];
    for (let i = 1; i < points.length; i++)
      if (points[i - 1] && points[i] && !breaks[i])
        out.push(points[i - 1]!, points[i]!);
    return out;
  }
  // A refined curve's points in order, joined except beside a null, which
  // carries every break.
  function joined(points: (Vec3 | null)[]) {
    const out: Vec3[] = [];
    for (let i = 1; i < points.length; i++)
      if (points[i - 1] && points[i]) out.push(points[i - 1]!, points[i]!);
    return out;
  }
  // A drawn curve's own samples with their breaks, or its refinement when
  // the study has one.
  const curve = (
    points: (Vec3 | null)[],
    breaks: boolean[],
    refined: RefinedPath | undefined,
  ) => (refined ? joined(refined.points) : pairs(points, breaks));
  const vertices = (points: Vec3[], phase = 0) =>
    points.flatMap((p) => [p.x, p.y, p.z, 0, 0, 1, phase]);
  function path(
    points: (Vec3 | null)[],
    breaks: boolean[],
    ink: number,
    refined?: RefinedPath,
    weight?: number,
  ) {
    return batch(
      vertices(curve(points, breaks, refined)),
      "lines",
      ink,
      weight,
    );
  }
  // Every member shares the base's breaks: arc length never crosses one, so
  // a member has no points beyond it. A collapsed member (a line's involute)
  // is one point, marked by a small three-axis cross sized to the study.
  function filamentBatch(result: SpatialResult) {
    const members = result.involute?.members ?? [];
    const arm = result.bounds.radius * 0.025;
    const data = members.flatMap((m, k) => {
      const phase = members.length > 1 ? k / (members.length - 1) : 0;
      const at = m.points.find((p) => p);
      if (m.collapsed && at)
        return vertices(
          (["x", "y", "z"] as const).flatMap((axis) => [
            { ...at, [axis]: at[axis] - arm },
            { ...at, [axis]: at[axis] + arm },
          ]),
          phase,
        );
      return vertices(
        curve(m.points, result.breaks, result.adaptive?.involute?.[k]),
        phase,
      );
    });
    return batch(data, "lines", 3);
  }
  // A sheet's faces as two triangles each. Where a corner has no normal
  // (a chart singularity, an umbilic or cuspidal edge of a focal sheet), the
  // triangle's own normal shades it; a triangle without area is skipped.
  function sheetBatch(sheet: SurfaceSheet, ink: number) {
    const data: number[] = [];
    const last = Math.max(1, sheet.points.length - 1);
    sheet.faces.forEach((column, i) =>
      column.forEach((face, j) => {
        if (!face) return;
        const corners: [number, number][] = [
          [i, j],
          [i + 1, j],
          [i + 1, j + 1],
          [i, j + 1],
        ];
        for (const [a, b, c] of [
          [0, 1, 2],
          [0, 2, 3],
        ]) {
          const at = [a, b, c].map((k) => corners[k]);
          const [p, q, r] = at.map(([u, v]) => sheet.points[u][v]!);
          const e = { x: q.x - p.x, y: q.y - p.y, z: q.z - p.z },
            f = { x: r.x - p.x, y: r.y - p.y, z: r.z - p.z };
          const flat = {
            x: e.y * f.z - e.z * f.y,
            y: e.z * f.x - e.x * f.z,
            z: e.x * f.y - e.y * f.x,
          };
          const size = Math.hypot(flat.x, flat.y, flat.z);
          const missing = at.some(([u, v]) => !sheet.normals[u][v]);
          if (missing && !(size > 0)) continue;
          at.forEach(([u, v]) => {
            const point = sheet.points[u][v]!,
              n = sheet.normals[u][v] ?? {
                x: flat.x / size,
                y: flat.y / size,
                z: flat.z / size,
              };
            data.push(point.x, point.y, point.z, n.x, n.y, n.z, u / last);
          });
        }
      }),
    );
    return batch(data, "triangles", ink);
  }
  // The representative parameter curves on a sheet, joined where its edges
  // are.
  function sheetLines(
    sheet: SurfaceSheet,
    uCurves: number[],
    vCurves: number[],
  ): Vec3[] {
    const out: Vec3[] = [];
    for (const j of uCurves)
      sheet.alongU.forEach((column, i) => {
        if (column[j]) out.push(sheet.points[i][j]!, sheet.points[i + 1][j]!);
      });
    for (const i of vCurves)
      (sheet.alongV[i] ?? []).forEach((joined, j) => {
        if (joined) out.push(sheet.points[i][j]!, sheet.points[i][j + 1]!);
      });
    return out;
  }
  const cross = (at: Vec3, arm: number): Vec3[] =>
    (["x", "y", "z"] as const).flatMap((axis) => [
      { ...at, [axis]: at[axis] - arm },
      { ...at, [axis]: at[axis] + arm },
    ]);
  const mesh = batch(
    result.mesh.flatMap((v) => [
      v.position.x,
      v.position.y,
      v.position.z,
      v.normal.x,
      v.normal.y,
      v.normal.z,
      v.phase,
    ]),
    "triangles",
    0,
  );
  const refined = result.adaptive;
  const base = path(result.base, result.breaks, 2, refined?.base);
  // A framed ribbon's edges are also broken where a Frenet normal reverses.
  // A ruled surface's partner thread (its plus) is broken where the
  // partner is missing or jumps, and drawn from its own refinement when the
  // study has one.
  const edgeBreaks =
    result.frame?.breaks ?? result.ruled?.breaks ?? result.breaks;
  // A ribbon's edges and a partner thread bound a sheet: lighter than the
  // curve they accompany.
  const minus = path(result.minus, edgeBreaks, 2, undefined, 1.4);
  const plus = path(result.plus, edgeBreaks, 2, refined?.partner, 1.4);
  const rulings = batch(
    result.rulings
      .flatMap((r) => [r.from, r.to])
      .flatMap((p) => [p.x, p.y, p.z, 0, 0, 1, 0]),
    "lines",
    1,
  );
  // A projection's own connectors, or those of the projection a
  // construction is built on; an involute input has strings from the base
  // instead, with no pole or feet.
  const q = result.projection ?? result.composition;
  const strung = result.composition?.input === "involute";
  const at = result.projection?.points.find((p) => p);
  const projection = batch(
    vertices(
      result.projection?.collapsed && at
        ? cross(at, result.bounds.radius * 0.025)
        : curve(
            result.projection?.points ?? [],
            result.breaks,
            refined?.projection,
          ),
    ),
    "lines",
    3,
  );
  const connectors = batch(
    vertices(
      (q?.constructions ?? []).flatMap((c) =>
        strung
          ? [c.contact, c.image]
          : [c.contact, c.foot, q!.pole, c.foot, c.foot, c.image],
      ),
    ),
    "lines",
    4,
  );
  const feet = batch(
    vertices(
      (strung ? [] : (q?.constructions ?? [])).flatMap((c) =>
        cross(c.foot, result.bounds.radius * 0.006),
      ),
    ),
    "lines",
    1,
  );
  const pole = batch(
    vertices(q && !strung ? cross(q.pole, result.bounds.radius * 0.03) : []),
    "lines",
    1,
  );
  // The base curve under a derived input, with its own breaks.
  const parent = path(
    result.composition?.curve ?? [],
    result.composition?.breaks ?? [],
    4,
    refined?.parent,
  );
  // The image uses its own breaks: the base's plus every passage through
  // the center, where the image leaves through infinity.
  const v = result.inversion;
  const image = v?.points.find((p) => p);
  const inverse = batch(
    vertices(
      v?.collapsed && image
        ? cross(image, result.bounds.radius * 0.025)
        : curve(v?.points ?? [], v?.breaks ?? [], refined?.image),
    ),
    "lines",
    3,
  );
  const correspondences = batch(
    vertices((v?.correspondences ?? []).flatMap((c) => [c.source, c.image])),
    "lines",
    4,
  );
  // Three great circles show the sphere sparingly, without a surface that
  // would hide the curves.
  const greatCircles = (o: Vec3, r: number) => {
    const circle = (u: Vec3, w: Vec3) =>
      Array.from({ length: 96 }, (_, k) => {
        const [a, b] = [0, 1].map((d) => (2 * Math.PI * (k + d)) / 96);
        return [a, b].map((t) => ({
          x: o.x + r * (Math.cos(t) * u.x + Math.sin(t) * w.x),
          y: o.y + r * (Math.cos(t) * u.y + Math.sin(t) * w.y),
          z: o.z + r * (Math.cos(t) * u.z + Math.sin(t) * w.z),
        }));
      }).flat();
    const [i, j, k] = [
      { x: 1, y: 0, z: 0 },
      { x: 0, y: 1, z: 0 },
      { x: 0, y: 0, z: 1 },
    ];
    return [...circle(i, j), ...circle(j, k), ...circle(k, i)];
  };
  const sphere = batch(
    vertices(v ? greatCircles(v.center, v.radius) : []),
    "lines",
    4,
  );
  // Contact circles where the spheres touch their envelope; a sphere with
  // no real circle is drawn by its great circles, in grey. Meridians shade
  // across the family like offset strands.
  const canal = result.canal;
  const real = (canal?.circles ?? []).filter((g) => g.real);
  const circles = batch(
    vertices(
      real.flatMap((g) =>
        g.points.slice(1).flatMap((p, k) => [g.points[k], p]),
      ),
    ),
    "lines",
    1,
  );
  const spheres = batch(
    vertices(
      (canal?.circles ?? [])
        .filter((g) => !g.real)
        .flatMap((g) => greatCircles(g.center, g.sphere)),
    ),
    "lines",
    4,
  );
  // Meridians, like offset strands, are drawn from their own refinement
  // when the study has one.
  const lines = canal?.meridians ?? [];
  const meridians = batch(
    lines.flatMap((points, k) =>
      vertices(
        curve(points, canal!.breaks, result.adaptive?.meridians?.[k]),
        lines.length > 1 ? k / (lines.length - 1) : 0,
      ),
    ),
    "lines",
    3,
  );
  const center = batch(
    vertices(v ? cross(v.center, result.bounds.radius * 0.03) : []),
    "lines",
    1,
  );
  // A derived source (a tangent projection) and its pole; a base source is
  // already drawn as the base.
  const source = batch(
    vertices(v?.pole ? pairs(v.source, result.breaks) : []),
    "lines",
    4,
  );
  const sourcePole = batch(
    vertices(v?.pole ? cross(v.pole, result.bounds.radius * 0.02) : []),
    "lines",
    1,
  );
  // A harmonic curve's chained generating vectors at every representative
  // sample, and, at the last one shown, that chain again with each turning
  // term's ellipse around its joint and a cross at c₀.
  const h = result.harmonic;
  const chain = (s: NonNullable<typeof h>["positions"][number]) =>
    s.joints.flatMap((j, k) => [j, s.joints[k + 1] ?? s.point]);
  const vectors = batch(
    vertices((h?.positions ?? []).flatMap(chain)),
    "lines",
    4,
  );
  const current = h?.positions.at(-1);
  const ellipses = batch(
    vertices(
      h && current
        ? [
            ...chain(current),
            ...cross(h.center, result.bounds.radius * 0.02),
            ...h.terms.flatMap((term, k) =>
              term.frequency === 0
                ? []
                : Array.from({ length: 64 }, (_, m) =>
                    [m, m + 1].map((d) => {
                      const t = (2 * Math.PI * d) / 64,
                        j = current.joints[k];
                      return {
                        x:
                          j.x +
                          Math.cos(t) * term.cosine.x +
                          Math.sin(t) * term.sine.x,
                        y:
                          j.y +
                          Math.cos(t) * term.cosine.y +
                          Math.sin(t) * term.sine.y,
                        z:
                          j.z +
                          Math.cos(t) * term.cosine.z +
                          Math.sin(t) * term.sine.z,
                      };
                    }),
                  ).flat(),
            ),
          ]
        : [],
    ),
    "lines",
    1,
  );
  // Offset strands shade across the family like involute filaments, each
  // drawn from its own refinement when the study has one. Frame
  // glyphs draw U (the longer arm) and V, with a short T behind them; the
  // seam shows the offset direction where the loop starts and where it
  // returns.
  const f = result.frame;
  const offsets = f?.strands ?? [];
  const strands = batch(
    offsets.flatMap((points, k) =>
      vertices(
        curve(points, f!.breaks, result.adaptive?.strands?.[k]),
        offsets.length > 1 ? k / (offsets.length - 1) : 0,
      ),
    ),
    "lines",
    3,
  );
  const arm = result.bounds.radius * 0.06;
  const along = (p: Vec3, d: Vec3, length: number) => [
    p,
    {
      x: p.x + d.x * length,
      y: p.y + d.y * length,
      z: p.z + d.z * length,
    },
  ];
  const frames = batch(
    vertices(
      (f?.frames ?? []).flatMap((g) => [
        ...along(g.point, g.normal, arm),
        ...along(g.point, g.binormal, arm * 0.6),
      ]),
    ),
    "lines",
    1,
  );
  const tangents = batch(
    vertices(
      (f?.frames ?? []).flatMap((g) => along(g.point, g.tangent, arm * 0.6)),
    ),
    "lines",
    4,
  );
  // The seam's arms reach past the ribbon and strands, joined by an arc
  // that sweeps the return angle about the starting tangent.
  const seamLines = () => {
    const s = f!.seam!,
      g = f!.frames[0];
    const beyond = (p: Vec3 | null | undefined) =>
      p ? Math.hypot(p.x - s.point.x, p.y - s.point.y, p.z - s.point.z) : 0;
    const reach =
      1.4 *
      Math.max(
        arm * 1.5,
        beyond(result.plus[0]),
        ...f!.strands.map((points) => beyond(points[0])),
        ...(result.canal?.meridians ?? []).map((points) => beyond(points[0])),
      );
    const normal = {
      x: g.tangent.y * s.start.z - g.tangent.z * s.start.y,
      y: g.tangent.z * s.start.x - g.tangent.x * s.start.z,
      z: g.tangent.x * s.start.y - g.tangent.y * s.start.x,
    };
    const at = (k: number) => {
      const phi = (s.angle * k) / 32,
        [c, n] = [Math.cos(phi), Math.sin(phi)];
      return along(
        s.point,
        {
          x: c * s.start.x + n * normal.x,
          y: c * s.start.y + n * normal.y,
          z: c * s.start.z + n * normal.z,
        },
        reach * 0.75,
      )[1];
    };
    return [
      ...along(s.point, s.start, reach),
      ...along(s.point, s.end, reach),
      ...Array.from({ length: 32 }, (_, k) => [at(k), at(k + 1)]).flat(),
    ];
  };
  const seam = batch(
    vertices(f?.seam && f.frames[0]?.sampleIndex === 0 ? seamLines() : []),
    "lines",
    2,
    1.4,
  );
  const filaments = filamentBatch(result);
  const strings = batch(
    vertices((result.involute?.strings ?? []).flatMap((r) => [r.from, r.to])),
    "lines",
    4,
  );
  // The first trajectory or pursuer is the base, drawn as such. The others
  // shade from teal to gold by order (decorative), joined wherever both
  // ends of an interval are known; a path has no break before its end.
  const flow = result.field;
  const chase = result.pursuit;
  const paths = flow?.paths ?? chase?.paths ?? [];
  const trajectories = batch(
    paths
      .slice(1)
      .flatMap((points, k) =>
        vertices(
          pairs(points, []),
          paths.length > 2 ? k / (paths.length - 2) : 0,
        ),
      ),
    "lines",
    3,
  );
  // Arrows show the field's direction only: one length, pointing on.
  const reach = result.bounds.radius * 0.07;
  const arrows = batch(
    vertices(
      (flow?.arrows ?? []).flatMap((a) => {
        const speed = Math.hypot(a.velocity.x, a.velocity.y, a.velocity.z);
        return along(
          a.point,
          {
            x: a.velocity.x / speed,
            y: a.velocity.y / speed,
            z: a.velocity.z / speed,
          },
          reach,
        );
      }),
    ),
    "lines",
    4,
  );
  // Seeds or starts, and where a trajectory stopped, or the whole chase
  // stopped, before the end of the interval.
  const early = chase && (chase.capture || chase.exhausted) ? chase.final : [];
  const seeds = batch(
    vertices([
      ...paths
        .map((p) => p[0])
        .filter((p): p is Vec3 => !!p)
        .flatMap((p) => cross(p, result.bounds.radius * 0.02)),
      ...[
        ...(flow?.ends ?? [])
          .filter((e) => e.reason !== "end" && e.point)
          .map((e) => e.point!),
        ...early,
      ].flatMap((p) => cross(p, result.bounds.radius * 0.012)),
    ]),
    "lines",
    1,
  );
  const surface = result.surface,
    rays = result.rays,
    patch = surface ?? rays;
  const empty: SurfaceSheet = {
    points: [],
    normals: [],
    alongU: [],
    alongV: [],
    faces: [],
  };
  const sheet = sheetBatch(patch?.surface ?? empty, 0);
  const sheetCurves = batch(
    vertices(
      patch ? sheetLines(patch.surface, patch.uCurves, patch.vCurves) : [],
    ),
    "lines",
    1,
  );
  const normalLines = batch(
    vertices((surface?.lines ?? []).flatMap((l) => [l.point, l.end])),
    "lines",
    4,
  );
  const offsetSheet = sheetBatch(surface?.offset ?? empty, -1);
  // A branch drawn as lines: its parameter curves, or a cross when it is
  // a point.
  const branchLines = (f: SurfaceSheet & { shape: string }, k: number) => {
    const at = f.points.flat().find((p) => p);
    return batch(
      vertices(
        f.shape === "point" && at
          ? cross(at, result.bounds.radius * 0.04)
          : sheetLines(f, patch!.uCurves, patch!.vCurves),
      ),
      "lines",
      5 + k,
    );
  };
  // A caustic's real parts are shaded like focal sheets; its virtual
  // parts, behind the mirror, are drawn only as lines.
  const part = (virtual: boolean) =>
    ([1, 2] as const).map((b) =>
      rays!.caustics.find((c) => c.branch === b && c.virtual === virtual)!,
    );
  const realParts = rays ? part(false) : (surface?.focal ?? []);
  const focalSheets = realParts.map((f, k) => sheetBatch(f, -2 - k));
  const focalCurves = realParts.map(branchLines);
  const virtualCaustics = rays ? part(true).map(branchLines) : [];
  const rayLines = rays?.lines ?? [];
  const incidentRays = batch(
    vertices(rayLines.flatMap((l) => [l.start, l.point])),
    "lines",
    4,
  );
  // Outgoing rays come in families: as light as construction lines.
  const reflectedRays = batch(
    vertices(rayLines.filter((l) => !l.total).flatMap((l) => [l.point, l.end])),
    "lines",
    2,
    0.9,
  );
  // Beyond the critical angle nothing is transmitted: the totally
  // reflected rays recede in grey.
  const totalRays = batch(
    vertices(rayLines.filter((l) => l.total).flatMap((l) => [l.point, l.end])),
    "lines",
    4,
  );
  const receiverSheet = batch(receiverVertices(rays?.receiver), "triangles", 7);
  const receiverFrame = batch(
    vertices(
      rays?.receiver
        ? rays.receiver.corners.flatMap((p, k, all) => [p, all[(k + 1) % 4]])
        : [],
    ),
    "lines",
    4,
  );
  const virtualRays = batch(
    // Only a ray with a virtual caustic point leads anywhere behind the
    // mirror.
    vertices(
      rayLines.filter((l) => l.virtual).flatMap((l) => [l.point, l.back]),
    ),
    "lines",
    4,
  );
  const lamp = batch(
    vertices(
      rays?.source ? cross(rays.source, result.bounds.radius * 0.03) : [],
    ),
    "lines",
    2,
    1.4,
  );
  // A level surface, its sections (each closed curve back to its start),
  // the planes they lie on, the box, and the edges where the surface is
  // cut open by the box or stops beside cells left out, with crosses at
  // poles and jumps.
  const level = result.implicit;
  const levelSheet = meshBatch(level, 0);
  const sectionLines = batch(
    vertices(
      (level?.sections ?? []).flatMap((s) =>
        s.paths.flatMap((path) =>
          path.points.flatMap((p, k, all) =>
            k + 1 < all.length
              ? [p, all[k + 1]]
              : path.closed && all.length > 2
                ? [p, all[0]]
                : [],
          ),
        ),
      ),
    ),
    "lines",
    2,
    1.8,
  );
  const planeLines = batch(
    vertices(
      (level?.sections ?? []).flatMap((s) =>
        s.polygon.flatMap((p, k, all) => [p, all[(k + 1) % all.length]]),
      ),
    ),
    "lines",
    4,
  );
  const boxLines = batch(vertices(boxEdges(level)), "lines", 4);
  const cutLines = batch(vertices(indexed(level, level?.cut)), "lines", 1);
  const openLines = batch(
    vertices([
      ...indexed(level, level?.open),
      ...(level?.marks ?? []).flatMap((p) =>
        cross(p, result.bounds.radius * 0.008),
      ),
    ]),
    "lines",
    5,
  );
  // Each connecting polygon closes, the last pursuer back to the first.
  const polygons = batch(
    vertices(
      (chase?.polygons ?? []).flatMap((g) =>
        g.points.flatMap((p, j) => [p, g.points[(j + 1) % g.points.length]]),
      ),
    ),
    "lines",
    4,
  );
  return {
    mesh,
    base,
    minus,
    plus,
    rulings,
    projection,
    parent,
    connectors,
    feet,
    pole,
    inverse,
    correspondences,
    sphere,
    circles,
    spheres,
    meridians,
    center,
    source,
    sourcePole,
    vectors,
    ellipses,
    strands,
    frames,
    tangents,
    seam,
    filaments,
    strings,
    trajectories,
    arrows,
    seeds,
    sheet,
    sheetCurves,
    normalLines,
    offsetSheet,
    focalSheets,
    focalCurves,
    virtualCaustics,
    incidentRays,
    reflectedRays,
    totalRays,
    receiverSheet,
    receiverFrame,
    virtualRays,
    lamp,
    levelSheet,
    sectionLines,
    planeLines,
    boxLines,
    cutLines,
    openLines,
    polygons,
  };
}
export type Scene = ReturnType<typeof buildScene>;

// One step of the drawing: a batch, the layer that shows it (the base is
// always shown), and whether it is a shaded sheet, drawn pushed back so that
// lines lying on it stay in front. The cut's edge (see cut.ts) and the
// parameter probe are drawn whenever they are given.
export type Pass = {
  layer: keyof Layers | "base" | "probe" | "cut";
  batch: Batch;
  sheet: boolean;
};

// What the drawing shows of a scene with these layers, in drawing order,
// with the cut's edge and then the parameter probe's batches (see probe.ts),
// if any, drawn last.
export function scenePasses(
  s: Scene,
  layers: Layers,
  probe: Batch[] = [],
  edge: Batch | null = null,
): Pass[] {
  const out: Pass[] = [];
  const add = (
    layer: Pass["layer"],
    on: boolean,
    sheet: boolean,
    ...batches: Batch[]
  ) => {
    if (on) batches.forEach((batch) => out.push({ layer, batch, sheet }));
  };
  add("surface", layers.surface, true, s.mesh, s.sheet, s.levelSheet);
  add("offset", layers.offset, true, s.offsetSheet);
  const focal = (k: number): "focal1" | "focal2" =>
    k === 0 ? "focal1" : "focal2";
  s.focalSheets.forEach((f, k) => add(focal(k), layers[focal(k)], true, f));
  s.focalCurves.forEach((f, k) => add(focal(k), layers[focal(k)], false, f));
  add("curves", layers.curves, false, s.sheetCurves);
  add("normals", layers.normals, false, s.normalLines);
  add("incident", layers.incident, false, s.incidentRays, s.lamp);
  add("reflected", layers.reflected, false, s.reflectedRays, s.totalRays);
  add("receiver", layers.receiver, true, s.receiverSheet);
  add("receiver", layers.receiver, false, s.receiverFrame);
  add("sections", layers.sections, false, s.sectionLines);
  add("planes", layers.planes, false, s.planeLines);
  add("box", layers.box, false, s.boxLines, s.cutLines, s.openLines);
  add("virtual", layers.virtual, false, s.virtualRays, ...s.virtualCaustics);
  add("rulings", layers.rulings, false, s.rulings);
  add("edges", layers.edges, false, s.minus, s.plus);
  add("strands", layers.strands, false, s.strands);
  add("meridians", layers.meridians, false, s.meridians);
  add("circles", layers.circles, false, s.circles, s.spheres);
  add("frames", layers.frames, false, s.tangents, s.frames);
  add("strings", layers.strings, false, s.strings);
  add("filaments", layers.filaments, false, s.filaments);
  add("connectors", layers.connectors, false, s.connectors, s.feet);
  add("projection", layers.projection, false, s.projection);
  add("parent", layers.parent, false, s.parent);
  add("sphere", layers.sphere, false, s.sphere);
  add("correspondences", layers.correspondences, false, s.correspondences);
  add("source", layers.source, false, s.source, s.sourcePole);
  add("inverse", layers.inverse, false, s.inverse);
  add("vectors", layers.vectors, false, s.vectors);
  add("ellipses", layers.ellipses, false, s.ellipses);
  add("arrows", layers.arrows, false, s.arrows);
  add("polygons", layers.polygons, false, s.polygons);
  add("trajectories", layers.trajectories, false, s.trajectories);
  add("base", true, false, s.base);
  add("seeds", layers.seeds, false, s.seeds);
  add("seam", layers.seam, false, s.seam);
  add("pole", layers.pole, false, s.pole);
  add("sphere", layers.sphere, false, s.center);
  if (edge) add("cut", true, false, edge);
  add("probe", true, false, ...probe);
  return out;
}

// The orthographic camera, with identical scale on all three axes: rotate
// about the view center (a column-major matrix), pan, then scale so the
// study's radius × 1.16 spans the page's shorter side. Depth spans four
// radii either side of the center; nearer points have smaller depth.
//
// A view with a lens is drawn in perspective instead. Its rotation's rows
// are right (forward × up), up and back (−forward); its center is a focus
// point at distance E = radius ahead of the eye, where the field of view
// spans the page's shorter side. Clip w is the distance ahead of the eye
// over E, and clip depth is chosen so window depth runs from 0 at the near
// plane to 1 at the far one, affine in 1/distance:
//   w = 1 − z·lens[0],  depth = −z·framing[2] + lens[1]·w + lens[2],
// with z the rotated point's coordinate toward the viewer. Orthographic
// views have lens = 0, so w is exactly 1 and nothing they draw changes.
export type Camera = {
  rotation: number[];
  center: Vec3;
  pan: [number, number];
  framing: [number, number, number];
  lens: [number, number, number];
  width: number;
  height: number;
};
const unit3 = (v: Vec3) => {
  const n = Math.hypot(v.x, v.y, v.z);
  return { x: v.x / n, y: v.y / n, z: v.z / n };
};
export function camera(
  view: View,
  size: { width: number; height: number },
): Camera {
  if (view.lens) return perspective(view.lens, view.radius, size);
  const fov = projections[view.projection ?? "orthographic"].fov;
  if (fov) return perspective(turntableLens(view, fov), view.radius, size);
  const aspect = size.width / size.height;
  const c = Math.cos(view.yaw),
    s = Math.sin(view.yaw),
    a = Math.cos(view.pitch),
    b = Math.sin(view.pitch);
  const scale = view.zoom / (view.radius * 1.16);
  return {
    rotation: [c, b * s, -a * s, 0, a, b, s, -b * c, a * c],
    center: view.center,
    pan: [view.panX, view.panY],
    framing: [
      scale / Math.max(1, aspect),
      scale * Math.min(1, aspect),
      1 / (view.radius * 4),
    ],
    lens: [0, 0, 0],
    width: size.width,
    height: size.height,
  };
}
// The turntable seen through a lens: its rows right (c, 0, s), up
// (b s, a, −b c) and back (−a s, b, a c), about a target panned from the
// center along right and up. The eye is d = 1.16 radius / (zoom tan(fov/2))
// behind the target, so the plane through the target is drawn at the
// orthographic scale, panning moves it as before and zooming dollies the
// eye. Far reaches four radii past the center, as the orthographic depth;
// near is four radii short of it, or a hundredth of d once the eye is that
// close.
// The projection as an export's metadata records it, only when it is a
// perspective, so orthographic files are unchanged.
export function projectionRecord(view: View) {
  const fov = !view.lens && projections[view.projection ?? "orthographic"].fov;
  if (!fov) return undefined;
  return {
    name: view.projection,
    statement: `A pinhole perspective, ${fov}° across the page's shorter side, from an eye behind the view's target; the plane through the target is drawn at the orthographic scale, and zoom moves the eye.`,
  };
}
function turntableLens(view: View, fov: number): Lens {
  const c = Math.cos(view.yaw),
    s = Math.sin(view.yaw),
    a = Math.cos(view.pitch),
    b = Math.sin(view.pitch);
  const right = { x: c, y: 0, z: s },
    up = { x: b * s, y: a, z: -b * c },
    back = { x: -a * s, y: b, z: a * c };
  const d =
    (1.16 * view.radius) / (view.zoom * Math.tan((fov * Math.PI) / 360));
  const shift = (k: "x" | "y" | "z") =>
    -view.panX * right[k] - view.panY * up[k] + d * back[k];
  const eye = {
    x: view.center.x + shift("x"),
    y: view.center.y + shift("y"),
    z: view.center.z + shift("z"),
  };
  const reach = Math.hypot(
    eye.x - view.center.x,
    eye.y - view.center.y,
    eye.z - view.center.z,
  );
  return {
    projection: "perspective",
    eye,
    forward: { x: -back.x, y: -back.y, z: -back.z },
    up,
    fov,
    near: Math.max(reach - 4 * view.radius, d / 100),
    far: reach + 4 * view.radius,
  };
}
function perspective(
  lens: Lens,
  radius: number,
  size: { width: number; height: number },
): Camera {
  const aspect = size.width / size.height;
  const f = unit3(lens.forward),
    along = lens.up.x * f.x + lens.up.y * f.y + lens.up.z * f.z;
  const u = unit3({
    x: lens.up.x - along * f.x,
    y: lens.up.y - along * f.y,
    z: lens.up.z - along * f.z,
  });
  const r = {
    x: f.y * u.z - f.z * u.y,
    y: f.z * u.x - f.x * u.z,
    z: f.x * u.y - f.y * u.x,
  };
  const E = radius,
    n = lens.near,
    far = lens.far;
  const scale = 1 / (E * Math.tan((lens.fov * Math.PI) / 360));
  return {
    rotation: [r.x, u.x, -f.x, r.y, u.y, -f.y, r.z, u.z, -f.z],
    center: {
      x: lens.eye.x + E * f.x,
      y: lens.eye.y + E * f.y,
      z: lens.eye.z + E * f.z,
    },
    pan: [0, 0],
    framing: [scale / Math.max(1, aspect), scale * Math.min(1, aspect), 0],
    lens: [1 / E, (far + n) / (far - n), (-2 * far * n) / ((far - n) * E)],
    width: size.width,
    height: size.height,
  };
}
// A point in homogeneous clip coordinates, each of x, y and depth within
// [−w, w] where it is drawn: the vertex shader's arithmetic.
export function clip(k: Camera, x: number, y: number, z: number) {
  const r = k.rotation,
    dx = x - k.center.x,
    dy = y - k.center.y,
    dz = z - k.center.z;
  const toward = r[2] * dx + r[5] * dy + r[8] * dz;
  const w = 1 - toward * k.lens[0];
  return [
    (r[0] * dx + r[3] * dy + r[6] * dz + k.pan[0]) * k.framing[0],
    (r[1] * dx + r[4] * dy + r[7] * dz + k.pan[1]) * k.framing[1],
    -toward * k.framing[2] + k.lens[1] * w + k.lens[2],
    w,
  ] as [number, number, number, number];
}
// The drawn camera's rows, right, up and toward the viewer, for the
// orientation indicator: the turntable's, or a lens's (the ride's).
export function viewBasis(view: View): Basis {
  const r = camera(view, { width: 1, height: 1 }).rotation;
  return {
    right: [r[0], r[3], r[6]],
    up: [r[1], r[4], r[7]],
    back: [r[2], r[5], r[8]],
  };
}
// Clip coordinates as page pixels (y down) and window depth from 0 to 1.
export const page = (k: Camera, c: readonly number[]) => {
  const w = c[3] ?? 1;
  return {
    x: ((c[0] / w + 1) / 2) * k.width,
    y: ((1 - c[1] / w) / 2) * k.height,
    depth: (c[2] / w + 1) / 2,
  };
};
export const project = (k: Camera, p: Vec3) => page(k, clip(k, p.x, p.y, p.z));
