import { useEffect, useMemo, useRef, type ReactNode } from "react";
import { createGesture, type Motion } from "../gestures";
import type { PlotCamera } from "../planar-link";
import type { ColorScheme } from "../color-schemes";
import { plotPalette } from "../palette";
import { svgStroke, type LineWeight } from "../line-weight";
import {
  gardenPage,
  gardenScale,
  gardenZoom,
  hitCircle,
  presented,
  type GardenPresentation,
  type GardenResult,
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
};
const { width, height } = gardenPage;
export const zoomRange = gardenZoom;

// A circle's regular stroke shrinks with its drawn radius, so the smallest
// circles stay rings rather than dots. Highlights keep a visible minimum.
const ring = (rpx: number, cap: number, floor: number) =>
  Math.min(cap, Math.max(floor, 0.25 * rpx));

// The circles of one presentation, in page units at the camera's zoom; the
// pan is the enclosing group's translation. Only geometry: no text, no hit
// targets.
function Circles(p: GardenDrawingProps) {
  const palette = plotPalette(p.dark, p.scheme),
    stroke = svgStroke(p.weight);
  const { result: r, presentation, selected } = p;
  const zoom = p.camera.zoom;
  return useMemo(() => {
    const k = gardenScale * zoom;
    const shown = presented(r, presentation, selected);
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
      const rpx = r.radius[i] * k;
      const width =
        role === "selected"
          ? ring(rpx, 2.4, 0.9)
          : role === "generator"
            ? ring(rpx, 2, 0.7)
            : ring(rpx, 1.25, 0.12);
      return (
        <circle
          key={`${role}-${i}`}
          data-circle={i}
          data-role={role}
          cx={500 + r.x[i] * k}
          cy={380 - r.y[i] * k}
          r={rpx}
          stroke={role === "selected" ? palette.derived : palette.base}
          opacity={role === "base" && recede ? 0.4 : undefined}
          {...stroke(width)}
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
    zoom,
    p.weight,
    palette.base,
    palette.derived,
  ]);
}

function Art(p: GardenDrawingProps & { clip: string }) {
  const palette = plotPalette(p.dark, p.scheme);
  return (
    <>
      <defs>
        <clipPath id={p.clip}>
          <rect width={width} height={height} />
        </clipPath>
      </defs>
      <rect width={width} height={height} fill={palette.bg} />
      <g clipPath={`url(#${p.clip})`}>
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
  const svg = useRef<SVGSVGElement>(null),
    gesture = useRef(createGesture());
  const camera = useRef(p.camera);
  camera.current = p.camera;
  const change = useRef(p.onCamera);
  change.current = p.onCamera;
  const tap = useRef<{ x: number; y: number; type: string } | null>(null);
  // Client pixels to page units, as the SVG's default meet fitting draws it.
  const page = (clientX: number, clientY: number, box: DOMRect) => {
    const ratio = Math.max(width / box.width, height / box.height);
    return {
      ratio,
      x: width / 2 + (clientX - box.left - box.width / 2) * ratio,
      y: height / 2 + (clientY - box.top - box.height / 2) * ratio,
    };
  };
  const apply = (motion: Motion, box: DOMRect) => {
    const c = camera.current,
      ratio = Math.max(width / box.width, height / box.height);
    let next: PlotCamera;
    if (motion.kind === "drag")
      next = { ...c, x: c.x + motion.dx * ratio, y: c.y + motion.dy * ratio };
    else {
      const zoom = Math.max(
          zoomRange[0],
          Math.min(zoomRange[1], c.zoom * motion.scale),
        ),
        k = zoom / c.zoom;
      // Zoom about the fingers' midpoint, kept under them as they move.
      const u = (motion.mid.x - box.left - box.width / 2) * ratio,
        v = (motion.mid.y - box.top - box.height / 2) * ratio;
      next = {
        zoom,
        x: u - (u - motion.dx * ratio - c.x) * k,
        y: v - (v - motion.dy * ratio - c.y) * k,
      };
    }
    camera.current = next;
    change.current?.(next);
  };
  useEffect(() => {
    const el = svg.current;
    if (!el || !p.onCamera) return;
    const wheel = (e: WheelEvent) => {
      e.preventDefault();
      apply(
        {
          kind: "pinch",
          scale: Math.exp(-e.deltaY * 0.001),
          dx: 0,
          dy: 0,
          mid: { x: e.clientX, y: e.clientY },
        },
        el.getBoundingClientRect(),
      );
    };
    el.addEventListener("wheel", wheel, { passive: false });
    return () => el.removeEventListener("wheel", wheel);
  }, [!!p.onCamera]);
  return (
    <svg
      ref={svg}
      id="garden-artwork"
      className="garden-drawing"
      viewBox={`0 0 ${width} ${height}`}
      role="img"
      aria-label="Apollonian circle packing"
      aria-busy={p.busy}
      data-zoom={p.camera.zoom}
      data-pan={`${p.camera.x},${p.camera.y}`}
      data-selected={p.selected}
      data-presentation={p.presentation}
      tabIndex={p.onCamera ? 0 : undefined}
      onPointerDown={(e) => {
        if (!p.onCamera || e.button !== 0) return;
        tap.current =
          gesture.current.count === 0
            ? { x: e.clientX, y: e.clientY, type: e.pointerType }
            : null;
        e.currentTarget.setPointerCapture(e.pointerId);
        gesture.current.down(e);
      }}
      onPointerMove={(e) => {
        const motion = gesture.current.move(e);
        if (!motion || !p.onCamera) return;
        if (
          motion.kind === "pinch" ||
          (tap.current &&
            Math.hypot(e.clientX - tap.current.x, e.clientY - tap.current.y) >
              4)
        )
          tap.current = null;
        apply(motion, e.currentTarget.getBoundingClientRect());
      }}
      onPointerUp={(e) => {
        gesture.current.up(e);
        const t = tap.current;
        tap.current = null;
        if (!t || !p.onSelect) return;
        const at = page(
          e.clientX,
          e.clientY,
          e.currentTarget.getBoundingClientRect(),
        );
        // A finger covers more than a cursor does.
        const tolerance = (t.type === "touch" ? 18 : 10) * at.ratio;
        const i = hitCircle(
          p.result,
          presented(p.result, p.presentation, p.selected),
          { x: at.x, y: at.y },
          p.camera,
          tolerance,
        );
        if (i >= 0) p.onSelect(i);
      }}
      onPointerCancel={(e) => {
        gesture.current.up(e);
        tap.current = null;
      }}
      onLostPointerCapture={(e) => gesture.current.up(e)}
      onKeyDown={(e) => {
        const onCamera = p.onCamera;
        if (!onCamera) return;
        const c = p.camera;
        const next =
          e.key === "Home"
            ? { x: 0, y: 0, zoom: 1 }
            : e.key === "+" || e.key === "="
              ? { ...c, zoom: Math.min(zoomRange[1], c.zoom * 1.2) }
              : e.key === "-"
                ? { ...c, zoom: Math.max(zoomRange[0], c.zoom / 1.2) }
                : e.key === "ArrowLeft"
                  ? { ...c, x: c.x - 25 }
                  : e.key === "ArrowRight"
                    ? { ...c, x: c.x + 25 }
                    : e.key === "ArrowUp"
                      ? { ...c, y: c.y - 25 }
                      : e.key === "ArrowDown"
                        ? { ...c, y: c.y + 25 }
                        : null;
        if (next) {
          e.preventDefault();
          onCamera(next);
        }
      }}
    >
      <Art {...p} clip="garden-live-clip" />
    </svg>
  );
}
