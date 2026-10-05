import { useEffect, useMemo, useRef, useState } from "react";
import { svgStroke, type LineWeight } from "./line-weight";
import { probeHighlight } from "./planar-probe";
import {
  usesPole,
  type Config,
  type Placement,
  type Result,
  type Rolling,
  type Vec,
} from "./types";
import type { AnimationView, Viewport } from "./animation";
import type { PlotCamera } from "./planar-link";
import { densityImage } from "./attractor";
import { plotPalette } from "./palette";
import { createGesture } from "./gestures";
import type { RefinedPath } from "./refinement";
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
  // Fit view after an animation completes: reframes only its exploration.
  refit?: number;
  animation?: AnimationView | null;
  onViewport?: (view: Viewport) => void;
  // A manual camera to start from at this reset, as a shared link restores.
  initialCamera?: { reset: number; camera: PlotCamera } | null;
  // The manual camera, offset from the fitted framing, whenever it changes.
  onCamera?: (camera: PlotCamera) => void;
  // How wide lines are drawn (line-weight.ts); regular when absent.
  weight?: LineWeight;
  // The base sample the probe stands at, when it is on and no animation
  // decides it (see planar-probe.ts).
  probe?: number;
  pixelRatio?: number;
};
const W = 1000,
  H = 760;
// The world rectangle a view shows, for light entering from its edge.
export function viewRect(view: { cx: number; cy: number; scale: number }) {
  return {
    x0: view.cx - W / 2 / view.scale,
    x1: view.cx + W / 2 / view.scale,
    y0: view.cy - H / 2 / view.scale,
    y1: view.cy + H / 2 / view.scale,
  };
}
// An arrow along a direction in plot coordinates, drawn in screen pixels: a
// shaft of the given length from `behind` pixels before (x, y), and a head
// of the given size at its tip. A zero-length shaft leaves a chevron at
// (x, y). Nothing is drawn for a zero or nonfinite direction.
function arrow(
  x: number,
  y: number,
  direction: Vec,
  length: number,
  behind: number,
  head: number,
) {
  const n = Math.hypot(direction.x, direction.y);
  if (!(n > 0) || !Number.isFinite(n)) return "";
  // The screen's y axis points down.
  const ux = direction.x / n,
    uy = -direction.y / n;
  const f = (v: number) => v.toFixed(3);
  const tip = [x + (length - behind) * ux, y + (length - behind) * uy];
  const side = (turn: number) =>
    `${f(tip[0] - head * (ux * Math.cos(turn) - uy * Math.sin(turn)))},${f(tip[1] - head * (ux * Math.sin(turn) + uy * Math.cos(turn)))}`;
  const shaft =
    length > 0
      ? `M${f(x - behind * ux)},${f(y - behind * uy)}L${f(tip[0])},${f(tip[1])}`
      : "";
  return `${shaft}M${side(0.5)}L${f(tip[0])},${f(tip[1])}L${side(-0.5)}`;
}

