import { useMemo, type ReactNode } from "react";
import { usePageGestures } from "../page-gestures";
import type { PlotCamera } from "../planar-link";
import type { ColorScheme } from "../color-schemes";
import { plotPalette } from "../palette";
import { svgStroke, type LineWeight } from "../line-weight";
import {
  gardenPage,
  gardenScale,
  gardenZoom,
  hitCircle,
  revealed,
  shapeOf,
  toModel,
  type GardenPresentation,
  type GardenResult,
  type GardenShape,
} from "./model";

export type GardenDrawingProps = {
  result: GardenResult;
  presentation: GardenPresentation;
  // Breadth-first index of the selected circle, or −1.
  selected: number;
  camera: PlotCamera;
  dark: boolean;
  scheme: ColorScheme;
  weight: LineWeight;
  // A reveal frame: only circles before this breadth-first index are drawn.
  count?: number;
};
const { width, height } = gardenPage;
export const zoomRange = gardenZoom;

// A circle's regular stroke shrinks with its drawn radius, so the smallest
// circles stay rings rather than dots. Highlights keep a visible minimum.
const ring = (rpx: number, cap: number, floor: number) =>
  Math.min(cap, Math.max(floor, 0.25 * rpx));

// Circles drawn larger than this, in page units, and lines are drawn as
// their stretch across the visible page instead of as SVG circles, whose
// rasterizers lose precision far from the origin.
export const bigCircle = 2e4;

// A line, or a circle too large to draw as a circle, as one quadratic
// Bézier across the visible page, in page units before the pan. Near the
// point of the circle nearest the view's center, its foot p₀ found exactly
// along the gradient of Φ, with unit normal
// n̂ (the gradient of Φ = b|w|² − 2z·w + b̄) and tangent t, the circle is
// p₀ + st − n̂·bs²/2 to within b³s⁴/8, under 0.003 page units here; a
// parabola is exactly a quadratic Bézier, and a line (b = 0) a straight
// one. Null when it misses the page.
export function stretch(c: GardenShape, camera: PlotCamera): string | null {
  const k = gardenScale * camera.zoom;
  const q = toModel({ x: 500, y: 380 }, camera);
  // Half the page's diagonal, with a margin, in model units.
  const span = (1.3 * Math.hypot(500, 380)) / k;
  const phi =
    c.b * (q.x * q.x + q.y * q.y) - 2 * (c.zx * q.x + c.zy * q.y) + c.co;
  // The gradient of Φ is 2(bq − z), along the line through the center;
  // the circle lies d = Φ/(|bq − z| + 1) back along it, exactly (a line
  // has |z| = 1, so d = Φ/2).
  const gx = c.b * q.x - c.zx,
    gy = c.b * q.y - c.zy;
  const g = Math.hypot(gx, gy);
  const nx = gx / g,
    ny = gy / g;
  const d = phi / (g + 1);
  if (!(Math.abs(d) <= span)) return null;
  const fx = q.x - d * nx,
    fy = q.y - d * ny;
  const bow = (c.b * span * span) / 2;
  const page = (x: number, y: number) => `${500 + x * k} ${380 - y * k}`;
  const a = page(fx - span * -ny - bow * nx, fy - span * nx - bow * ny);
  const b = page(fx + span * -ny - bow * nx, fy + span * nx - bow * ny);
  const control = page(fx + bow * nx, fy + bow * ny);
  return `M${a}Q${control} ${b}`;
}

