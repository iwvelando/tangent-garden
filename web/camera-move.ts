import { useEffect, useRef } from "react";
import type { PlotCamera } from "./planar-link";

// The camera's eased move to a view in a fixed page whose model is drawn at
// `scale` page units per unit about the page's center, as the Apollonian
// garden and hyperbolic lace draw theirs; or a jump when reduced motion is
// requested. It interpolates the model point at the page's center and the
// logarithm of zoom over 250 ms, so the zoom changes monotonically and the
// target ends exactly where it was aimed. halt stops it, as a manual change
// of the view must.
export function useCameraMove(o: {
  view: PlotCamera;
  setView: (view: PlotCamera) => void;
  scale: number;
}) {
  const camera = useRef(o.view);
  camera.current = o.view;
  const set = useRef(o.setView);
  set.current = o.setView;
  const move = useRef(0);
  const halt = () => {
    cancelAnimationFrame(move.current);
    move.current = 0;
  };
  useEffect(() => halt, []);
  // The model point at the page's center under a view.
  const center = (v: PlotCamera) => ({
    x: -v.x / (o.scale * v.zoom),
    y: v.y / (o.scale * v.zoom),
  });
  const moveTo = (target: PlotCamera) => {
    halt();
    const from = camera.current;
    if (matchMedia("(prefers-reduced-motion: reduce)").matches) {
      set.current(target);
      return;
    }
    const a = center(from),
      b = center(target);
    const start = performance.now();
    const step = (now: number) => {
      const t = Math.min(1, (now - start) / 250);
      const e = t < 0.5 ? 4 * t ** 3 : 1 - (-2 * t + 2) ** 3 / 2;
      let view = target;
      if (t < 1) {
        const zoom = from.zoom * (target.zoom / from.zoom) ** e;
        const k = o.scale * zoom;
        view = {
          zoom,
          x: -(a.x + (b.x - a.x) * e) * k,
          y: (a.y + (b.y - a.y) * e) * k,
        };
      }
      set.current(view);
      move.current = t < 1 ? requestAnimationFrame(step) : 0;
    };
    move.current = requestAnimationFrame(step);
  };
  return { moveTo, halt };
}
