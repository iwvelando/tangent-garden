import {
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
} from "react";
import { AnimationPanel } from "./AnimationPanel";
import { getIn } from "./config-path";
import { EngineClient, EngineError } from "./engine-client";
import { Field, FieldErrorContext } from "./Field";
import {
  journeyStudy,
  journeyTitle,
  type Journey,
  type JourneyStep,
  type JourneyAdoption,
} from "./journeys";
import type { SpatialStudy } from "./spatial/link";
import type { TesseractStudy } from "./tesseract/link";
import type { Frame as SpatialFrame } from "./spatial/types";
import type {
  Result as ShapeResult,
  Config as ShapeConfig,
} from "./tesseract/types";
import { Plot } from "./Plot";
import type { PlanarStudy } from "./planar-link";
import { probeSample, sampleProbe } from "./planar-probe";
import { ScalarInput, ScalarStatus, type ScalarState } from "./ScalarInput";
import { useQuietFocus } from "./quiet-focus";
import { useTheme } from "./useTheme";
import type { AnimationView, Viewport } from "./animation";
import type { Frame } from "./types";
import "./journey.css";

// A wait shorter than this changes nothing visible, so a quick step never
// flashes disabled buttons or a busy message.
const graceMs = 300;
export type ShapeFrame = { config: ShapeConfig; result: ShapeResult };
type Outcome = {
  frame?: Frame;
  spatial?: SpatialFrame;
  shape?: ShapeFrame;
  error?: string;
  field?: string;
};
// A step's calculation, by its example and the value of an edited field. A
// probe edit needs none: the probe is read from the example's result.
const calculation = (i: number, step: JourneyStep, edit?: number) =>
  step.control.kind === "scalar" && edit !== undefined
    ? `${i}:${edit}`
    : `${i}`;
const short = (v: number) => String(Number(v.toPrecision(4)));

