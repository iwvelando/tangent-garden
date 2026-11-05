import type { ColorScheme } from "../color-schemes";
import { useEffect, useRef } from "react";
import { createGesture, zoomAbout } from "../gestures";
import { useDrawingTouch } from "../MobileNotebookNav";
import {
  Composition,
  type CompositionProps,
  type PanelViewport,
} from "./Composition";
import { exportBaseSize } from "../export-quality";
import { plotPalette } from "../palette";
import { Drawing, markerShown, projector, sampleOf } from "./Drawing";
import { objects } from "./objects";
import {
  initialView,
  type View,
  type Config,
  type Result,
  type Layers,
} from "./types";
// The manual camera's zoom range, and its zoom by k about a page point
// (u, v) measured from the middle of the 1000 × 760 drawing, which keeps
// showing what it showed: the pan is in page units from the middle, after
// the projection's scale.
const zoomRange: [number, number] = [0.2, 8];
function zoomed(view: View, k: number, u = 0, v = 0): View {
  const c = zoomAbout(
    { x: view.panX, y: view.panY, zoom: view.zoom },
    k,
    zoomRange,
    u,
    v,
  );
  return { ...view, zoom: c.zoom, panX: c.x, panY: c.y };
}
// A client point's page offset from the middle of the drawing, as its
// default meet fitting draws it, or null while it has no size. Nested SVG
// panels can have zero clientWidth/clientHeight, so their screen rectangle
// gives the scale.
function fromMiddle(el: Element, clientX: number, clientY: number) {
  const box = el.getBoundingClientRect();
  const scale = Math.min(box.width / 1000, box.height / 760);
  if (!(scale > 0)) return null;
  return {
    scale,
    u: (clientX - (box.left + box.width / 2)) / scale,
    v: (clientY - (box.top + box.height / 2)) / scale,
  };
}

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
    // The wheel zooms about the point under the pointer.
    const wheel = (e: WheelEvent) => {
      e.preventDefault();
      const at = fromMiddle(el, e.clientX, e.clientY);
      if (!at) return;
      const next = zoomed(
        state.current.view,
        Math.exp(-e.deltaY * 0.001),
        at.u,
        at.v,
      );
      state.current.view = next;
      state.current.onView(next);
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
      project = projector(result, config, view),
      selection = objects[config.object].selection,
      itemOf = selection?.itemOf ?? sampleOf;
    let best: { d: number; sample: number } | undefined;
    const near: { d: number; sample: number }[] = [];
    const consider = (d: number, sample: number | undefined) => {
      if (sample === undefined || d > reach) return;
      near.push({ d, sample });
      if (!best || d < best.d) best = { d, sample };
    };
    // Only drawn markers can be tapped.
    for (const m of result.markers ?? [])
      if (markerShown(m, layers)) {
        const [px, py] = project(m.point);
        consider(Math.hypot(px - x, py - y), itemOf(m.id, result));
      }
    if (layers.edges) {
      for (const p of result.paths) {
        const sample = itemOf(p.source, result);
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
    if (best && selection?.cycleCoincident) {
      // Items drawn within half a pixel of the nearest coincide: choose
      // the first after the current selection, in ID order.
      const current = selection.get(config),
        n = selection.count(config),
        tied = near
          .filter((c) => c.d <= best!.d + 0.5 / scale)
          .map((c) => c.sample);
      if (tied.length > 1)
        return tied.sort(
          (a, b) => ((a - current - 1 + n) % n) - ((b - current - 1 + n) % n),
        )[0];
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
          ? (objects[config.object].selection?.instructions?.(config) ??
            " Tap a point or fiber to select it; [ and ] step the selection.")
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
        const at = fromMiddle(
          e.currentTarget,
          motion.kind === "pinch" ? motion.mid.x : 0,
          motion.kind === "pinch" ? motion.mid.y : 0,
        );
        if (!at) return;
        const { scale } = at;
        // Moves can outpace renders, so each builds on the latest view.
        const view = state.current.view;
        const moved = {
          ...view,
          panX: view.panX + motion.dx / scale,
          panY: view.panY + motion.dy / scale,
        };
        // Two fingers pan together and pinch about the point between them.
        const next =
          motion.kind === "pinch"
            ? zoomed(moved, motion.scale, at.u, at.v)
            : panning.current
              ? moved
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
      // + and − zoom about the middle of the drawing. Keys repeat faster
      // than renders, so each applies to the latest view.
      onKeyDown={(e) => {
        let v = { ...state.current.view };
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
            v = zoomed(v, 1.1);
            break;
          case "-":
            v = zoomed(v, 1 / 1.1);
            break;
          case "Home":
            Object.assign(v, initialView);
            break;
          case "[":
          case "]": {
            if (!onStep) return;
            e.preventDefault();
            onStep(e.key === "]" ? 1 : -1);
            return;
          }
          default:
            return;
        }
        e.preventDefault();
        state.current.view = v;
        onView(v);
      }}
    >
      <Drawing {...{ result, config, view, layers, dark, scheme }} />
    </svg>
  );
}

export function StudyPlot(
  p: CompositionProps & {
    id?: string;
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
      id={p.id ?? "tesseract-artwork"}
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
            id={`${p.id ?? "tesseract"}-${panel.config.mode}`}
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
