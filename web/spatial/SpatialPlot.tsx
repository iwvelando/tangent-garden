import { useEffect, useRef, useState } from "react";
import type { SpatialResult } from "./types";
import {
  createRenderer,
  initialView,
  type Layers,
  type View,
} from "./renderer";
export function SpatialPlot({
  result,
  dark,
  layers,
  reset,
  spinning,
  override,
  onViewport,
  onError,
}: {
  result: SpatialResult;
  dark: boolean;
  layers: Layers;
  reset: number;
  spinning: boolean;
  override?: View;
  onViewport: (view: View) => void;
  onError: (message: string) => void;
}) {
  const canvas = useRef<HTMLCanvasElement>(null),
    renderer = useRef<ReturnType<typeof createRenderer> | null>(null);
  const manual = useRef({ ...initialView });
  const state = useRef({ dark, layers, result, override, onViewport });
  state.current = { dark, layers, result, override, onViewport };
  const [error, setError] = useState("");
  const current = (): View =>
    state.current.override ?? {
      ...manual.current,
      ...state.current.result.bounds,
    };
  const draw = () => {
    const v = current();
    renderer.current?.draw(v, state.current.layers, state.current.dark);
    state.current.onViewport(v);
  };
  useEffect(() => {
    const element = canvas.current!;
    try {
      renderer.current = createRenderer(element);
      onError("");
    } catch (e) {
      const text = (e as Error).message;
      setError(text);
      onError(text);
      return;
    }
    const observer = new ResizeObserver(() => {
      if (element.clientWidth) draw();
    });
    observer.observe(element);
    const wheel = (e: WheelEvent) => {
      e.preventDefault();
      if (state.current.override) return;
      manual.current.zoom = Math.max(
        0.2,
        Math.min(8, manual.current.zoom * Math.exp(-e.deltaY * 0.001)),
      );
      draw();
    };
    const lost = (e: Event) => {
      e.preventDefault();
      const text =
        "The 3D graphics context was lost. Reload this page to restore it.";
      setError(text);
      onError(text);
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
  useEffect(draw, [dark, layers, override]);
  useEffect(() => {
    manual.current = { ...initialView };
    draw();
  }, [reset]);
  useEffect(() => {
    if (!spinning || override) return;
    let id = 0,
      last = 0;
    const tick = (now: number) => {
      if (last) manual.current.yaw += Math.min(now - last, 50) * 0.00018;
      last = now;
      draw();
      id = requestAnimationFrame(tick);
    };
    id = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(id);
  }, [spinning, override]);
  const drag = useRef<{
    id: number;
    x: number;
    y: number;
    pan: boolean;
  } | null>(null);
  return (
    <>
      <canvas
        ref={canvas}
        id="spatial-artwork"
        role="img"
        aria-label="Interactive 3D tangent developable. Drag to orbit, shift-drag to pan, scroll to zoom. Arrow keys orbit; shift-arrows pan; plus and minus zoom."
        tabIndex={0}
        onPointerDown={(e) => {
          if (override) return;
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
          if (!d || d.id !== e.pointerId || override) return;
          const dx = e.clientX - d.x,
            dy = e.clientY - d.y;
          if (d.pan) {
            const unit =
              (2 * result.bounds.radius * 1.16) /
              (Math.min(
                e.currentTarget.clientWidth,
                e.currentTarget.clientHeight,
              ) *
                manual.current.zoom);
            manual.current.panX += dx * unit;
            manual.current.panY -= dy * unit;
          } else {
            manual.current.yaw += dx * 0.008;
            manual.current.pitch = Math.max(
              -1.5,
              Math.min(1.5, manual.current.pitch + dy * 0.008),
            );
          }
          drag.current = { ...d, x: e.clientX, y: e.clientY };
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
          if (override) return;
          const v = manual.current,
            delta = (result.bounds.radius * 0.05) / v.zoom;
          switch (e.key) {
            case "ArrowLeft":
              if (e.shiftKey) v.panX -= delta;
              else v.yaw -= 0.1;
              break;
            case "ArrowRight":
              if (e.shiftKey) v.panX += delta;
              else v.yaw += 0.1;
              break;
            case "ArrowUp":
              if (e.shiftKey) v.panY += delta;
              else v.pitch = Math.max(-1.5, v.pitch - 0.1);
              break;
            case "ArrowDown":
              if (e.shiftKey) v.panY -= delta;
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
              manual.current = { ...initialView };
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
