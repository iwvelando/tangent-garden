import { Fragment, useMemo } from "react";
import type { ColorScheme } from "../color-schemes";
import { plotPalette, type PlotPalette } from "../palette";
import { svgStroke, type LineWeight } from "../line-weight";
import { usePageGestures } from "../page-gestures";
import type { PlotCamera } from "../planar-link";
import type { Vec } from "../types";
import {
  pastSamples,
  sampleAt,
  threeBodyPage,
  threeBodyZoom,
  type ThreeBodyFraming,
  type ThreeBodyPrepared,
  type Trail,
} from "./model";

const { width, height } = threeBodyPage;

// The bodies' inks: the scheme's primary, secondary and third family.
export const bodyInks = (p: PlotPalette) => [p.base, p.derived, p.third];
// A body's marker radius in page units, growing with its mass.
export const markerRadius = (mass: number) => 4 + 10 * Math.sqrt(mass);

// One frame for the whole history, so a later moment never rescales the
// drawing: the center and page units per unit length at zoom 1.
export type Frame = { cx: number; cy: number; k: number };
// The whole history fits every sample and the final state. The close dance
// fits only the samples whose bodies are all within 2 of that moment's
// center of mass, so a fleeing body leaves the frame instead of shrinking
// the rest; with no such sample it fits the whole history. A twin shares
// the frame, which fits both histories by the same rule.
export const closeRadius = 2;
export function frameOf(
  p: ThreeBodyPrepared,
  masses: readonly number[],
  framing: ThreeBodyFraming,
  twin?: ThreeBodyPrepared,
): Frame {
  const histories = twin ? [p, twin] : [p];
  let x0 = Infinity,
    x1 = -Infinity,
    y0 = Infinity,
    y1 = -Infinity;
  const take = (v: Vec) => {
    x0 = Math.min(x0, v.x);
    x1 = Math.max(x1, v.x);
    y0 = Math.min(y0, v.y);
    y1 = Math.max(y1, v.y);
  };
  const close = (h: ThreeBodyPrepared, k: number) => {
    let cx = 0,
      cy = 0;
    h.paths.forEach((path, i) => {
      cx += masses[i] * path.positions[k].x;
      cy += masses[i] * path.positions[k].y;
    });
    return h.paths.every(
      (path) =>
        Math.hypot(path.positions[k].x - cx, path.positions[k].y - cy) <=
        closeRadius,
    );
  };
  if (framing === "close")
    for (const h of histories)
      for (let k = 0; k < h.available; k++)
        if (close(h, k)) for (const path of h.paths) take(path.positions[k]);
  if (!(x1 >= x0))
    for (const h of histories) {
      for (let k = 0; k < h.available; k++)
        for (const path of h.paths) take(path.positions[k]);
      h.final.positions.forEach(take);
    }
  const w = Math.max(x1 - x0, 1e-6),
    h = Math.max(y1 - y0, 1e-6);
  const k = 0.9 * Math.min(width / w, height / h);
  return { cx: (x0 + x1) / 2, cy: (y0 + y1) / 2, k };
}

// Each body's sampled path, simplified once for the frame and zoom: the
// indices of the samples a polyline within a twentieth of a page unit of
// the full one keeps (Douglas–Peucker), with their page coordinates. A
// trail joins the kept samples between its ends and ends at the shown
// sample itself, so it never cuts a corner the full path turns.
export type Geometry = {
  kept: Int32Array[];
  text: string[][];
  point: (v: Vec) => string;
  // Each body's whole history, to its terminal state.
  whole: string[];
};
const tolerance = 0.05;
const fixed = (v: number) => Math.round(v * 100) / 100;
export function geometryOf(
  p: ThreeBodyPrepared,
  f: Frame,
  zoom: number,
): Geometry {
  const k = f.k * zoom;
  const px = (v: Vec) => width / 2 + (v.x - f.cx) * k,
    py = (v: Vec) => height / 2 - (v.y - f.cy) * k;
  const point = (v: Vec) => `${fixed(px(v))} ${fixed(py(v))}`;
  const kept = p.paths.map((path) => {
    const n = p.available;
    if (n < 3) return Int32Array.from({ length: n }, (_, i) => i);
    const keep = new Uint8Array(n);
    keep[0] = keep[n - 1] = 1;
    const stack = [0, n - 1];
    while (stack.length) {
      const b = stack.pop()!,
        a = stack.pop()!;
      const ax = px(path.positions[a]),
        ay = py(path.positions[a]),
        bx = px(path.positions[b]),
        by = py(path.positions[b]);
      const length = Math.hypot(bx - ax, by - ay);
      let far = 0,
        at = -1;
      for (let i = a + 1; i < b; i++) {
        const qx = px(path.positions[i]),
          qy = py(path.positions[i]);
        const d = length
          ? Math.abs((bx - ax) * (ay - qy) - (ax - qx) * (by - ay)) / length
          : Math.hypot(qx - ax, qy - ay);
        if (d > far) [far, at] = [d, i];
      }
      if (far > tolerance) {
        keep[at] = 1;
        stack.push(a, at, at, b);
      }
    }
    const out: number[] = [];
    keep.forEach((v, i) => v && out.push(i));
    return Int32Array.from(out);
  });
  const text = kept.map((indices, i) =>
    Array.from(indices, (j) => point(p.paths[i].positions[j])),
  );
  const g: Geometry = { kept, text, point, whole: [] };
  g.whole = p.paths.map(
    (_, i) =>
      pathBetween(g, p, i, 0, Math.max(0, p.available - 1)) + tailOf(g, p, i),
  );
  return g;
}
// The segment from a body's last sample to its terminal state, when the
// history ends between samples.
const tailOf = (g: Geometry, p: ThreeBodyPrepared, i: number) =>
  pastSamples(p) ? `L${g.point(p.final.positions[i])}` : "";
