import { useMemo } from "react";
import { Field, FieldErrorContext } from "./Field";
import { targetLabel, type Target } from "./animation";
import type { Phrase, PhraseView } from "./phrase";
import { tiered } from "./help";
import { plainZoom, viewZoom } from "./refinement";

export const phraseHelp = tiered(
  "Reveal, move and hold one study through labeled phases.",
  "Edit phase durations, numeric keys and camera views; omitted ones hold the preceding value. Keys accept constants such as pi. Each phase lasts at least 0.1 seconds, with at most 12 phases and 3600 seconds total. Visibility changes at phase starts; geometry is never blended. Stop restores your study.",
);
export const phrasePaceHelp = tiered(
  "Sets how inputs and reveals move within each phase.",
  "Steady uses a constant rate within each phase. Ease in and out rests at every boundary. Choosing a pace applies it to all phases, preserving their durations and stationary holds.",
);
export const phraseRayLengthHelp = "Ray length keys must be 0.01–100.";
export const phraseCameraHelp = tiered(
  "Hold the view, move to a key view, or return to the opening view.",
  `The camera arrives as the phase ends, at the phase's pace, together with its value and reveal. Set to drawing takes the drawing's pan and zoom. Views zoom up to ${plainZoom}×, or ${viewZoom.toLocaleString("en-US")}× in a study refined to its view.`,
);
type PhaseCamera = "hold" | "view" | "entry";

// These labels are also the controls' accessible names. A scalar failure or
// duration refusal stays beside the editable draft that produced it.
export const phraseProblemField = (problem?: string) =>
  /^Phase \d+ (duration|key|view)\b/.exec(problem ?? "")?.[0];

export function PhraseEditor({
  phrase,
  targets,
  onChange,
  problem,
  drawn,
  onShow,
  describe,
}: {
  phrase: Phrase;
  targets: Target[];
  onChange: (phrase: Phrase) => void;
  problem?: string;
  // The drawing's view as a key, or null before it is drawn.
  drawn: () => PhraseView | null;
  onShow: (view: PhraseView) => void;
  describe: (view: PhraseView) => string;
}) {
  const fieldError = useMemo(() => {
    const label = phraseProblemField(problem);
    return label && problem
      ? { label, message: problem, claim: () => {}, touch: () => {} }
      : null;
  }, [problem]);
  return (
    <FieldErrorContext.Provider value={fieldError}>
      <Field
        label="Phrase parameter"
        help={
          phrase.target === "rayLength"
            ? phraseRayLengthHelp
            : "One continuous parameter consumed by this study."
        }
      >
        <select
          value={phrase.target}
          onChange={(e) =>
            onChange({ ...phrase, target: e.target.value as Target })
          }
        >
          {!targets.includes(phrase.target) && (
            <option value={phrase.target}>
              Unavailable: {targetLabel(phrase.target)}
            </option>
          )}
          {targets.map((target) => (
            <option key={target} value={target}>
              {targetLabel(target)}
            </option>
          ))}
        </select>
      </Field>
      <ol className="phrase-phases">
        {phrase.phases.map((phase, i) => {
          const update = (patch: Partial<typeof phase>) =>
            onChange({
              ...phrase,
              phases: phrase.phases.map((p, j) =>
                j === i ? { ...p, ...patch } : p,
              ),
            });
          return (
            <li className="animation-track" key={i}>
              <p className="phrase-name">{phase.name}</p>
              <div className="pair">
                <Field label="Seconds" topic={`Phase ${i + 1} duration`}>
                  <input
                    aria-label={`Phase ${i + 1} duration`}
                    type="number"
                    min="0.1"
                    max="3600"
                    step="any"
                    value={Number.isNaN(phase.duration) ? "" : phase.duration}
                    onChange={(e) =>
                      update({ duration: e.target.valueAsNumber })
                    }
                  />
                </Field>
                <Field
                  label={phase.key === undefined ? "Held value" : "End value"}
                  topic={`Phase ${i + 1} key`}
                >
                  <input
                    aria-label={`Phase ${i + 1} key`}
                    value={phase.key ?? "Previous value"}
                    readOnly={phase.key === undefined}
                    spellCheck={false}
                    onChange={(e) => update({ key: e.target.value })}
                  />
                </Field>
              </div>
              <Field
                label="Camera"
                topic={`Phase ${i + 1} view`}
                help={i === 0 ? phraseCameraHelp : undefined}
              >
                <select
                  aria-label={`Phase ${i + 1} camera`}
                  value={
                    phase.view === undefined
                      ? "hold"
                      : phase.view === "entry"
                        ? "entry"
                        : "view"
                  }
                  onChange={(e) => {
                    const choice = e.target.value as PhaseCamera;
                    if (choice === "hold") {
                      const { view: _, ...rest } = phase;
                      onChange({
                        ...phrase,
                        phases: phrase.phases.map((p, j) =>
                          j === i ? rest : p,
                        ),
                      });
                    } else if (choice === "entry") update({ view: "entry" });
                    else {
                      const view = drawn();
                      if (view) update({ view });
                    }
                  }}
                >
                  <option value="hold">Hold the view</option>
                  <option value="view">Move to a key view</option>
                  <option value="entry">Return to the opening view</option>
                </select>
              </Field>
              {typeof phase.view === "object" && (
                <>
                  <p className="hint">{describe(phase.view)}</p>
                  <div className="path-view-buttons">
                    <button
                      type="button"
                      className="text-button"
                      aria-label={`Show phase ${i + 1} view`}
                      onClick={() => onShow(phase.view as PhraseView)}
                    >
                      Show
                    </button>
                    <button
                      type="button"
                      className="text-button"
                      aria-label={`Set phase ${i + 1} view to the drawing's view`}
                      onClick={() => {
                        const view = drawn();
                        if (view) update({ view });
                      }}
                    >
                      Set to drawing
                    </button>
                  </div>
                </>
              )}
            </li>
          );
        })}
      </ol>
      <p className="note">
        Total:{" "}
        {phrase.phases
          .reduce((sum, p) => sum + p.duration, 0)
          .toLocaleString("en-US")}{" "}
        s. Holds keep the preceding value.
      </p>
    </FieldErrorContext.Provider>
  );
}
