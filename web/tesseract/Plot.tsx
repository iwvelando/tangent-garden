import type { ColorScheme } from "../color-schemes";
import { useEffect, useRef } from "react";
import { createGesture } from "../gestures";
import { useDrawingTouch } from "../MobileNotebookNav";
import {
  Composition,
  type CompositionProps,
  type PanelViewport,
} from "./Composition";
import { exportBaseSize } from "../export-quality";
import { plotPalette } from "../palette";
import { Drawing, projector, sampleOf } from "./Drawing";
import { objects } from "./objects";
import {
  initialView,
  type View,
  type Config,
  type Result,
  type Layers,
} from "./types";
export function Plot({
  result,
  config,
  dark,
  scheme,
  layers,
  view,
  onView,
  id = "tesseract-artwork",
  viewport,
  onSelect,
  onStep,
  primary,
}: {
  result: Result;
  config: Config;
  dark: boolean;
  scheme?: ColorScheme;
  layers: Layers;
  view: View;
  onView: (v: View) => void;
  id?: string;
  viewport?: PanelViewport;
  // Choosing a sample by tapping it or with [ and ]; only a study with a
  // selection offers it.
  onSelect?: (sample: number) => void;
  // Steps the selection, from the latest study rather than this drawing's.
  onStep?: (step: 1 | -1) => void;
  // The paired result's own panel, which a gallery thumbnail shows.
  primary?: boolean;
}) {
  const ref = useRef<SVGSVGElement>(null),
    state = useRef({ view, onView });
  state.current = { view, onView };
  // A press that has not moved more than a few pixels, and only one
  // pointer, is a tap.
  const tap = useRef<{ x: number; y: number; id: number } | null>(null);
  const flat = objects[config.object].flat?.(config);
  useEffect(() => {
    const el = ref.current!;
    const wheel = (e: WheelEvent) => {
      e.preventDefault();
      const { view, onView } = state.current;
      onView({
        ...view,
        zoom: Math.max(
          0.2,
          Math.min(8, view.zoom * Math.exp(-e.deltaY * 0.001)),
        ),
      });
    };
    el.addEventListener("wheel", wheel, { passive: false });
    return () => el.removeEventListener("wheel", wheel);
  }, []);
  const gesture = useRef(createGesture()),
    // Shift held as a mouse drag begins makes it a pan.
    panning = useRef(false);
  const touchEnabled = useDrawingTouch();
  useEffect(() => {
    gesture.current = createGesture();
  }, [touchEnabled]);
  // The sample whose drawn fiber or base point lies nearest the tap, within
  // a finger's reach (24 screen pixels): distances, not the topmost
  // element, decide between thin or overlapping lines.
  const nearestSample = (el: SVGSVGElement, cx: number, cy: number) => {
    const box = el.getBoundingClientRect();
    const scale = Math.min(box.width / 1000, box.height / 760);
    if (!(scale > 0)) return undefined;
    const x = 500 + (cx - (box.left + box.width / 2)) / scale,
      y = 380 + (cy - (box.top + box.height / 2)) / scale,
      reach = 24 / scale,
      project = projector(result, config, view);
    let best: { d: number; sample: number } | undefined;
    const consider = (d: number, sample: number | undefined) => {
      if (sample !== undefined && d <= reach && (!best || d < best.d))
        best = { d, sample };
    };
    if (layers.edges) {
      for (const m of result.markers ?? []) {
        const [px, py] = project(m.point);
        consider(Math.hypot(px - x, py - y), sampleOf(m.id, result));
      }
      for (const p of result.paths) {
        const sample = sampleOf(p.source, result);
        if (sample === undefined) continue;
        const q = p.points.map(project);
        for (let i = 0; i < q.length; i++) {
          const [ax, ay] = q[i],
            [bx, by] = q[Math.min(i + 1, q.length - 1)];
          const dx = bx - ax,
            dy = by - ay,
            l = dx * dx + dy * dy;
          const s =
            l > 0
              ? Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / l))
              : 0;
          consider(Math.hypot(ax + s * dx - x, ay + s * dy - y), sample);
        }
      }
    }
    return best?.sample;
  };
  return (
    <svg
      ref={ref}
      id={id}
      {...viewport}
      className={viewport ? "tesseract-panel" : undefined}
      data-representation={config.mode}
      data-primary-panel={primary || undefined}
      overflow="hidden"
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 1000 760"
      role="img"
      aria-label={
        (objects[config.object].viewingLabel?.(config) ??
          "Interactive tesseract construction. Drag to orbit; shift-drag or two fingers to pan; scroll or pinch to zoom. Arrow keys orbit, shift-arrows pan, plus and minus zoom, Home resets.") +
        (onSelect
          ? " Tap a point or fiber to select it; [ and ] step the selection."
          : "")
      }
      tabIndex={0}
      // The page's background fills whatever viewer shows an SVG export,
      // beyond its viewBox, as the other notebooks' drawings do; a paired
      // panel takes it from the pair.
      style={{
        ...(viewport ? {} : { background: plotPalette(dark, scheme).bg }),
        touchAction: touchEnabled ? "none" : "pan-y pinch-zoom",
      }}
      onPointerDown={(e) => {
        // A tap selects even while touch scrolls the page instead of
        // turning the drawing: scrolling cancels the pointer.
        tap.current =
          gesture.current.count || !e.isPrimary
            ? null
            : { x: e.clientX, y: e.clientY, id: e.pointerId };
        if (e.pointerType === "touch" && !touchEnabled) return;
        e.currentTarget.setPointerCapture(e.pointerId);
        if (!gesture.current.count) panning.current = e.shiftKey || !!flat;
        gesture.current.down(e);
      }}
      onPointerMove={(e) => {
        if (
          tap.current &&
          Math.hypot(e.clientX - tap.current.x, e.clientY - tap.current.y) > 6
        )
          tap.current = null;
        if (e.pointerType === "touch" && !touchEnabled) return;
        const motion = gesture.current.move(e);
        if (!motion) return;
        // Nested SVG panels can have zero clientWidth/clientHeight. Their
        // screen rectangle gives the actual scale for pan and pinch gestures.
        const box = e.currentTarget.getBoundingClientRect();
        const scale = Math.min(box.width / 1000, box.height / 760);
        if (!(scale > 0)) return;
        // Moves can outpace renders, so each builds on the latest view.
        const view = state.current.view;
        const zoom =
          motion.kind === "pinch"
            ? Math.max(0.2, Math.min(8, view.zoom * motion.scale))
            : view.zoom;
        const next =
          motion.kind === "pinch" || panning.current
            ? {
                ...view,
                zoom,
                panX: view.panX + motion.dx / scale,
                panY: view.panY + motion.dy / scale,
              }
            : {
                ...view,
                yaw: view.yaw + motion.dx * 0.008,
                pitch: Math.max(
                  -1.5,
                  Math.min(1.5, view.pitch + motion.dy * 0.008),
                ),
              };
        state.current.view = next;
        onView(next);
      }}
      onPointerUp={(e) => {
        gesture.current.up(e);
        const t = tap.current;
        tap.current = null;
        if (!t || t.id !== e.pointerId || !onSelect) return;
        const sample = nearestSample(e.currentTarget, e.clientX, e.clientY);
        if (sample !== undefined) onSelect(sample);
      }}
      onPointerCancel={(e) => {
        tap.current = null;
        gesture.current.up(e);
      }}
      onLostPointerCapture={(e) => gesture.current.up(e)}
      onKeyDown={(e) => {
        const v = { ...view };
        switch (e.key) {
          case "ArrowLeft":
            if (e.shiftKey || flat) v.panX -= 20;
            else v.yaw -= 0.1;
            break;
          case "ArrowRight":
            if (e.shiftKey || flat) v.panX += 20;
            else v.yaw += 0.1;
            break;
          case "ArrowUp":
            if (e.shiftKey || flat) v.panY -= 20;
            else v.pitch = Math.max(-1.5, v.pitch - 0.1);
            break;
          case "ArrowDown":
            if (e.shiftKey || flat) v.panY += 20;
            else v.pitch = Math.min(1.5, v.pitch + 0.1);
            break;
          case "+":
          case "=":
            v.zoom = Math.min(8, v.zoom * 1.1);
            break;
          case "-":
            v.zoom = Math.max(0.2, v.zoom / 1.1);
            break;
          case "Home":
            Object.assign(v, initialView);
            break;
          case "[":
          case "]": {
            if (!onStep || !result.weave?.correspondence) return;
            e.preventDefault();
            onStep(e.key === "]" ? 1 : -1);
            return;
          }
          default:
            return;
        }
        e.preventDefault();
        onView(v);
      }}
    >
      <Drawing {...{ result, config, view, layers, dark, scheme }} />
    </svg>
  );
}

