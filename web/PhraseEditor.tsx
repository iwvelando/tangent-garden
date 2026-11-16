import { count as formatCount } from "./number-format";
import { useLayoutEffect, useMemo, useRef, type ReactNode } from "react";
import { Field, FieldErrorContext } from "./Field";
import { targetLabel, type Target } from "./animation";
import { ViewName } from "./KeyViews";
import type { Layers } from "./Plot";
import {
  phaseRevealChoice,
  withPhaseReveal,
  type Phrase,
  type PhrasePhase,
  type PhraseView,
  type RevealChoice,
} from "./phrase";
import {
  addPhraseTrack,
  insertPhase,
  maxPhases,
  maxPhraseTracks,
  movePhase,
  phaseKey,
  phraseKeyField,
  phraseTrackTargets,
  removePhase,
  removePhraseTrack,
  retargetPhraseTrack,
  setPhaseKey,
  type Timeline,
  type TimelinePhase,
} from "./phrase-timeline";
import { tiered, type Help } from "./help";
import { plainZoom, viewZoom } from "./refinement";
import { useQuietFocus } from "./quiet-focus";

export const phraseHelp = tiered(
  "Reveal, move and hold one study through labeled phases you arrange.",
  "Add, remove, rename and reorder phases; edit their durations, end values, reveals and camera views. Empty end values hold the preceding value. Values accept constants such as pi. Each phase lasts at least 0.1 seconds, with 1–12 phases and at most 3600 seconds in total. Visibility changes at phase starts; geometry is never blended. Stop restores your study.",
);
export const phrasePaceHelp = tiered(
  "Sets how inputs and reveals move within each phase.",
  "Steady uses a constant rate within each phase. Ease in and out rests at every boundary. Choosing a pace applies it to all phases, preserving their durations and stationary holds.",
);
export const phraseRayLengthHelp = "Ray length keys must be 0.01–100.";
export const phraseParameterHelp = tiered(
  "A continuous parameter this study consumes; a phrase moves up to three together.",
  "Each parameter owns one value of the study and has its own end values on the shared phases, so one can hold while another moves. Choosing another parameter resets its end values to the study's current value. Counts and categorical choices are not offered, and no parameter is offered twice.",
);
export const phraseKeyHelp = tiered(
  "The value reached as the phase ends; empty holds the last.",
  "A constant such as 0.5 or pi/4. With several parameters, each has its own end value and holds alone when its value is empty.",
);
export const phraseRevealHelp = tiered(
  "Draw or erase the base curve, construction or derived curve during the phase.",
  "Drawing follows the curve from its start at the phase's pace and shows that part from the phase's start, even where the study hides it. Erasing runs back the same way. Parts not named keep their state. A linked phrase's partial reveal stays until another choice replaces it.",
);
export const phraseCameraHelp = tiered(
  "Hold the view, move to a key view, or return to the opening view.",
  `The camera arrives as the phase ends, at the phase's pace, together with its value and reveal. Set to drawing takes the drawing's pan and zoom. Views zoom up to ${plainZoom}×, or ${formatCount(viewZoom)}× in a study refined to its view.`,
);
type PhaseCamera = "hold" | "view" | "entry";

const revealLabels: Record<RevealChoice, string> = {
  keep: "Keep what is drawn",
  "draw-base": "Draw the base curve",
  "draw-construction": "Draw the construction",
  "draw-derived": "Draw the derived curve",
  "draw-base-construction": "Draw the base curve and construction",
  "draw-construction-derived": "Draw the construction and derived curve",
  "draw-all": "Draw everything",
  "erase-construction": "Erase the construction",
  "erase-derived": "Erase the derived curve",
  "erase-construction-derived": "Erase the construction and derived curve",
};

// These labels are also the controls' accessible names. A scalar failure,
// duration or name refusal stays beside the editable draft that produced it.
export const phraseProblemField = (problem?: string) =>
  /^Phase \d+ (duration|key \d|key|view|name)\b/.exec(problem ?? "")?.[0];

// What a notebook's phases reveal and how their views are taken, shown and
// described; the timeline, tracks and arrangement are shared.
type EditorPhase<T extends string, V> = TimelinePhase<T> & {
  view?: V | "entry";
  // A second camera's key, where a notebook shows two spatial panes.
  companionView?: V | "entry";
};
export type PhraseEditorReveal<P> = {
  value: (phase: P) => string;
  options: readonly (readonly [string, string])[];
  // The label of a value the options do not name, as a link may carry.
  custom: string;
  apply: (phase: P, choice: string) => P;
  help: Help<string>;
};
export type PhraseEditorCamera<V> = {
  drawn: () => V | null;
  onShow: (view: V) => void;
  describe: (view: V) => string;
  help: Help<string>;
  // What of a phase's own view the drawing's view keeps when it replaces
  // it; absent, the drawing's view replaces it whole.
  keep?: (old: V, view: V) => V;
  // The field's label where a notebook names its cameras; "Camera" when
  // absent.
  label?: string;
  // A notebook's own controls for this camera's key in a phase, after its
  // buttons.
  after?: (index: number) => ReactNode;
};

