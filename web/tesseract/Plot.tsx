import { useEffect, useRef } from "react";
import { createGesture } from "../gestures";
import {
  Composition,
  type CompositionProps,
  type PanelViewport,
} from "./Composition";
import { exportBaseSize } from "../export-quality";
import { Drawing } from "./Drawing";
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
  layers,
  view,
  onView,
  id = "tesseract-artwork",
  viewport,
}: {
  result: Result;
  config: Config;
  dark: boolean;
  layers: Layers;
  view: View;
  onView: (v: View) => void;
  id?: string;
  viewport?: PanelViewport;
}) {
  const ref = useRef<SVGSVGElement>(null),
    state = useRef({ view, onView });
  state.current = { view, onView };
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
  return (
    <svg
      ref={ref}
      id={id}
      {...viewport}
      className={viewport ? "tesseract-panel" : undefined}
      data-representation={config.mode}
      overflow="hidden"
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 1000 760"
      role="img"
      aria-label={
        objects[config.object].viewingLabel?.(config) ??
        "Interactive tesseract construction. Drag to orbit; shift-drag or two fingers to pan; scroll or pinch to zoom. Arrow keys orbit, shift-arrows pan, plus and minus zoom, Home resets."
      }
      tabIndex={0}
      onPointerDown={(e) => {
        e.currentTarget.setPointerCapture(e.pointerId);
        if (!gesture.current.count) panning.current = e.shiftKey || !!flat;
        gesture.current.down(e);
      }}
      onPointerMove={(e) => {
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
      onPointerUp={(e) => gesture.current.up(e)}
      onPointerCancel={(e) => gesture.current.up(e)}
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
          default:
            return;
        }
        e.preventDefault();
        onView(v);
      }}
    >
      <Drawing {...{ result, config, view, layers, dark }} />
    </svg>
  );
}

export function StudyPlot(
  p: CompositionProps & {
    onView: (v: View) => void;
    onDiagramView: (v: View) => void;
  },
) {
  if (!p.result.companion) return <Plot {...p} />;
  const size = exportBaseSize(p.layout ?? "columns");
  return (
    <svg
      id="tesseract-artwork"
      xmlns="http://www.w3.org/2000/svg"
      viewBox={`0 0 ${size.width} ${size.height}`}
      data-layout={p.layout ?? "columns"}
      role="group"
      aria-label="Synchronized XYZ shadow and coordinate diagram"
    >
      <Composition
        {...p}
        renderPanel={(panel, viewport, index) => (
          <Plot
            {...panel}
            viewport={viewport}
            id={`tesseract-${panel.config.mode}`}
            onView={index === 0 ? p.onView : p.onDiagramView}
          />
        )}
      />
    </svg>
  );
}