// The first kept position whose sample index is at least i.
function lower(kept: Int32Array, i: number) {
  let lo = 0,
    hi = kept.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (kept[mid] < i) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}
// A body's polyline from sample `from` to sample `to`, through the kept
// samples between them.
function pathBetween(
  g: Geometry,
  p: ThreeBodyPrepared,
  body: number,
  from: number,
  to: number,
) {
  const positions = p.paths[body].positions;
  const a = lower(g.kept[body], from + 1),
    b = lower(g.kept[body], to);
  let d = `M${g.point(positions[from])}`;
  if (b > a) d += "L" + g.text[body].slice(a, b).join("L");
  if (to > from) d += `L${g.point(positions[to])}`;
  return d;
}

// The state drawn at physical time t: the sample at or before it, or the
// terminal state once t reaches a terminal that lies past the last sample.
export function shownState(h: ThreeBodyPrepared, t: number) {
  if (pastSamples(h) && t >= h.final.time)
    return {
      time: h.final.time,
      sample: "final" as const,
      positions: h.final.positions,
      velocities: h.final.velocities,
    };
  const k = sampleAt(h, t);
  return {
    time: h.times[k],
    sample: k,
    positions: h.paths.map((path) => path.positions[k]),
    velocities: h.paths.map((path) => path.velocities[k]),
  };
}

export type ThreeBodyDrawingProps = {
  history: ThreeBodyPrepared;
  masses: readonly number[];
  frame: Frame;
  // The physical time shown, from 0 to the history's last time.
  time: number;
  trail: Trail;
  window: number;
  ghost: boolean;
  triangle: boolean;
  camera: PlotCamera;
  dark: boolean;
  scheme: ColorScheme;
  weight: LineWeight;
  // The simplified paths for the frame at the camera's zoom; computed when
  // absent.
  geometry?: Geometry;
  // The twin, drawn on the same clock and frame, and its simplified paths.
  twin?: ThreeBodyPrepared;
  twinGeometry?: Geometry;
};

// How a history is drawn: the reference solid with filled markers, its
// twin dashed with hollow ones, both in the bodies' own inks.
type Style = "reference" | "twin";
const dashes = { trail: "7 5", ghost: "5 5", triangle: "2 4" };

