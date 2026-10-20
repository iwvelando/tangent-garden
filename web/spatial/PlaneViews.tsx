// The face-on views of a curve study's shadow in the grid beside its
// drawing (grid.ts). Each draws the plane on the same 1000 × 760 page as
// the other drawings, with geometry only: the 2D construction as the 2D
// notebook draws it (its own Plot, with its own inks and representative
// lines), and the shadows in the 3D drawing's inks, so the views match its
// legend: the curve's shadow gray, the 2D construction broad in rust, and
// the 3D construction's shadow thin in slate over it. Their widths are
// near the 2D drawing's own curves'.
import { useEffect, useRef, useState, type ReactNode } from "react";
import type { ColorScheme } from "../color-schemes";
import { createGesture } from "../gestures";
import { svgStroke, type LineWeight } from "../line-weight";
import { useDrawingTouch } from "../MobileNotebookNav";
import { Plot } from "../Plot";
import { defaultLayers as planarLayers, defaultLength } from "../planar-link";
import { presets as planarPresets } from "../presets";
import type { Config as PlanarConfig, Vec } from "../types";
import {
  fittedCamera,
  flat,
  framing as frameOf,
  grow,
  onPage,
  page,
  planeRect,
  planeZoom,
  type Framing,
  type PlaneCamera,
  type PlaneRect,
  type PlaneView,
} from "./grid";
import { hex, lineColor, spatialPalette } from "./palette";
import type { Layers } from "./scene";
import type {
  PlaneStudy,
  RefinedPath,
  ShadowPath,
  SpatialResult,
  Vec3,
} from "./types";

// The 2D notebook's configuration for the plane's study: its construction,
// input, pole and circle of inversion, over its first example's settings,
// which the drawing reads no more of.
function planarConfig(s: PlaneStudy): PlanarConfig {
  const base = planarPresets[0].config;
  return {
    ...base,
    kind: s.kind,
    input: s.input as PlanarConfig["input"],
    pole: s.pole,
    inversion: { ...base.inversion, ...s.inversion },
  };
}

// The 2D notebook's layers for the plane: its curve, construction and
// representative lines, without axes, as the other views have none.
const planeLayers = { ...planarLayers, axes: false };

// A path's page coordinates, joined except across a break (before sample
// i when breaks[i]) or a gap.
function pathData(
  points: (Vec3 | null)[],
  breaks: boolean[] | undefined,
  at: (p: Vec3) => Vec,
) {
  let d = "",
    open = false;
  points.forEach((p, i) => {
    if (!p || breaks?.[i]) open = false;
    if (!p) return;
    const q = at(p);
    if (!Number.isFinite(q.x) || !Number.isFinite(q.y)) {
      open = false;
      return;
    }
    d += `${open ? "L" : "M"}${q.x.toFixed(2)},${q.y.toFixed(2)}`;
    open = true;
  });
  return d;
}

export type PlaneDrawingProps = {
  view: PlaneView;
  result: SpatialResult;
  framing: Framing;
  layers: Layers;
  dark: boolean;
  scheme?: ColorScheme;
  weight?: LineWeight;
  // Where the 3D probe stands, when it is on: marked on the plane below it.
  probe?: Vec3 | null;
  // The animation's progress at the frame drawn, as the stage records it.
  progress?: number;
};

