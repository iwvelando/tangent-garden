import { useEffect, useId, useMemo, useRef, useState } from "react";
import { EngineClient } from "../engine-client";
import { Field, HelpText, HelpToggle, useHelp } from "../Field";
import type { JourneyVia } from "../JourneyContext";
import { useQuietFocus } from "../quiet-focus";
import { useTheme } from "../useTheme";
import type { HarmonicFitEntry } from "./HarmonicFitContext";
import JourneyDrawing from "./JourneyDrawing";
import {
  harmonicEllipseWords,
  HarmonicFitSession,
  harmonicFitOpeningView,
  harmonicFitParameterHelp,
  harmonicFitStudy,
  harmonicFitTermsHelp,
  type HarmonicFitState,
  type HarmonicParameter,
} from "./harmonic-fit";
import type { SpatialStudy } from "./link";
import type { Frame } from "./types";
import "../fourier-fit.css";
import "../journey.css";
import "./harmonic-fit.css";

const short = (x: number) =>
  x === 0 ? "0" : Math.abs(x) < 1e-3 ? x.toExponential(1) : x.toPrecision(3);

// A note that varies with the fit, holding the height of its longest wording
// at any width, so that nothing beside or below it moves as it changes.
function SteadyNote({
  longest,
  testid,
  children,
}: {
  longest: string;
  testid: string;
  children: React.ReactNode;
}) {
  return (
    <p className="note harmonic-fit-steady">
      <span aria-hidden="true">{longest}</span>
      <span data-testid={testid}>{children}</span>
    </p>
  );
}

