import {
  camera,
  clip,
  page,
  scenePasses,
  type Batch,
  type Camera,
  type Layers,
  type Scene,
  type View,
} from "./scene";
import { hex, lineColor, palette } from "./palette";

// Vector linework: the lines the drawing shows, from the same scene, layers
// and camera, as page paths. Sheets are not drawn. With occlusion "none"
// every line is drawn, including those behind sheets. With "sampled", each
// line is tested along its length against a depth raster of the shown
// sheets at the page's resolution: a sampled approximation of hidden lines,
// not exact hidden-line removal. Lines never hide other lines.
export type Occlusion = "none" | "sampled";
export type LineGroup = {
  layer: string;
  strokes: { color: string; paths: [number, number][][] }[];
};
export type LineworkOptions = {
  width: number;
  height: number;
  occlusion: Occlusion;
  // Bounds visibility testing: rasterized pixels plus line samples.
  limit?: number;
  signal?: AbortSignal;
};
// Line samples are at most half a pixel apart.
export const sampleStep = 0.5;
export const workLimit = 200_000_000;

type Point = { x: number; y: number; depth: number };

export function linework(
  scene: Scene,
  view: View,
  layers: Layers,
  dark: boolean,
  options: LineworkOptions,
): LineGroup[] {
  const k = camera(view, options),
    passes = scenePasses(scene, layers);
  const work = { done: 0, limit: options.limit ?? workLimit };
  const raster =
    options.occlusion === "sampled"
      ? depthRaster(
          k,
          passes.filter((p) => p.sheet).map((p) => p.batch),
          work,
          options.signal,
        )
      : undefined;
  const groups = new Map<string, Map<string, [number, number][][]>>();
  for (const pass of passes) {
    if (pass.sheet) continue;
    options.signal?.throwIfAborted();
    let strokes = groups.get(pass.layer);
    if (!strokes) groups.set(pass.layer, (strokes = new Map()));
    const data = pass.batch.data;
    for (let i = 0; i + 13 < data.length; i += 14) {
      const piece = clipped(
        k,
        clip(k, data[i], data[i + 1], data[i + 2]),
        clip(k, data[i + 7], data[i + 8], data[i + 9]),
      );
      if (!piece) continue;
      const color = hex(lineColor(pass.batch.ink, data[i + 6], dark));
      let paths = strokes.get(color);
      if (!paths) strokes.set(color, (paths = []));
      for (const [a, b] of raster ? visible(raster, piece, work) : [piece])
        extend(paths, a, b);
    }
  }
  return [...groups]
    .map(([layer, strokes]) => ({
      layer,
      strokes: [...strokes]
        .filter(([, paths]) => paths.length)
        .map(([color, paths]) => ({ color, paths })),
    }))
    .filter((g) => g.strokes.length);
}

// A segment continues the last path when it starts exactly where that path
// ends: consecutive samples of one curve. Anything else (a break, a gap, a
// clipped or hidden end) starts a new path.
function extend(paths: [number, number][][], a: Point, b: Point) {
  const last = paths.at(-1),
    end = last?.at(-1);
  if (end && end[0] === a.x && end[1] === a.y) last!.push([b.x, b.y]);
  else
    paths.push([
      [a.x, a.y],
      [b.x, b.y],
    ]);
}

// The part of a segment within the drawing's clip volume (Liang–Barsky), as
// page points, or nothing.
function clipped(
  k: Camera,
  a: [number, number, number],
  b: [number, number, number],
): [Point, Point] | undefined {
  let t0 = 0,
    t1 = 1;
  for (let axis = 0; axis < 3; axis++) {
    const d = b[axis] - a[axis];
    for (const [p, q] of [
      [-d, a[axis] + 1],
      [d, 1 - a[axis]],
    ]) {
      if (p === 0) {
        if (q < 0) return;
        continue;
      }
      const r = q / p;
      if (p < 0) t0 = Math.max(t0, r);
      else t1 = Math.min(t1, r);
    }
  }
  if (!(t0 <= t1)) return;
  const at = (t: number) =>
    page(k, t === 0 ? a : t === 1 ? b : a.map((v, i) => v + (b[i] - v) * t));
  return [at(t0), at(t1)];
}

