import { useEffect, useRef, useState } from "react";
import type { SpatialResult } from "./types";
import { createRenderer, type Layers, type View } from "./renderer";
const initial: View = { yaw: 0.3, pitch: 0.75, zoom: 1 };
export function SpatialPlot({
  result,
  dark,
  layers,
  reset,
  spinning,
}: {
  result: SpatialResult;
  dark: boolean;
  layers: Layers;
  reset: number;
  spinning: boolean;
}) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const renderer = useRef<ReturnType<typeof createRenderer> | null>(null);
  const view = useRef({ ...initial });
  const state = useRef({ dark, layers });
  state.current = { dark, layers };
  const [error, setError] = useState("");
  const draw = () =>
    renderer.current?.draw(
      view.current,
      state.current.layers,
      state.current.dark,
    );
  useEffect(() => {
    const element = canvas.current!;
    try {
      renderer.current = createRenderer(element);
    } catch (e) {
      setError((e as Error).message);
      return;
    }
    const observer = new ResizeObserver(draw);
    observer.observe(element);
    const wheel = (e: WheelEvent) => {
      e.preventDefault();
      view.current.zoom = Math.max(
        0.4,
        Math.min(3, view.current.zoom * Math.exp(-e.deltaY * 0.001)),
      );
      draw();
    };
    const lost = (e: Event) => {
      e.preventDefault();
      setError(
        "The 3D graphics context was lost. Reload this page to restore it.",
      );
    };
    element.addEventListener("wheel", wheel, { passive: false });
    element.addEventListener("webglcontextlost", lost);
    return () => {
      observer.disconnect();
      element.removeEventListener("wheel", wheel);
      element.removeEventListener("webglcontextlost", lost);
      renderer.current?.dispose();
      renderer.current = null;
    };
  }, []);
  useEffect(() => {
    renderer.current?.upload(result);
    draw();
  }, [result]);
  useEffect(draw, [dark, layers]);
  useEffect(() => {
    view.current = { ...initial };
    draw();
  }, [reset]);
  useEffect(() => {
    if (!spinning) return;
    let id = 0,
      last = 0;
    const tick = (now: number) => {
      if (last) view.current.yaw += Math.min(now - last, 50) * 0.00018;
      last = now;
      draw();
      id = requestAnimationFrame(tick);
    };
    id = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(id);
  }, [spinning]);
  const drag = useRef<{ id: number; x: number; y: number } | null>(null);
  return (
    <>
      <canvas
        ref={canvas}
        id="spatial-artwork"
        role="img"
        aria-label="Interactive 3D tangent developable. Drag to orbit, scroll to zoom, or use arrow keys and plus and minus."
        tabIndex={0}
        onPointerDown={(e) => {
          e.currentTarget.setPointerCapture(e.pointerId);
          drag.current = { id: e.pointerId, x: e.clientX, y: e.clientY };
        }}
        onPointerMove={(e) => {
          const d = drag.current;
          if (!d || d.id !== e.pointerId) return;
          view.current.yaw += (e.clientX - d.x) * 0.008;
          view.current.pitch = Math.max(
            -1.5,
            Math.min(1.5, view.current.pitch + (e.clientY - d.y) * 0.008),
          );
          drag.current = { id: e.pointerId, x: e.clientX, y: e.clientY };
          draw();
        }}
        onPointerUp={() => {
          drag.current = null;
        }}
        onPointerCancel={() => {
          drag.current = null;
        }}
        onLostPointerCapture={() => {
          drag.current = null;
        }}
        onKeyDown={(e) => {
          const v = view.current;
          switch (e.key) {
            case "ArrowLeft":
              v.yaw -= 0.1;
              break;
            case "ArrowRight":
              v.yaw += 0.1;
              break;
            case "ArrowUp":
              v.pitch = Math.max(-1.5, v.pitch - 0.1);
              break;
            case "ArrowDown":
              v.pitch = Math.min(1.5, v.pitch + 0.1);
              break;
            case "+":
            case "=":
              v.zoom = Math.min(3, v.zoom * 1.1);
              break;
            case "-":
              v.zoom = Math.max(0.4, v.zoom / 1.1);
              break;
            case "Home":
              view.current = { ...initial };
              break;
            default:
              return;
          }
          e.preventDefault();
          draw();
        }}
      />
      {error && (
        <p role="alert" className="spatial-render-error">
          {error}
        </p>
      )}
    </>
  );
}