// One face-on view of the plane, as an SVG drawing of the page.
export function PlaneDrawing({
  view,
  result,
  framing,
  layers,
  dark,
  scheme = "default",
  weight = "regular",
  probe,
  progress,
}: PlaneDrawingProps) {
  const s = result.shadow!;
  const ink = (k: number) => hex(lineColor(k, 0, dark, scheme));
  const stroke = svgStroke(weight);
  const at = (p: Vec3) => onPage(framing, flat(s.plane, p));
  const drawn = (
    paths: ShadowPath[],
    refined: (RefinedPath | undefined)[] | undefined,
    color: string,
    width: number,
    testid: string,
  ) =>
    paths.map((path, k) => {
      const r = refined?.[k];
      return (
        <path
          key={k}
          data-testid={testid}
          d={
            r
              ? pathData(r.points, undefined, at)
              : pathData(path.points, path.breaks, at)
          }
          fill="none"
          stroke={color}
          {...stroke(width)}
          strokeLinejoin="round"
          strokeLinecap="round"
        />
      );
    });
  // The 2D drawing has the shadow as its own curve; without the 2D study
  // (which a note explains) the shadow stands in for it.
  const shadow =
    layers.shadow &&
    (view !== "planar" || !s.study) &&
    drawn([s.curve], [s.adaptive?.curve], ink(4), 1.8, "plane-shadow");
  const planar =
    layers.planar &&
    view === "overlay" &&
    drawn(s.planar, s.adaptive?.planar, ink(5), 3.2, "plane-planar");
  const cast =
    layers.cast &&
    (view === "cast" || view === "overlay") &&
    drawn(s.cast, s.adaptive?.cast, ink(6), 1.5, "plane-cast");
  const study = s.study;
  let planarDrawing: ReactNode = null;
  if (view === "planar" && study) {
    // The 2D study is in units of study.unit.
    const u = study.unit;
    planarDrawing = (
      <Plot
        id={`plane-${view}-plot`}
        result={study.result}
        config={planarConfig(study)}
        layers={planeLayers}
        dark={dark}
        scheme={scheme}
        length={defaultLength}
        reset={0}
        weight={weight}
        framing={{
          cx: framing.cx / u,
          cy: framing.cy / u,
          scale: framing.scale * u,
          span: framing.span / u,
        }}
      />
    );
  }
  const mark = probe ? at(probe) : null;
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox={`0 0 ${page.width} ${page.height}`}
      width={page.width}
      height={page.height}
      overflow="hidden"
      data-plane-view={view}
      data-animation-progress={progress}
      data-camera-scale={framing.scale}
      data-camera-center={`${framing.cx},${framing.cy}`}
    >
      <rect
        width={page.width}
        height={page.height}
        fill={hex(spatialPalette(scheme).background[dark ? 1 : 0])}
      />
      {planarDrawing}
      {shadow}
      {planar}
      {cast}
      {mark && Number.isFinite(mark.x) && Number.isFinite(mark.y) && (
        <circle
          data-testid="plane-probe"
          cx={mark.x}
          cy={mark.y}
          r="5"
          fill="none"
          stroke={ink(8)}
          {...stroke(1.6)}
        />
      )}
    </svg>
  );
}

// The face-on views' shared camera and the rectangle it frames: the shown
// shadow's window, or during playback every window shown since it began
// (grid.ts grow). The manual camera is kept while an animation plays, which
// frames the views itself, and a finished one is explored with a camera of
// its own, as the 2D drawing does. A reset fits the window again.
export function usePlaneFraming(
  shadow: SpatialResult["shadow"],
  playing: boolean,
  complete: boolean,
  reset: number,
) {
  const [manual, setManual] = useState(fittedCamera),
    [explore, setExplore] = useState(fittedCamera);
  const grown = useRef<PlaneRect | null>(null);
  useEffect(() => setManual(fittedCamera), [reset]);
  useEffect(() => {
    if (!complete) setExplore(fittedCamera);
  }, [complete]);
  const own = shadow ? planeRect(shadow) : null;
  if (!playing) grown.current = null;
  else if (own) grown.current = grow(grown.current, own);
  const rect = playing ? grown.current : own;
  const locked = playing && !complete;
  const camera = locked ? fittedCamera : playing ? explore : manual;
  return {
    framing: rect ? frameOf(rect, camera) : null,
    locked,
    setCamera: playing ? setExplore : setManual,
  };
}

// The keys of the face-on views, as the 2D drawing's: arrows pan, + and −
// zoom about the middle, Home fits. Each is [pan x, pan y, zoom factor].
const keys: Record<string, [number, number, number]> = {
  ArrowLeft: [-20, 0, 1],
  ArrowRight: [20, 0, 1],
  ArrowUp: [0, -20, 1],
  ArrowDown: [0, 20, 1],
  "+": [0, 0, 1.1],
  "=": [0, 0, 1.1],
  "-": [0, 0, 1 / 1.1],
};
const zoomed = (c: PlaneCamera, k: number, u = 0, v = 0) => {
  const zoom = Math.max(planeZoom.min, Math.min(planeZoom.max, c.zoom * k)),
    r = zoom / c.zoom;
  return { zoom, x: u - (u - c.x) * r, y: v - (v - c.y) * r };
};