// One disposable engine for the entire excursion. At most one calculation
// runs: the requested step first, then each other example nearest it, once.
// A study is fixed by its example and edit, so each result stays valid until
// dismissal and returning to a step is immediate; only each step's latest
// edit is kept beside its example.
export function JourneyPreview({
  journey,
  onReturn,
  onOpen,
  via,
}: {
  journey: Journey;
  onReturn: (via: "keyboard" | "pointer") => void;
  onOpen: (adoption: JourneyAdoption, via: "keyboard" | "pointer") => void;
  via: "keyboard" | "pointer";
}) {
  const theme = useTheme();
  const dialog = useRef<HTMLDialogElement>(null);
  const back = useRef<HTMLButtonElement>(null);
  const quiet = useQuietFocus(dialog);
  const title = useId();
  const interaction = useRef(via);
  const steps = journey.steps;
  const [index, setIndex] = useState(0);
  // Each step's edited control, as a resolved value; absent while unedited.
  // The field's own value follows an invalid entry (NaN), as the notebook's
  // configuration does, while the drawing and adoption keep the last valid
  // edit. Edits live only as long as the excursion.
  const [entered, setEntered] = useState<Record<number, number>>({});
  const [edits, setEdits] = useState<Record<number, number>>({});
  const outcomes = useRef(new Map<string, Outcome>());
  // Load the renderer alongside its first calculation, before presenting
  // that step. A Suspense fallback would hide the completed drawing during
  // a cross-notebook transition, separating it from its retained prose.
  const drawings = useRef<{
    spatial?: typeof import("./spatial/JourneyDrawing").default;
    shape?: typeof import("./tesseract/JourneyDrawing").default;
  }>({});
  const SpatialJourneyDrawing = drawings.current.spatial;
  const ShapeJourneyDrawing = drawings.current.shape;
  const [, redraw] = useReducer((n: number) => n + 1, 0);
  const client = useRef<EngineClient | null>(null);
  const key = calculation(index, steps[index], edits[index]);
  const requested = useRef({ index, key, edit: edits[index] });
  requested.current = { index, key, edit: edits[index] };
  const pump = useRef<() => void>(() => {});
  useEffect(() => {
    const engine = new EngineClient();
    client.current = engine;
    let live = true;
    let working = false;
    pump.current = () => {
      if (!live || working) return;
      const known = outcomes.current;
      const from = requested.current;
      const want = !known.has(from.key)
        ? from
        : steps
            .map((step, i) => ({ index: i, key: calculation(i, step) }))
            .filter((s) => !known.has(s.key))
            .sort((a, b) => {
              const d =
                Math.abs(a.index - from.index) - Math.abs(b.index - from.index);
              return d || b.index - a.index;
            })[0];
      if (!want) return;
      working = true;
      const step = steps[want.index];
      const edit = want.key === from.key ? from.edit : undefined;
      const record = (outcome: Outcome) => {
        if (!live) return;
        // A step keeps its example and its latest edit.
        for (const k of known.keys())
          if (k.startsWith(`${want.index}:`)) known.delete(k);
        known.set(want.key, outcome);
        redraw();
      };
      const compute = async (): Promise<Outcome> => {
        if (step.notebook === "2d") {
          const study = journeyStudy(step, edit);
          return {
            frame: await engine.compute(study.config, study.bounds, {
              diagnostics: study.probe.enabled,
            }),
          };
        }
        if (step.notebook === "3d") {
          const study = journeyStudy(step, edit) as SpatialStudy;
          const [drawing, spatial] = await Promise.all([
            import("./spatial/JourneyDrawing"),
            engine.computeSpatial(study.config),
          ]);
          drawings.current.spatial = drawing.default;
          return { spatial };
        }
        const study = journeyStudy(step, edit) as TesseractStudy;
        const [drawing, result] = await Promise.all([
          import("./tesseract/JourneyDrawing"),
          engine.tesseract(study.config),
        ]);
        drawings.current.shape = drawing.default;
        return { shape: { config: study.config, result } };
      };
      void compute()
        .then(record, (error: Error) =>
          record({
            error: error.message,
            field: error instanceof EngineError ? error.field : undefined,
          }),
        )
        .finally(() => {
          working = false;
          pump.current();
        });
    };
    pump.current();
    return () => {
      live = false;
      engine.dispose();
    };
  }, []);
  useEffect(() => {
    pump.current();
  }, [key]);
  // Each step's control resolves its text through the notebook's own scalar
  // path, reporting pending and invalid entries for that step alone.
  const [scalars, setScalars] = useState<
    Record<number, Record<string, ScalarState>>
  >({});
  const statuses = useMemo(
    () =>
      steps.map((_, i) => ({
        client,
        generation: { current: 0 },
        track: () => {},
        report: (id: string, state: ScalarState | null) =>
          setScalars((all) => {
            const own = { ...all[i] };
            if (state) own[id] = state;
            else if (id in own) delete own[id];
            else return all;
            return { ...all, [i]: own };
          }),
      })),
    [],
  );
  const entries = Object.values(scalars[index] ?? {});
  const resolving = entries.some((s) => s.pending);
  const invalid =
    entries.find((s) => s.error)?.error ??
    (Number.isNaN(entered[index]) ? "empty" : undefined);
  // The study on screen changes only once the requested calculation has an
  // outcome, so the completed drawing and its explanation stay together
  // meanwhile. It is held here, so a later edit cannot evict it.
  const outcome = outcomes.current.get(key);
  const [presented, setPresented] = useState<{
    step: number;
    key: string;
    outcome: Outcome;
  } | null>(null);
  if (outcome && presented?.key !== key)
    setPresented({ step: index, key, outcome });
  const pending = !outcome || resolving;
  const [slow, setSlow] = useState(false);
  useEffect(() => {
    if (!pending) return;
    const timer = setTimeout(() => setSlow(true), graceMs);
    return () => {
      clearTimeout(timer);
      setSlow(false);
    };
  }, [pending]);
  const previous = useRef<HTMLButtonElement>(null);
  const next = useRef<HTMLButtonElement>(null);
  // A step button that disables itself at an end of the path hands focus
  // to the other, rather than dropping it.
  const go = (to: number, button: HTMLButtonElement) => {
    setIndex(to);
    const end = to === 0 ? next : to === steps.length - 1 ? previous : null;
    if (end && document.activeElement === button) {
      quiet.quiet();
      end.current!.focus();
    }
  };
  // iOS opens its keyboard by shortening the visual viewport and panning it
  // down the layout viewport, which a modal fills: the page behind showed
  // below the journey, and the focused field could stay under the keyboard.
  // On a phone the journey fits the visual viewport instead, and once the
  // keyboard settles brings a focused field and its label into view. Only
  // the moments after focus count, so a reader who then scrolls away is left
  // there. Pinch zoom keeps the browser's own behavior.
  useEffect(() => {
    const viewport = window.visualViewport;
    const box = dialog.current!;
    if (!viewport) return;
    const phone = matchMedia("(max-width: 700px)");
    let timer = 0;
    let focusedAt = -Infinity;
    // Only the dialog scrolls: scrolling the page as well, as scrollIntoView
    // does, pans iOS's viewport again mid-keyboard and moves the dialog
    // under the field it was revealing.
    const reveal = () => {
      const field = document.activeElement;
      if (!(field instanceof HTMLElement) || !box.contains(field)) return;
      const target = (field.closest(".field") ?? field).getBoundingClientRect();
      const frame = box.getBoundingClientRect();
      const above = target.top - (frame.top + 8);
      const below = target.bottom - (frame.bottom - 8);
      if (above < 0) box.scrollTop += above;
      else if (below > 0) box.scrollTop += Math.min(below, above);
    };
    const fit = () => {
      if (phone.matches && Math.abs(viewport.scale - 1) < 0.01) {
        box.style.top = `${Math.max(0, viewport.offsetTop)}px`;
        box.style.height = box.style.maxHeight = `${viewport.height}px`;
      } else box.style.top = box.style.height = box.style.maxHeight = "";
      if (performance.now() - focusedAt > 1000) return;
      clearTimeout(timer);
      timer = window.setTimeout(reveal, 150);
    };
    const focus = () => {
      focusedAt = performance.now();
      fit();
    };
    fit();
    viewport.addEventListener("resize", fit);
    viewport.addEventListener("scroll", fit);
    phone.addEventListener("change", fit);
    box.addEventListener("focusin", focus);
    return () => {
      clearTimeout(timer);
      viewport.removeEventListener("resize", fit);
      viewport.removeEventListener("scroll", fit);
      phone.removeEventListener("change", fit);
      box.removeEventListener("focusin", focus);
    };
  }, []);
  // On a phone the study behind stays where the reader left it: swipes past
  // the journey's end, or over it once iOS's keyboard has panned the page,
  // must not scroll it. A scroll the keyboard left behind is undone.
  useLayoutEffect(() => {
    const root = document.documentElement;
    const { scrollX: x, scrollY: y } = window;
    root.classList.add("journey-open");
    return () => {
      root.classList.remove("journey-open");
      if (window.scrollX !== x || window.scrollY !== y) window.scrollTo(x, y);
    };
  }, []);
  useEffect(() => {
    if (via === "pointer") quiet.onPointerDown();
    dialog.current!.showModal();
    quiet.quiet();
    back.current!.focus();
  }, []);
  const ending = useRef(false);
  const finish = (action = () => onReturn(interaction.current)) => {
    if (ending.current) return;
    ending.current = true;
    dialog.current?.close();
    action();
  };
  const shown = presented?.step ?? index;
  const study = journeyStudy(steps[shown], edits[shown]);
  const frame = presented?.outcome.frame ?? null;
  const [renderError, setRenderError] = useState<{
    key: string;
    message: string;
  } | null>(null);
  const error =
    outcome?.error ||
    (renderError?.key === key ? renderError.message : undefined);
  // An edit, like a step change, stops playback.
  const revision = JSON.stringify([
    index,
    key,
    edits[index],
    entered[index],
    resolving,
    !!invalid,
  ]);
  return (
    <dialog
      ref={dialog}
      className="journey"
      aria-labelledby={title}
      onPointerDown={() => {
        interaction.current = "pointer";
        quiet.onPointerDown();
      }}
      onKeyDownCapture={() => {
        interaction.current = "keyboard";
        quiet.onKeyDownCapture();
      }}
      onCancel={(e) => {
        e.preventDefault();
        finish();
      }}
      onClose={() => finish()}
      onClick={(e) => {
        if (e.target === e.currentTarget) finish();
      }}
    >
      <div className="journey-body">
        <div className="journey-heading">
          <div>
            <div className="example-kicker">A path through the garden</div>
            <h2 id={title}>{journey.title}</h2>
          </div>
          <button ref={back} onClick={() => finish()}>
            Return to my study
          </button>
        </div>
        <div className="journey-content">
          <p className="example-kicker journey-step" role="status">
            Step {shown + 1} of {steps.length}
          </p>
          <div className="journey-intro">
            {steps.map((step, i) => (
              <div
                key={step.preset}
                className="journey-copy"
                data-current={i === shown}
                aria-hidden={i !== shown || undefined}
              >
                <h3>{journeyTitle(step)}</h3>
                <p>{step.note}</p>
              </div>
            ))}
          </div>
          {steps[shown].notebook === "2d" ? (
            <JourneyDrawing
              step={shown}
              requested={index}
              study={study as PlanarStudy}
              frame={frame}
              pending={pending}
              slow={slow}
              updating={presented?.step === index}
              revision={revision}
              invalid={!!invalid}
              error={error}
              client={client}
              dark={theme.dark}
              scheme={theme.scheme}
            />
          ) : steps[shown].notebook === "3d" && SpatialJourneyDrawing ? (
            <SpatialJourneyDrawing
              key={`3d:${shown}`}
              study={study as SpatialStudy}
              frame={presented?.outcome.spatial ?? null}
              pending={pending}
              slow={slow}
              requested={index}
              revision={revision}
              invalid={!!invalid}
              error={error}
              onError={(message) =>
                setRenderError({ key: presented?.key ?? key, message })
              }
              client={client}
              dark={theme.dark}
              scheme={theme.scheme}
            />
          ) : ShapeJourneyDrawing ? (
            <ShapeJourneyDrawing
              key={`4d:${shown}`}
              study={study as TesseractStudy}
              frame={presented?.outcome.shape ?? null}
              pending={pending}
              slow={slow}
              requested={index}
              revision={revision}
              invalid={!!invalid}
              error={error}
              client={client}
              dark={theme.dark}
              scheme={theme.scheme}
            />
          ) : (
            <div className="journey-drawing">
              <div className="journey-art" aria-busy={pending} />
              <p
                className="journey-feedback note"
                role={error ? "alert" : pending && slow ? "status" : undefined}
              >
                {error
                  ? `${error} Return to your study or try another step.`
                  : pending && slow
                    ? `Preparing step ${index + 1}…`
                    : ""}
              </p>
            </div>
          )}
          <div
            className="journey-navigation"
            role="group"
            aria-label="Journey steps"
          >
            <button
              ref={previous}
              disabled={index === 0}
              onClick={(e) => go(index - 1, e.currentTarget)}
            >
              Previous step
            </button>
            <button
              ref={next}
              disabled={index === steps.length - 1}
              onClick={(e) => go(index + 1, e.currentTarget)}
            >
              Next step
            </button>
          </div>
          <div
            className="journey-adopt"
            role="group"
            aria-label="Explore this study"
          >
            <div className="journey-experiments">
              {steps.map((step, i) => (
                <p
                  key={step.preset}
                  className="note"
                  data-current={i === shown}
                  aria-hidden={i !== shown || undefined}
                >
                  {step.suggestion} Open study keeps your change; then edit
                  anything, copy a link or export.
                </p>
              ))}
            </div>
            <div className="journey-controls">
              {steps.map((step, i) => (
                <div
                  key={step.preset}
                  className="journey-control"
                  data-current={i === shown}
                  aria-hidden={i !== shown || undefined}
                >
                  <ScalarStatus.Provider value={statuses[i]}>
                    <StepControl
                      step={step}
                      entered={entered[i] ?? edits[i]}
                      error={
                        Object.values(scalars[i] ?? {}).find((s) => s.error)
                          ?.error ??
                        (step.control.kind === "scalar" &&
                        outcomes.current.get(calculation(i, step, edits[i]))
                          ?.field === step.control.path.join(".")
                          ? outcomes.current.get(calculation(i, step, edits[i]))
                              ?.error
                          : "") ??
                        ""
                      }
                      frame={outcomes.current.get(calculation(i, step))?.frame}
                      onEdit={(value) => {
                        setEntered((e) => ({ ...e, [i]: value }));
                        if (!Number.isNaN(value))
                          setEdits((e) => ({ ...e, [i]: value }));
                      }}
                    />
                  </ScalarStatus.Provider>
                </div>
              ))}
            </div>
            {/* Inert, not disabled, during the grace period: it looks unchanged
                but cannot open a study about to be replaced. The control
                stays editable while its drawing updates. */}
            <button
              className="export"
              inert={pending || undefined}
              disabled={(pending && slow) || !presented || !!invalid || !!error}
              onClick={() => {
                const step = steps[index];
                finish(() =>
                  onOpen(
                    {
                      notebook: step.notebook,
                      preset: step.preset,
                      study: journeyStudy(step, edits[index]),
                      custom:
                        step.control.kind === "scalar" &&
                        edits[index] !== undefined,
                    } as JourneyAdoption,
                    interaction.current,
                  ),
                );
              }}
            >
              Open study
            </button>
          </div>
        </div>
      </div>
    </dialog>
  );
}