export function Plot({
  result,
  config,
  layers,
  dark,
  length,
  reset,
  refit = 0,
  animation,
  onViewport,
  initialCamera,
  onCamera,
  pixelRatio = 1,
  weight = "regular",
  probe,
}: Props) {
  // Every stroke's regular width, at the chosen line weight.
  const stroke = svgStroke(weight);
  const [camera, setCamera] = useState(() =>
    initialCamera?.reset === reset
      ? { ...initialCamera.camera, reset }
      : { x: 0, y: 0, zoom: 1, reset },
  );
  // A completed animation is explored with its own camera, offset from the
  // animation's framing, so the manual one is intact when the study returns.
  const [explore, setExplore] = useState({ x: 0, y: 0, zoom: 1, reset: refit });
  const exploring = !!animation?.complete;
  const locked = !!animation && !exploring;
  useEffect(() => {
    if (!exploring) setExplore({ x: 0, y: 0, zoom: 1, reset: refit });
  }, [exploring]);
  const current = exploring ? explore : camera;
  const setCurrent = exploring ? setExplore : setCamera;
  const key = exploring ? refit : reset;
  // The camera a reset starts from: fitted, or the one a link restored.
  const fresh = (k: number) =>
    !exploring && initialCamera?.reset === k
      ? { ...initialCamera.camera, reset: k }
      : { x: 0, y: 0, zoom: 1, reset: k };
  const cam = !locked && current.reset === key ? current : fresh(key);
  const gesture = useRef(createGesture());
  const svgRef = useRef<SVGSVGElement>(null);
  useEffect(() => {
    const svg = svgRef.current;
    if (!svg || locked) return;
    const zoom = (e: WheelEvent) => {
      e.preventDefault();
      setCurrent((previous) => {
        const c = previous.reset === key ? previous : fresh(key);
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
  }, [key, locked, exploring]);
  const palette = plotPalette(dark);
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
  useEffect(() => {
    if (!animation) onCamera?.({ x: cam.x, y: cam.y, zoom: cam.zoom });
  }, [animation, cam.x, cam.y, cam.zoom, onCamera]);
  const xy = (p: Vec): Vec => ({
    x: W / 2 + (p.x - frame.cx) * scale + cam.x,
    y: H / 2 - (p.y - frame.cy) * scale + cam.y,
  });
  const path = (
    points: (Vec | null)[],
    virtual?: boolean,
    breaks?: Set<number>,
  ) =>
    pathData(
      points,
      xy,
      (i) => virtual === undefined || result.virtual[i] === virtual,
      breaks,
    );
  // A refined curve's real or virtual points, by its own flags.
  const refinedPath = (refined: RefinedPath<Vec>, virtual?: boolean) =>
    pathData(
      refined.points,
      xy,
      (i) => virtual === undefined || !!refined.virtual?.[i] === virtual,
    );
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
      !Number.isFinite(p.x) ||
      !Number.isFinite(p.y) ||
      Math.abs(p.x) > 1e7 ||
      Math.abs(p.y) > 1e7 ||
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
        {...stroke(1)}
        opacity={opacity}
        strokeDasharray={dashed ? "5 5" : undefined}
      />
    );
  };
  // An implicit curve has contours and an iterated map a density, and
  // neither a construction, whatever kind the configuration still names.
  const contours = result.contours;
  const attractor = result.attractor;
  const kind = contours ? "implicit" : attractor ? "attractor" : config.kind;
  const optical = kind === "catacaustic" || kind === "diacaustic";
  // Constructions whose derived points can be virtual: optical rays behind
  // the curve, and envelope points beyond their chords.
  const extended =
    kind === "envelope" &&
    (config.envelope.mode === "angle" || config.envelope.extend);
  const rings = kind === "envelope" && config.envelope.mode === "circle";
  const dashed = optical || (kind === "envelope" && !rings && !extended);
  // The circle of inversion, the curve inverted when it is derived, and where
  // its image is open between samples.
  const inversion = result.inversion;
  const breaks = new Set(inversion?.breaks);
  // Curves refined between their samples are drawn from their refined
  // points, whose nulls carry every break; framing keeps the samples.
  const refined = result.adaptive ?? {};
  // The probe's drawing at its sample, in its own inks: the highlighted
  // construction, the osculating circle and its center, the point, and the
  // tangent and normal, each a fixed share of the page long. An animation
  // decides the sample while it plays, and leaves it out of a frame without
  // one.
  const probeAt = animation ? animation.probe : probe;
  const probeDrawing = (() => {
    const d = result.diagnostics;
    const p = probeAt === undefined ? null : result.base[probeAt];
    if (!d || !p || probeAt === undefined) return null;
    const j = probeAt,
      at = xy(p),
      ink = (k: "mark" | "tangent" | "normal") =>
        ({
          mark: palette.probe,
          tangent: palette.probeTangent,
          normal: palette.probeNormal,
        })[k];
    const T = d.tangent[j],
      N = d.normal[j],
      c = d.center[j],
      k = d.curvature[j];
    const glyph = 70;
    const arm = (v: Vec, testid: string, color: string) => (
      <line
        data-testid={testid}
        x1={at.x}
        y1={at.y}
        x2={at.x + v.x * glyph}
        y2={at.y - v.y * glyph}
        stroke={color}
        {...stroke(1.6)}
        strokeLinecap="round"
      />
    );
    const center = c && xy(c);
    const radius = k ? scale / Math.abs(k) : 0;
    return (
      <g data-testid="probe" data-sample={j}>
        {probeHighlight(config, result)
          ?.lines(result, j, config)
          .map(([a, b], i) => {
            const u = xy(a),
              v = xy(b);
            return (
              <line
                key={i}
                data-testid="probe-construction"
                x1={u.x}
                y1={u.y}
                x2={v.x}
                y2={v.y}
                stroke={ink("mark")}
                {...stroke(1.2)}
              />
            );
          })}
        {center && radius < 1e6 && (
          <>
            <circle
              data-testid="probe-circle"
              cx={center.x}
              cy={center.y}
              r={radius}
              fill="none"
              stroke={ink("mark")}
              {...stroke(1.2)}
            />
            <circle
              data-testid="probe-center"
              cx={center.x}
              cy={center.y}
              r="3.5"
              fill={ink("mark")}
            />
          </>
        )}
        {T && arm(T, "probe-tangent", ink("tangent"))}
        {N && arm(N, "probe-normal", ink("normal"))}
        <circle
          data-testid="probe-point"
          cx={at.x}
          cy={at.y}
          r="5"
          fill="none"
          stroke={ink("mark")}
          {...stroke(1.6)}
        />
      </g>
    );
  })();
  // A derived curve or stack member that collapses to one point, such as a
  // circle offset by its radius, is drawn as a dot rather than vanishing.
  const collapsed = (points: (Vec | null)[]) => {
    const visible = points.filter((p): p is Vec => !!p);
    return visible.length > 0 &&
      visible.every(
        (p) => Math.hypot(p.x - visible[0].x, p.y - visible[0].y) * scale < 0.5,
      )
      ? xy(visible[0])
      : null;
  };
  const focuses = [
    collapsed(
      result.derived.map((p, i) =>
        !dashed || layers.virtual || !result.virtual[i] ? p : null,
      ),
    ),
    ...result.family.map((path) => collapsed(path.points)),
  ].filter((p): p is Vec => !!p);
  const gridStep = 10 ** Math.floor(Math.log10(frame.span / (cam.zoom * 5)));
  const grid = [];
  // The visible world rectangle, for lines that cross the whole drawing.
  const x0 = frame.cx + (-W / 2 - cam.x) / scale,
    x1 = x0 + W / scale,
    y1 = frame.cy + (H / 2 + cam.y) / scale,
    y0 = y1 - H / scale;
  // Unbounded lines reach past the view box, which a wider panel shows.
  const pad = 2 * Math.max(x1 - x0, y1 - y0);
  const roulette = result.roulette;
  // Rolling circles are drawn where their traces have reached.
  const rolling = roulette?.positions.at(-1);
  const harmonic = result.harmonic;
  // Like rolling circles, the rotating vectors are drawn where the trace
  // has reached.
  const epicycles = harmonic?.positions.at(-1);
  const pursuit = result.pursuit;
  // The pursuers are marked where the chase has reached.
  const chasers = pursuit?.polygons.at(-1);
  const field = result.field;
  const seeds = field ? config.curve.field.seeds : [];
  const roller = result.rolling.at(-1);
  const moving = result.moving;
  const placed = moving?.positions.at(-1);
  const tracer = roller ?? placed;
  // A rolling circle with its tracing arm, center, and contact point.
  const rollingParts = (s: Rolling) => (
    <>
      <circle
        cx={xy(s.center).x}
        cy={xy(s.center).y}
        r={s.radius * scale}
        fill="none"
        stroke={palette.line}
        {...stroke(1.2)}
        opacity=".75"
      />
      {line(s.center, s.point, palette.line, 0.75)}
      <circle
        cx={xy(s.center).x}
        cy={xy(s.center).y}
        r="2.5"
        fill={palette.line}
      />
      <circle
        data-testid="contact-point"
        cx={xy(s.contact).x}
        cy={xy(s.contact).y}
        r="3.5"
        fill="none"
        stroke={palette.line}
        {...stroke(1.5)}
      />
    </>
  );
  if (layers.axes) {
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
      data-animation-time={animation?.time}
      role="img"
      aria-label={
        contours
          ? `Implicit curve with ${config.lines} gradient normals`
          : attractor
            ? `Iterated map density with its first ${attractor.orbit.length - 1} iterates`
            : `${config.kind} construction with ${config.lines} representative lines`
      }
      style={{ background: palette.bg, touchAction: "none" }}
      onPointerDown={(e) => {
        if (locked) return;
        e.currentTarget.setPointerCapture(e.pointerId);
        gesture.current.down(e);
      }}
      onPointerMove={(e) => {
        const motion = gesture.current.move(e);
        if (!motion || locked) return;
        const r = e.currentTarget.getBoundingClientRect();
        const ratio = Math.max(W / r.width, H / r.height);
        // Moves can outpace renders, so each applies to the latest camera.
        setCurrent((previous) => {
          const c = previous.reset === key ? previous : fresh(key);
          if (motion.kind === "drag")
            return {
              ...c,
              x: c.x + motion.dx * ratio,
              y: c.y + motion.dy * ratio,
            };
          // A pinch zooms about the point between the fingers, which stays
          // where it is, and their shared movement pans.
          const zoom = Math.max(0.1, Math.min(20, c.zoom * motion.scale));
          const k = zoom / c.zoom;
          const u = (motion.mid.x - (r.left + r.width / 2)) * ratio,
            v = (motion.mid.y - (r.top + r.height / 2)) * ratio;
          return {
            ...c,
            zoom,
            x: u - (u - motion.dx * ratio - c.x) * k,
            y: v - (v - motion.dy * ratio - c.y) * k,
          };
        });
      }}
      onPointerUp={(e) => gesture.current.up(e)}
      onPointerCancel={(e) => gesture.current.up(e)}
      onLostPointerCapture={(e) => gesture.current.up(e)}
    >
      <title>Tangent Garden · {kind}</title>
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
          // Recorded only when it is not the drawing as it always was.
          weight: weight === "regular" ? undefined : weight,
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
        // An orthotomic point is the pole reflected across the tangent. Draw
        // the genuine projection foot H=(P+Q)/2 and dash the reflected part.
        const foot =
          config.kind === "orthotomic" && ray.target
            ? {
                x: (config.pole.x + ray.target.x) / 2,
                y: (config.pole.y + ray.target.y) / 2,
              }
            : ray.target;
        // A point joined to its image, along a ray from the center.
        if (inversion)
          return (
            layers.lines &&
            ray.target && (
              <g key={i} data-testid="inversion-segment">
                {line(ray.origin, ray.target, palette.line, 0.4)}
              </g>
            )
          );
        // A circle's radius to one of its touching points.
        if (rings)
          return (
            layers.lines &&
            ray.target && (
              <g key={i} data-testid="envelope-radius">
                {line(ray.origin, ray.target, palette.line, 0.45)}
              </g>
            )
          );
        if (config.kind === "envelope") {
          const ends =
            ray.end && !extended
              ? [ray.origin, ray.end]
              : across(
                  ray.origin,
                  ray.direction,
                  x0 - pad,
                  x1 + pad,
                  y0 - pad,
                  y1 + pad,
                );
          return (
            layers.lines &&
            ends && (
              <g key={i} data-testid="envelope-line">
                {line(ends[0], ends[1], palette.line, 0.45)}
              </g>
            )
          );
        }
        // A traced ray is drawn as far as its light has travelled.
        const traced = ray.traced;
        return (
          <g key={i}>
            {optical &&
              layers.incident &&
              (traced
                ? line(traced.from, traced.to, palette.incident, 0.3)
                : line(incoming, ray.origin, palette.incident, 0.3))}
            {layers.lines &&
              (optical
                ? (!traced || traced.out) &&
                  line(
                    ray.origin,
                    traced?.out ?? end,
                    ray.tir ? "#c18b32" : palette.line,
                    0.5,
                  )
                : foot && line(ray.origin, foot, palette.line, 0.52))}
            {usesPole(config.kind) &&
              layers.lines &&
              foot &&
              line(config.pole, foot, palette.line, 0.35)}
            {config.kind === "orthotomic" &&
              layers.lines &&
              foot &&
              ray.target &&
              line(foot, ray.target, palette.line, 0.35, true)}
            {optical &&
              layers.lines &&
              layers.virtual &&
              (!traced || traced.back) &&
              line(ray.origin, traced?.back ?? back, palette.line, 0.23, true)}
          </g>
        );
      })}
      {layers.lines && result.circles.length > 0 && (
        <g data-testid="generating-circles" aria-label="Generating circles">
          {result.circles.map((c) => {
            const center = xy(c.center);
            const radius = c.radius * scale;
            return (
              Number.isFinite(radius) &&
              radius < 1e7 && (
                <circle
                  key={c.sampleIndex}
                  cx={center.x}
                  cy={center.y}
                  r={radius}
                  fill="none"
                  stroke={palette.line}
                  {...stroke(1)}
                  opacity=".32"
                />
              )
            );
          })}
        </g>
      )}
      {layers.lines && roulette && (
        <g data-testid="rolling-geometry" aria-label="Rolling circle">
          {roulette.roll === "line" ? (
            <g data-testid="fixed-line">
              {line({ x: x0, y: 0 }, { x: x1, y: 0 }, palette.line, 0.6, false)}
            </g>
          ) : (
            <circle
              data-testid="fixed-circle"
              cx={xy({ x: 0, y: 0 }).x}
              cy={xy({ x: 0, y: 0 }).y}
              r={roulette.fixedRadius * scale}
              fill="none"
              stroke={palette.line}
              {...stroke(1.8)}
              opacity=".9"
            />
          )}
          {rolling && (
            <g data-testid="rolling-circle" data-sample={rolling.sampleIndex}>
              {rollingParts(rolling)}
            </g>
          )}
        </g>
      )}
      {layers.lines && pursuit && (
        <g data-testid="pursuit-polygons" aria-label="Connecting polygons">
          {pursuit.polygons.map((p) => (
            <path
              key={p.sampleIndex}
              data-testid="pursuit-polygon"
              data-sample={p.sampleIndex}
              d={
                // Always joined: a long edge is not a jump, as in a path.
                `M${p.points
                  .map((q) => `${xy(q).x.toFixed(3)},${xy(q).y.toFixed(3)}`)
                  .join("L")}Z`
              }
              fill="none"
              stroke={palette.line}
              {...stroke(1)}
              strokeLinejoin="round"
              opacity=".55"
            />
          ))}
        </g>
      )}
      {layers.lines && field && (
        <g data-testid="field-construction" aria-label="Direction field">
          {/* Trajectories end where they leave this circle; it does not
              frame the drawing, so a large one only shows as an arc. */}
          <circle
            data-testid="escape-circle"
            cx={xy({ x: 0, y: 0 }).x}
            cy={xy({ x: 0, y: 0 }).y}
            r={config.curve.field.escape * scale}
            fill="none"
            stroke={palette.line}
            {...stroke(1)}
            strokeDasharray="4 5"
            opacity=".5"
          />
          {/* Directions only: the speed varies too widely to draw to
              scale. Each arrow is centered on its lattice point. */}
          {field.grid.points.map(({ point, velocity }, k) => {
            const length = 0.6 * field.grid.spacing * scale;
            const { x, y } = xy(point);
            return (
              <path
                key={k}
                data-testid="field-direction"
                d={arrow(x, y, velocity, length, length / 2, length * 0.3)}
                fill="none"
                stroke={palette.line}
                {...stroke(1)}
                strokeLinecap="round"
                strokeLinejoin="round"
                opacity=".55"
              />
            );
          })}
        </g>
      )}
      {/* One pixel per cell, embedded as a PNG so exports carry it; cells
          stay square-edged at any size rather than blurring into each
          other. */}
      {layers.base &&
        attractor &&
        attractor.accumulated > attractor.outside && (
          <image
            data-testid="attractor-density"
            data-columns={attractor.columns}
            data-rows={attractor.rows}
            data-accumulated={attractor.accumulated}
            href={densityImage(attractor, palette.base)}
            x={xy({ x: attractor.window.xMin, y: attractor.window.yMax }).x}
            y={xy({ x: attractor.window.xMin, y: attractor.window.yMax }).y}
            width={(attractor.window.xMax - attractor.window.xMin) * scale}
            height={(attractor.window.yMax - attractor.window.yMin) * scale}
            preserveAspectRatio="none"
            imageRendering="pixelated"
          />
        )}
      {layers.lines && attractor && (
        <g
          data-testid="attractor-construction"
          aria-label="Window and first iterates"
        >
          <rect
            data-testid="attractor-window"
            x={xy({ x: attractor.window.xMin, y: attractor.window.yMax }).x}
            y={xy({ x: attractor.window.xMin, y: attractor.window.yMax }).y}
            width={(attractor.window.xMax - attractor.window.xMin) * scale}
            height={(attractor.window.yMax - attractor.window.yMin) * scale}
            fill="none"
            stroke={palette.line}
            {...stroke(1)}
            strokeDasharray="4 5"
            opacity=".5"
          />
          {/* The start and the first iterates as separate dots: a map jumps
              from one to the next, so they are never joined. */}
          {attractor.orbit.map((p, k) => {
            const { x, y } = xy(p);
            if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
            return (
              <circle
                key={k}
                data-testid="attractor-orbit"
                cx={x}
                cy={y}
                r={k === 0 ? 4 : 2.2}
                fill={k === 0 ? "none" : palette.line}
                stroke={palette.line}
                {...stroke(k === 0 ? 1.5 : 0)}
                opacity=".85"
              />
            );
          })}
          {attractor.orbit.length > 0 && (
            <circle
              data-testid="attractor-start"
              cx={xy(attractor.orbit[0]).x}
              cy={xy(attractor.orbit[0]).y}
              r="7"
              fill="none"
              stroke={palette.line}
              {...stroke(1)}
              opacity=".6"
            />
          )}
        </g>
      )}
      {layers.lines && contours && (
        <g data-testid="contour-construction" aria-label="Window and normals">
          {/* The contours are sought only inside the window. */}
          <rect
            data-testid="contour-window"
            x={xy({ x: contours.window.xMin, y: contours.window.yMax }).x}
            y={xy({ x: contours.window.xMin, y: contours.window.yMax }).y}
            width={(contours.window.xMax - contours.window.xMin) * scale}
            height={(contours.window.yMax - contours.window.yMin) * scale}
            fill="none"
            stroke={palette.line}
            {...stroke(1)}
            strokeDasharray="4 5"
            opacity=".5"
          />
          {/* Where F changes sign without reaching the level: a pole or a
              jump, not a curve. */}
          {contours.discontinuities.map((p, k) => {
            const { x, y } = xy(p);
            return (
              <path
                key={`break-${k}`}
                data-testid="contour-break"
                data-x={p.x}
                data-y={p.y}
                d={`M${x - 2.5},${y - 2.5}L${x + 2.5},${y + 2.5}M${x - 2.5},${y + 2.5}L${x + 2.5},${y - 2.5}`}
                stroke={palette.line}
                {...stroke(1)}
                opacity=".6"
              />
            );
          })}
          {/* F's gradient, from the curve toward larger values; a fixed
              length, since its size varies too widely to draw to scale. */}
          {contours.normals.map(({ point, gradient }, k) => {
            const length =
              0.05 *
              Math.max(
                contours.window.xMax - contours.window.xMin,
                contours.window.yMax - contours.window.yMin,
              ) *
              scale;
            const { x, y } = xy(point);
            return (
              <path
                key={k}
                data-testid="contour-normal"
                d={arrow(x, y, gradient, length, 0, 5)}
                fill="none"
                stroke={palette.line}
                {...stroke(1.2)}
                strokeLinecap="round"
                strokeLinejoin="round"
                opacity=".75"
              />
            );
          })}
        </g>
      )}
      {layers.lines && harmonic && (
        <g data-testid="harmonic-geometry" aria-label="Rotating vectors">
          {harmonic.guides.map((g, k) => (
            <circle
              key={k}
              data-testid="lissajous-guide"
              cx={xy(g.center).x}
              cy={xy(g.center).y}
              r={g.radius * scale}
              fill="none"
              stroke={palette.line}
              {...stroke(1.5)}
              opacity=".85"
            />
          ))}
          {epicycles && (
            <g data-testid="epicycles" data-sample={epicycles.sampleIndex}>
              {harmonic.radii.map(
                (r, k) =>
                  r > 0 && (
                    <circle
                      key={`c${k}`}
                      data-testid="epicycle"
                      cx={xy(epicycles.joints[k]).x}
                      cy={xy(epicycles.joints[k]).y}
                      r={r * scale}
                      fill="none"
                      stroke={palette.line}
                      {...stroke(1)}
                      opacity=".55"
                    />
                  ),
              )}
              {harmonic.radii.map((_, k) => (
                <g key={`v${k}`} data-testid="epicycle-arm">
                  {line(
                    epicycles.joints[k],
                    epicycles.joints[k + 1] ?? epicycles.point,
                    palette.line,
                    0.95,
                  )}
                </g>
              ))}
              {harmonic.guides.map((g, k) => (
                <g key={`g${k}`}>
                  {line(g.center, epicycles.joints[k], palette.line, 0.8)}
                  <g data-testid="lissajous-projection">
                    {line(
                      epicycles.joints[k],
                      epicycles.point,
                      palette.line,
                      0.6,
                      true,
                    )}
                  </g>
                </g>
              ))}
              {epicycles.joints.map((j, k) => (
                <circle
                  key={`j${k}`}
                  cx={xy(j).x}
                  cy={xy(j).y}
                  r="2.5"
                  fill={palette.line}
                />
              ))}
            </g>
          )}
        </g>
      )}
      {layers.lines && roller && (
        <g
          data-testid="rolling-construction"
          data-sample={roller.sampleIndex}
          aria-label="Circle rolling on the curve"
        >
          {rollingParts(roller)}
        </g>
      )}
      {layers.lines && moving && placed && (
        <g
          data-testid="rolling-curve"
          data-sample={placed.sampleIndex}
          aria-label="Curve rolling on the curve"
        >
          <path
            d={path(moving.path.map((p) => p && carry(placed, p)))}
            fill="none"
            stroke={palette.line}
            {...stroke(1.2)}
            strokeLinejoin="round"
            opacity=".75"
          />
          {line(placed.contact, placed.point, palette.line, 0.75)}
          <circle
            data-testid="contact-point"
            cx={xy(placed.contact).x}
            cy={xy(placed.contact).y}
            r="3.5"
            fill="none"
            stroke={palette.line}
            {...stroke(1.5)}
          />
        </g>
      )}
      {layers.base && result.second && (
        <path
          data-testid="second-curve"
          aria-label="Second endpoints"
          d={path(result.second)}
          fill="none"
          stroke={palette.base}
          {...stroke(1.4)}
          opacity=".55"
        />
      )}
      {layers.lines && inversion && (
        <circle
          data-testid="inversion-circle"
          aria-label="Circle of inversion"
          cx={xy(inversion.center).x}
          cy={xy(inversion.center).y}
          r={inversion.radius * scale}
          fill="none"
          stroke={palette.line}
          {...stroke(1.4)}
          strokeDasharray="7 5"
          opacity=".85"
        />
      )}
      {layers.base && result.input && (
        <path
          data-testid="construction-input"
          aria-label={`The curve's ${config.input}, which the construction acts on`}
          d={path(refined.input?.points ?? result.input)}
          fill="none"
          stroke={palette.derived}
          {...stroke(1.5)}
          strokeLinejoin="round"
          opacity=".5"
        />
      )}
      {layers.base &&
        pursuit?.paths.map((points, k) => (
          <path
            key={k}
            data-testid="pursuit-path"
            d={path(points)}
            fill="none"
            stroke={palette.base}
            {...stroke(2.3)}
            strokeLinejoin="round"
          />
        ))}
      {layers.base &&
        contours?.curve.contours.map((c, k) => (
          <path
            key={k}
            data-testid="contour-path"
            d={path(c.points) + (c.closed ? "Z" : "")}
            fill="none"
            stroke={palette.base}
            {...stroke(2.3)}
            strokeLinejoin="round"
          />
        ))}
      {layers.base &&
        field?.paths.map((points, k) => (
          <path
            key={k}
            data-testid="field-path"
            d={path(points)}
            fill="none"
            stroke={palette.base}
            {...stroke(2.3)}
            strokeLinejoin="round"
          />
        ))}
      {layers.base && (
        <path
          data-testid="base-curve"
          d={path(refined.base?.points ?? result.base)}
          fill="none"
          stroke={palette.base}
          {...stroke(2.3)}
        />
      )}
      {layers.lines &&
        chasers?.points.map((p, k) => (
          <circle
            key={k}
            data-testid="pursuer"
            cx={xy(p).x}
            cy={xy(p).y}
            r="3.5"
            fill={palette.base}
          />
        ))}
      {layers.lines &&
        field?.arrows.map((a) => {
          // The direction of travel at representative samples.
          const { x, y } = xy(a.point);
          return (
            <path
              key={`${a.seed}-${a.sampleIndex}`}
              data-testid="field-arrow"
              data-sample={a.sampleIndex}
              d={arrow(x, y, a.velocity, 0, 0, 5.5)}
              fill="none"
              stroke={palette.base}
              {...stroke(2)}
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          );
        })}
      {layers.lines &&
        seeds.map((p, k) => (
          <circle
            key={k}
            data-testid="seed"
            cx={xy(p).x}
            cy={xy(p).y}
            r="3.5"
            fill={palette.bg}
            stroke={palette.base}
            {...stroke(1.5)}
          />
        ))}
      {layers.lines && epicycles && (
        <circle
          data-testid="harmonic-point"
          cx={xy(epicycles.point).x}
          cy={xy(epicycles.point).y}
          r="4"
          fill={palette.base}
        />
      )}
      {layers.lines && rolling && (
        <circle
          data-testid="tracing-point"
          cx={xy(rolling.point).x}
          cy={xy(rolling.point).y}
          r="4"
          fill={palette.base}
        />
      )}
      {layers.derived && result.derived.length > 0 && (
        <path
          data-testid="derived-curve"
          d={
            refined.derived
              ? refinedPath(refined.derived, dashed ? false : undefined)
              : path(result.derived, dashed ? false : undefined, breaks)
          }
          fill="none"
          stroke={palette.derived}
          {...stroke(2.6)}
          strokeLinejoin="round"
        />
      )}
      {dashed && layers.derived && layers.virtual && (
        <path
          data-testid="virtual-derived-curve"
          d={
            refined.derived
              ? refinedPath(refined.derived, true)
              : path(result.derived, true)
          }
          fill="none"
          stroke={palette.derived}
          {...stroke(2.3)}
          strokeDasharray="6 4"
        />
      )}
      {layers.derived && contours && contours.family.length > 0 && (
        <g data-testid="contour-levels" aria-label="Family of levels">
          {contours.family.flatMap((set, k) =>
            set.contours.map((c, j) => (
              <path
                key={`${k}-${j}`}
                data-testid="contour-family"
                data-level={set.level}
                d={path(c.points) + (c.closed ? "Z" : "")}
                fill="none"
                stroke={palette.derived}
                {...stroke(1.5)}
                strokeLinejoin="round"
                opacity=".8"
              />
            )),
          )}
        </g>
      )}
      {layers.derived && result.family.length > 0 && (
        <g
          data-testid={rings ? "envelope-branches" : "offset-family"}
          aria-label={rings ? "Envelope branches" : "Offset stack"}
        >
          {result.family.map((member, k) => (
            <path
              key={k}
              data-distance={rings ? undefined : member.distance}
              data-branch={member.branch}
              d={path((refined.family?.[k] ?? member).points)}
              fill="none"
              stroke={palette.derived}
              {...stroke(1.8)}
              strokeLinejoin="round"
              opacity=".9"
            />
          ))}
        </g>
      )}
      {layers.lines && tracer && (
        <circle
          data-testid="rolling-construction-point"
          cx={xy(tracer.point).x}
          cy={xy(tracer.point).y}
          r="4"
          fill={palette.derived}
        />
      )}
      {layers.derived &&
        focuses.map((focus, i) => (
          <circle
            key={i}
            data-testid="focus-point"
            cx={focus.x}
            cy={focus.y}
            r="3.5"
            fill={palette.derived}
          />
        ))}
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
      {inversion && (
        <g data-testid="inversion-center" aria-label="Center of inversion">
          <circle
            cx={xy(inversion.center).x}
            cy={xy(inversion.center).y}
            r="4"
            fill={palette.line}
          />
        </g>
      )}
      {(usesPole(kind) || (result.input && usesPole(config.input))) && (
        <g data-testid="pole-point" aria-label="Pole">
          <circle
            cx={xy(config.pole).x}
            cy={xy(config.pole).y}
            r="5"
            fill={palette.derived}
          />
          <circle
            cx={xy(config.pole).x}
            cy={xy(config.pole).y}
            r="10"
            fill="none"
            stroke={palette.derived}
            opacity=".35"
          />
        </g>
      )}
      {probeDrawing}
    </svg>
  );
}