// The shown sheets' triangles on the page, and which of them is nearest at
// each pixel center (−1 where there is none). Points hold each corner's page
// x, y and depth; corners hold each triangle's three points.
type Raster = {
  width: number;
  height: number;
  depth: Float32Array;
  nearest: Int32Array;
  points: Float64Array;
  corners: Uint32Array;
};
function depthRaster(
  k: Camera,
  sheets: Batch[],
  work: { done: number; limit: number },
  signal?: AbortSignal,
): Raster {
  const { width, height } = k;
  let vertices = 0,
    triangles = 0;
  for (const sheet of sheets) {
    vertices += sheet.data.length / 7;
    triangles += Math.floor(
      (sheet.indices?.length ?? sheet.data.length / 7) / 3,
    );
  }
  const r: Raster = {
    width,
    height,
    depth: new Float32Array(width * height).fill(Infinity),
    nearest: new Int32Array(width * height).fill(-1),
    points: new Float64Array(3 * vertices),
    corners: new Uint32Array(3 * triangles),
  };
  let base = 0,
    t = 0;
  for (const sheet of sheets) {
    signal?.throwIfAborted();
    const data = sheet.data,
      count = data.length / 7;
    for (let v = 0; v < count; v++) {
      const p = page(k, clip(k, data[7 * v], data[7 * v + 1], data[7 * v + 2]));
      r.points[3 * (base + v)] = p.x;
      r.points[3 * (base + v) + 1] = p.y;
      r.points[3 * (base + v) + 2] = p.depth;
    }
    const indices = sheet.indices;
    const corners = indices ? indices.length : count;
    for (let c = 0; c + 2 < corners; c += 3, t++) {
      for (let j = 0; j < 3; j++)
        r.corners[3 * t + j] = base + (indices ? indices[c + j] : c + j);
      rasterize(r, t, work);
    }
    base += count;
  }
  return r;
}
// A triangle's corners on the page, and its plane: depth at its first
// corner, changing by dx per pixel across and dy down. Undefined when it has
// no area on the page.
function plane(r: Raster, t: number) {
  const [a, b, c] = [0, 1, 2].map((j) => 3 * r.corners[3 * t + j]);
  const p = r.points;
  const ax = p[a],
    ay = p[a + 1],
    az = p[a + 2],
    bx = p[b],
    by = p[b + 1],
    bz = p[b + 2],
    cx = p[c],
    cy = p[c + 1],
    cz = p[c + 2];
  const area = (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
  if (!(Math.abs(area) > 0) || !Number.isFinite(area)) return;
  return {
    ax,
    ay,
    az,
    bx,
    by,
    cx,
    cy,
    area,
    dx: ((bz - az) * (cy - ay) - (cz - az) * (by - ay)) / area,
    dy: ((cz - az) * (bx - ax) - (bz - az) * (cx - ax)) / area,
  };
}
type Plane = NonNullable<ReturnType<typeof plane>>;
// Where a page point lies against a triangle's edges: all three
// non-negative (after the triangle's orientation) when it is inside or on
// an edge.
function inside(q: Plane, x: number, y: number, slack = 0) {
  const s = q.area > 0 ? 1 : -1,
    e = slack * Math.abs(q.area);
  return (
    s * ((q.bx - x) * (q.cy - y) - (q.by - y) * (q.cx - x)) >= -e &&
    s * ((q.cx - x) * (q.ay - y) - (q.cy - y) * (q.ax - x)) >= -e &&
    s * ((q.ax - x) * (q.by - y) - (q.ay - y) * (q.bx - x)) >= -e
  );
}
const depthAt = (q: Plane, x: number, y: number) =>
  q.az + q.dx * (x - q.ax) + q.dy * (y - q.ay);
function rasterize(
  r: Raster,
  t: number,
  work: { done: number; limit: number },
) {
  const q = plane(r, t);
  if (!q) return;
  const x0 = Math.max(0, Math.floor(Math.min(q.ax, q.bx, q.cx))),
    x1 = Math.min(r.width - 1, Math.ceil(Math.max(q.ax, q.bx, q.cx))),
    y0 = Math.max(0, Math.floor(Math.min(q.ay, q.by, q.cy))),
    y1 = Math.min(r.height - 1, Math.ceil(Math.max(q.ay, q.by, q.cy)));
  if (x1 < x0 || y1 < y0) return;
  work.done += (x1 - x0 + 1) * (y1 - y0 + 1);
  if (work.done > work.limit) throw overLimit();
  for (let y = y0; y <= y1; y++)
    for (let x = x0; x <= x1; x++) {
      // Pixel centers on an edge count as inside, for both neighbors.
      if (!inside(q, x + 0.5, y + 0.5)) continue;
      const z = depthAt(q, x + 0.5, y + 0.5);
      // The drawing clips depth to [0, 1] too.
      if (z < 0 || z > 1) continue;
      const i = y * r.width + x;
      if (z < r.depth[i]) {
        r.depth[i] = z;
        r.nearest[i] = t;
      }
    }
}
const overLimit = () =>
  new Error(
    "These lines and sheets need more visibility testing than the export's work limit allows. Hide a layer, or export every line without hiding.",
  );

// Whether a page point is hidden: behind a sheet triangle that contains it
// by more than the drawing's own polygon offset (the triangle's steepest
// depth change per pixel, plus a small constant), so lines lying on a sheet
// stay visible, as they are drawn. The triangles tried are those nearest at
// the nine pixel centers around the point, and their depth is found at the
// point itself, inside the triangle. When none contains it (a triangle
// smaller than a pixel), the nearest at its own pixel center is used, with
// one more offset for the half pixel between them.
function hidden(r: Raster, x: number, y: number, depth: number) {
  const px = Math.min(r.width - 1, Math.max(0, Math.floor(x))),
    py = Math.min(r.height - 1, Math.max(0, Math.floor(y)));
  const tried: number[] = [];
  let found = false;
  for (let dy = -1; dy <= 1; dy++)
    for (let dx = -1; dx <= 1; dx++) {
      const u = px + dx,
        v = py + dy;
      if (u < 0 || v < 0 || u >= r.width || v >= r.height) continue;
      const t = r.nearest[v * r.width + u];
      if (t < 0 || tried.includes(t)) continue;
      tried.push(t);
      const q = plane(r, t)!;
      if (!inside(q, x, y, 1e-9)) continue;
      const z = depthAt(q, x, y);
      if (z < 0 || z > 1) continue;
      found = true;
      if (depth > z + Math.max(Math.abs(q.dx), Math.abs(q.dy)) + 1e-6)
        return true;
    }
  if (found) return false;
  const t = r.nearest[py * r.width + px];
  if (t < 0) return false;
  const q = plane(r, t)!;
  return (
    depth >
    r.depth[py * r.width + px] +
      2 * Math.max(Math.abs(q.dx), Math.abs(q.dy)) +
      1e-6
  );
}

// The visible parts of a page segment, sampled along it. Visibility changes
// halfway between samples that disagree.
function visible(
  r: Raster,
  [a, b]: [Point, Point],
  work: { done: number; limit: number },
): [Point, Point][] {
  const n = Math.max(
    1,
    Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) / sampleStep),
  );
  work.done += n + 1;
  if (work.done > work.limit) throw overLimit();
  const at = (t: number): Point =>
    t === 0
      ? a
      : t === 1
        ? b
        : {
            x: a.x + (b.x - a.x) * t,
            y: a.y + (b.y - a.y) * t,
            depth: a.depth + (b.depth - a.depth) * t,
          };
  const shown = (t: number) => {
    const p = at(t);
    return !hidden(r, p.x, p.y, p.depth);
  };
  const out: [Point, Point][] = [];
  let start: number | undefined = shown(0) ? 0 : undefined;
  for (let s = 1; s <= n; s++) {
    const on = shown(s / n),
      edge = (s - 0.5) / n;
    if (on && start === undefined) start = edge;
    else if (!on && start !== undefined) {
      out.push([at(start), at(edge)]);
      start = undefined;
    }
  }
  if (start !== undefined) out.push([at(start), at(1)]);
  return out;
}

const xml = (s: string) =>
  s.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
const fixed = (v: number) => String(Math.round(v * 100) / 100 + 0);

// The linework as an SVG document on the theme's background: one group per
// layer, one path per color. Metadata stays in title and desc; nothing in
// the drawing is text.
export function linesSvg(
  groups: LineGroup[],
  options: {
    width: number;
    height: number;
    dark: boolean;
    title: string;
    metadata: unknown;
  },
) {
  const { width, height } = options;
  const body = groups
    .map(
      (g) =>
        `<g id="${g.layer}" fill="none" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">${g.strokes
          .map(
            (s) =>
              `<path stroke="${s.color}" d="${s.paths
                .map((path) =>
                  path
                    .map(
                      ([x, y], i) => `${i ? "L" : "M"}${fixed(x)} ${fixed(y)}`,
                    )
                    .join(""),
                )
                .join("")}"/>`,
          )
          .join("")}</g>`,
    )
    .join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><title>${xml(options.title)}</title><desc>${xml(JSON.stringify(options.metadata))}</desc><rect width="${width}" height="${height}" fill="${hex(palette.background[options.dark ? 1 : 0])}"/>${body}</svg>`;
}