// A step's one experiment control, labeled and validated as the notebook's
// own: a numeric field whose text resolves through Go, or the probe's point
// along the curve, which moves by sample over the example's result.
function StepControl({
  step,
  entered,
  error,
  frame,
  onEdit,
}: {
  step: JourneyStep;
  entered?: number;
  error: string;
  frame?: Frame;
  onEdit: (value: number) => void;
}) {
  const { control } = step;
  const study = journeyStudy(step, entered);
  const target = useMemo(
    () => ({
      label: control.label,
      message: error,
      claim: () => {},
      touch: () => {},
    }),
    [control.label, error],
  );
  if (control.kind === "scalar")
    return (
      <FieldErrorContext.Provider value={target}>
        <Field label={control.label}>
          <ScalarInput
            name={control.label}
            value={getIn(study.config, control.path)}
            onChange={onEdit}
          />
        </Field>
      </FieldErrorContext.Provider>
    );
  const d = frame?.result.diagnostics;
  const n = d ? d.curvature.length - 1 : 1;
  const sample = frame
    ? (probeSample(frame.result, (study as PlanarStudy).probe) ?? 0)
    : 0;
  const at = frame ? sampleProbe(frame.result, sample) : null;
  return (
    <Field
      label={control.label}
      value={at ? `t = ${short(at.t)}` : ""}
      className="probe-slider"
    >
      <input
        type="range"
        min={0}
        max={n}
        step={1}
        value={sample}
        disabled={!frame}
        aria-valuetext={
          at ? `t = ${short(at.t)}, sample ${sample} of ${n}` : undefined
        }
        onChange={(e) => onEdit(e.target.valueAsNumber / n)}
      />
    </Field>
  );
}

