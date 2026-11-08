import {
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ButtonHTMLAttributes,
  type PointerEvent,
  type CSSProperties,
} from "react";
import { EngineClient } from "./engine-client";
import {
  FourierFitSession,
  curveFitAvailable,
  fittedStudy,
  fitTermsHelp,
  fitSourceHelp,
  fitCorrectionHelp,
  fitOutlineViewHelp,
  maxStrokePoints,
  sampleLeaf,
  strokeWindow,
  type FitState,
} from "./fourier-fit";
import type { FourierFitRequest } from "./FourierFitContext";
import type { JourneyVia } from "./JourneyContext";
import { createGesture, zoomAbout } from "./gestures";
import { useQuietFocus } from "./quiet-focus";
import { useTheme } from "./useTheme";
import { Plot } from "./Plot";
import { reveal } from "./animation";
import { Field, HelpToggle, HelpText, useHelp } from "./Field";
import type { PlanarStudy } from "./planar-link";
import type { Vec } from "./types";
import "./fourier-fit.css";

// A press that makes its own button unavailable must not drop the keyboard's
// place, as `disabled` would: this one stays focusable, dimmed and inert.
function SteadyButton({
  unavailable,
  onClick,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { unavailable: boolean }) {
  return (
    <button
      type="button"
      aria-disabled={unavailable || undefined}
      onClick={unavailable ? undefined : onClick}
      {...rest}
    />
  );
}

// A refusal beside the action that caused it, brought into view on a phone.
function FitError({ message }: { message: string }) {
  const box = useRef<HTMLParagraphElement>(null);
  useLayoutEffect(() => {
    box.current?.scrollIntoView({ block: "nearest" });
  }, [message]);
  return (
    <p className="field-error" role="alert" ref={box}>
      {message.charAt(0).toUpperCase() + message.slice(1)}
    </p>
  );
}

// How far a press moves before it is a drag, in CSS pixels: wider for a finger.
const dragSlop = { touch: 8, other: 4 };
// A pinch reaches the wheel as small deltas with ctrlKey; a held Ctrl and a
// mouse wheel send far larger ones, kept here to one modest step.
const pinchRate = 0.01,
  pinchStep = 25;
const outlineZoomRange = [1, 32] as const;

// A client point in the outline's 1000 × 760 page, from its middle, as the SVG
// actually draws it: its border and rounded box sizes would otherwise make a
// pan fall short of the pointer and a zoom drift from its anchor. The result
// does not depend on the camera, so events within one frame can share it.
function outlinePage(svg: SVGSVGElement, x: number, y: number) {
  const m = svg.getScreenCTM()!,
    view = svg.viewBox.baseVal,
    ratio = 1000 / (view.width * m.a);
  return {
    ratio,
    height: 760 / ratio,
    u: (x - m.a * (view.x + view.width / 2) - m.e) * ratio,
    v: (y - m.d * (view.y + view.height / 2) - m.f) * ratio,
  };
}

export function FourierFitPreview({
  request,
  onReturn,
  onAdopt,
}: {
  request: FourierFitRequest;
  onReturn: (via: JourneyVia) => void;
  onAdopt: (study: PlanarStudy, via: JourneyVia) => void;
}) {
  const theme = useTheme(),
    title = useId();
  const sourceHelp = useHelp(),
    correctionHelp = useHelp(),
    outlineViewHelp = useHelp();
  const dialog = useRef<HTMLDialogElement>(null),
    back = useRef<HTMLButtonElement>(null),
    capture = useRef<SVGSVGElement>(null);
  const quiet = useQuietFocus(dialog),
    via = useRef(request.via);
  const engine = useRef<FourierFitSession | null>(null);
  const stroke = useRef<Vec[]>([]),
    pointer = useRef<number | null>(null);
  const [points, setPoints] = useState<Vec[]>([]),
    [closed, setClosed] = useState(false);
  const [drawing, setDrawing] = useState(false),
    [notice, setNotice] = useState("");
  const [reference, setReference] = useState(false);
  const [imported, setImported] = useState(false);
  const [correcting, setCorrecting] = useState(false),
    [selected, setSelected] = useState(0),
    [reach, setReach] = useState(0.1);
  const gesture = useRef(createGesture()),
    navigating = useRef(false),
    panning = useRef(false);
  const editFrame = useRef({ cx: 0, cy: 0, scale: 1000 / 6, span: 6 });
  const [outlineCamera, setOutlineCamera] = useState({ x: 0, y: 0, zoom: 1 });
  const drag = useRef<{
    id: number;
    index: number;
    previousIndex: number;
    start: Vec;
    target: Vec;
    client: { x: number; y: number };
    slop: number;
    moved: boolean;
  } | null>(null);
  const [ghost, setGhost] = useState<Vec | null>(null);
  const [state, setState] = useState<FitState>({ count: 8, pending: false });
  const [progress, setProgress] = useState(1),
    [playing, setPlaying] = useState(false);
  const clock = useRef({ time: 0, progress: 0 });
  const ending = useRef(false);
  useEffect(() => {
    engine.current = new FourierFitSession(() => new EngineClient(), setState);
    if (request.via === "pointer") quiet.onPointerDown();
    dialog.current!.showModal();
    quiet.quiet();
    back.current!.focus();
    return () => engine.current?.cancel();
  }, []);
  useLayoutEffect(() => {
    document.documentElement.classList.add("fourier-fit-open");
    return () => document.documentElement.classList.remove("fourier-fit-open");
  }, []);
  useEffect(() => {
    if (!playing) return;
    let raf = 0;
    const tick = (time: number) => {
      const p = Math.min(
        1,
        clock.current.progress + Math.max(0, time - clock.current.time) / 10000,
      );
      setProgress(p);
      if (p === 1) setPlaying(false);
      else raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playing]);
  // Playback belongs to the completed preview. A new completed fit stops the
  // preceding chain, while pending work leaves that drawing available.
  useEffect(() => {
    setPlaying(false);
    setProgress(1);
  }, [state.frame]);
  // A trackpad acts as fingers do on a phone. Held pointers own the view: iOS
  // also sends gesture events during a touch pinch they already handle.
  useEffect(() => {
    const svg = capture.current;
    if (!svg || !correcting) return;
    const wheel = (e: WheelEvent) => {
      e.preventDefault();
      if (gesture.current.count) return;
      const { ratio, height, u, v } = outlinePage(svg, e.clientX, e.clientY);
      if (e.ctrlKey) {
        const step = Math.max(-pinchStep, Math.min(pinchStep, e.deltaY));
        setOutlineCamera((c) =>
          zoomAbout(c, Math.exp(-step * pinchRate), outlineZoomRange, u, v),
        );
        return;
      }
      const unit =
        e.deltaMode === WheelEvent.DOM_DELTA_LINE
          ? 16
          : e.deltaMode === WheelEvent.DOM_DELTA_PAGE
            ? height
            : 1;
      setOutlineCamera((c) => ({
        ...c,
        x: c.x - e.deltaX * unit * ratio,
        y: c.y - e.deltaY * unit * ratio,
      }));
    };
    // Safari's own events for a trackpad pinch: scale runs from the start.
    type Pinch = Event & { scale: number; clientX: number; clientY: number };
    let last = 1;
    const pinchStart = (e: Event) => {
      e.preventDefault();
      last = 1;
    };
    const pinchChange = (event: Event) => {
      const e = event as Pinch;
      e.preventDefault();
      if (gesture.current.count) return;
      const k = e.scale / last,
        { u, v } = outlinePage(svg, e.clientX, e.clientY);
      last = e.scale;
      setOutlineCamera((c) => zoomAbout(c, k, outlineZoomRange, u, v));
    };
    svg.addEventListener("wheel", wheel, { passive: false });
    svg.addEventListener("gesturestart", pinchStart);
    svg.addEventListener("gesturechange", pinchChange);
    return () => {
      svg.removeEventListener("wheel", wheel);
      svg.removeEventListener("gesturestart", pinchStart);
      svg.removeEventListener("gesturechange", pinchChange);
    };
  }, [correcting]);
  function reset(next: Vec[] = []) {
    engine.current?.cancel();
    stroke.current = next;
    setPoints(next);
    setClosed(false);
    setPlaying(false);
    setProgress(1);
    setNotice("");
    setImported(false);
    setCorrecting(false);
    setSelected(0);
    drag.current = null;
    gesture.current = createGesture();
    navigating.current = false;
    panning.current = false;
    setOutlineCamera({ x: 0, y: 0, zoom: 1 });
    setGhost(null);
  }
  function model(e: PointerEvent<SVGSVGElement>): Vec {
    const box = e.currentTarget.getBoundingClientRect();
    const scale = Math.min(
      box.width / strokeWindow.width,
      box.height / strokeWindow.height,
    );
    return {
      x: Math.max(
        -3,
        Math.min(3, (e.clientX - box.left - box.width / 2) / scale),
      ),
      y: Math.max(
        -2.28,
        Math.min(2.28, -(e.clientY - box.top - box.height / 2) / scale),
      ),
    };
  }
  function append(e: PointerEvent<SVGSVGElement>) {
    if (pointer.current !== e.pointerId) return;
    if (stroke.current.length === maxStrokePoints) {
      setNotice(
        "4,096 points reached. Further samples are ignored; only the visible stroke will be fitted.",
      );
      return;
    }
    const p = model(e);
    stroke.current = [...stroke.current, p];
    setPoints(stroke.current);
  }
  function finishPointer(e: PointerEvent<SVGSVGElement>, canceled = false) {
    if (pointer.current !== e.pointerId) return;
    if (!canceled) append(e);
    pointer.current = null;
    setDrawing(false);
    if (e.currentTarget.hasPointerCapture(e.pointerId))
      e.currentTarget.releasePointerCapture(e.pointerId);
    if (canceled)
      setNotice(
        "Stroke interrupted. The visible draft is kept open; redraw or explicitly close it.",
      );
  }
  function finish(adopt = false) {
    const study = adopt ? engine.current?.candidate() : null;
    if (ending.current || (adopt && !study)) return;
    ending.current = true;
    engine.current?.cancel();
    setPlaying(false);
    dialog.current?.close();
    if (study) onAdopt(study, via.current);
    else onReturn(via.current);
  }
  const viewHint = useMemo(
    () =>
      matchMedia("(pointer: coarse)").matches
        ? "Pinch to zoom · two fingers to pan"
        : "Pinch or Ctrl+scroll to zoom · scroll to pan",
    [],
  );
  const frame = state.frame;
  const sourceAvailable = curveFitAvailable(request.study);
  const visiblePoints =
    state.editing?.points ??
    (imported ? (state.outline?.points ?? []) : points);
  const originalPoints = state.editing?.original ?? visiblePoints;
  const uniqueCount =
    visiblePoints.length -
    (visiblePoints.length > 1 &&
    visiblePoints[0].x === visiblePoints.at(-1)!.x &&
    visiblePoints[0].y === visiblePoints.at(-1)!.y
      ? 1
      : 0);
  const pointIndex = Math.min(selected, Math.max(0, uniqueCount - 1));
  const chosen = visiblePoints[pointIndex];
  const heldFraming = useRef({ cx: 0, cy: 0, scale: 1000 / 6, span: 6 });
  const openSource = imported && !!state.outline?.open;
  const isClosed = imported ? !!state.outline && !openSource : closed;
  // Keep imported coordinates untouched. One frame includes the entire
  // source and all 16 ranked circles, independent of selection/playback.
  const framing = useMemo(() => {
    if (!imported && !state.editing?.changed) {
      heldFraming.current = { cx: 0, cy: 0, scale: 1000 / 6, span: 6 };
    } else if (!state.pending && (state.fit || openSource)) {
      const r = Math.max(
        imported ? 0 : 3,
        state.outline?.previewRadius ?? 0,
        state.fit?.previewRadius ?? 0,
        ...originalPoints.map((p) => Math.max(Math.abs(p.x), Math.abs(p.y))),
        ...visiblePoints.map((p) => Math.max(Math.abs(p.x), Math.abs(p.y))),
      );
      heldFraming.current = {
        cx: 0,
        cy: 0,
        scale: 760 / (2.2 * r),
        span: 2.2 * r,
      };
    }
    return heldFraming.current;
  }, [imported, state]);
  const viewBox = `${framing.cx - 500 / framing.scale} ${-framing.cy - 380 / framing.scale} ${1000 / framing.scale} ${760 / framing.scale}`;
  function fitOutlineView() {
    const xs = visiblePoints.map((p) => p.x),
      ys = visiblePoints.map((p) => p.y);
    const x0 = Math.min(...xs),
      x1 = Math.max(...xs),
      y0 = Math.min(...ys),
      y1 = Math.max(...ys);
    const scale = Math.min(1000 / (1.12 * (x1 - x0)), 760 / (1.12 * (y1 - y0)));
    editFrame.current = {
      cx: (x0 + x1) / 2,
      cy: (y0 + y1) / 2,
      scale,
      span: 1000 / scale,
    };
    drag.current = null;
    setGhost(null);
    gesture.current = createGesture();
    navigating.current = false;
    panning.current = false;
    setOutlineCamera({ x: 0, y: 0, zoom: 1 });
  }
  const inputScale = correcting
    ? editFrame.current.scale * outlineCamera.zoom
    : framing.scale;
  const inputCX = correcting
    ? editFrame.current.cx - outlineCamera.x / inputScale
    : framing.cx;
  const inputCY = correcting
    ? editFrame.current.cy + outlineCamera.y / inputScale
    : framing.cy;
  const inputViewBox = `${inputCX - 500 / inputScale} ${-inputCY - 380 / inputScale} ${1000 / inputScale} ${760 / inputScale}`;

  const layers = useMemo(
    () => (state.fit ? fittedStudy(state.fit.terms).layers : undefined),
    [state.fit],
  );
  const shown =
    frame &&
    (progress < 1
      ? { ...frame, result: reveal(frame.result, progress) }
      : frame);
  function correctionPoint(e: PointerEvent<SVGSVGElement>): Vec {
    const p = new DOMPoint(e.clientX, e.clientY).matrixTransform(
      e.currentTarget.getScreenCTM()!.inverse(),
    );
    return { x: p.x, y: -p.y };
  }
  function commitCorrection(index: number, target: Vec) {
    setPlaying(false);
    setProgress(1);
    setNotice("");
    engine.current?.correct({ index, target, reach });
  }
  function endCorrection(e: PointerEvent<SVGSVGElement>, canceled = false) {
    gesture.current.up(e);
    if (navigating.current) {
      if (gesture.current.count === 0) {
        navigating.current = false;
        panning.current = false;
      }
      return;
    }
    const d = drag.current;
    if (!d || d.id !== e.pointerId) return;
    drag.current = null;
    setGhost(null);
    if (e.currentTarget.hasPointerCapture(e.pointerId))
      e.currentTarget.releasePointerCapture(e.pointerId);
    const source = visiblePoints[d.index];
    if (
      !canceled &&
      d.moved &&
      (source.x !== d.target.x || source.y !== d.target.y)
    )
      commitCorrection(d.index, d.target);
  }
  const path = (points: Vec[]) => points.map((p) => `${p.x},${-p.y}`).join(" ");
  const targetPoints = state.fitPoints ?? visiblePoints;
  const outline = (preview = false) => (
    <svg
      ref={preview ? undefined : capture}
      viewBox={preview ? viewBox : inputViewBox}
      tabIndex={!preview && correcting ? 0 : undefined}
      aria-describedby={
        !preview && correcting ? `${title}-correction-note` : undefined
      }
      onKeyDown={
        !preview && correcting
          ? (e) => {
              const direction: Record<string, Vec> = {
                ArrowLeft: { x: -1, y: 0 },
                ArrowRight: { x: 1, y: 0 },
                ArrowUp: { x: 0, y: 1 },
                ArrowDown: { x: 0, y: -1 },
              };
              // Step through the closed outline, about 1% at a time; Shift is
              // finer, as with the arrows, down to a single point.
              const stepping = (
                { "[": -1, "]": 1, "{": -1, "}": 1 } as Record<string, number>
              )[e.key];
              if (stepping) {
                e.preventDefault();
                const step =
                  e.shiftKey || "{}".includes(e.key)
                    ? 1
                    : Math.max(1, Math.round(uniqueCount / 100));
                setSelected(
                  (pointIndex + stepping * step + uniqueCount) % uniqueCount,
                );
                return;
              }
              if (["+", "=", "-", "Home"].includes(e.key)) {
                e.preventDefault();
                if (e.key === "Home") fitOutlineView();
                else
                  setOutlineCamera((c) =>
                    zoomAbout(
                      c,
                      e.key === "-" ? 1 / 1.6 : 1.6,
                      outlineZoomRange,
                    ),
                  );
                return;
              }
              if (!direction[e.key]) return;
              e.preventDefault();
              if (state.pending || !chosen) return;
              const step = (1000 / inputScale) * (e.shiftKey ? 0.001 : 0.01),
                d = direction[e.key];
              commitCorrection(pointIndex, {
                x: chosen.x + step * d.x,
                y: chosen.y + step * d.y,
              });
            }
          : undefined
      }
      aria-hidden={preview || undefined}
      role={preview ? undefined : "img"}
      aria-label={
        preview
          ? undefined
          : (state.editing?.changed
              ? "Edited outline"
              : imported
                ? "Current curve outline"
                : "Draw one outline") +
            (correcting ? `, point ${pointIndex + 1} of ${uniqueCount}` : "")
      }
      className={preview ? "fit-reference" : "fit-capture"}
      data-testid={preview ? "fit-reference" : "stroke-reference"}
      data-closed={String(isClosed)}
      data-point-count={visiblePoints.length}
      data-selected-point={pointIndex}
      data-source={imported ? "curve" : "drawing"}
      style={
        {
          "--outline-unit": `${(0.015 * (1000 / 6)) / (preview ? framing.scale : inputScale)}px`,
          cursor: correcting ? "grab" : imported ? "default" : undefined,
          touchAction: correcting
            ? "none"
            : imported
              ? "pan-y pinch-zoom"
              : undefined,
        } as CSSProperties
      }
      onPointerDown={
        preview
          ? undefined
          : (e) => {
              if (e.button !== 0) return;
              if (correcting) {
                if (gesture.current.count >= 2) return;
                e.preventDefault();
                gesture.current.down(e);
                e.currentTarget.setPointerCapture(e.pointerId);
                if (gesture.current.count === 2) {
                  navigating.current = true;
                  panning.current = false;
                  if (drag.current) setSelected(drag.current.previousIndex);
                  drag.current = null;
                  setGhost(null);
                  return;
                }
                if (navigating.current || !chosen || drag.current) return;
                const target = correctionPoint(e);
                let index = 0,
                  distance = Infinity,
                  outlineDistance = Infinity;
                for (let i = 0; i < uniqueCount; i++) {
                  const p = visiblePoints[i],
                    d = Math.hypot(p.x - target.x, p.y - target.y);
                  if (d < distance) {
                    distance = d;
                    index = i;
                  }
                  // Hit the visible closed polygon, including long edges and
                  // its closing segment. Tolerance stays in CSS pixels.
                  const next = visiblePoints[(i + 1) % uniqueCount];
                  const dx = next.x - p.x,
                    dy = next.y - p.y,
                    length2 = dx * dx + dy * dy;
                  const u =
                    length2 === 0
                      ? 0
                      : Math.max(
                          0,
                          Math.min(
                            1,
                            ((target.x - p.x) * dx + (target.y - p.y) * dy) /
                              length2,
                          ),
                        );
                  outlineDistance = Math.min(
                    outlineDistance,
                    Math.hypot(
                      target.x - p.x - u * dx,
                      target.y - p.y - u * dy,
                    ),
                  );
                }
                quiet.quiet();
                e.currentTarget.focus({ preventScroll: true });
                const matrix = e.currentTarget.getScreenCTM()!;
                const pixelsPerUnit = Math.hypot(matrix.a, matrix.b);
                if (
                  outlineDistance * pixelsPerUnit >
                  (e.pointerType === "touch" ? 18 : 10)
                ) {
                  // Ownership is fixed at pointer-down; crossing the outline
                  // while panning must never start a correction.
                  panning.current = true;
                  navigating.current = true;
                  return;
                }
                if (state.pending) return;
                setSelected(index);
                drag.current = {
                  id: e.pointerId,
                  index,
                  previousIndex: pointIndex,
                  start: target,
                  target,
                  client: { x: e.clientX, y: e.clientY },
                  slop:
                    e.pointerType === "touch" ? dragSlop.touch : dragSlop.other,
                  moved: false,
                };
                e.currentTarget.setPointerCapture(e.pointerId);
              } else if (e.isPrimary && !imported && pointer.current === null) {
                e.preventDefault();
                reset();
                pointer.current = e.pointerId;
                setDrawing(true);
                e.currentTarget.setPointerCapture(e.pointerId);
                append(e);
              }
            }
      }
      onPointerMove={
        preview
          ? undefined
          : (e) => {
              if (correcting) {
                const motion = gesture.current.move(e);
                if (navigating.current) {
                  if (motion?.kind === "drag" && panning.current) {
                    e.preventDefault();
                    const { ratio } = outlinePage(e.currentTarget, 0, 0);
                    setOutlineCamera((c) => ({
                      ...c,
                      x: c.x + motion.dx * ratio,
                      y: c.y + motion.dy * ratio,
                    }));
                  } else if (motion?.kind === "pinch") {
                    e.preventDefault();
                    const { ratio, u, v } = outlinePage(
                      e.currentTarget,
                      motion.mid.x,
                      motion.mid.y,
                    );
                    setOutlineCamera((c) =>
                      zoomAbout(
                        {
                          ...c,
                          x: c.x + motion.dx * ratio,
                          y: c.y + motion.dy * ratio,
                        },
                        motion.scale,
                        outlineZoomRange,
                        u,
                        v,
                      ),
                    );
                  }
                  return;
                }
                const d = drag.current;
                if (d?.id !== e.pointerId) return;
                e.preventDefault();
                // A tap's tremor selects. Once crossed, the drag keeps the
                // whole distance, so the point stays under the pointer.
                if (
                  !d.moved &&
                  Math.hypot(e.clientX - d.client.x, e.clientY - d.client.y) <
                    d.slop
                )
                  return;
                d.moved = true;
                // Move relative to the vertex, so grabbing near it never jumps it.
                const p = correctionPoint(e),
                  source = visiblePoints[d.index];
                d.target = {
                  x: source.x + (p.x - d.start.x),
                  y: source.y + (p.y - d.start.y),
                };
                setGhost(d.target);
              } else if (!imported && pointer.current === e.pointerId) {
                e.preventDefault();
                append(e);
              }
            }
      }
      onPointerUp={
        preview
          ? undefined
          : (e) =>
              correcting ? endCorrection(e) : !imported && finishPointer(e)
      }
      onPointerCancel={
        preview
          ? undefined
          : (e) =>
              correcting
                ? endCorrection(e, true)
                : !imported && finishPointer(e, true)
      }
      onLostPointerCapture={
        preview
          ? undefined
          : (e) =>
              correcting
                ? endCorrection(e, true)
                : !imported && finishPointer(e, true)
      }
    >
      {isClosed ? (
        <polygon points={path(preview ? targetPoints : visiblePoints)} />
      ) : (
        <polyline points={path(preview ? targetPoints : visiblePoints)} />
      )}
      {!preview && correcting && chosen && (
        <>
          {state.editing?.changed && (
            <polygon className="fit-original" points={path(originalPoints)} />
          )}
          {ghost && (
            <line
              className="fit-edit-vector"
              x1={chosen.x}
              y1={-chosen.y}
              x2={ghost.x}
              y2={-ghost.y}
            />
          )}
          <circle
            className="fit-edit-handle"
            cx={(ghost ?? chosen).x}
            cy={-(ghost ?? chosen).y}
            r={9 / inputScale}
          />
        </>
      )}
    </svg>
  );
  return (
    <dialog
      ref={dialog}
      className="fourier-fit"
      aria-labelledby={title}
      onCancel={(e) => {
        e.preventDefault();
        finish();
      }}
      onPointerDown={() => {
        via.current = "pointer";
        quiet.onPointerDown();
      }}
      onKeyDownCapture={() => {
        via.current = "keyboard";
        quiet.onKeyDownCapture();
      }}
    >
      <div className="fit-heading">
        <div>
          <div className="eyebrow">DRAW A LOOP · FOURIER</div>
          <h2 id={title}>
            {imported
              ? "Your curve, made of circles"
              : "Your leaf, made of circles"}
          </h2>
        </div>
        <button ref={back} type="button" onClick={() => finish()}>
          Cancel drawing
        </button>
      </div>
      <p className="note">
        Draw your own outline or start with the example leaf, then close it. A
        new stroke replaces this draft. Or use your current base curve; your
        original study stays here until adoption.
      </p>
      <div className="fit-layout">
        <section className="fit-draft" aria-label="Outline input">
          <h3>
            {state.editing?.changed
              ? "1. Edited outline"
              : imported
                ? "1. Original curve"
                : "1. Draw or try an example"}
          </h3>
          {outline()}
          <div className="fit-canvas-tools">
            <div className="fit-source-action-row">
              <button
                type="button"
                aria-pressed={correcting}
                disabled={!state.editing || drawing}
                onClick={() => {
                  fitOutlineView();
                  setCorrecting(!correcting);
                  setPlaying(false);
                }}
              >
                Correct outline
              </button>
              <HelpToggle topic="outline correction" help={correctionHelp} />
            </div>
            {correcting && (
              <div
                className="fit-outline-zoom"
                role="group"
                aria-label="Outline view"
              >
                <SteadyButton
                  aria-label="Zoom in on outline"
                  title="Zoom in"
                  unavailable={outlineCamera.zoom >= outlineZoomRange[1]}
                  onClick={() =>
                    setOutlineCamera((c) => zoomAbout(c, 1.6, outlineZoomRange))
                  }
                >
                  +
                </SteadyButton>
                <SteadyButton
                  aria-label="Zoom out of outline"
                  title="Zoom out"
                  unavailable={outlineCamera.zoom <= outlineZoomRange[0]}
                  onClick={() =>
                    setOutlineCamera((c) =>
                      zoomAbout(c, 1 / 1.6, outlineZoomRange),
                    )
                  }
                >
                  −
                </SteadyButton>
                <button
                  type="button"
                  aria-label="Fit outline"
                  title="Fit outline"
                  onClick={fitOutlineView}
                >
                  Fit
                </button>
              </div>
            )}
          </div>
          <HelpText help={correctionHelp}>{fitCorrectionHelp}</HelpText>
          <div className="fit-actions">
            <div className="fit-source-action">
              <div className="fit-source-action-row">
                <button
                  type="button"
                  disabled={drawing || !sourceAvailable}
                  onClick={() => {
                    reset();
                    setImported(true);
                    engine.current?.useCurve(request.study);
                  }}
                >
                  Use current curve
                </button>
                <HelpToggle topic="current curve" help={sourceHelp} />
              </div>
              <HelpText help={sourceHelp}>{fitSourceHelp}</HelpText>
              {state.errorFrom === "source" && (
                <FitError message={state.error!} />
              )}
            </div>
            <button
              type="button"
              className="fit-example-action"
              disabled={drawing}
              onClick={() => reset(structuredClone(sampleLeaf))}
            >
              Use example leaf
            </button>
            <SteadyButton
              unavailable={drawing || (!points.length && !imported)}
              onClick={() => reset()}
            >
              Reset outline
            </SteadyButton>
            <SteadyButton
              unavailable={
                drawing || (imported ? !openSource : closed || !points.length)
              }
              onClick={() => {
                setNotice("");
                setPlaying(false);
                setProgress(1);
                if (imported) engine.current?.closeSource();
                else {
                  setClosed(true);
                  engine.current?.close(stroke.current);
                }
              }}
            >
              Close outline
            </SteadyButton>
            {openSource && (
              <p className="note" data-testid="open-source-note">
                This curve is open. Close outline joins its ends with a straight
                segment, then fits it.
              </p>
            )}
            {state.errorFrom === "close" && <FitError message={state.error!} />}
          </div>
          <div className="fit-correction">
            {state.editing && (
              <div
                className="fit-history"
                role="group"
                aria-label="Outline history"
              >
                <SteadyButton
                  unavailable={!state.editing.canUndo}
                  onClick={() => {
                    setPlaying(false);
                    setProgress(1);
                    engine.current?.undo();
                  }}
                >
                  Undo correction
                </SteadyButton>
                <SteadyButton
                  unavailable={!state.editing.canRedo}
                  onClick={() => {
                    setPlaying(false);
                    setProgress(1);
                    engine.current?.redo();
                  }}
                >
                  Redo correction
                </SteadyButton>
                <SteadyButton
                  unavailable={!state.editing.changed}
                  onClick={() => {
                    setPlaying(false);
                    setProgress(1);
                    engine.current?.restoreOriginal();
                  }}
                >
                  Restore original outline
                </SteadyButton>
              </div>
            )}
            {state.errorFrom === "correction" && (
              <FitError message={state.error!} />
            )}
            {correcting && (
              <>
                <p className="note" id={`${title}-correction-note`}>
                  Drag near the outline to correct; drag open space to pan.
                  Arrow keys nudge; [ and ] choose another point; Shift is
                  finer.
                </p>
                <div className="fit-outline-view-note">
                  <p className="note">
                    {viewHint} · {outlineCamera.zoom.toFixed(1)}×
                  </p>
                  <HelpToggle topic="outline view" help={outlineViewHelp} />
                </div>
                <HelpText help={outlineViewHelp}>{fitOutlineViewHelp}</HelpText>
                <Field label="Correction reach">
                  <select
                    value={reach}
                    onChange={(e) => setReach(+e.target.value)}
                  >
                    <option value="0.05">Narrow · 5%</option>
                    <option value="0.1">Medium · 10%</option>
                    <option value="0.2">Broad · 20%</option>
                  </select>
                </Field>
              </>
            )}
          </div>
          <p className="note">
            {visiblePoints.length.toLocaleString("en-US")} / 4,096 points ·{" "}
            {imported
              ? state.outline?.joined
                ? "Closed by a straight segment · original model units"
                : isClosed
                  ? "Closed source · original model units"
                  : openSource
                    ? "Open curve · original model units"
                    : state.pending
                      ? "Checking source closure and sampling"
                      : "Source not admitted"
              : closed
                ? "Closed by a straight segment"
                : "Open outline"}
          </p>
          {state.outline && (
            <p className="note" data-testid="source-sampling">
              Original sampled chord tolerance{" "}
              {state.outline.tolerance.toPrecision(4)} model units ·{" "}
              {state.outline.evaluations.toLocaleString("en-US")} evaluations.
              Arc-length fitting reparameterizes the source; sampling is an
              approximation, separate from the fit residuals.
              {state.editing?.changed &&
                " Corrections edit the polygon; this tolerance applies only to the original."}
            </p>
          )}
        </section>
        <section
          className="fit-result"
          aria-label="Fitted preview"
          aria-busy={state.pending}
        >
          <h3>2. Find the shape in circles</h3>
          <div className="fit-player">
            <div className="fit-art">
              {shown && (
                <Plot
                  id="fit-artwork"
                  result={shown.result}
                  config={shown.config}
                  layers={layers!}
                  dark={theme.dark}
                  scheme={theme.scheme}
                  length={0.8}
                  reset={0}
                  framing={framing}
                />
              )}
              {reference && isClosed && outline(true)}
            </div>
            <div
              className="fit-playback"
              role="group"
              aria-label="Preview playback"
            >
              <button
                type="button"
                disabled={!frame}
                onClick={() => {
                  if (playing) setPlaying(false);
                  else {
                    const p = progress === 1 ? 0 : progress;
                    setProgress(p);
                    clock.current = { time: performance.now(), progress: p };
                    setPlaying(true);
                  }
                }}
              >
                {playing ? "Pause circles" : "Play circles"}
              </button>
              <input
                aria-label="Preview position"
                type="range"
                min="0"
                max="1"
                step="0.001"
                value={progress}
                disabled={!frame}
                onChange={(e) => {
                  setPlaying(false);
                  setProgress(+e.target.value);
                }}
              />
            </div>
          </div>
          <Field label="Total terms" help={fitTermsHelp}>
            <select
              value={state.count}
              onChange={(e) => {
                setPlaying(false);
                setProgress(1);
                engine.current?.select(+e.target.value);
              }}
            >
              {Array.from({ length: 15 }, (_, i) => i + 2).map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
          </Field>
          {state.errorFrom === "terms" && <FitError message={state.error!} />}
          <label className="fit-reference-choice">
            <input
              type="checkbox"
              checked={reference}
              onChange={(e) => setReference(e.target.checked)}
            />{" "}
            Show target outline in preview
          </label>
          {state.fit && (
            <p className="note" data-testid="fit-residuals">
              Sample RMS {state.fit.rms.toPrecision(4)} · maximum{" "}
              {state.fit.maxResidual.toPrecision(4)} model units, at 1,024
              arc-length samples
              {state.fitEdited ? " of the edited outline" : ""}.
            </p>
          )}
          <p className="note">
            Finite sums smooth corners and can overshoot. Sample errors do not
            bound the gaps between samples or your intended smooth curve.
          </p>
        </section>
      </div>
      <p className="fit-feedback" role="status">
        {notice ||
          (openSource
            ? "Close the outline to fit this open curve."
            : state.fit
              ? "Preview and sample residuals show the last completed fit."
              : state.pending
                ? "Fitting the closed outline…"
                : "Draw your own shape or use the example leaf.")}
      </p>
      <div className="fit-notes">
        <p className="note">
          Adoption replaces your study with editable Fourier terms. A short
          offset is ready to show under Layers; reveal animation starts only
          when played.
        </p>
        <p className="note">
          Links and exports preserve the fitted study, never the raw outline.
          The reference and correction history are discarded when you leave.
        </p>
      </div>
      <footer className="fit-footer" aria-label="Use the fitted study">
        <p className="fit-adopt-copy">
          <strong>Make this your study</strong>
          <span id={`${title}-adopt-note`}>Replaces your current study.</span>
        </p>
        <button
          type="button"
          aria-describedby={`${title}-adopt-note`}
          aria-busy={state.pending && !!state.frame}
          disabled={!state.frame || state.pending || !!state.error || drawing}
          onClick={() => finish(true)}
        >
          Adopt fitted study
        </button>
      </footer>
    </dialog>
  );
}