// The source notebook stays mounted and inert beneath this excursion, so its
// raw drafts and camera survive by construction.
export default function HarmonicFitPreview({
  request,
  onReturn,
  onAdopt,
}: {
  request: HarmonicFitEntry;
  onReturn: (via: JourneyVia) => void;
  onAdopt: (study: SpatialStudy, via: JourneyVia) => void;
}) {
  const theme = useTheme(),
    title = useId();
  const termsHelp = useHelp(),
    parameterHelp = useHelp();
  const dialog = useRef<HTMLDialogElement>(null),
    back = useRef<HTMLButtonElement>(null);
  const quiet = useQuietFocus(dialog),
    via = useRef(request.via);
  const session = useRef<HarmonicFitSession | null>(null);
  const client = useRef<EngineClient | null>(null);
  const [state, setState] = useState<HarmonicFitState>({
    count: 8,
    parameter: "source",
    pending: true,
  });
  const [frame, setFrame] = useState<Frame | null>(null),
    [renderError, setRenderError] = useState(""),
    [showSource, setShowSource] = useState(true),
    [showVectors, setShowVectors] = useState(true),
    [computing, setComputing] = useState(false);
  useEffect(() => {
    client.current = new EngineClient();
    session.current = new HarmonicFitSession(
      () => new EngineClient(),
      request.study.config,
      setState,
    );
    if (request.via === "pointer") quiet.onPointerDown();
    dialog.current!.showModal();
    quiet.quiet();
    back.current!.focus();
    return () => {
      session.current?.cancel();
      client.current?.dispose();
      client.current = null;
    };
  }, []);
  const fit = state.fit;
  const curveKey = fit ? JSON.stringify(fit.curve) : "";
  // Fixed for the session by the source, whichever terms are shown.
  const opening = useMemo(
    () => (state.outline ? harmonicFitOpeningView(state.outline) : null),
    [state.outline],
  );
  const study = useMemo(
    () => (fit && opening ? harmonicFitStudy(fit.curve, opening) : null),
    [curveKey, opening],
  );
  // Layers change the picture, not the computation or the adopted study's
  // geometry, so toggling one need not compute a new frame.
  const drawn = useMemo(
    () =>
      study && {
        ...study,
        layers: { ...study.layers, vectors: showVectors },
      },
    [study, showVectors],
  );
  const bounds = fit?.bounds;
  useEffect(() => {
    if (!study) {
      setFrame(null);
      return;
    }
    let current = true;
    setComputing(true);
    client.current
      ?.computeSpatial(study.config)
      .then((value) => {
        if (!current) return;
        setFrame(value);
        setComputing(false);
      })
      .catch((e: Error) => {
        if (!current) return;
        setRenderError(e.message);
        setComputing(false);
      });
    return () => {
      current = false;
    };
  }, [study]);
  // One frame for every term count, with the source beneath the fit. Both are
  // transient: an adopted study, its links and exports carry neither.
  const shown = useMemo<Frame | null>(
    () =>
      frame && bounds
        ? {
            ...frame,
            result: {
              ...frame.result,
              bounds,
              ...(showSource && state.outline
                ? { fitSource: state.outline }
                : {}),
            },
          }
        : null,
    [frame, bounds, showSource, state.outline],
  );
  const pending = state.pending || computing;
  const finish = (adopted?: SpatialStudy) => {
    session.current?.cancel();
    if (adopted) onAdopt(adopted, via.current);
    else onReturn(via.current);
  };
  const exact = fit && fit.maxResidual <= 1e-11 * fit.extent;
  const available = fit?.available ?? 8;
  const options = Array.from({ length: available }, (_, i) => i + 1);
  const firstPlane = fit?.ellipses.find((e) => e.minor > 1e-9 * e.major);
  return (
    <dialog
      ref={dialog}
      className="fourier-fit harmonic-fit"
      aria-labelledby={title}
      data-pending={pending}
      data-count={fit ? fit.curve.terms.length : undefined}
      data-fit={fit ? JSON.stringify(fit) : undefined}
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
          <div className="eyebrow">FIT A CURVE · SPATIAL HARMONICS</div>
          <h2 id={title}>Your curve, as turning vectors</h2>
        </div>
        <button ref={back} type="button" onClick={() => finish()}>
          Back to your study
        </button>
      </div>
      <div className="harmonic-fit-layout">
        <section className="harmonic-fit-art" aria-label="Fitted curve">
          {drawn && shown ? (
            <JourneyDrawing
              study={drawn}
              frame={shown}
              pending={pending}
              slow={false}
              requested={0}
              revision={curveKey}
              invalid={false}
              error={renderError || undefined}
              onError={setRenderError}
              client={client}
              dark={theme.dark}
              scheme={theme.scheme}
              viewControls
            />
          ) : (
            <div className="harmonic-fit-empty">
              {state.error ? (
                <p className="field-error" role="alert">
                  {state.error}
                </p>
              ) : (
                <p className="note" role="status">
                  Fitting the source…
                </p>
              )}
            </div>
          )}
        </section>
        <section className="harmonic-fit-choice" aria-label="Fit">
          <Field label="Terms" help={harmonicFitTermsHelp}>
            <select
              value={Math.min(state.count, available)}
              disabled={!fit}
              onChange={(e) => {
                setRenderError("");
                session.current?.choose(+e.target.value);
              }}
            >
              {options.map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
          </Field>
          <SteadyNote
            testid="fit-error"
            longest="Sample error: RMS 0.00123, largest 0.00123, 0.00123% of the source's 1.00e+5 diagonal. Between samples, proved within 0.00123 of the source's polygon."
          >
            {fit &&
              (exact
                ? "These terms reproduce all 1,024 samples to rounding."
                : `Sample error: RMS ${short(fit.rms)}, largest ${short(fit.maxResidual)}, ${short((100 * fit.maxResidual) / fit.extent)}% of the source's ${short(fit.extent)} diagonal.`)}
            {fit?.continuousBound
              ? ` Between samples, proved within ${short(fit.continuousBound)} of the source's polygon.`
              : ""}
          </SteadyNote>
          <fieldset className="harmonic-fit-parameter">
            <legend>
              Sampled by
              <HelpToggle
                topic="how the source is sampled"
                help={parameterHelp}
              />
            </legend>
            <div className="harmonic-fit-options">
              {(
                [
                  ["source", "Source parameter"],
                  ["arc-length", "Even pace (arc length)"],
                ] as [HarmonicParameter, string][]
              ).map(([value, label]) => (
                <label key={value}>
                  <input
                    type="radio"
                    name={`${title}-parameter`}
                    checked={state.parameter === value}
                    onChange={() => session.current?.parameterize(value)}
                  />
                  {label}
                </label>
              ))}
            </div>
            <HelpText help={parameterHelp}>{harmonicFitParameterHelp}</HelpText>
          </fieldset>
        </section>
        <section className="harmonic-fit-details" aria-label="Terms and layers">
          <label className="fit-reference-choice">
            <input
              type="checkbox"
              checked={showSource}
              onChange={(e) => setShowSource(e.target.checked)}
            />
            Show the source beneath the fit
          </label>
          <label className="fit-reference-choice">
            <input
              type="checkbox"
              checked={showVectors}
              onChange={(e) => setShowVectors(e.target.checked)}
            />
            Vector sums
          </label>
          <p className="note">
            Each term is one vector turning around its own ellipse, in its own
            plane. Chained tip to tail, they add up to the curve.
          </p>
          <SteadyNote
            testid="fit-remainder"
            longest="These are all of this source's terms up to frequency 256; the error is detail finer than that."
          >
            {fit &&
              (fit.curve.terms.length < fit.available
                ? `${fit.available - fit.curve.terms.length} more ${fit.available - fit.curve.terms.length === 1 ? "term is" : "terms are"} available.`
                : fit.available === 8
                  ? "Eight is the budget; smaller terms beyond it stay in the error."
                  : exact
                    ? "These are all of this source's terms up to frequency 256."
                    : "These are all of this source's terms up to frequency 256; the error is detail finer than that.")}
          </SteadyNote>
          {fit && (
            <ol className="harmonic-fit-terms">
              {fit.curve.terms.map((term, i) => (
                <li key={term.frequency} data-testid="fit-term">
                  <span>ω = {term.frequency}</span>{" "}
                  {harmonicEllipseWords(fit.ellipses[i], firstPlane)}
                </li>
              ))}
            </ol>
          )}
        </section>
      </div>
      <footer className="fit-footer" aria-label="Use the fitted study">
        <p className="fit-adopt-copy">
          <strong>Make this your study</strong>
          <span id={`${title}-adopt-note`}>
            Replaces your study with these editable terms. The source outline is
            not kept.
          </span>
        </p>
        <button
          type="button"
          aria-describedby={`${title}-adopt-note`}
          disabled={!drawn || pending || !!state.error}
          onClick={() => drawn && finish(drawn)}
        >
          Adopt fitted study
        </button>
      </footer>
    </dialog>
  );
}
