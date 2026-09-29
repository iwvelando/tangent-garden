import { useEffect, useRef } from "react";
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
  const drag = useRef<{
    id: number;
    x: number;
    y: number;
    pan: boolean;
  } | null>(null);
  return (
    <svg
      ref={ref}
      id="tesseract-artwork"
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 1000 760"
      role="img"
      aria-label="Interactive tesseract construction. Drag to orbit; shift-drag to pan; scroll to zoom. Arrow keys orbit, shift-arrows pan, plus and minus zoom, Home resets."
      tabIndex={0}
      onPointerDown={(e) => {
        e.currentTarget.setPointerCapture(e.pointerId);
        drag.current = {
          id: e.pointerId,
          x: e.clientX,
          y: e.clientY,
          pan: e.shiftKey,
        };
      }}
      onPointerMove={(e) => {
        const d = drag.current;
        if (!d || d.id !== e.pointerId) return;
        const dx = e.clientX - d.x,
          dy = e.clientY - d.y;
        const scale = Math.min(
          e.currentTarget.clientWidth / 1000,
          e.currentTarget.clientHeight / 760,
        );
        onView(
          d.pan
            ? {
                ...view,
                panX: view.panX + dx / scale,
                panY: view.panY + dy / scale,
              }
            : {
                ...view,
                yaw: view.yaw + dx * 0.008,
                pitch: Math.max(-1.5, Math.min(1.5, view.pitch + dy * 0.008)),
              },
        );
        drag.current = { ...d, x: e.clientX, y: e.clientY };
      }}
      onPointerUp={() => (drag.current = null)}
      onPointerCancel={() => (drag.current = null)}
      onLostPointerCapture={() => (drag.current = null)}
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