function JourneyDrawing({
  step,
  requested,
  pending,
  slow,
  updating,
  revision,
  invalid,
  study,
  frame,
  error,
  client,
  dark,
  scheme,
}: {
  step: number;
  requested: number;
  pending: boolean;
  slow: boolean;
  updating: boolean;
  revision: string;
  invalid: boolean;
  study: PlanarStudy;
  frame: Frame | null;
  error?: string;
  client: { current: EngineClient | null };
  dark: boolean;
  scheme: ReturnType<typeof useTheme>["scheme"];
}) {
  const [viewState, setViewState] = useState<{
    step: number;
    view: AnimationView | null;
  } | null>(null);
  const animation =
    !pending && viewState?.step === step ? viewState.view : null;
  const view = useRef<Viewport | undefined>(undefined);
  const shown = animation?.frame ?? frame;
  const probe =
    frame && study.probe.enabled
      ? (sampleProbe(
          frame.result,
          probeSample(frame.result, study.probe) ?? 0,
        ) ?? undefined)
      : undefined;
  return (
    <div className="journey-drawing">
      <div className="journey-art" aria-busy={pending || (!frame && !error)}>
        {shown && (
          <Plot
            key={step}
            id="journey-artwork"
            result={shown.result}
            config={shown.config}
            layers={study.layers}
            weight={study.weight}
            dark={dark}
            scheme={scheme}
            length={animation?.length ?? study.length}
            stop={animation?.stop ?? study.stop}
            reset={0}
            initialCamera={{ reset: 0, camera: study.camera }}
            probe={probe}
            animation={animation}
            onViewport={(v) => {
              view.current = v;
            }}
          />
        )}
      </div>
      <p
        className="journey-feedback note"
        role={error ? "alert" : pending && slow ? "status" : undefined}
      >
        {error
          ? `${error} Return to your study or try another step.`
          : pending && slow
            ? updating
              ? "Updating the drawing…"
              : `Preparing step ${requested + 1}…`
            : ""}
      </p>
      <div inert={pending || undefined}>
        <AnimationPanel
          key={step}
          preview
          frame={frame}
          client={client}
          length={study.length}
          stopAtCaustic={study.stop}
          revision={revision}
          disabled={(pending && slow) || !frame || !!error || invalid}
          dark={dark}
          scheme={scheme}
          layers={study.layers}
          weight={study.weight}
          probe={study.probe.enabled ? study.probe : null}
          getCurrentView={() => view.current}
          getFocus={() => null}
          refineView={false}
          onShowCamera={() => {}}
          onView={(view) => setViewState({ step, view })}
          onRunning={() => {}}
          onReveal={() => {}}
          restore={frame ? { id: 0, settings: study.animation } : null}
        />
      </div>
    </div>
  );
}
