import type { ColorScheme } from "../color-schemes";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { RefinementView, SpatialResult } from "./types";
import type { SpatialCamera } from "./link";
import { createGesture } from "../gestures";
import { useDrawingTouch } from "../MobileNotebookNav";
import {
  createRenderer,
  initialView,
  type Layers,
  type View,
} from "./renderer";
import {
  refinementView,
  turntableAngle,
  type Batch,
  type Projection,
} from "./scene";
import { zoomAbout as zoomed, type PagePoint } from "./zoom";
import type { Vec3 } from "./types";
import { spatialPlainZoom, viewZoom } from "../refinement";
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
  scheme = "default",
  layers,
  reset,
  spinning,
  override,
  released,
  refit = 0,
  onViewport,
  onError,
  restored,
  home = null,
  onCamera,
  probe = noProbe,
  cut = null,
  sight = defaultSight,
  onSeeThrough,
  onStrokes,
  onGeometry,
  projection = "orthographic",
  lensAngle,
  turn = null,
  refineView = false,
  receiverView = false,
  onFocus,
}: {
  result: SpatialResult;
  dark: boolean;
  scheme?: ColorScheme;
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
  // The camera a reset and Home return to: a preset's opening view, or
  // without one the default view.
  home?: SpatialCamera | null;
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
  // The layers each uploaded result has something to draw for (sceneLayers
  // in scene.ts), for the legend.
  onGeometry?: (result: SpatialResult, layers: ReadonlySet<string>) => void;
  // The manual camera's projection, drawn for the manual and released
  // views; an animation's camera carries its own.
  projection?: Projection;
  // The chosen projection's lens angle, which the others ignore.
  lensAngle?: number;
  // A named view to turn the shown camera to, once per id.
  turn?: { id: number; to: NamedView } | null;
  // Whether the study is refined to its view: the drawing then zooms to
  // viewZoom, and reports what it shows once zoomed in.
  refineView?: boolean;
  receiverView?: boolean;
  // What the shown camera shows while it is zoomed in and the study is
  // refined to its view, or null, whenever that changes; an animation's
  // camera reports nothing.
  onFocus?: (view: RefinementView | null) => void;
}) {
  const canvas = useRef<HTMLCanvasElement>(null),
    renderer = useRef<ReturnType<typeof createRenderer> | null>(null);
  const manual = useRef({ ...initialView });
  const lost = useRef(false);
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
    onGeometry,
    projection,
    lensAngle,
    refineView,
    receiverView,
    onFocus,
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
    onGeometry,
    projection,
    lensAngle,
    refineView,
    receiverView,
    onFocus,
  };
  const [error, setError] = useState("");
  const zoomLimit = () =>
    state.current.refineView ? viewZoom : spatialPlainZoom;
  // The point last zoomed toward through a lens, and the camera that zoom
  // left, so a run of wheel steps at one place picks it once: until the
  // camera, the pointer or what is drawn changes, it stays under the
  // pointer, nearest the viewer.
  const anchor = useRef<{
    key: unknown[];
    at: PagePoint;
    camera: string;
    point: Vec3 | null;
  } | null>(null);
  // Zooms the shown camera by factor about a point of the page, in client
  // coordinates, which stays where it is (see zoom.ts). Through a lens it
  // zooms toward the geometry drawn there.
  const zoomAbout = (factor: number, x: number, y: number) => {
    const element = canvas.current!;
    const r = element.getBoundingClientRect();
    const size = { width: element.clientWidth, height: element.clientHeight };
    const at = {
      x: x - (r.left + r.width / 2) + size.width / 2,
      y: y - (r.top + r.height / 2) + size.height / 2,
    };
    const v = target(),
      shown = current();
    let point: Vec3 | null = null;
    if (turntableAngle(shown)) {
      const { result, layers, probe, cut } = state.current;
      const key = [result, layers, probe, cut, size.width, size.height];
      const last = anchor.current;
      point =
        last &&
        last.camera === JSON.stringify(v) &&
        Math.hypot(last.at.x - at.x, last.at.y - at.y) <= 1 &&
        last.key.every((k, i) => k === key[i])
          ? last.point
          : (renderer.current?.pick(shown, layers, size, at) ?? null);
      Object.assign(v, zoomed(shown, size, at, factor, zoomLimit(), point));
      anchor.current = { key, at, camera: JSON.stringify(v), point };
    } else Object.assign(v, zoomed(shown, size, at, factor, zoomLimit()));
  };
  // What was last reported to onFocus.
  const focused = useRef("null");
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
    // Nothing is drawn or reported while the context is lost; a restored
    // one draws the camera as it then stands.
    if (!canvas.current?.clientWidth || lost.current) return;
    // A camera zoomed past the limit, as where refinement to the view was
    // turned off, zooms out about the middle of the drawing.
    const shownCamera = explored.current ?? manual.current;
    shownCamera.zoom = Math.min(shownCamera.zoom, zoomLimit());
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
    const { weight, depth, ...drawn } = through
      ? shown
      : { ...shown, sheets: "opaque" as const };
    if (isPlain({ ...drawn, weight })) delete canvas.current.dataset.sight;
    else canvas.current.dataset.sight = JSON.stringify(drawn);
    // The weight as drawn, when lines are strokes rather than hairlines.
    const stroked = !!renderer.current?.strokes();
    if (weight === "hairline" || !stroked)
      delete canvas.current.dataset.strokes;
    else
      canvas.current.dataset.strokes = JSON.stringify({
        weight,
        ...(depth === "taper" && { depth }),
      });
    state.current.onSeeThrough?.(through);
    state.current.onStrokes?.(stroked);
    state.current.onViewport(v);
    state.current.onCamera?.({ ...manual.current });
    // What the study is refined to: the view while zoomed in, or nothing.
    // An animation keeps the study's refinement as it was.
    if (!state.current.override && state.current.onFocus) {
      const focus =
        state.current.refineView && (v.zoom > 1 || state.current.receiverView)
          ? {
              ...refinementView(v, {
                width: canvas.current.clientWidth,
                height: canvas.current.clientHeight,
              }),
              ...(state.current.receiverView && {
                pixels: [canvas.current.width, canvas.current.height] as [
                  number,
                  number,
                ],
              }),
            }
          : null;
      const text = JSON.stringify(focus);
      if (text !== focused.current) {
        focused.current = text;
        state.current.onFocus(focus);
      }
    }
  };
  // A layout effect, so the renderer exists when the first result is
  // uploaded below.
  useLayoutEffect(() => {
    const element = canvas.current!;
    const failed = (e: unknown) => {
      const text = (e as Error).message;
      setError(text);
      onError(text);
    };
    // A lost context keeps the camera, the study and every setting, which
    // live here rather than on the device: restoring it rebuilds the
    // renderer from them. Asking for restoration requires preventDefault.
    const lose = (e: Event) => {
      e.preventDefault();
      lost.current = true;
      renderer.current = null;
      const text =
        "The 3D graphics context was lost. The drawing returns when the browser restores it; if it does not, reload the page.";
      setError(text);
      onError(text);
    };
    // The context stays lost, and nothing is drawn, until a renderer is
    // rebuilt on it.
    const regained = () => {
      try {
        renderer.current = createRenderer(element, scheme);
      } catch (e) {
        failed(e);
        return;
      }
      lost.current = false;
      const { result, probe, onGeometry } = state.current;
      renderer.current.upload(result);
      renderer.current.setProbe(probe);
      onGeometry?.(result, renderer.current.layers()!);
      setError("");
      onError("");
      draw();
    };
    // Listening before building, so a context lost while the scheme
    // changes, which no renderer can be built on, is still rebuilt on
    // restore, in that scheme.
    element.addEventListener("webglcontextlost", lose);
    element.addEventListener("webglcontextrestored", regained);
    const unlisten = () => {
      element.removeEventListener("webglcontextlost", lose);
      element.removeEventListener("webglcontextrestored", regained);
    };
    if (!lost.current)
      try {
        renderer.current = createRenderer(element, scheme);
        setError("");
        onError("");
      } catch (e) {
        failed(e);
        return unlisten;
      }
    const observer = new ResizeObserver(() => {
      if (element.clientWidth) draw();
    });
    observer.observe(element);
    const wheel = (e: WheelEvent) => {
      e.preventDefault();
      if (state.current.override) return;
      // The wheel zooms about the pointer, which stays where it is.
      zoomAbout(Math.exp(-e.deltaY * 0.001), e.clientX, e.clientY);
      draw();
    };
    element.addEventListener("wheel", wheel, { passive: false });
    return () => {
      observer.disconnect();
      element.removeEventListener("wheel", wheel);
      unlisten();
      renderer.current?.dispose();
      renderer.current = null;
    };
  }, [scheme]);
  // Before the page can see the frame as settled: a frame whose bounds move
  // the view it is refined to (as a preset's first frame does, refined to
  // the view the previous study's bounds framed) reports the new view in
  // the same task, so the drawing never reads idle in between.
  useLayoutEffect(() => {
    renderer.current?.upload(result);
    renderer.current?.setProbe(state.current.probe);
    const drawable = renderer.current?.layers();
    if (drawable) onGeometry?.(result, drawable);
    draw();
  }, [result, scheme]);
  useEffect(() => {
    renderer.current?.setProbe(probe);
    draw();
  }, [probe]);
  useEffect(draw, [
    dark,
    layers,
    override,
    cut,
    sight,
    projection,
    lensAngle,
    refineView,
    receiverView,
  ]);
  useEffect(() => {
    manual.current =
      restored?.reset === reset
        ? { ...restored.view }
        : { ...(home ?? initialView) };
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
  const touchEnabled = useDrawingTouch();
  useEffect(() => {
    gesture.current = createGesture();
  }, [touchEnabled]);
  return (
    <>
      <canvas
        ref={canvas}
        id="spatial-artwork"
        role="img"
        aria-label="Interactive 3D curve construction. Drag to orbit, shift-drag or two fingers to pan, scroll or pinch to zoom. Arrow keys orbit; shift-arrows pan; plus and minus zoom."
        tabIndex={0}
        style={{ touchAction: touchEnabled ? "none" : "pan-y pinch-zoom" }}
        onPointerDown={(e) => {
          if (override || (e.pointerType === "touch" && !touchEnabled)) return;
          e.currentTarget.setPointerCapture(e.pointerId);
          if (!gesture.current.count) panning.current = e.shiftKey;
          gesture.current.down(e);
        }}
        onPointerMove={(e) => {
          if (e.pointerType === "touch" && !touchEnabled) return;
          const motion = gesture.current.move(e);
          if (!motion || override) return;
          const v = target();
          // One finger or the mouse orbits, or pans with shift; two fingers
          // pinch to zoom about the point between them and pan together.
          if (motion.kind === "pinch")
            zoomAbout(motion.scale, motion.mid.x, motion.mid.y);
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
            // About the middle of the drawing, toward the geometry there
            // through a lens.
            case "+":
            case "=":
            case "-": {
              const r = e.currentTarget.getBoundingClientRect();
              zoomAbout(
                e.key === "-" ? 1 / 1.1 : 1.1,
                r.left + r.width / 2,
                r.top + r.height / 2,
              );
              break;
            }
            case "Home":
              if (explored.current && released)
                explored.current = { ...released };
              else manual.current = { ...(home ?? initialView) };
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