// One face-on view in the grid, which pans and zooms them all: drag or
// arrows pan, scroll, pinch or + and − zoom, Home fits.
export function PlaneCell(
  p: PlaneDrawingProps & {
    locked: boolean;
    caption: string;
    onCamera: (f: (c: PlaneCamera) => PlaneCamera) => void;
  },
) {
  const ref = useRef<HTMLDivElement>(null),
    state = useRef(p);
  state.current = p;
  const gesture = useRef(createGesture());
  const touchEnabled = useDrawingTouch();
  useEffect(() => {
    gesture.current = createGesture();
  }, [touchEnabled]);
  // Page units per screen pixel, and a point's page offset from the
  // middle of the drawing.
  const ratio = (r: DOMRect) =>
    Math.max(page.width / r.width, page.height / r.height);
  const fromMiddle = (r: DOMRect, x: number, y: number) => ({
    u: (x - (r.left + r.width / 2)) * ratio(r),
    v: (y - (r.top + r.height / 2)) * ratio(r),
  });
  useEffect(() => {
    const el = ref.current!;
    const wheel = (e: WheelEvent) => {
      if (state.current.locked) return;
      e.preventDefault();
      const r = el.getBoundingClientRect(),
        { u, v } = fromMiddle(r, e.clientX, e.clientY);
      state.current.onCamera((c) =>
        zoomed(c, Math.exp(-e.deltaY * 0.001), u, v),
      );
    };
    el.addEventListener("wheel", wheel, { passive: false });
    return () => el.removeEventListener("wheel", wheel);
  }, []);
  return (
    <div
      ref={ref}
      className="plane-view"
      role="img"
      tabIndex={0}
      aria-label={`${p.caption}. Drag or arrow keys to pan; scroll, pinch, or plus and minus to zoom; Home fits. The face-on views move together.`}
      data-locked={p.locked || undefined}
      style={{ touchAction: touchEnabled ? "none" : "pan-y pinch-zoom" }}
      onKeyDown={(e) => {
        if (p.locked) return;
        if (e.key === "Home") {
          e.preventDefault();
          p.onCamera(() => fittedCamera);
          return;
        }
        if (!Object.hasOwn(keys, e.key)) return;
        e.preventDefault();
        const [dx, dy, k] = keys[e.key];
        p.onCamera((c) => {
          const z = zoomed(c, k);
          return { ...z, x: z.x + dx, y: z.y + dy };
        });
      }}
      onPointerDown={(e) => {
        if (p.locked || (e.pointerType === "touch" && !touchEnabled)) return;
        e.currentTarget.setPointerCapture(e.pointerId);
        gesture.current.down(e);
      }}
      onPointerMove={(e) => {
        if (e.pointerType === "touch" && !touchEnabled) return;
        const motion = gesture.current.move(e);
        if (!motion || p.locked) return;
        const r = e.currentTarget.getBoundingClientRect(),
          k = ratio(r);
        if (motion.kind === "drag") {
          p.onCamera((c) => ({
            ...c,
            x: c.x + motion.dx * k,
            y: c.y + motion.dy * k,
          }));
          return;
        }
        // A pinch zooms about the point between the fingers, and their
        // shared movement pans.
        const { u, v } = fromMiddle(r, motion.mid.x, motion.mid.y);
        p.onCamera((c) =>
          zoomed(
            { ...c, x: c.x + motion.dx * k, y: c.y + motion.dy * k },
            motion.scale,
            u,
            v,
          ),
        );
      }}
      onPointerUp={(e) => gesture.current.up(e)}
      onPointerCancel={(e) => gesture.current.up(e)}
      onLostPointerCapture={(e) => gesture.current.up(e)}
    >
      <PlaneDrawing {...p} />
    </div>
  );
}
