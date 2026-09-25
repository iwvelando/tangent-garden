import { useEffect, useMemo, useRef, useState } from "react";
import type { Config, Result, Vec } from "./types";
import type { AnimationView, Viewport } from "./animation";
export type Layers = {
  base: boolean;
  derived: boolean;
  lines: boolean;
  incident: boolean;
  virtual: boolean;
  axes: boolean;
};
type Props = {
  result: Result;
  config: Config;
  layers: Layers;
  dark: boolean;
  length: number;
  reset: number;
  animation?: AnimationView | null;
  onViewport?: (view: Viewport) => void;
  pixelRatio?: number;
};
const W = 1000,
  H = 760;
export function Plot({
  result,
  config,
  layers,
  dark,
  length,
  reset,
  animation,
  onViewport,
  pixelRatio = 1,
}: Props) {
  const [camera, setCamera] = useState({ x: 0, y: 0, zoom: 1, reset });
  const cam =
    !animation && camera.reset === reset
      ? camera
      : { x: 0, y: 0, zoom: 1, reset };
  const drag = useRef<{ x: number; y: number; cx: number; cy: number } | null>(
    null,
  );
  const svgRef = useRef<SVGSVGElement>(null);
  useEffect(() => {
    const svg = svgRef.current;
    if (!svg || animation) return;
    const zoom = (e: WheelEvent) => {
      e.preventDefault();
      setCamera((previous) => {
        const c =
          previous.reset === reset ? previous : { x: 0, y: 0, zoom: 1, reset };
        return {
          ...c,
          zoom: Math.max(
            0.1,
            Math.min(20, c.zoom * Math.exp(-e.deltaY * 0.001)),
          ),
        };
      });
    };
    svg.addEventListener("wheel", zoom, { passive: false });
    return () => svg.removeEventListener("wheel", zoom);
  }, [reset, !!animation]);
  const palette = dark
    ? {
        bg: "#141e22",
        base: "#72c9c4",
        derived: "#f3bc83",
        line: "#86b5b6",
        incident: "#9aaab9",
        axis: "#2b3b41",
        text: "#a0b0b4",
      }
    : {
        bg: "#fffefa",
        base: "#186b6b",
        derived: "#bc562e",
        line: "#397f82",
        incident: "#8797aa",
        axis: "#e8e5dd",
        text: "#8a928f",
      };
  const currentFrame = useMemo(
    () => fitFrame(result, config),
    [result, config],
  );
  const finalFrame = useMemo(
    () =>
      animation
        ? fitFrame(animation.final.result, animation.final.config)
        : null,
    [animation?.final],
  );
  const frame =
    animation?.camera === "current" && animation.heldView
      ? animation.heldView
      : !animation || !finalFrame || animation.camera === "fit"
        ? currentFrame
        : animation.camera === "hold"
          ? finalFrame
          : { ...finalFrame, cx: currentFrame.cx, cy: currentFrame.cy };
  const scale = frame.scale * cam.zoom;
  useEffect(() => {
    if (!animation)
      onViewport?.({
        cx: frame.cx - cam.x / scale,
        cy: frame.cy + cam.y / scale,
        scale,
        span: frame.span / cam.zoom,
      });
  }, [
    animation,
    frame.cx,
    frame.cy,
    frame.span,
    scale,
    cam.x,
    cam.y,
    cam.zoom,
    onViewport,
  ]);
  const xy = (p: Vec): Vec => ({
    x: W / 2 + (p.x - frame.cx) * scale + cam.x,
    y: H / 2 - (p.y - frame.cy) * scale + cam.y,
  });
  const path = (points: (Vec | null)[], virtual?: boolean) => {
    let s = "",
      last: Vec | null = null;
    points.forEach((p, i) => {
      if (!p || (virtual !== undefined && result.virtual[i] !== virtual)) {
        last = null;
        return;
      }
      const a = xy(p);
      if (Math.abs(a.x) > 1e6 || Math.abs(a.y) > 1e6) {
        last = null;
        return;
      }
      const gap =
        !last || Math.hypot(a.x - last.x, a.y - last.y) > Math.max(W, H) * 0.6;
      s += `${gap ? "M" : "L"}${a.x.toFixed(3)},${a.y.toFixed(3)} `;
      last = a;
    });
    return s;
  };
  const line = (
    a: Vec,
    b: Vec,
    color: string,
    opacity: number,
    dashed = false,
    key?: string,
  ) => {
    const p = xy(a),
      q = xy(b);
    if (
      !Number.isFinite(q.x) ||
      !Number.isFinite(q.y) ||
      Math.abs(q.x) > 1e7 ||
      Math.abs(q.y) > 1e7
    )
      return null;
    return (
      <line
        key={key}
        x1={p.x}
        y1={p.y}
        x2={q.x}
        y2={q.y}
        stroke={color}
        strokeWidth="1"
        opacity={opacity}
        strokeDasharray={dashed ? "5 5" : undefined}
      />
    );
  };
  const optical = config.kind === "catacaustic" || config.kind === "diacaustic";
  const visibleDerived = result.derived.filter(
    (p, i): p is Vec =>
      !!p && (!optical || layers.virtual || !result.virtual[i]),
  );
  const focus =
    visibleDerived.length > 0 &&
    visibleDerived.every(
      (p) =>
        Math.hypot(p.x - visibleDerived[0].x, p.y - visibleDerived[0].y) *
          scale <
        0.5,
    )
      ? xy(visibleDerived[0])
      : null;
  const gridStep = 10 ** Math.floor(Math.log10(frame.span / (cam.zoom * 5)));
  const grid = [];
  if (layers.axes) {
    const x0 = frame.cx + (-W / 2 - cam.x) / scale,
      x1 = x0 + W / scale,
      y1 = frame.cy + (H / 2 + cam.y) / scale,
      y0 = y1 - H / scale;
    for (
      let x = Math.ceil(x0 / gridStep) * gridStep;
      x < x1 && grid.length < 200;
      x += gridStep
    )
      grid.push(
        line({ x, y: y0 }, { x, y: y1 }, palette.axis, 1, false, `x${x}`),
      );
    for (
      let y = Math.ceil(y0 / gridStep) * gridStep;
      y < y1 && grid.length < 400;
      y += gridStep
    )
      grid.push(
        line({ x: x0, y }, { x: x1, y }, palette.axis, 1, false, `y${y}`),
      );
    grid.push(
      line({ x: 0, y: y0 }, { x: 0, y: y1 }, palette.text, 0.5, false, "yaxis"),
      line({ x: x0, y: 0 }, { x: x1, y: 0 }, palette.text, 0.5, false, "xaxis"),
    );
  }
  return (
    <svg
      ref={svgRef}
      id="artwork"
      xmlns="http://www.w3.org/2000/svg"
      width={W * pixelRatio}
      height={H * pixelRatio}
      viewBox={`0 0 ${W} ${H}`}
      data-camera-scale={scale}
      data-camera-center={`${frame.cx - cam.x / scale},${frame.cy + cam.y / scale}`}
      data-animation-progress={animation?.progress}
      role="img"
      aria-label={`${config.kind} construction with ${config.lines} representative lines`}
      style={{ background: palette.bg, touchAction: "none" }}
      onPointerDown={(e) => {
        if (animation) return;
        e.currentTarget.setPointerCapture(e.pointerId);
        drag.current = { x: e.clientX, y: e.clientY, cx: cam.x, cy: cam.y };
      }}
      onPointerMove={(e) => {
        if (!drag.current) return;
        const r = e.currentTarget.getBoundingClientRect();
        const ratio = Math.max(W / r.width, H / r.height);
        setCamera({
          ...cam,
          x: drag.current.cx + (e.clientX - drag.current.x) * ratio,
          y: drag.current.cy + (e.clientY - drag.current.y) * ratio,
        });
      }}
      onPointerUp={() => {
        drag.current = null;
      }}
      onPointerCancel={() => {
        drag.current = null;
      }}
    >
      <title>Tangent Garden · {config.kind}</title>
      <desc>
        {JSON.stringify({
          ...config,
          animation: animation
            ? {
                mode: animation.mode,
                progress: animation.progress,
                camera: animation.camera,
                heldView: animation.heldView,
              }
            : undefined,
        })}
      </desc>
      <rect width={W} height={H} fill={palette.bg} />
      {grid}
      {result.rays.map((ray, i) => {
        const distance = (finalFrame?.span ?? frame.span) * length;
        const end = {
          x: ray.origin.x + ray.direction.x * distance,
          y: ray.origin.y + ray.direction.y * distance,
        };
        const back = {
          x: ray.origin.x - ray.direction.x * distance,
          y: ray.origin.y - ray.direction.y * distance,
        };
        const incoming =
          config.source.kind === "point"
            ? config.source.position
            : {
                x: ray.origin.x - ray.incident.x * distance,
                y: ray.origin.y - ray.incident.y * distance,
              };
        return (
          <g key={i}>
            {optical &&
              layers.incident &&
              line(incoming, ray.origin, palette.incident, 0.3)}
            {layers.lines &&
              (optical
                ? line(ray.origin, end, ray.tir ? "#c18b32" : palette.line, 0.5)
                : ray.target &&
                  line(ray.origin, ray.target, palette.line, 0.52))}
            {optical &&
              layers.lines &&
              layers.virtual &&
              line(ray.origin, back, palette.line, 0.23, true)}
          </g>
        );
      })}
      {layers.base && (
        <path
          d={path(result.base)}
          fill="none"
          stroke={palette.base}
          strokeWidth="2.3"
        />
      )}
      {layers.derived && (
        <path
          d={path(result.derived, optical ? false : undefined)}
          fill="none"
          stroke={palette.derived}
          strokeWidth="2.6"
          strokeLinejoin="round"
        />
      )}
      {optical && layers.derived && layers.virtual && (
        <path
          d={path(result.derived, true)}
          fill="none"
          stroke={palette.derived}
          strokeWidth="2.3"
          strokeDasharray="6 4"
        />
      )}
      {layers.derived && focus && (
        <circle
          data-testid="focus-point"
          cx={focus.x}
          cy={focus.y}
          r="3.5"
          fill={palette.derived}
        />
      )}
      {optical && config.source.kind === "point" && (
        <g>
          <circle
            cx={xy(config.source.position).x}
            cy={xy(config.source.position).y}
            r="5"
            fill={palette.derived}
          />
          <circle
            cx={xy(config.source.position).x}
            cy={xy(config.source.position).y}
            r="10"
            fill="none"
            stroke={palette.derived}
            opacity=".35"
          />
        </g>
      )}
    </svg>
  );
}