export function PhraseTimelineEditor<
  T extends string,
  V extends object,
  P extends EditorPhase<T, V>,
  F extends Timeline<T, P>,
>({
  phrase,
  targets,
  label,
  current,
  onChange,
  problem,
  problemField,
  parameterHelp,
  reveal: revealing,
  camera,
  companion,
  extra,
  opening,
  inputs,
  holds = "An empty end value holds the preceding value.",
}: {
  phrase: F;
  // The parameters a phrase can move; absent, the phrase has no tracks
  // (an engraving phrase), and neither tracks nor end values are shown.
  targets?: T[];
  label?: (target: T) => string;
  // A target's value in the study, as text for a retargeted track's keys.
  current?: (target: T) => string;
  // Applied to the latest phrase, as a functional update.
  onChange: (change: (phrase: F) => F) => void;
  problem?: string;
  // The field a problem names, shown under that control.
  problemField: (problem?: string) => string | undefined;
  // The help beside a track's parameter.
  parameterHelp?: (target: T, track: number) => Help<string> | undefined;
  // What a phase reveals; a notebook without reveals leaves it out.
  reveal?: PhraseEditorReveal<P>;
  camera: PhraseEditorCamera<V>;
  // A second spatial pane's camera, keyed in companionView; its controls
  // are named with a 2, as further parameters' keys are.
  companion?: PhraseEditorCamera<V>;
  // A notebook's own controls for a phase, after its camera.
  extra?: (
    phase: P,
    index: number,
    patch: (change: (phase: P) => P) => void,
  ) => ReactNode;
  // Controls for how the phrase opens, before its phases.
  opening?: ReactNode;
  // A notebook's own end values for a phase, after its duration.
  inputs?: (
    phase: P,
    index: number,
    patch: (change: (phase: P) => P) => void,
  ) => ReactNode;
  // What an empty end value does, in the note below the phases.
  holds?: string;
}) {
  const fieldError = useMemo(() => {
    const label = problemField(problem);
    return label && problem
      ? { label, message: problem, claim: () => {}, touch: () => {} }
      : null;
  }, [problem, problemField]);
  const tracks = targets ? phraseTrackTargets(phrase) : [];
  const several = tracks.length > 1;
  const free = (targets ?? []).filter((t) => !tracks.includes(t));
  // Focus follows a moved phase to its new place, onto the same way's
  // button while it can move further, else the other's; after a removal it
  // goes to the phase now in that place. The way is kept with the move,
  // since Safari leaves a pressed button unfocused.
  const list = useRef<HTMLOListElement>(null);
  const { quiet, ring, ...via } = useQuietFocus(list);
  const settle = useRef<string[] | null>(null);
  useLayoutEffect(() => {
    const names = settle.current;
    settle.current = null;
    for (const name of names ?? []) {
      const b = list.current?.querySelector<HTMLButtonElement>(
        `button[aria-label="${name}"]`,
      );
      if (b && !b.disabled) {
        quiet();
        return b.focus();
      }
    }
  }, [phrase.phases]);
  const patch = (i: number, change: (phase: P) => P) =>
    onChange((p) => ({
      ...p,
      phases: p.phases.map((phase, j) => (j === i ? change(phase) : phase)),
    }));
  const parameter = (track: number) => {
    const target = tracks[track];
    if (!targets || !label || !current) return null;
    return (
      <Field
        key={track}
        label={
          track === 0
            ? "Phrase parameter"
            : track === 1
              ? "Second parameter"
              : "Third parameter"
        }
        topic={`Phrase parameter${track ? ` ${track + 1}` : ""}`}
        help={parameterHelp?.(target, track)}
      >
        <select
          aria-label={`Phrase parameter${track ? ` ${track + 1}` : ""}`}
          value={target}
          onChange={(e) => {
            const next = e.target.value as T;
            onChange((p) => retargetPhraseTrack(p, track, next, current(next)));
          }}
        >
          {!targets.includes(target) && (
            <option value={target}>Unavailable: {label(target)}</option>
          )}
          {targets
            .filter((t) => t === target || !tracks.includes(t))
            .map((t) => (
              <option key={t} value={t}>
                {label(t)}
              </option>
            ))}
        </select>
      </Field>
    );
  };
  return (
    <FieldErrorContext.Provider value={fieldError}>
      {targets && (
        <>
          {parameter(0)}
          {tracks.slice(1).map((target, k) => (
            <div className="phrase-track" key={k}>
              {parameter(k + 1)}
              <button
                type="button"
                className="text-button"
                aria-label={`Remove phrase parameter ${k + 2}`}
                onClick={() => onChange((p) => removePhraseTrack(p, target))}
              >
                Remove parameter
              </button>
            </div>
          ))}
          <button
            type="button"
            className="phrase-add-track"
            disabled={tracks.length >= maxPhraseTracks || free.length === 0}
            onClick={() =>
              onChange((p) => {
                const used = phraseTrackTargets(p);
                const next = targets.find((t) => !used.includes(t));
                return next ? addPhraseTrack(p, next) : p;
              })
            }
          >
            + Add a parameter
          </button>
        </>
      )}
      {opening}
      <ol
        className="phrase-phases"
        ref={list}
        {...via}
        onBlur={(e) => {
          if (!e.currentTarget.contains(e.relatedTarget)) ring();
        }}
      >
        {phrase.phases.map((phase, i) => {
          const update = (change: Partial<P>) =>
            patch(i, (p) => ({ ...p, ...change }));
          const shown = revealing?.value(phase) ?? "";
          const named = !!revealing?.options.some(([value]) => value === shown);
          const keyField = (track: number) => (
            <Field
              key={track}
              label={several ? label!(tracks[track]) : "End value"}
              topic={phraseKeyField(i, track)}
              help={i === 0 && track === 0 ? phraseKeyHelp : undefined}
            >
              <input
                aria-label={phraseKeyField(i, track)}
                value={phaseKey(phrase, phase, track) ?? ""}
                placeholder="Held"
                spellCheck={false}
                onChange={(e) => {
                  const text = e.target.value;
                  onChange((p) => setPhaseKey(p, i, track, text));
                }}
              />
            </Field>
          );
          // A camera's key for one pane: hold, a key view or the opening
          // view, with its description, Show and Set to drawing.
          const cameraField = (
            spec: PhraseEditorCamera<V>,
            field: "view" | "companionView",
            suffix: string,
          ) => {
            const key = phase[field];
            return (
              <>
                <Field
                  label={spec.label ?? "Camera"}
                  topic={`Phase ${i + 1} view${suffix}`}
                  help={i === 0 ? spec.help : undefined}
                >
                  <select
                    aria-label={`Phase ${i + 1} camera${suffix}`}
                    value={
                      key === undefined
                        ? "hold"
                        : key === "entry"
                          ? "entry"
                          : "view"
                    }
                    onChange={(e) => {
                      const choice = e.target.value as PhaseCamera;
                      if (choice === "hold")
                        patch(i, (p) => {
                          const { [field]: _, ...rest } = p;
                          return rest as P;
                        });
                      else if (choice === "entry")
                        update({ [field]: "entry" } as Partial<P>);
                      else {
                        const view = spec.drawn();
                        if (view) update({ [field]: view } as Partial<P>);
                      }
                    }}
                  >
                    <option value="hold">Hold the view</option>
                    <option value="view">Move to a key view</option>
                    <option value="entry">Return to the opening view</option>
                  </select>
                </Field>
                {typeof key === "object" && (
                  <>
                    <p className="hint">{spec.describe(key as V)}</p>
                    <div className="path-view-buttons">
                      <button
                        type="button"
                        className="text-button"
                        aria-label={`Show phase ${i + 1} view${suffix}`}
                        onClick={() => spec.onShow(key as V)}
                      >
                        Show
                      </button>
                      <button
                        type="button"
                        className="text-button"
                        aria-label={`Set phase ${i + 1} view${suffix} to the drawing's view`}
                        onClick={() => {
                          const view = spec.drawn();
                          if (!view) return;
                          patch(i, (p) => ({
                            ...p,
                            [field]:
                              spec.keep && typeof p[field] === "object"
                                ? spec.keep(p[field] as V, view)
                                : view,
                          }));
                        }}
                      >
                        Set to drawing
                      </button>
                    </div>
                  </>
                )}
                {spec.after?.(i)}
              </>
            );
          };
          const seconds = (
            <Field label="Seconds" topic={`Phase ${i + 1} duration`}>
              <input
                aria-label={`Phase ${i + 1} duration`}
                type="number"
                min="0.1"
                max="3600"
                step="any"
                value={Number.isNaN(phase.duration) ? "" : phase.duration}
                onChange={(e) =>
                  update({ duration: e.target.valueAsNumber } as Partial<P>)
                }
              />
            </Field>
          );
          return (
            <li className="animation-track" key={i}>
              <Field label="Name" topic={`Phase ${i + 1} name`}>
                <ViewName
                  aria-label={`Phase ${i + 1} name`}
                  value={phase.name}
                  onChange={(name) => update({ name } as Partial<P>)}
                />
              </Field>
              {targets ? (
                <div className="pair">
                  {seconds}
                  {keyField(0)}
                </div>
              ) : (
                seconds
              )}
              {inputs?.(phase, i, (change) => patch(i, change))}
              {tracks.length === 2 && keyField(1)}
              {tracks.length === 3 && (
                <div className="pair">
                  {keyField(1)}
                  {keyField(2)}
                </div>
              )}
              {revealing && (
                <>
                  <Field
                    label="Reveal"
                    topic={`Phase ${i + 1} reveal`}
                    help={i === 0 ? revealing.help : undefined}
                  >
                    <select
                      aria-label={`Phase ${i + 1} reveal`}
                      value={named ? shown : "custom"}
                      onChange={(e) => {
                        const choice = e.target.value;
                        patch(i, (p) => revealing.apply(p, choice));
                      }}
                    >
                      {!named && (
                        <option value="custom">{revealing.custom}</option>
                      )}
                      {revealing.options.map(([value, text]) => (
                        <option key={value} value={value}>
                          {text}
                        </option>
                      ))}
                    </select>
                  </Field>
                </>
              )}
              {cameraField(camera, "view", "")}
              {companion && cameraField(companion, "companionView", " 2")}
              {extra?.(phase, i, (change) => patch(i, change))}
              <div className="path-view-buttons phrase-arrange">
                {(["up", "down"] as const).map((way) => {
                  const to = way === "up" ? i - 1 : i + 1;
                  return (
                    <button
                      key={way}
                      type="button"
                      className="text-button"
                      aria-label={`Move phase ${i + 1} ${way}`}
                      disabled={to < 0 || to >= phrase.phases.length}
                      onClick={() => {
                        const other = way === "up" ? "down" : "up";
                        settle.current = [
                          `Move phase ${to + 1} ${way}`,
                          `Move phase ${to + 1} ${other}`,
                        ];
                        onChange((p) => movePhase(p, i, to));
                      }}
                    >
                      {way === "up" ? "Move up" : "Move down"}
                    </button>
                  );
                })}
                <button
                  type="button"
                  className="text-button"
                  aria-label={`Add a phase after phase ${i + 1}`}
                  disabled={phrase.phases.length >= maxPhases}
                  onClick={() => onChange((p) => insertPhase(p, i))}
                >
                  Add below
                </button>
                <button
                  type="button"
                  className="text-button"
                  aria-label={`Remove phase ${i + 1}`}
                  disabled={phrase.phases.length <= 1}
                  onClick={() => {
                    const at = Math.min(i, phrase.phases.length - 2);
                    settle.current = [
                      `Remove phase ${at + 1}`,
                      `Add a phase after phase ${at + 1}`,
                    ];
                    onChange((p) => removePhase(p, i));
                  }}
                >
                  Remove
                </button>
              </div>
            </li>
          );
        })}
      </ol>
      <p className="note">
        Total:{" "}
        {formatCount(phrase.phases.reduce((sum, p) => sum + p.duration, 0))} s.{" "}
        {formatCount(phrase.phases.length)} of {formatCount(maxPhases)} phases.{" "}
        {holds}
      </p>
    </FieldErrorContext.Provider>
  );
}

