import { useEffect, useRef, useState } from "react";
import type { SpatialResult } from "./types";
import type { SpatialCamera } from "./link";
import { createGesture } from "../gestures";
import {
  createRenderer,
  initialView,
  type Layers,
  type View,
} from "./renderer";
import type { Batch, Projection } from "./scene";
import type { CutSpec } from "./cut";
import { defaultSight, isPlain, type Sight } from "./sight";
import { turnTo, type NamedView } from "../named-views";
const noProbe: Batch[] = [];
const cameraKeys = [
  "ArrowLeft",
  "ArrowRight",
  "ArrowUp",
  "ArrowDown",
  "+",
  "=",
  "-",
  "Home",
];
export function SpatialPlot({
  result,
  dark,
  layers,
  reset,
  spinning,
  override,
  released,
  refit = 0,
  onViewport,
  onError,
  restored,
  onCamera,
  probe = noProbe,
  cut = null,
  sight = defaultSight,
  onSeeThrough,
  onStrokes,
  projection = "orthographic",
  lensAngle,
  turn = null,
}: {
  result: SpatialResult;
  dark: boolean;
  layers: Layers;
  reset: number;
  spinning: boolean;
  override?: View;
  // A finished animation's camera, explored in place of the manual one,
  // which is kept for when the study returns. refit restores it.
  released?: View;
  refit?: number;
  onViewport: (view: View) => void;
  onError: (message: string) => void;
  // A manual camera to start from at this reset, as a shared link restores.
  restored?: { reset: number; view: SpatialCamera } | null;
  // The manual camera whenever it is drawn, for a study link.
  onCamera?: (camera: SpatialCamera) => void;
  // The parameter probe's batches for this result (see probe.ts).
  probe?: Batch[];
  // The cutaway plane as drawn (see cut.ts), or none.
  cut?: CutSpec | null;
  // Seeing through sheets and lines behind them (see sight.ts), and
  // whether see-through sheets could be drawn, reported when asked for.
  sight?: Sight;
  onSeeThrough?: (available: boolean) => void;
  // Whether strokes could be drawn rather than hairlines.
  onStrokes?: (available: boolean) => void;
  // The manual camera's projection, drawn for the manual and released
  // views; an animation's camera carries its own.
  projection?: Projection;
  // The chosen projection's lens angle, which the others ignore.
  lensAngle?: number;
  // A named view to turn the shown camera to, once per id.
  turn?: { id: number; to: NamedView } | null;
}) {
  const canvas = useRef<HTMLCanvasElement>(null),
    renderer = useRef<ReturnType<typeof createRenderer> | null>(null);
  const manual = useRef({ ...initialView });
  const explored = useRef<View | null>(null);
  // Orbit, pan, and zoom act on whichever camera is shown. A ride's
  // released perspective camera has no orbit of its own: they leave the ray
  // for the orthographic view it was held about. Home returns to the ray.
  const target = () => {
    if (explored.current) delete explored.current.lens;
    return explored.current ?? manual.current;
  };
  const state = useRef({
    dark,
    layers,
    result,
    override,
    onViewport,
    onCamera,
    probe,
    cut,
    sight,
    onSeeThrough,
    onStrokes,
    projection,
    lensAngle,
  });
  state.current = {
    dark,
    layers,
    result,
    override,
    onViewport,
    onCamera,
    probe,
    cut,
    sight,
    onSeeThrough,
    onStrokes,
    projection,
    lensAngle,
  };
  const [error, setError] = useState("");
  const projected = (v: View): View => {
    const { projection: _, lensAngle: __, ...rest } = v;
    const { projection: p, lensAngle } = state.current;
    return p === "orthographic"
      ? rest
      : p === "chosen"
        ? { ...rest, projection: p, lensAngle }
        : { ...rest, projection: p };
  };
  const current = (): View =>
    state.current.override ??
    projected(
      explored.current ?? {
        ...manual.current,
        ...state.current.result.bounds,
      },
    );
  const draw = () => {
    if (!canvas.current?.clientWidth) return;
    const v = current();
    renderer.current?.setCut(state.current.cut);
    const shown = state.current.sight;
    const through =
      shown.sheets !== "through" || !!renderer.current?.seeThrough();
    renderer.current?.setSight(shown);
    renderer.current?.draw(v, state.current.layers, state.current.dark);
    // The shown camera and cut, for tests and inspection, without a
    // re-render.
    canvas.current.dataset.view = JSON.stringify(v);
    if (state.current.cut)
      canvas.current.dataset.cut = JSON.stringify(state.current.cut);
    else delete canvas.current.dataset.cut;
    // The sight as drawn: opaque sheets where they could not be seen
    // through.
    const { weight, ...drawn } = through
      ? shown
      : { ...shown, sheets: "opaque" as const };
    if (isPlain({ ...drawn, weight })) delete canvas.current.dataset.sight;
    else canvas.current.dataset.sight = JSON.stringify(drawn);
    // The weight as drawn, when lines are strokes rather than hairlines.
    const stroked = !!renderer.current?.strokes();
    if (weight === "hairline" || !stroked)
      delete canvas.current.dataset.strokes;
    else canvas.current.dataset.strokes = JSON.stringify({ weight });
    state.current.onSeeThrough?.(through);
    state.current.onStrokes?.(stroked);
    state.current.onViewport(v);
    state.current.onCamera?.({ ...manual.current });
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
      const v = target();
      v.zoom = Math.max(0.2, Math.min(8, v.zoom * Math.exp(-e.deltaY * 0.001)));
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
    renderer.current?.setProbe(state.current.probe);
    draw();
  }, [result]);
  useEffect(() => {
    renderer.current?.setProbe(probe);
    draw();
  }, [probe]);
  useEffect(draw, [dark, layers, override, cut, sight, projection, lensAngle]);
  useEffect(() => {
    manual.current =
      restored?.reset === reset ? { ...restored.view } : { ...initialView };
    draw();
  }, [reset]);
  useEffect(() => {
    explored.current = released ? { ...released } : null;
    draw();
  }, [!!released, refit]);
  // Only turns asked for after the drawing opened, not one it opened with.
  const turned = useRef(turn?.id);
  useEffect(() => {
    if (!turn || turn.id === turned.current) return;
    turned.current = turn.id;
    if (state.current.override) return;
    Object.assign(target(), turnTo(target(), turn.to));
    draw();
  }, [turn?.id]);
  useEffect(() => {
    if (!spinning || override) return;
    let id = 0,
      last = 0;
    const tick = (now: number) => {
      if (last) target().yaw += Math.min(now - last, 50) * 0.00018;
      last = now;
      draw();
      id = requestAnimationFrame(tick);
    };
    id = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(id);
  }, [spinning, override]);
  const gesture = useRef(createGesture()),
    // Shift held as a mouse drag begins makes it a pan.
    panning = useRef(false);
  return (
    <>
      <canvas
        ref={canvas}
        id="spatial-artwork"
        role="img"
        aria-label="Interactive 3D curve construction. Drag to orbit, shift-drag or two fingers to pan, scroll or pinch to zoom. Arrow keys orbit; shift-arrows pan; plus and minus zoom."
        tabIndex={0}
        onPointerDown={(e) => {
          if (override) return;
          e.currentTarget.setPointerCapture(e.pointerId);
          if (!gesture.current.count) panning.current = e.shiftKey;
          gesture.current.down(e);
        }}
        onPointerMove={(e) => {
          const motion = gesture.current.move(e);
          if (!motion || override) return;
          const v = target();
          // One finger or the mouse orbits, or pans with shift; two fingers
          // pinch to zoom and pan together.
          if (motion.kind === "pinch")
            v.zoom = Math.max(0.2, Math.min(8, v.zoom * motion.scale));
          if (motion.kind === "pinch" || panning.current) {
            const unit =
              (2 * current().radius * 1.16) /
              (Math.min(
                e.currentTarget.clientWidth,
                e.currentTarget.clientHeight,
              ) *
                v.zoom);
            v.panX += motion.dx * unit;
            v.panY -= motion.dy * unit;
          } else {
            v.yaw += motion.dx * 0.008;
            v.pitch = Math.max(
              -1.5,
              Math.min(1.5, v.pitch + motion.dy * 0.008),
            );
          }
          draw();
        }}
        onPointerUp={(e) => gesture.current.up(e)}
        onPointerCancel={(e) => gesture.current.up(e)}
        onLostPointerCapture={(e) => gesture.current.up(e)}
        onKeyDown={(e) => {
          if (override || !cameraKeys.includes(e.key)) return;
          const v = target(),
            delta = (current().radius * 0.05) / v.zoom;
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
              if (explored.current && released)
                explored.current = { ...released };
              else manual.current = { ...initialView };
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