// The bodies alone: each one's faint whole history, its trail to the shown
// moment and its marker, sized by mass, in its own ink, and the optional
// triangle joining the three; a twin's the same, dashed and hollow, beneath
// the reference's. Samples are chosen by physical time and never
// interpolated; past a history's last sample only its terminal state is
// drawn. No text.
function Art(p: ThreeBodyDrawingProps & { clip?: string }) {
  const palette = plotPalette(p.dark, p.scheme),
    stroke = svgStroke(p.weight),
    inks = bodyInks(palette);
  const layer = (h: ThreeBodyPrepared, g: Geometry, style: Style) => {
    const twin = style === "twin",
      role = (r: string) => (twin ? `twin-${r}` : r);
    const k = sampleAt(h, p.time);
    const shown = shownState(h, p.time);
    const past = shown.sample === "final";
    const from =
      p.trail === "whole" ? 0 : Math.max(0, sampleAt(h, p.time - p.window));
    const heads = shown.positions;
    // The reference's elements sit directly in the drawing, as they do
    // without a twin; the twin's are grouped.
    const Group = twin ? "g" : Fragment;
    return (
      <Group key={style} {...(twin && { "data-history": "twin" })}>
        {p.ghost &&
          h.paths.map((_, i) => (
            <path
              key={`ghost-${i}`}
              data-role={role("ghost")}
              data-body={i + 1}
              d={g.whole[i]}
              stroke={inks[i]}
              strokeOpacity={0.22}
              strokeDasharray={twin ? dashes.ghost : undefined}
              {...stroke(1)}
            />
          ))}
        {h.paths.map((_, i) => (
          <path
            key={`trail-${i}`}
            data-role={role("trail")}
            data-body={i + 1}
            d={pathBetween(g, h, i, from, k) + (past ? tailOf(g, h, i) : "")}
            stroke={inks[i]}
            strokeOpacity={0.85}
            strokeDasharray={twin ? dashes.trail : undefined}
            {...stroke(1.6)}
          />
        ))}
        {p.triangle && (
          <polygon
            data-role={role("triangle")}
            points={heads.map(g.point).join(" ")}
            stroke={palette.line}
            strokeDasharray={twin ? dashes.triangle : "5 4"}
            {...stroke(1)}
          />
        )}
        {heads.map((v, i) => {
          const [x, y] = g.point(v).split(" ");
          return (
            <circle
              key={`body-${i}`}
              data-role={role("body")}
              data-body={i + 1}
              cx={x}
              cy={y}
              r={markerRadius(p.masses[i])}
              fill={twin ? palette.bg : inks[i]}
              stroke={twin ? inks[i] : palette.bg}
              strokeWidth={twin ? 2 : 1.5}
            />
          );
        })}
      </Group>
    );
  };
  const g = p.geometry ?? geometryOf(p.history, p.frame, p.camera.zoom);
  return (
    <>
      {p.clip && (
        <defs>
          <clipPath id={p.clip}>
            <rect width={width} height={height} />
          </clipPath>
        </defs>
      )}
      <rect width={width} height={height} fill={palette.bg} />
      <g clipPath={p.clip ? `url(#${p.clip})` : undefined}>
        <g
          transform={`translate(${p.camera.x} ${p.camera.y})`}
          fill="none"
          strokeLinejoin="round"
          strokeLinecap="round"
        >
          {p.twin &&
            layer(
              p.twin,
              p.twinGeometry ?? geometryOf(p.twin, p.frame, p.camera.zoom),
              "twin",
            )}
          {layer(p.history, g, "reference")}
        </g>
      </g>
    </>
  );
}

// The still and export page: the same drawing, with the study's record in
// the root's desc rather than in the drawing.
export function ThreeBodyStill(
  p: ThreeBodyDrawingProps & { metadata: unknown },
) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox={`0 0 ${width} ${height}`}
      width={width}
      height={height}
      style={{ background: plotPalette(p.dark, p.scheme).bg }}
    >
      <desc>{JSON.stringify(p.metadata)}</desc>
      <Art {...p} clip="threebody-clip" />
    </svg>
  );
}

// The live drawing: drag to pan, wheel or pinch to zoom, keys to move. The
// simplified paths are kept for the history, frame and zoom, so a frame of
// the motion only joins slices of them.
export function ThreeBodyDrawing(
  p: ThreeBodyDrawingProps & {
    busy: boolean;
    onCamera?: (c: PlotCamera) => void;
  },
) {
  const gestures = usePageGestures({
    page: threeBodyPage,
    range: threeBodyZoom,
    camera: p.camera,
    onCamera: p.onCamera,
  });
  const geometry = useMemo(
    () => geometryOf(p.history, p.frame, p.camera.zoom),
    [p.history, p.frame, p.camera.zoom],
  );
  const twinGeometry = useMemo(
    () => p.twin && geometryOf(p.twin, p.frame, p.camera.zoom),
    [p.twin, p.frame, p.camera.zoom],
  );
  return (
    <svg
      {...gestures}
      id="threebody-artwork"
      overflow="hidden"
      style={{ background: plotPalette(p.dark, p.scheme).bg }}
      className="garden-drawing"
      viewBox={`0 0 ${width} ${height}`}
      role="img"
      aria-label={
        p.twin
          ? "Three bodies and their twins, with their trails"
          : "Three bodies and their trails"
      }
      aria-busy={p.busy}
      data-zoom={p.camera.zoom}
      data-pan={`${p.camera.x},${p.camera.y}`}
      data-time={p.time}
      data-sample={sampleAt(p.history, p.time)}
    >
      <Art {...p} geometry={geometry} twinGeometry={twinGeometry} />
    </svg>
  );
}
