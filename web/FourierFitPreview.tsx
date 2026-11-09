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
  type ReactNode,
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
import {
  atHome,
  cameraMatching,
  drawingWindow,
  frameBox,
  paneView,
  pointsBox,
  usePaneCamera,
  viewBoxOf,
  type PaneFrame,
} from "./fit-view";
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
// How near the outline a press edits rather than pans, in CSS pixels.
const touchReach = 18,
  pointerReach = 10;
// One pane's zoom: the readout and buttons are the same on both, and there is
// a place for what each pane adds beside them.
function PaneZoom({
  noun,
  view,
  available,
  onFit,
  children,
}: {
  noun: string;
  view: ReturnType<typeof usePaneCamera>;
  available: boolean;
  onFit: () => void;
  children?: ReactNode;
}) {
  const title = noun.charAt(0).toUpperCase() + noun.slice(1);
  return (
    <div className="fit-pane-zoom" role="group" aria-label={`${title} view`}>
      {children}
      <span className="fit-zoom-readout" data-testid={`${noun}-zoom`}>
        {view.camera.zoom.toFixed(1)}×
      </span>
      <SteadyButton
        aria-label={`Zoom in on ${noun}`}
        title="Zoom in"
        unavailable={!available || !view.canZoomIn}
        onClick={() => view.zoomBy(1.6)}
      >
        +
      </SteadyButton>
      <SteadyButton
        aria-label={`Zoom out of ${noun}`}
        title="Zoom out"
        unavailable={!available || !view.canZoomOut}
        onClick={() => view.zoomBy(1 / 1.6)}
      >
        −
      </SteadyButton>
      <SteadyButton
        aria-label={`Fit ${noun}`}
        title={`Fit ${noun}`}
        unavailable={!available}
        onClick={onFit}
      >
        Fit
      </SteadyButton>
    </div>
  );
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
    capture = useRef<SVGSVGElement>(null),
    art = useRef<HTMLDivElement>(null);
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
  const [selected, setSelected] = useState(0),
    [reach, setReach] = useState(0.1);
  const navigating = useRef(false),
    panning = useRef(false);
  const inputFrame = useRef<PaneFrame | null>(null),
    previewFrame = useRef<PaneFrame>(drawingWindow);
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
  function reset(next: Vec[] = []) {
    engine.current?.cancel();
    stroke.current = next;
    setPoints(next);
    setClosed(false);
    setPlaying(false);
    setProgress(1);
    setNotice("");
    setImported(false);
    setSelected(0);
    drag.current = null;
    inputFrame.current = null;
    previewFrame.current = drawingWindow;
    input.home();
    preview.home();
    navigating.current = false;
    panning.current = false;
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
        : "Pinch or Ctrl+scroll to zoom · drag to pan",
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
  const openSource = imported && !!state.outline?.open;
  const isClosed = imported ? !!state.outline && !openSource : closed;
  // What a press on the input means. Until an outline exists it draws. Once one
  // is retained there is nothing left to draw: it pans, and a closed outline
  // can also be edited in place.
  const editable = !!state.editing;
  const navigable = editable || (imported && visiblePoints.length > 0);
  const hit = (svg: SVGSVGElement, x: number, y: number) => {
    const m = svg.getScreenCTM()!.inverse();
    const p = new DOMPoint(x, y).matrixTransform(m),
      target = { x: p.x, y: -p.y };
    let index = 0,
      distance = Infinity,
      outlineDistance = Infinity;
    for (let i = 0; i < uniqueCount; i++) {
      const a = visiblePoints[i],
        d = Math.hypot(a.x - target.x, a.y - target.y);
      if (d < distance) {
        distance = d;
        index = i;
      }
      // Hit the visible closed polygon, including long edges and its closing
      // segment. Tolerance stays in CSS pixels.
      const next = visiblePoints[(i + 1) % uniqueCount];
      const dx = next.x - a.x,
        dy = next.y - a.y,
        length2 = dx * dx + dy * dy;
      const u =
        length2 === 0
          ? 0
          : Math.max(
              0,
              Math.min(
                1,
                ((target.x - a.x) * dx + (target.y - a.y) * dy) / length2,
              ),
            );
      outlineDistance = Math.min(
        outlineDistance,
        Math.hypot(target.x - a.x - u * dx, target.y - a.y - u * dy),
      );
    }
    const forward = svg.getScreenCTM()!;
    return {
      index,
      target,
      pixels: outlineDistance * Math.hypot(forward.a, forward.b),
    };
  };
  const input = usePaneCamera(capture, () => capture.current, {
    active: navigable,
    claimsTouch: (x, y) =>
      editable &&
      !!capture.current &&
      hit(capture.current, x, y).pixels <= touchReach,
  });
  const preview = usePaneCamera(
    art,
    () => art.current?.querySelector("svg") ?? null,
    { active: !!frame },
  );
  const targetPoints = state.fitPoints ?? visiblePoints;
  // Each pane fits its own content and is centered on it. The input keeps its
  // frame through edits, so a point stays under the pointer; Fit takes a new
  // one. A fitted preview follows each completed fit, until it has been moved.
  if (!inputFrame.current && navigable)
    inputFrame.current = frameBox(pointsBox(visiblePoints));
  if (!state.pending && state.fit && atHome(preview.camera))
    previewFrame.current = frameBox(
      pointsBox(
        [...targetPoints, ...originalPoints],
        state.fit.previewBounds ?? undefined,
      ),
    );
  const inputView = paneView(inputFrame.current ?? drawingWindow, input.camera);
  const previewView = paneView(previewFrame.current, preview.camera);
  function fitInput() {
    inputFrame.current = navigable ? frameBox(pointsBox(visiblePoints)) : null;
    drag.current = null;
    setGhost(null);
    navigating.current = false;
    panning.current = false;
    input.home();
  }
  const inputScale = inputView.scale;

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
    input.gesture.current.up(e);
    if (navigating.current) {
      if (input.gesture.current.count === 0) {
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
  const outline = (reference = false) => (
    <svg
      ref={reference ? undefined : capture}
      viewBox={viewBoxOf(reference ? previewView : inputView)}
      tabIndex={!reference && navigable ? 0 : undefined}
      aria-describedby={
        !reference && editable ? `${title}-correction-note` : undefined
      }
      onKeyDown={
        !reference && navigable
          ? (e) => {
              // Leave browser shortcuts alone, such as Cmd+[ for Back. Only the
              // brackets allow Alt, since some layouts type them with Option or
              // AltGr; Alt+Left is Back elsewhere.
              if (e.metaKey || (e.ctrlKey && !e.altKey)) return;
              const direction: Record<string, Vec> = {
                ArrowLeft: { x: -1, y: 0 },
                ArrowRight: { x: 1, y: 0 },
                ArrowUp: { x: 0, y: 1 },
                ArrowDown: { x: 0, y: -1 },
              };
              // Step through the closed outline, about 1% at a time; Shift is
              // finer, as with the arrows, down to a single point.
              const stepping =
                editable &&
                (
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
              if (e.altKey) return;
              if (["+", "=", "-", "Home"].includes(e.key)) {
                e.preventDefault();
                if (e.key === "Home") fitInput();
                else input.zoomBy(e.key === "-" ? 1 / 1.6 : 1.6);
                return;
              }
              if (!editable || !direction[e.key]) return;
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
      aria-hidden={reference || undefined}
      role={reference ? undefined : "img"}
      aria-label={
        reference
          ? undefined
          : (state.editing?.changed
              ? "Edited outline"
              : imported
                ? "Current curve outline"
                : "Draw one outline") +
            (editable ? `, point ${pointIndex + 1} of ${uniqueCount}` : "")
      }
      className={reference ? "fit-reference" : "fit-capture"}
      data-testid={reference ? "fit-reference" : "stroke-reference"}
      data-closed={String(isClosed)}
      data-point-count={visiblePoints.length}
      data-selected-point={pointIndex}
      data-source={imported ? "curve" : "drawing"}
      style={
        {
          "--outline-unit": `${(0.015 * (1000 / 6)) / (reference ? previewView.scale : inputScale)}px`,
          cursor: navigable ? "grab" : undefined,
          touchAction: navigable
            ? atHome(input.camera)
              ? "pan-y"
              : "none"
            : undefined,
        } as CSSProperties
      }
      onPointerDown={
        reference
          ? undefined
          : (e) => {
              if (e.button !== 0) return;
              if (navigable) {
                const gesture = input.gesture.current;
                if (gesture.count >= 2) return;
                e.preventDefault();
                gesture.down(e);
                e.currentTarget.setPointerCapture(e.pointerId);
                if (gesture.count === 2) {
                  navigating.current = true;
                  panning.current = false;
                  if (drag.current) setSelected(drag.current.previousIndex);
                  drag.current = null;
                  setGhost(null);
                  return;
                }
                if (navigating.current || drag.current) return;
                quiet.quiet();
                e.currentTarget.focus({ preventScroll: true });
                const { index, target, pixels } = hit(
                  e.currentTarget,
                  e.clientX,
                  e.clientY,
                );
                const touch = e.pointerType === "touch";
                if (!editable || pixels > (touch ? touchReach : pointerReach)) {
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
                  slop: touch ? dragSlop.touch : dragSlop.other,
                  moved: false,
                };
              } else if (!imported && e.isPrimary && pointer.current === null) {
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
        reference
          ? undefined
          : (e) => {
              if (navigable) {
                const motion = input.gesture.current.move(e);
                if (navigating.current) {
                  if (motion) e.preventDefault();
                  input.follow(motion, e.currentTarget, panning.current);
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
              } else if (pointer.current === e.pointerId) {
                e.preventDefault();
                append(e);
              }
            }
      }
      onPointerUp={
        reference
          ? undefined
          : (e) => (navigable ? endCorrection(e) : finishPointer(e))
      }
      onPointerCancel={
        reference
          ? undefined
          : (e) => (navigable ? endCorrection(e, true) : finishPointer(e, true))
      }
      onLostPointerCapture={
        reference
          ? undefined
          : (e) => (navigable ? endCorrection(e, true) : finishPointer(e, true))
      }
    >
      {isClosed ? (
        <polygon points={path(reference ? targetPoints : visiblePoints)} />
      ) : (
        <polyline points={path(reference ? targetPoints : visiblePoints)} />
      )}
      {!reference && editable && chosen && (
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
      onPointerDownCapture={() => {
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
        Draw your own outline or start with the example leaf, then close it. Or
        use your current base curve; your original study stays here until
        adoption.
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
            <div className="fit-reach">
              <label htmlFor={`${title}-reach`}>Correction reach</label>
              <select
                id={`${title}-reach`}
                value={reach}
                disabled={!editable}
                onChange={(e) => setReach(+e.target.value)}
              >
                <option value="0.05">Narrow · 5%</option>
                <option value="0.1">Medium · 10%</option>
                <option value="0.2">Broad · 20%</option>
              </select>
              <HelpToggle topic="outline correction" help={correctionHelp} />
            </div>
            <PaneZoom
              noun="outline"
              view={input}
              available={navigable}
              onFit={fitInput}
            />
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
            {editable && (
              <p className="note" id={`${title}-correction-note`}>
                Drag near the outline to correct; drag open space to pan. Arrow
                keys nudge; [ and ] choose another point; Shift is finer.
              </p>
            )}
            {navigable && (
              <div className="fit-outline-view-note">
                <p className="note">{viewHint}</p>
                <HelpToggle topic="outline view" help={outlineViewHelp} />
              </div>
            )}
            <HelpText help={outlineViewHelp}>{fitOutlineViewHelp}</HelpText>
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
            <div
              ref={art}
              className="fit-art"
              role="group"
              aria-label="Fitted preview view"
              tabIndex={frame ? 0 : undefined}
              style={{
                touchAction: atHome(preview.camera) ? "pan-y" : "none",
                cursor: frame ? "grab" : undefined,
              }}
              onKeyDown={(e) => {
                if (!frame || e.metaKey || e.ctrlKey || e.altKey) return;
                const pan: Record<string, [number, number]> = {
                  ArrowLeft: [40, 0],
                  ArrowRight: [-40, 0],
                  ArrowUp: [0, 40],
                  ArrowDown: [0, -40],
                };
                if (e.key === "Home") preview.home();
                else if (e.key === "+" || e.key === "=") preview.zoomBy(1.6);
                else if (e.key === "-") preview.zoomBy(1 / 1.6);
                else if (pan[e.key])
                  preview.setCamera((c) => ({
                    ...c,
                    x: c.x + pan[e.key][0],
                    y: c.y + pan[e.key][1],
                  }));
                else return;
                e.preventDefault();
              }}
              onPointerDown={(e) => {
                if (!frame || e.button !== 0) return;
                preview.gesture.current.down(e);
                e.currentTarget.setPointerCapture(e.pointerId);
                quiet.quiet();
              }}
              onPointerMove={(e) => {
                const svg = art.current?.querySelector("svg");
                const motion = preview.gesture.current.move(e);
                if (motion && svg) {
                  e.preventDefault();
                  preview.follow(motion, svg);
                }
              }}
              onPointerUp={(e) => preview.gesture.current.up(e)}
              onPointerCancel={(e) => preview.gesture.current.up(e)}
              onLostPointerCapture={(e) => preview.gesture.current.up(e)}
            >
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
                  framing={previewView}
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
          <div className="fit-canvas-tools fit-preview-tools">
            <SteadyButton
              className="fit-match"
              title="Show the same part of the plane as the outline"
              unavailable={!frame || !navigable}
              onClick={() =>
                preview.setCamera(
                  cameraMatching(previewFrame.current, inputView),
                )
              }
            >
              Match outline
            </SteadyButton>
            <PaneZoom
              noun="preview"
              view={preview}
              available={!!frame}
              onFit={preview.home}
            />
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