// The circles of one presentation, in page units at the camera's zoom; the
// pan is the enclosing group's translation. Only geometry: no text, no hit
// targets.
function Circles(p: GardenDrawingProps) {
  const palette = plotPalette(p.dark, p.scheme),
    stroke = svgStroke(p.weight);
  const { result: r, presentation } = p;
  const count = p.count ?? r.curvature.length;
  // A selection not yet revealed is not drawn; its generators come before
  // it, so they are revealed with it.
  const selected = p.selected < count ? p.selected : -1;
  const zoom = p.camera.zoom;
  // Lines and very large circles follow the pan too; the rest only zoom.
  const big = useMemo(() => {
    const out = new Set<number>();
    if (r.image)
      for (let i = 0; i < r.curvature.length; i++) {
        const b = r.image[4 * i];
        if (b === 0 || gardenScale * zoom > bigCircle * Math.abs(b)) out.add(i);
      }
    return out;
  }, [r, zoom]);
  const pan = big.size ? `${p.camera.x},${p.camera.y}` : "";
  return useMemo(() => {
    const k = gardenScale * zoom;
    const shown = revealed(r, presentation, selected, count);
    const highlight = new Map<number, "selected" | "generator" | "seed">();
    if (selected >= 0) {
      highlight.set(selected, "selected");
      if (r.generation[selected] > 0)
        for (const g of r.parents[selected]) highlight.set(g, "generator");
    }
    // With a selection, the rest of the packing recedes; in the sparse view
    // the enclosing circle, when not a generator, is a faint frame.
    const recede = selected >= 0;
    const circle = (i: number, role: "base" | "selected" | "generator") => {
      const c = shapeOf(r, i);
      const rpx = (c.r ?? Infinity) * k;
      const width =
        role === "selected"
          ? ring(rpx, 2.4, 0.9)
          : role === "generator"
            ? ring(rpx, 2, 0.7)
            : ring(rpx, 1.25, 0.12);
      const stroked = {
        stroke: role === "selected" ? palette.derived : palette.base,
        opacity: role === "base" && recede ? 0.4 : undefined,
        ...stroke(width),
      };
      if (big.has(i)) {
        const d = stretch(c, p.camera);
        return d ? (
          <path
            key={`${role}-${i}`}
            data-circle={i}
            data-role={role}
            data-shape={c.r ? "arc" : "line"}
            d={d}
            {...stroked}
          />
        ) : null;
      }
      return (
        <circle
          key={`${role}-${i}`}
          data-circle={i}
          data-role={role}
          cx={500 + c.x! * k}
          cy={380 - c.y! * k}
          r={rpx}
          {...stroked}
        />
      );
    };
    const out: ReactNode[] = [];
    for (const i of shown) if (!highlight.has(i)) out.push(circle(i, "base"));
    for (const [i, role] of highlight)
      if (role === "generator") out.push(circle(i, "generator"));
    if (selected >= 0) out.push(circle(selected, "selected"));
    return out;
  }, [
    r,
    presentation,
    selected,
    count,
    zoom,
    big,
    pan,
    p.weight,
    palette.base,
    palette.derived,
  ]);
}

function Art(p: GardenDrawingProps & { clip?: string }) {
  const palette = plotPalette(p.dark, p.scheme);
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
        <g transform={`translate(${p.camera.x} ${p.camera.y})`} fill="none">
          <Circles {...p} />
        </g>
      </g>
    </>
  );
}

// The still and export page: the same circles, with the study's metadata
// in the root's desc rather than in the drawing.
export function GardenStill(p: GardenDrawingProps & { metadata: unknown }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox={`0 0 ${width} ${height}`}
      width={width}
      height={height}
      // The page's color fills whatever viewer shows the file, beyond the
      // page too, as the ordinary notebooks' exports do. A transparent
      // still removes it with the background rectangle.
      style={{ background: plotPalette(p.dark, p.scheme).bg }}
    >
      <desc>{JSON.stringify(p.metadata)}</desc>
      <Art {...p} clip="garden-clip" />
    </svg>
  );
}

// The live drawing: drag to pan, wheel or pinch to zoom, keys to move, and
// a click or tap near a circle to select it.
export function GardenDrawing(
  p: GardenDrawingProps & {
    busy: boolean;
    onCamera?: (c: PlotCamera) => void;
    onSelect?: (i: number) => void;
  },
) {
  const gestures = usePageGestures({
    page: gardenPage,
    range: zoomRange,
    camera: p.camera,
    onCamera: p.onCamera,
    onTap:
      p.onSelect &&
      ((at, tolerance) => {
        const i = hitCircle(
          p.result,
          revealed(
            p.result,
            p.presentation,
            p.selected,
            p.count ?? p.result.curvature.length,
          ),
          at,
          p.camera,
          tolerance,
        );
        if (i >= 0) p.onSelect?.(i);
      }),
  });
  return (
    <svg
      {...gestures}
      id="garden-artwork"
      overflow="hidden"
      style={{ background: plotPalette(p.dark, p.scheme).bg }}
      className="garden-drawing"
      viewBox={`0 0 ${width} ${height}`}
      role="img"
      aria-label="Apollonian circle packing"
      aria-busy={p.busy}
      data-zoom={p.camera.zoom}
      data-pan={`${p.camera.x},${p.camera.y}`}
      data-selected={p.selected}
      data-presentation={p.presentation}
      data-count={p.count}
    >
      <Art {...p} />
    </svg>
  );
}