// Fit each point family independently: a short base arc must not discard a
// distant but coherent derived arc. Outer Tukey fences suppress isolated tails
// near asymptotes without clipping ordinary extrema to percentile bounds.
export function framingPoints(points: (Vec | null)[]): Vec[] {
  const finite = points.filter(
    (p): p is Vec =>
      !!p &&
      Number.isFinite(p.x) &&
      Number.isFinite(p.y) &&
      Math.abs(p.x) < 1e10 &&
      Math.abs(p.y) < 1e10,
  );
  if (finite.length < 8) return finite;
  const fence = (values: number[]) => {
    values.sort((a, b) => a - b);
    const q1 = values[Math.floor((values.length - 1) * 0.25)];
    const q3 = values[Math.floor((values.length - 1) * 0.75)];
    const spread = Math.max(q3 - q1, 0.1);
    return [q1 - 3 * spread, q3 + 3 * spread];
  };
  const [x0, x1] = fence(finite.map((p) => p.x));
  const [y0, y1] = fence(finite.map((p) => p.y));
  return finite.filter((p) => p.x >= x0 && p.x <= x1 && p.y >= y0 && p.y <= y1);
}
export function fitFrame(result: Result, config: Config) {
  const points = [
    ...framingPoints(result.base),
    ...framingPoints(result.derived),
  ];
  if (!points.length) return { cx: 0, cy: 0, scale: 100, span: 5 };
  let minX = Infinity,
    maxX = -Infinity,
    minY = Infinity,
    maxY = -Infinity;
  const include = (p: Vec) => {
    minX = Math.min(minX, p.x);
    maxX = Math.max(maxX, p.x);
    minY = Math.min(minY, p.y);
    maxY = Math.max(maxY, p.y);
  };
  points.forEach(include);
  const extent = Math.max(maxX - minX, maxY - minY, 0.1);
  if (
    (config.kind === "catacaustic" || config.kind === "diacaustic") &&
    config.source.kind === "point" &&
    Math.hypot(
      config.source.position.x - (minX + maxX) / 2,
      config.source.position.y - (minY + maxY) / 2,
    ) <
      extent * 4
  )
    include(config.source.position);
  return {
    cx: (minX + maxX) / 2,
    cy: (minY + maxY) / 2,
    scale: Math.min(
      (W * 0.78) / Math.max(maxX - minX, 0.1),
      (H * 0.78) / Math.max(maxY - minY, 0.1),
    ),
    span: Math.max(maxX - minX, maxY - minY, 0.1),
  };
}
