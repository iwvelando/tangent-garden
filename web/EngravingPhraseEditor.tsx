// The editor for an engraving phrase (engraving-phrase.ts), shared by the
// planar and 3D notebooks: the shared timeline editor without parameter
// tracks, with the opening span, each phase's span and its layer events.
// Each notebook supplies its layers, camera keys and their help.
import type { ReactNode } from "react";
import { Field } from "./Field";
import {
  memberField,
  setSpanEnd,
  spanBefore,
  type EngravingPhase,
  type EngravingPhrase,
  type MemberSpan,
} from "./engraving-phrase";
import { familyMotionHelp } from "./family-motion";
import type { Help } from "./help";
import { PhaseLayers } from "./PhaseLayers";
import { PhraseTimelineEditor, type PhraseEditorCamera } from "./PhraseEditor";

// The field a problem names, shown under that control.
export const engravingProblemField = (problem?: string) =>
  /^(Opening|Phase \d+) (first|last) member\b|^Phase \d+ (duration|view|turns|name)\b/.exec(
    problem ?? "",
  )?.[0];

function SpanFields({
  span,
  place,
  count,
  help,
  onChange,
}: {
  // The phase's own span, or undefined while it holds.
  span?: MemberSpan;
  place: number | "opening";
  count: number;
  help?: Help<string>;
  // An end's entered value, NaN while its field is empty.
  onChange: (end: keyof MemberSpan, value: number) => void;
}) {
  const field = (end: keyof MemberSpan) => {
    const label = memberField(place, end);
    return (
      <Field
        label={
          place === "opening"
            ? label
            : end === "first"
              ? "First member"
              : "Last member"
        }
        topic={label}
        help={end === "first" ? help : undefined}
      >
        <input
          aria-label={label}
          type="number"
          min="1"
          max={count}
          step="1"
          placeholder={place === "opening" ? undefined : "Held"}
          value={span && !Number.isNaN(span[end]) ? span[end] : ""}
          onChange={(e) => onChange(end, e.target.valueAsNumber)}
        />
      </Field>
    );
  };
  return (
    <div className="pair">
      {field("first")}
      {field("last")}
    </div>
  );
}

export function EngravingPhraseEditor<L extends object, V extends object>({
  phrase,
  count,
  onChange,
  problem,
  layers,
  layersHelp,
  camera,
  extra,
}: {
  phrase: EngravingPhrase<L, V>;
  count: number;
  // Applied to the latest phrase, as a functional update.
  onChange: (
    change: (phrase: EngravingPhrase<L, V>) => EngravingPhrase<L, V>,
  ) => void;
  problem?: string;
  // The layers a phase can show or hide, with their labels.
  layers: readonly (readonly [keyof L & string, string])[];
  layersHelp: Help<string>;
  camera: PhraseEditorCamera<V>;
  // A notebook's own controls for a phase, after its camera.
  extra?: (
    phase: EngravingPhase<L, V>,
    index: number,
    patch: (
      change: (phase: EngravingPhase<L, V>) => EngravingPhase<L, V>,
    ) => void,
  ) => ReactNode;
}) {
  return (
    <PhraseTimelineEditor
      // No parameter tracks: the family owns its parameter.
      phrase={phrase as never}
      onChange={(change) =>
        onChange((p) => change(p as never) as unknown as EngravingPhrase<L, V>)
      }
      problem={problem}
      problemField={engravingProblemField}
      camera={camera}
      holds="Empty members hold the preceding span."
      opening={
        <SpanFields
          span={phrase.opening}
          place="opening"
          count={count}
          help={familyMotionHelp.opening}
          onChange={(end, value) =>
            onChange((p) => ({
              ...p,
              opening: setSpanEnd(p.opening, p.opening, end, value, false)!,
            }))
          }
        />
      }
      inputs={(phase, i) => (
        <SpanFields
          span={(phase as unknown as EngravingPhase<L, V>).members}
          place={i}
          count={count}
          help={i === 0 ? familyMotionHelp.members : undefined}
          // Against the latest phrase, whose earlier phases give the span
          // this one holds.
          onChange={(end, value) =>
            onChange((p) => ({
              ...p,
              phases: p.phases.map((own, j) => {
                if (j !== i) return own;
                const { members, ...rest } = own;
                const span = setSpanEnd(
                  members,
                  spanBefore(p, i),
                  end,
                  value,
                  true,
                );
                return span ? { ...rest, members: span } : rest;
              }),
            }))
          }
        />
      )}
      extra={(phase, i, patch) => {
        const own = phase as unknown as EngravingPhase<L, V>;
        const patchOwn = (
          change: (phase: EngravingPhase<L, V>) => EngravingPhase<L, V>,
        ) => patch((p) => change(p as never) as never);
        return (
          <>
            {extra?.(own, i, patchOwn)}
            <PhaseLayers<keyof L & string>
              phase={
                own as { layers?: Partial<Record<keyof L & string, boolean>> }
              }
              index={i}
              offered={layers}
              help={layersHelp}
              onChange={(events) =>
                patchOwn((p) => {
                  const { layers: _, ...rest } = p;
                  return events
                    ? { ...rest, layers: events as Partial<L> }
                    : rest;
                })
              }
            />
          </>
        );
      }}
    />
  );
}