export function StudyPlot(
  p: CompositionProps & {
    onView: (v: View) => void;
    onDiagramView: (v: View) => void;
    onSelect?: (sample: number) => void;
    onStep?: (step: 1 | -1) => void;
  },
) {
  const touchEnabled = useDrawingTouch();
  if (!p.result.companion) return <Plot {...p} />;
  const size = exportBaseSize(p.layout ?? "columns");
  return (
    <svg
      id="tesseract-artwork"
      style={{
        background: plotPalette(p.dark, p.scheme).bg,
        touchAction: touchEnabled ? "none" : "pan-y pinch-zoom",
      }}
      xmlns="http://www.w3.org/2000/svg"
      viewBox={`0 0 ${size.width} ${size.height}`}
      data-layout={p.layout ?? "columns"}
      role="group"
      aria-label={
        objects[p.config.object].pairedLabel ??
        "Synchronized XYZ shadow and coordinate diagram"
      }
    >
      <Composition
        {...p}
        renderPanel={(panel, viewport, index) => (
          <Plot
            {...panel}
            viewport={viewport}
            id={`tesseract-${panel.config.mode}`}
            onView={index === 0 ? p.onView : p.onDiagramView}
            onSelect={p.onSelect}
            onStep={p.onStep}
            primary={index === 0}
          />
        )}
      />
    </svg>
  );
}
