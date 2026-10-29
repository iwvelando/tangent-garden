import { createGesture } from "../gestures";
import { useEffect, useId, useMemo, useRef, type PointerEvent } from "react";
import { framingPoints, pathData } from "../Plot";
import type { PlotCamera } from "../planar-link";
import type { ColorScheme } from "../color-schemes";
import { plotPalette } from "../palette";
import { svgStroke, type LineWeight } from "../line-weight";
import type { Vec } from "../types";
import type { LoomResult, LoomMarker } from "./model";
export type Pane = "source" | "image";
export function loomFit(result: LoomResult, pane: Pane) {
  const points = result.members.flatMap((m) => {
    // The ordinary fitter has a legacy coordinate fence. Normalize extreme
    // units by an exact power of two before applying its robust family fit.
    let magnitude = 0;
    for (const p of m[pane])
      if (p) magnitude = Math.max(magnitude, Math.abs(p.x), Math.abs(p.y));
    const unit =
      magnitude >= 1e9 || (magnitude > 0 && magnitude <= 1e-6)
        ? 2 ** Math.max(-1022, Math.min(1023, Math.floor(Math.log2(magnitude))))
        : 1;
    if (unit === 1) return framingPoints(m[pane]);
    return framingPoints(
      m[pane].map((p) => (p ? { x: p.x / unit, y: p.y / unit } : null)),
    ).map((p) => ({ x: p.x * unit, y: p.y * unit }));
  });
  if (!points.length) return { cx: 0, cy: 0, scale: 100 };
  let x0 = Infinity,
    x1 = -Infinity,
    y0 = Infinity,
    y1 = -Infinity;
  for (const p of points) {
    x0 = Math.min(x0, p.x);
    x1 = Math.max(x1, p.x);
    y0 = Math.min(y0, p.y);
    y1 = Math.max(y1, p.y);
  }
  const extent = Math.max(x1 - x0, y1 - y0) || 0.1;
  return {
    cx: x0 / 2 + x1 / 2,
    cy: y0 / 2 + y1 / 2,
    scale: Math.min(
      Number.MAX_VALUE,
      780 / Math.max(x1 - x0, extent * 0.01),
      590 / Math.max(y1 - y0, extent * 0.01),
    ),
  };
}
export type DrawingProps = {
  result: LoomResult;
  marker: LoomMarker;
  pane: Pane;
  selected: number;
  camera: PlotCamera;
  framing?: import("./model").LoomFraming;
  dark: boolean;
  scheme: ColorScheme;
  weight: LineWeight;
  onCamera?: (c: PlotCamera) => void;
  onSelect?: (id: number) => void;
};
export function PaneDrawing(p: DrawingProps) {
  const clip = useId().replaceAll(":", "");
  const palette = plotPalette(p.dark, p.scheme),
    stroke = svgStroke(p.weight);
  const computed = useMemo(
    () => p.framing ?? loomFit(p.result, p.pane),
    [p.result, p.pane, p.framing],
  );
  const fit = computed;
  const xy = (v: Vec) => ({
    x: 500 + (v.x - fit.cx) * fit.scale * p.camera.zoom + p.camera.x,
    y: 380 - (v.y - fit.cy) * fit.scale * p.camera.zoom + p.camera.y,
  });
  const svgRef = useRef<SVGSVGElement>(null),
    gesture = useRef(createGesture());
  const camera = useRef(p.camera);
  camera.current = p.camera;
  const change = useRef(p.onCamera);
  change.current = p.onCamera;
  const tapped = useRef<{ id: number; x: number; y: number } | null>(null);
  const moved = useRef(false);
  const apply = (motion: import("../gestures").Motion, r: DOMRect) => {
    const c = camera.current,
      ratio = Math.max(1000 / r.width, 760 / r.height);
    if (motion.kind === "drag") {
      const next = {
        ...c,
        x: c.x + motion.dx * ratio,
        y: c.y + motion.dy * ratio,
      };
      camera.current = next;
      change.current?.(next);
      return;
    }
    const zoom = Math.max(0.1, Math.min(100, c.zoom * motion.scale)),
      k = zoom / c.zoom;
    const u = (motion.mid.x - r.left - r.width / 2) * ratio,
      v = (motion.mid.y - r.top - r.height / 2) * ratio;
    const next = {
      zoom,
      x: u - (u - motion.dx * ratio - c.x) * k,
      y: v - (v - motion.dy * ratio - c.y) * k,
    };
    camera.current = next;
    change.current?.(next);
  };
  useEffect(() => {
    const svg = svgRef.current;
    if (!svg || !p.onCamera) return;
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
        svg.getBoundingClientRect(),
      );
    };
    svg.addEventListener("wheel", wheel, { passive: false });
    return () => svg.removeEventListener("wheel", wheel);
  }, [!!p.onCamera]);
  const point = p.marker[p.pane];
  return (
    <svg
      ref={svgRef}
      data-zoom={p.camera.zoom}
      data-pan={`${p.camera.x},${p.camera.y}`}
      width="1000"
      height="760"
      viewBox="0 0 1000 760"
      role="img"
      aria-label={
        p.pane === "source" ? "Complex source plane" : "Squared image plane"
      }
      data-pane={p.pane}
      tabIndex={p.onCamera ? 0 : undefined}
      onPointerDown={(e) => {
        if (!p.onCamera || e.button !== 0) return;
        const path = (e.target as Element).closest(
          "[data-hit-member], [data-member]",
        );
        if (gesture.current.count === 0) {
          moved.current = false;
          tapped.current = path
            ? {
                id: Number(
                  path.getAttribute("data-hit-member") ??
                    path.getAttribute("data-member"),
                ),
                x: e.clientX,
                y: e.clientY,
              }
            : null;
        } else {
          moved.current = true;
          tapped.current = null;
        }
        e.currentTarget.setPointerCapture(e.pointerId);
        gesture.current.down(e);
      }}
      onPointerMove={(e) => {
        const motion = gesture.current.move(e);
        if (!motion || !p.onCamera) return;
        if (motion.kind === "pinch" || Math.hypot(motion.dx, motion.dy) > 0.5)
          moved.current = true;
        apply(motion, e.currentTarget.getBoundingClientRect());
      }}
      onPointerUp={(e) => {
        gesture.current.up(e);
        if (!moved.current && tapped.current) p.onSelect?.(tapped.current.id);
        tapped.current = null;
      }}
      onPointerCancel={(e) => {
        gesture.current.up(e);
        tapped.current = null;
      }}
      onLostPointerCapture={(e) => gesture.current.up(e)}
      onKeyDown={(e) => {
        if (!p.onCamera) return;
        const c = p.camera;
        const next =
          e.key === "Home"
            ? { x: 0, y: 0, zoom: 1 }
            : e.key === "+" || e.key === "="
              ? { ...c, zoom: Math.min(100, c.zoom * 1.2) }
              : e.key === "-"
                ? { ...c, zoom: Math.max(0.1, c.zoom / 1.2) }
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
          p.onCamera(next);
        }
      }}
    >
      <defs>
        <clipPath id={clip}>
          <rect width="1000" height="760" />
        </clipPath>
      </defs>
      <rect width="1000" height="760" fill={palette.bg} />
      <g
        clipPath={`url(#${clip})`}
        fill="none"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        {p.result.members.map((m) => (
          <path
            key={m.id}
            data-member={m.id}
            data-selected={m.id === p.selected}
            d={pathData(m[p.pane], xy)}
            stroke={m.id === p.selected ? palette.derived : palette.base}
            opacity={m.id === p.selected ? 1 : 0.5}
            {...stroke(m.id === p.selected ? 2.4 : 1.25)}
          />
        ))}
        {p.onSelect &&
          p.result.members.map((m) => (
            <path
              key={`hit-${m.id}`}
              data-hit-member={m.id}
              d={pathData(m[p.pane], xy)}
              stroke="transparent"
              strokeWidth={20}
              vectorEffect="non-scaling-stroke"
              pointerEvents="stroke"
            />
          ))}
        {point && (
          <circle
            data-marker="true"
            data-point={JSON.stringify(point)}
            cx={xy(point).x}
            cy={xy(point).y}
            r={5.5}
            stroke={palette.probe}
            strokeWidth={2.4}
            fill={palette.bg}
          />
        )}
      </g>
    </svg>
  );
}
// Deterministic still/movie layout: source left, image right. Each panel keeps
// its own equal-scale 1000 x 760 camera; no labels enter either viewport.
export function PairedDrawing({
  source,
  image,
  metadata,
}: {
  source: DrawingProps;
  image: DrawingProps;
  metadata: unknown;
}) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 2000 760"
      width="2000"
      height="760"
    >
      <desc>{JSON.stringify(metadata)}</desc>
      <g>
        <PaneDrawing {...source} onCamera={undefined} onSelect={undefined} />
      </g>
      <g transform="translate(1000 0)">
        <PaneDrawing {...image} onCamera={undefined} onSelect={undefined} />
      </g>
    </svg>
  );
}
