import type {
  SpatialResult,
  SurfaceSheet,
  Vec3,
  Bounds3,
  ReceiverResult,
} from "./types";

export type View = Bounds3 & {
  yaw: number;
  pitch: number;
  zoom: number;
  panX: number;
  panY: number;
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
// as their own layers. The base curve is always drawn.
export type Layers = {
  surface: boolean;
  rulings: boolean;
  edges: boolean;
  filaments: boolean;
  strings: boolean;
  projection: boolean;
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
};
export const defaultLayers: Layers = {
  surface: true,
  rulings: true,
  edges: true,
  filaments: true,
  strings: true,
  projection: true,
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
};
const vertexSource = `
attribute vec3 position;
attribute vec3 normal;
attribute float phase;
uniform mat3 rotation;
uniform vec3 framing;
uniform vec3 center;
uniform vec2 pan;
varying vec3 N;
varying vec3 P;
varying float U;
void main() {
  P = rotation * (position - center);
  N = rotation * normal;
  U = phase;
  gl_Position = vec4((P.x + pan.x) * framing.x, (P.y + pan.y) * framing.y, -P.z * framing.z, 1.0);
}`;
const fragmentSource = `
precision mediump float;
varying vec3 N;
varying vec3 P;
varying float U;
uniform float ink;
uniform float dark;
void main() {
  float blend = 0.5 + 0.5 * cos(6.2831853 * U);
  vec3 teal = mix(vec3(0.30,0.62,0.56),vec3(0.23,0.70,0.67),dark);
  vec3 gold = mix(vec3(0.90,0.66,0.36),vec3(0.94,0.65,0.31),dark);
  vec3 color = mix(teal,gold,blend);
  // A surface's focal sheets: rust for the first, slate for the second.
  vec3 rust = mix(vec3(0.72,0.36,0.26),vec3(0.90,0.55,0.42),dark);
  vec3 slate = mix(vec3(0.33,0.40,0.66),vec3(0.58,0.66,0.92),dark);
  if (ink > 6.5) {
    // A receiver's irradiance on a logarithmic ramp, unshaded and without
    // hue, since it is a measured quantity: ink on paper, or light on the
    // dark theme. U < 0 marks a bin no light reaches.
    vec3 empty = mix(vec3(0.91,0.90,0.86),vec3(0.12,0.14,0.14),dark);
    vec3 faint = mix(vec3(0.84,0.83,0.79),vec3(0.21,0.23,0.23),dark);
    vec3 full = mix(vec3(0.08,0.09,0.10),vec3(0.98,0.97,0.92),dark);
    color = U < 0.0 ? empty : mix(faint,full,U);
  } else if (ink > 5.5) {
    color = slate;
  } else if (ink > 4.5) {
    color = rust;
  } else if (ink > 3.5) {
    // Unwinding strings recede toward the background behind the filaments.
    color = mix(vec3(0.58,0.66,0.63),vec3(0.24,0.37,0.37),dark);
  } else if (ink > 2.5) {
    // Involute filaments: deep teal drifting toward gold across a family by
    // member position (decorative, not a measured quantity).
    vec3 deep = mix(vec3(0.66,0.40,0.12),gold,dark);
    color = mix(mix(vec3(0.04,0.38,0.36),vec3(0.40,0.88,0.80),dark),deep,0.7*U);
  } else if (ink > 0.5) {
    if (ink < 1.5) color = mix(vec3(0.10,0.30,0.29),vec3(0.63,0.89,0.83),dark);
    else color = mix(vec3(0.50,0.25,0.09),vec3(1.0,0.87,0.58),dark);
  } else {
    // Shaded sheets: a surface's offset in sage, its focal sheets in rust
    // and slate, anything else in the decorative teal and gold.
    if (ink < -2.5) color = slate;
    else if (ink < -1.5) color = rust;
    else if (ink < -0.5) color = mix(vec3(0.58,0.66,0.58),vec3(0.42,0.54,0.50),dark);
    vec3 n = normalize(N);
    if (!gl_FrontFacing) n = -n;
    float key = abs(dot(n,normalize(vec3(-0.4,0.7,1.0))));
    float sheen = pow(abs(dot(n,normalize(vec3(0.2,0.8,1.4)))),24.0);
    color = color * (mix(0.58,0.38,dark) + mix(0.42,0.62,dark)*key) + vec3(0.23,0.25,0.22)*sheen;
  }
  gl_FragColor = vec4(color,1.0);
}`;

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

// Rendering only: all curve samples, analytic normals and mesh topology come
// from Go. The camera is orthographic with identical scale on all three axes.
export function createRenderer(canvas: HTMLCanvasElement) {
  const gl = canvas.getContext("webgl", {
    antialias: true,
    alpha: false,
    preserveDrawingBuffer: true,
  });
  if (!gl)
    throw new Error(
      "This 3D study needs WebGL. The 2D notebook is still available.",
    );
  const shaders: WebGLShader[] = [];
  const buffers: WebGLBuffer[] = [];
  const program = gl.createProgram()!;
  const shader = (type: number, source: string) => {
    const s = gl.createShader(type)!;
    shaders.push(s);
    gl.shaderSource(s, source);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS))
      throw new Error("The 3D shader could not compile.");
    gl.attachShader(program, s);
  };
  shader(gl.VERTEX_SHADER, vertexSource);
  shader(gl.FRAGMENT_SHADER, fragmentSource);
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS))
    throw new Error("The 3D renderer could not start.");
  const attributes = ["position", "normal", "phase"].map((n) =>
    gl.getAttribLocation(program, n),
  );
  const uniforms = Object.fromEntries(
    ["rotation", "framing", "center", "pan", "ink", "dark"].map((n) => [
      n,
      gl.getUniformLocation(program, n),
    ]),
  );
  type Batch = {
    buffer: WebGLBuffer;
    count: number;
    mode: number;
    ink: number;
  };
  let mesh: Batch,
    base: Batch,
    minus: Batch,
    plus: Batch,
    rulings: Batch,
    filaments: Batch,
    strings: Batch,
    projection: Batch,
    connectors: Batch,
    feet: Batch,
    pole: Batch,
    inverse: Batch,
    correspondences: Batch,
    sphere: Batch,
    center: Batch,
    source: Batch,
    sourcePole: Batch,
    vectors: Batch,
    ellipses: Batch,
    strands: Batch,
    frames: Batch,
    tangents: Batch,
    seam: Batch,
    circles: Batch,
    spheres: Batch,
    meridians: Batch,
    trajectories: Batch,
    arrows: Batch,
    seeds: Batch,
    polygons: Batch,
    sheet: Batch,
    sheetCurves: Batch,
    normalLines: Batch,
    offsetSheet: Batch,
    focalSheets: Batch[],
    focalCurves: Batch[],
    incidentRays: Batch,
    reflectedRays: Batch,
    virtualRays: Batch,
    totalRays: Batch,
    lamp: Batch,
    virtualCaustics: Batch[],
    receiverSheet: Batch,
    receiverFrame: Batch;

  function batch(data: number[], mode: number, ink: number): Batch {
    const buffer = gl!.createBuffer()!;
    buffers.push(buffer);
    gl!.bindBuffer(gl!.ARRAY_BUFFER, buffer);
    gl!.bufferData(gl!.ARRAY_BUFFER, new Float32Array(data), gl!.STATIC_DRAW);
    return { buffer, count: data.length / 7, mode, ink };
  }
  function pairs(points: (Vec3 | null)[], breaks: boolean[]) {
    const out: Vec3[] = [];
    for (let i = 1; i < points.length; i++)
      if (points[i - 1] && points[i] && !breaks[i])
        out.push(points[i - 1]!, points[i]!);
    return out;
  }
  const vertices = (points: Vec3[], phase = 0) =>
    points.flatMap((p) => [p.x, p.y, p.z, 0, 0, 1, phase]);
  function path(points: (Vec3 | null)[], breaks: boolean[], ink: number) {
    return batch(vertices(pairs(points, breaks)), gl!.LINES, ink);
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
      return vertices(pairs(m.points, result.breaks), phase);
    });
    return batch(data, gl!.LINES, 3);
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
    return batch(data, gl!.TRIANGLES, ink);
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
  function upload(result: SpatialResult) {
    buffers.splice(0).forEach((b) => gl!.deleteBuffer(b));
    mesh = batch(
      result.mesh.flatMap((v) => [
        v.position.x,
        v.position.y,
        v.position.z,
        v.normal.x,
        v.normal.y,
        v.normal.z,
        v.phase,
      ]),
      gl!.TRIANGLES,
      0,
    );
    base = path(result.base, result.breaks, 2);
    // A framed ribbon's edges are also broken where a Frenet normal reverses.
    // A ruled surface's partner thread (its plus) is broken where the
    // partner is missing or jumps.
    const edgeBreaks =
      result.frame?.breaks ?? result.ruled?.breaks ?? result.breaks;
    minus = path(result.minus, edgeBreaks, 2);
    plus = path(result.plus, edgeBreaks, 2);
    rulings = batch(
      result.rulings
        .flatMap((r) => [r.from, r.to])
        .flatMap((p) => [p.x, p.y, p.z, 0, 0, 1, 0]),
      gl!.LINES,
      1,
    );
    const q = result.projection;
    const at = q?.points.find((p) => p);
    projection = batch(
      vertices(
        q?.collapsed && at
          ? cross(at, result.bounds.radius * 0.025)
          : pairs(q?.points ?? [], result.breaks),
      ),
      gl!.LINES,
      3,
    );
    connectors = batch(
      vertices(
        (q?.constructions ?? []).flatMap((c) => [
          c.contact,
          c.foot,
          q!.pole,
          c.foot,
          c.foot,
          c.image,
        ]),
      ),
      gl!.LINES,
      4,
    );
    feet = batch(
      vertices(
        (q?.constructions ?? []).flatMap((c) =>
          cross(c.foot, result.bounds.radius * 0.006),
        ),
      ),
      gl!.LINES,
      1,
    );
    pole = batch(
      vertices(q ? cross(q.pole, result.bounds.radius * 0.03) : []),
      gl!.LINES,
      1,
    );
    // The image uses its own breaks: the base's plus every passage through
    // the center, where the image leaves through infinity.
    const v = result.inversion;
    const image = v?.points.find((p) => p);
    inverse = batch(
      vertices(
        v?.collapsed && image
          ? cross(image, result.bounds.radius * 0.025)
          : pairs(v?.points ?? [], v?.breaks ?? []),
      ),
      gl!.LINES,
      3,
    );
    correspondences = batch(
      vertices((v?.correspondences ?? []).flatMap((c) => [c.source, c.image])),
      gl!.LINES,
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
    sphere = batch(
      vertices(v ? greatCircles(v.center, v.radius) : []),
      gl!.LINES,
      4,
    );
    // Contact circles where the spheres touch their envelope; a sphere with
    // no real circle is drawn by its great circles, in grey. Meridians shade
    // across the family like offset strands.
    const canal = result.canal;
    const real = (canal?.circles ?? []).filter((g) => g.real);
    circles = batch(
      vertices(
        real.flatMap((g) =>
          g.points.slice(1).flatMap((p, k) => [g.points[k], p]),
        ),
      ),
      gl!.LINES,
      1,
    );
    spheres = batch(
      vertices(
        (canal?.circles ?? [])
          .filter((g) => !g.real)
          .flatMap((g) => greatCircles(g.center, g.sphere)),
      ),
      gl!.LINES,
      4,
    );
    const lines = canal?.meridians ?? [];
    meridians = batch(
      lines.flatMap((points, k) =>
        vertices(
          pairs(points, canal!.breaks),
          lines.length > 1 ? k / (lines.length - 1) : 0,
        ),
      ),
      gl!.LINES,
      3,
    );
    center = batch(
      vertices(v ? cross(v.center, result.bounds.radius * 0.03) : []),
      gl!.LINES,
      1,
    );
    // A derived source (a tangent projection) and its pole; a base source is
    // already drawn as the base.
    source = batch(
      vertices(v?.pole ? pairs(v.source, result.breaks) : []),
      gl!.LINES,
      4,
    );
    sourcePole = batch(
      vertices(v?.pole ? cross(v.pole, result.bounds.radius * 0.02) : []),
      gl!.LINES,
      1,
    );
    // A harmonic curve's chained generating vectors at every representative
    // sample, and, at the last one shown, that chain again with each turning
    // term's ellipse around its joint and a cross at c₀.
    const h = result.harmonic;
    const chain = (s: NonNullable<typeof h>["positions"][number]) =>
      s.joints.flatMap((j, k) => [j, s.joints[k + 1] ?? s.point]);
    vectors = batch(
      vertices((h?.positions ?? []).flatMap(chain)),
      gl!.LINES,
      4,
    );
    const current = h?.positions.at(-1);
    ellipses = batch(
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
      gl!.LINES,
      1,
    );
    // Offset strands shade across the family like involute filaments. Frame
    // glyphs draw U (the longer arm) and V, with a short T behind them; the
    // seam shows the offset direction where the loop starts and where it
    // returns.
    const f = result.frame;
    const offsets = f?.strands ?? [];
    strands = batch(
      offsets.flatMap((points, k) =>
        vertices(
          pairs(points, f!.breaks),
          offsets.length > 1 ? k / (offsets.length - 1) : 0,
        ),
      ),
      gl!.LINES,
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
    frames = batch(
      vertices(
        (f?.frames ?? []).flatMap((g) => [
          ...along(g.point, g.normal, arm),
          ...along(g.point, g.binormal, arm * 0.6),
        ]),
      ),
      gl!.LINES,
      1,
    );
    tangents = batch(
      vertices(
        (f?.frames ?? []).flatMap((g) => along(g.point, g.tangent, arm * 0.6)),
      ),
      gl!.LINES,
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
    seam = batch(
      vertices(f?.seam && f.frames[0]?.sampleIndex === 0 ? seamLines() : []),
      gl!.LINES,
      2,
    );
    filaments = filamentBatch(result);
    strings = batch(
      vertices((result.involute?.strings ?? []).flatMap((r) => [r.from, r.to])),
      gl!.LINES,
      4,
    );
    // The first trajectory or pursuer is the base, drawn as such. The others
    // shade from teal to gold by order (decorative), joined wherever both
    // ends of an interval are known; a path has no break before its end.
    const flow = result.field;
    const chase = result.pursuit;
    const paths = flow?.paths ?? chase?.paths ?? [];
    trajectories = batch(
      paths
        .slice(1)
        .flatMap((points, k) =>
          vertices(
            pairs(points, []),
            paths.length > 2 ? k / (paths.length - 2) : 0,
          ),
        ),
      gl!.LINES,
      3,
    );
    // Arrows show the field's direction only: one length, pointing on.
    const reach = result.bounds.radius * 0.07;
    arrows = batch(
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
      gl!.LINES,
      4,
    );
    // Seeds or starts, and where a trajectory stopped, or the whole chase
    // stopped, before the end of the interval.
    const early =
      chase && (chase.capture || chase.exhausted) ? chase.final : [];
    seeds = batch(
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
      gl!.LINES,
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
    sheet = sheetBatch(patch?.surface ?? empty, 0);
    sheetCurves = batch(
      vertices(
        patch ? sheetLines(patch.surface, patch.uCurves, patch.vCurves) : [],
      ),
      gl!.LINES,
      1,
    );
    normalLines = batch(
      vertices((surface?.lines ?? []).flatMap((l) => [l.point, l.end])),
      gl!.LINES,
      4,
    );
    offsetSheet = sheetBatch(surface?.offset ?? empty, -1);
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
        gl!.LINES,
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
    focalSheets = realParts.map((f, k) => sheetBatch(f, -2 - k));
    focalCurves = realParts.map(branchLines);
    virtualCaustics = rays ? part(true).map(branchLines) : [];
    const rayLines = rays?.lines ?? [];
    incidentRays = batch(
      vertices(rayLines.flatMap((l) => [l.start, l.point])),
      gl!.LINES,
      4,
    );
    reflectedRays = batch(
      vertices(
        rayLines.filter((l) => !l.total).flatMap((l) => [l.point, l.end]),
      ),
      gl!.LINES,
      2,
    );
    // Beyond the critical angle nothing is transmitted: the totally
    // reflected rays recede in grey.
    totalRays = batch(
      vertices(
        rayLines.filter((l) => l.total).flatMap((l) => [l.point, l.end]),
      ),
      gl!.LINES,
      4,
    );
    receiverSheet = batch(receiverVertices(rays?.receiver), gl!.TRIANGLES, 7);
    receiverFrame = batch(
      vertices(
        rays?.receiver
          ? rays.receiver.corners.flatMap((p, k, all) => [p, all[(k + 1) % 4]])
          : [],
      ),
      gl!.LINES,
      4,
    );
    virtualRays = batch(
      // Only a ray with a virtual caustic point leads anywhere behind the
      // mirror.
      vertices(
        rayLines.filter((l) => l.virtual).flatMap((l) => [l.point, l.back]),
      ),
      gl!.LINES,
      4,
    );
    lamp = batch(
      vertices(
        rays?.source ? cross(rays.source, result.bounds.radius * 0.03) : [],
      ),
      gl!.LINES,
      2,
    );
    // Each connecting polygon closes, the last pursuer back to the first.
    polygons = batch(
      vertices(
        (chase?.polygons ?? []).flatMap((g) =>
          g.points.flatMap((p, j) => [p, g.points[(j + 1) % g.points.length]]),
        ),
      ),
      gl!.LINES,
      4,
    );
  }
  function draw(
    view: View,
    layers: Layers,
    dark: boolean,
    size?: { width: number; height: number },
  ) {
    const ratio = Math.min(devicePixelRatio || 1, 2);
    const width = Math.max(
        1,
        size?.width ?? Math.round(canvas.clientWidth * ratio),
      ),
      height = Math.max(
        1,
        size?.height ?? Math.round(canvas.clientHeight * ratio),
      );
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
    }
    gl!.viewport(0, 0, width, height);
    const background = (dark ? [11, 21, 23] : [243, 241, 234]).map(
      (c) => c / 255,
    );
    gl!.clearColor(background[0], background[1], background[2], 1);
    gl!.clear(gl!.COLOR_BUFFER_BIT | gl!.DEPTH_BUFFER_BIT);
    if (!mesh) return;
    gl!.useProgram(program);
    gl!.enable(gl!.DEPTH_TEST);
    gl!.depthFunc(gl!.LEQUAL);
    const c = Math.cos(view.yaw),
      s = Math.sin(view.yaw),
      a = Math.cos(view.pitch),
      b = Math.sin(view.pitch);
    gl!.uniformMatrix3fv(
      uniforms.rotation,
      false,
      new Float32Array([c, b * s, -a * s, 0, a, b, s, -b * c, a * c]),
    );
    const radius = view.radius;
    gl!.uniform3f(uniforms.center, view.center.x, view.center.y, view.center.z);
    gl!.uniform2f(uniforms.pan, view.panX, view.panY);
    const scale = view.zoom / (radius * 1.16),
      aspect = width / height;
    gl!.uniform3f(
      uniforms.framing,
      scale / Math.max(1, aspect),
      scale * Math.min(1, aspect),
      1 / (radius * 4),
    );
    gl!.uniform1f(uniforms.dark, dark ? 1 : 0);
    const render = (v: Batch) => {
      gl!.bindBuffer(gl!.ARRAY_BUFFER, v.buffer);
      attributes.forEach((loc, i) => {
        gl!.enableVertexAttribArray(loc);
        gl!.vertexAttribPointer(
          loc,
          i === 2 ? 1 : 3,
          gl!.FLOAT,
          false,
          28,
          i === 0 ? 0 : i === 1 ? 12 : 24,
        );
      });
      gl!.uniform1f(uniforms.ink, v.ink);
      gl!.drawArrays(v.mode, 0, v.count);
    };
    const shaded = (on: boolean, ...sheets: Batch[]) => {
      if (!on) return;
      gl!.enable(gl!.POLYGON_OFFSET_FILL);
      gl!.polygonOffset(1, 1);
      sheets.forEach(render);
      gl!.disable(gl!.POLYGON_OFFSET_FILL);
    };
    shaded(layers.surface, mesh, sheet);
    shaded(layers.offset, offsetSheet);
    focalSheets.forEach((f, k) =>
      shaded(k === 0 ? layers.focal1 : layers.focal2, f),
    );
    focalCurves.forEach((f, k) => {
      if (k === 0 ? layers.focal1 : layers.focal2) render(f);
    });
    if (layers.curves) render(sheetCurves);
    if (layers.normals) render(normalLines);
    if (layers.incident) {
      render(incidentRays);
      render(lamp);
    }
    if (layers.reflected) {
      render(reflectedRays);
      render(totalRays);
    }
    if (layers.receiver) {
      shaded(true, receiverSheet);
      render(receiverFrame);
    }
    if (layers.virtual) {
      render(virtualRays);
      virtualCaustics.forEach(render);
    }
    if (layers.rulings) render(rulings);
    if (layers.edges) {
      render(minus);
      render(plus);
    }
    if (layers.strands) render(strands);
    if (layers.meridians) render(meridians);
    if (layers.circles) {
      render(circles);
      render(spheres);
    }
    if (layers.frames) {
      render(tangents);
      render(frames);
    }
    if (layers.strings) render(strings);
    if (layers.filaments) render(filaments);
    if (layers.connectors) {
      render(connectors);
      render(feet);
    }
    if (layers.projection) render(projection);
    if (layers.sphere) render(sphere);
    if (layers.correspondences) render(correspondences);
    if (layers.source) {
      render(source);
      render(sourcePole);
    }
    if (layers.inverse) render(inverse);
    if (layers.vectors) render(vectors);
    if (layers.ellipses) render(ellipses);
    if (layers.arrows) render(arrows);
    if (layers.polygons) render(polygons);
    if (layers.trajectories) render(trajectories);
    render(base);
    if (layers.seeds) render(seeds);
    if (layers.seam) render(seam);
    if (layers.pole) render(pole);
    if (layers.sphere) render(center);
  }
  return {
    upload,
    draw,
    dispose: () => {
      buffers.forEach((b) => gl.deleteBuffer(b));
      shaders.forEach((s) => gl.deleteShader(s));
      gl.deleteProgram(program);
    },
  };
}
