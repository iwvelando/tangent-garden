import {
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent,
  type CSSProperties,
} from "react";
import { EngineClient } from "./engine-client";
import {
  FourierFitSession,
  curveFitUnavailable,
  fittedStudy,
  fitTermsHelp,
  fitSourceHelp,
  maxStrokePoints,
  sampleLeaf,
  strokeWindow,
  type FitState,
} from "./fourier-fit";
import type { FourierFitRequest } from "./FourierFitContext";
import type { JourneyVia } from "./JourneyContext";
import { useQuietFocus } from "./quiet-focus";
import { useTheme } from "./useTheme";
import { Plot } from "./Plot";
import { reveal } from "./animation";
import { Field, HelpToggle, HelpText, useHelp } from "./Field";
import type { PlanarStudy } from "./planar-link";
import type { Vec } from "./types";
import "./fourier-fit.css";

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
  const sourceHelp = useHelp();
  const dialog = useRef<HTMLDialogElement>(null),
    back = useRef<HTMLButtonElement>(null);
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
  function reset(next: Vec[] = []) {
    engine.current?.cancel();
    stroke.current = next;
    setPoints(next);
    setClosed(false);
    setPlaying(false);
    setProgress(1);
    setNotice("");
    setImported(false);
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
  const frame = state.frame;
  const unavailable = curveFitUnavailable(request.study);
  const visiblePoints = imported ? (state.outline?.points ?? []) : points;
  const isClosed = imported ? !!state.outline : closed;
  // Keep imported coordinates untouched. One frame includes the entire
  // source and all 16 ranked circles, independent of selection/playback.
  const framing = useMemo(() => {
    if (!imported || !state.outline)
      return { cx: 0, cy: 0, scale: 1000 / 6, span: 6 };
    const r = Math.max(
      state.outline.previewRadius,
      ...state.outline.points.map((p) =>
        Math.max(Math.abs(p.x), Math.abs(p.y)),
      ),
    );
    return { cx: 0, cy: 0, scale: 760 / (2.2 * r), span: 2.2 * r };
  }, [imported, state.outline]);
  const viewBox = `${framing.cx - 500 / framing.scale} ${-framing.cy - 380 / framing.scale} ${1000 / framing.scale} ${760 / framing.scale}`;
  const layers = useMemo(
    () => (state.fit ? fittedStudy(state.fit.terms).layers : undefined),
    [state.fit],
  );
  const shown =
    frame &&
    (progress < 1
      ? { ...frame, result: reveal(frame.result, progress) }
      : frame);
  const path = visiblePoints.map((p) => `${p.x},${-p.y}`).join(" ");
  const outline = (preview = false) => (
    <svg
      viewBox={viewBox}
      aria-hidden={preview || undefined}
      role={preview ? undefined : "img"}
      aria-label={
        preview
          ? undefined
          : imported
            ? "Current curve outline"
            : "Draw one outline"
      }
      className={preview ? "fit-reference" : "fit-capture"}
      data-testid={preview ? "fit-reference" : "stroke-reference"}
      data-closed={String(isClosed)}
      data-point-count={visiblePoints.length}
      data-source={imported ? "curve" : "drawing"}
      style={
        {
          "--outline-unit": `${(0.015 * (1000 / 6)) / framing.scale}px`,
          cursor: imported ? "default" : undefined,
          touchAction: imported ? "pan-y pinch-zoom" : undefined,
        } as CSSProperties
      }
      onPointerDown={
        preview || imported
          ? undefined
          : (e) => {
              if (!e.isPrimary || e.button !== 0 || pointer.current !== null)
                return;
              e.preventDefault();
              reset();
              pointer.current = e.pointerId;
              setDrawing(true);
              e.currentTarget.setPointerCapture(e.pointerId);
              append(e);
            }
      }
      onPointerMove={
        preview || imported
          ? undefined
          : (e) => {
              if (pointer.current === e.pointerId) {
                e.preventDefault();
                append(e);
              }
            }
      }
      onPointerUp={preview || imported ? undefined : (e) => finishPointer(e)}
      onPointerCancel={
        preview || imported ? undefined : (e) => finishPointer(e, true)
      }
      onLostPointerCapture={
        preview || imported ? undefined : (e) => finishPointer(e, true)
      }
    >
      {isClosed ? <polygon points={path} /> : <polyline points={path} />}
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
        new stroke replaces this draft. Or use your current closed base curve;
        your original study stays here until adoption.
      </p>
      <div className="fit-layout">
        <section className="fit-draft" aria-label="Outline input">
          <h3>
            {imported ? "1. Original curve" : "1. Draw or try an example"}
          </h3>
          {outline()}
          <div className="fit-actions">
            <div className="fit-source-action">
              <div className="fit-source-action-row">
                <button
                  type="button"
                  disabled={drawing || !!unavailable}
                  aria-describedby={
                    unavailable ? `${title}-source-note` : undefined
                  }
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
              {unavailable && (
                <p className="note" id={`${title}-source-note`}>
                  {unavailable}
                </p>
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
            <button
              type="button"
              disabled={drawing || (!points.length && !imported)}
              onClick={() => reset()}
            >
              Reset outline
            </button>
            <button
              type="button"
              disabled={drawing || imported || closed || !points.length}
              onClick={() => {
                setClosed(true);
                setNotice("");
                setPlaying(false);
                setProgress(1);
                engine.current?.close(stroke.current);
              }}
            >
              Close outline
            </button>
          </div>
          <p className="note">
            {visiblePoints.length.toLocaleString("en-US")} / 4,096 points ·{" "}
            {imported
              ? isClosed
                ? "Closed source · original model units"
                : state.pending
                  ? "Checking source closure and sampling"
                  : "Source not admitted"
              : closed
                ? "Closed by a straight segment"
                : "Open outline"}
          </p>
          {state.outline && (
            <p className="note" data-testid="source-sampling">
              Sampled chord tolerance {state.outline.tolerance.toPrecision(4)}{" "}
              model units · {state.outline.evaluations.toLocaleString("en-US")}{" "}
              evaluations. Arc-length fitting reparameterizes the source;
              sampling is an approximation, separate from the fit residuals.
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
                disabled={!frame || state.pending}
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
                disabled={!frame || state.pending}
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
          <label className="fit-reference-choice">
            <input
              type="checkbox"
              checked={reference}
              onChange={(e) => setReference(e.target.checked)}
            />{" "}
            Show original outline in preview
          </label>
          {state.fit && (
            <p className="note" data-testid="fit-residuals">
              Sample RMS {state.fit.rms.toPrecision(4)} · maximum{" "}
              {state.fit.maxResidual.toPrecision(4)} model units, at 1,024
              arc-length samples.
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
          state.error ||
          (state.pending
            ? "Fitting the closed outline…"
            : state.fit
              ? "Fit ready. Play the circles or adopt this study."
              : "Draw your own shape or use the example leaf.")}
      </p>
      <div className="fit-notes">
        <p className="note">
          Adoption replaces your study with editable Fourier terms. A short
          offset is ready to show under Layers; reveal animation starts only
          when played.
        </p>
        <p className="note">
          Links and exports preserve the fitted study, never the raw stroke. The
          reference is discarded on adoption.
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
          disabled={!state.frame || state.pending || !!state.error || drawing}
          onClick={() => finish(true)}
        >
          Adopt fitted study
        </button>
      </footer>
    </dialog>
  );
}