const planarReveal: PhraseEditorReveal<PhrasePhase> = {
  value: (phase) => phaseRevealChoice(phase),
  options: Object.entries(revealLabels),
  custom: "Partly drawn, as linked",
  apply: (phase) => phase,
  help: phraseRevealHelp,
};
export function PhraseEditor({
  phrase,
  targets,
  layers,
  current,
  onChange,
  problem,
  drawn,
  onShow,
  describe,
}: {
  phrase: Phrase;
  targets: Target[];
  // The study's layers, whose construction subsets a drawn reveal keeps.
  layers: Layers;
  // A target's value in the study, as text for a retargeted track's keys.
  current: (target: Target) => string;
  // Applied to the latest phrase, as a functional update.
  onChange: (change: (phrase: Phrase) => Phrase) => void;
  problem?: string;
  // The drawing's view as a key, or null before it is drawn.
  drawn: () => PhraseView | null;
  onShow: (view: PhraseView) => void;
  describe: (view: PhraseView) => string;
}) {
  return (
    <PhraseTimelineEditor
      phrase={phrase}
      targets={targets}
      label={targetLabel}
      current={current}
      onChange={onChange}
      problem={problem}
      problemField={phraseProblemField}
      parameterHelp={(target, track) =>
        target === "rayLength"
          ? phraseRayLengthHelp
          : track === 0
            ? phraseParameterHelp
            : undefined
      }
      reveal={{
        ...planarReveal,
        apply: (phase, choice) =>
          withPhaseReveal(phase, choice as RevealChoice, layers),
      }}
      camera={{ drawn, onShow, describe, help: phraseCameraHelp }}
    />
  );
}