// SVG path data for points drawn by xy. The path breaks at gaps, at points
// keep rejects, before each sample in breaks, where the curve is known to be
// open between two finite samples, and at jumps too long to be one step of a
// curve.
export function pathData(
  points: (Vec | null)[],
  xy: (p: Vec) => Vec,
  keep: (i: number) => boolean = () => true,
  breaks?: Set<number>,
) {
  let s = "",
    last: Vec | null = null;
  points.forEach((p, i) => {
    if (breaks?.has(i)) last = null;
    if (!p || !keep(i)) {
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
// The part of the unbounded line through p along u inside the rectangle
// [x0, x1] × [y0, y1], or null where it misses.
function across(
  p: Vec,
  u: Vec,
  x0: number,
  x1: number,
  y0: number,
  y1: number,
): [Vec, Vec] | null {
  let lo = -Infinity,
    hi = Infinity;
  for (const [start, step, min, max] of [
    [p.x, u.x, x0, x1],
    [p.y, u.y, y0, y1],
  ]) {
    if (step === 0) {
      if (start < min || start > max) return null;
      continue;
    }
    const a = (min - start) / step,
      b = (max - start) / step;
    lo = Math.max(lo, Math.min(a, b));
    hi = Math.min(hi, Math.max(a, b));
  }
  if (!(lo < hi)) return null;
  return [
    { x: p.x + lo * u.x, y: p.y + lo * u.y },
    { x: p.x + hi * u.x, y: p.y + hi * u.y },
  ];
}
// A rolling curve frames every placement, like a rolling circle, by the
// circle enclosing it.
function movingExtents(result: Result) {
  const moving = result.moving;
  const body = moving && enclosing(moving.path);
  if (!moving || !body) return [];
  return circleExtents(
    moving.positions.map((p) => ({
      center: carry(p, body.center),
      radius: body.radius,
    })),
  );
}
// The four extreme points of each circle.
const circleExtents = (circles: { center: Vec; radius: number }[]) =>
  circles.flatMap(({ center: c, radius: r }) => [
    { x: c.x - r, y: c.y },
    { x: c.x + r, y: c.y },
    { x: c.x, y: c.y - r },
    { x: c.x, y: c.y + r },
  ]);
// A rolling curve's frame point, carried to the drawing by a placement.
function carry(placement: Placement, v: Vec): Vec {
  const cos = Math.cos(placement.angle),
    sin = Math.sin(placement.angle);
  return {
    x: placement.origin.x + cos * v.x - sin * v.y,
    y: placement.origin.y + sin * v.x + cos * v.y,
  };
}
// A circle enclosing a rolling curve in its own frame, so each placement is
// framed by four points rather than the whole curve.
function enclosing(points: (Vec | null)[]) {
  const finite = points.filter((p): p is Vec => !!p);
  if (!finite.length) return null;
  // Loops rather than spreads: a path can hold 32,768 points.
  let x0 = Infinity,
    x1 = -Infinity,
    y0 = Infinity,
    y1 = -Infinity;
  for (const p of finite) {
    x0 = Math.min(x0, p.x);
    x1 = Math.max(x1, p.x);
    y0 = Math.min(y0, p.y);
    y1 = Math.max(y1, p.y);
  }
  const center = { x: (x0 + x1) / 2, y: (y0 + y1) / 2 };
  let radius = 0;
  for (const p of finite)
    radius = Math.max(radius, Math.hypot(p.x - center.x, p.y - center.y));
  return { center, radius };
}
export function fitFrame(result: Result, config: Config) {
  // An implicit curve is framed by its window, which bounds every contour
  // and stays put while they split and join; so is an iterated map's
  // density.
  const window = result.contours?.window ?? result.attractor?.window;
  if (window)
    return {
      cx: (window.xMin + window.xMax) / 2,
      cy: (window.yMin + window.yMax) / 2,
      scale: Math.min(
        (W * 0.78) / (window.xMax - window.xMin),
        (H * 0.78) / (window.yMax - window.yMin),
      ),
      span: Math.max(window.xMax - window.xMin, window.yMax - window.yMin),
    };
  // Circles are framed by their full extent when requested, independent of
  // whether the construction layer is showing, so toggling it never reframes.
  const extents = circleExtents(result.circles);
  // A roulette and the rolling construction frame every rolling-circle
  // position, so the circle stays in view as it is revealed. A roulette also
  // frames its fixed circle as its own family, never an outlier of the
  // rolling ones. A fixed line is unbounded; the rolling circles frame the
  // stretch that is rolled over.
  const roulette = result.roulette;
  const fixed =
    roulette && roulette.roll !== "line"
      ? circleExtents([
          { center: { x: 0, y: 0 }, radius: roulette.fixedRadius },
        ])
      : [];
  const points = [
    ...framingPoints(result.base),
    ...framingPoints(result.second ?? []),
    ...framingPoints(result.derived),
    ...result.family.flatMap((path) => framingPoints(path.points)),
    ...framingPoints(extents),
    ...framingPoints(fixed),
    ...framingPoints(circleExtents(roulette?.positions ?? [])),
    // A Lissajous figure's guides and a Fourier curve's circles, at every
    // representative sample, as their own families.
    ...framingPoints(circleExtents(result.harmonic?.guides ?? [])),
    ...framingPoints(
      circleExtents(
        (result.harmonic?.positions ?? []).flatMap((s) =>
          result.harmonic!.radii.map((radius, k) => ({
            center: s.joints[k],
            radius,
          })),
        ),
      ),
    ),
    // Each pursuer's path is its own family.
    ...(result.pursuit?.paths ?? []).flatMap((points) => framingPoints(points)),
    // So is each trajectory; the escape circle is not framed.
    ...(result.field?.paths ?? []).flatMap((points) => framingPoints(points)),
    ...framingPoints(circleExtents(result.rolling)),
    ...framingPoints(movingExtents(result)),
    // A derived input, and the circle of inversion, are their own families:
    // an input can be far smaller or larger than the curve, and so can an
    // image.
    ...framingPoints(result.input ?? []),
    ...framingPoints(circleExtents(result.inversion ? [result.inversion] : [])),
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
    (usesPole(config.kind) || (result.input && usesPole(config.input))) &&
    Math.hypot(
      config.pole.x - (minX + maxX) / 2,
      config.pole.y - (minY + maxY) / 2,
    ) <
      extent * 4
  )
    include(config.pole);
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
