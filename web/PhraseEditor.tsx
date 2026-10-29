import { useMemo } from "react";
import { Field, FieldErrorContext } from "./Field";
import { targetLabel, type Target } from "./animation";
import type { Phrase } from "./phrase";
import { tiered } from "./help";

export const phraseHelp = tiered(
  "Reveal, move and hold one study through labeled phases.",
  "Edit phase durations and numeric keys; omitted keys hold the preceding value. Keys accept constants such as pi. Each phase lasts at least 0.1 seconds, with at most 12 phases and 3600 seconds total. Visibility changes at phase starts; geometry is never blended. Stop restores your study.",
);
export const phrasePaceHelp = tiered(
  "Sets how inputs and reveals move within each phase.",
  "Steady uses a constant rate within each phase. Ease in and out rests at every boundary. Choosing a pace applies it to all phases, preserving their durations and stationary holds.",
);
export const phraseRayLengthHelp = "Ray length keys must be 0.01–100.";

// These labels are also the controls' accessible names. A scalar failure or
// duration refusal stays beside the editable draft that produced it.
export const phraseProblemField = (problem?: string) =>
  /^Phase \d+ (duration|key)\b/.exec(problem ?? "")?.[0];

export function PhraseEditor({
  phrase,
  targets,
  onChange,
  problem,
}: {
  phrase: Phrase;
  targets: Target[];
  onChange: (phrase: Phrase) => void;
  problem?: string;
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
