import { useEffect, useRef } from "react";
import { createGesture } from "../gestures";
import { Drawing } from "./Drawing";
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
}: {
  result: Result;
  config: Config;
  dark: boolean;
  layers: Layers;
  view: View;
  onView: (v: View) => void;
}) {
  const ref = useRef<SVGSVGElement>(null),
    state = useRef({ view, onView });
  state.current = { view, onView };
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
      id="tesseract-artwork"
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 1000 760"
      role="img"
      aria-label="Interactive tesseract construction. Drag to orbit; shift-drag or two fingers to pan; scroll or pinch to zoom. Arrow keys orbit, shift-arrows pan, plus and minus zoom, Home resets."
      tabIndex={0}
      onPointerDown={(e) => {
        e.currentTarget.setPointerCapture(e.pointerId);
        if (!gesture.current.count) panning.current = e.shiftKey;
        gesture.current.down(e);
      }}
      onPointerMove={(e) => {
        const motion = gesture.current.move(e);
        if (!motion) return;
        const scale = Math.min(
          e.currentTarget.clientWidth / 1000,
          e.currentTarget.clientHeight / 760,
        );
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
            if (e.shiftKey) v.panX -= 20;
            else v.yaw -= 0.1;
            break;
          case "ArrowRight":
            if (e.shiftKey) v.panX += 20;
            else v.yaw += 0.1;
            break;
          case "ArrowUp":
            if (e.shiftKey) v.panY -= 20;
            else v.pitch = Math.max(-1.5, v.pitch - 0.1);
            break;
          case "ArrowDown":
            if (e.shiftKey) v.panY += 20;
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
