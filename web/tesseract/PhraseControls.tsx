// The 4D notebook's phrase editor: the shared timeline, tracks and
// arrangement (PhraseTimelineEditor), with a camera for each spatial pane,
// its whole turns, and the selection's cuts. Labels, help and limits come
// from the object's descriptor and ./phrase.ts; nothing here branches on an
// object's name.
import {
  count as formatCount,
  readout as formatNumber,
} from "../number-format";
import { Field } from "../Field";
import { tiered } from "../help";
import { phraseParameterHelp, PhraseTimelineEditor } from "../PhraseEditor";
import { objects } from "./objects";
import {
  constantText,
  maxTurns,
  paneLabel,
  phrasePanes,
  tesseractPhraseProblemField,
  tesseractPhraseTargets,
  tesseractTargetLabel,
  tesseractTargetValue,
  type PhrasePane,
  type TesseractPhrase,
  type TesseractPhrasePhase,
  type TesseractPhraseView,
} from "./phrase";
import type { Config, TesseractTarget, View } from "./types";

export const tesseractPhraseCameraHelp = tiered(
  "Hold the view, turn to a key view, or return to the opening view.",
  "The view arrives as the phase ends, at the phase's pace, turning the shorter way plus any whole turns. Set to drawing takes the view's orbit, pan and zoom, from 0.2× to 8×. A flat diagram keeps its view.",
);
export const tesseractPhraseTurnsHelp = `Whole turns added on the way to this view, −${maxTurns} to ${maxTurns}; positive turns as Rotate view does.`;
export const tesseractPhraseSelectionHelp = tiered(
  "Cuts to another selection as the phase starts; Keep leaves it.",
  "A trace is counted from the selected item, so the moving point jumps with it. A cut is never blended. Stop restores your selection.",
);

const degrees = (x: number) => {
  const d = Math.round((((x * 180) / Math.PI) % 360) + 360) % 360;
  return d > 180 ? d - 360 : d;
};
export const describeTesseractView = (key: TesseractPhraseView) =>
  `yaw ${formatNumber(degrees(key.yaw))}°, pitch ${formatNumber(degrees(key.pitch))}°, zoom ${formatNumber(key.zoom)}×${key.panX !== 0 || key.panY !== 0 ? ", panned" : ""}`;

function Turns({
  phase,
  index,
  pane,
  onChange,
}: {
  phase: TesseractPhrasePhase;
  index: number;
  pane: PhrasePane;
  onChange: (turns: number) => void;
}) {
  const key = phase[pane];
  if (typeof key !== "object") return null;
  const suffix = pane === "view" ? "" : " 2";
  return (
    <Field
      label="Turns"
      topic={`Phase ${index + 1} turns${suffix}`}
      help={tesseractPhraseTurnsHelp}
    >
      <input
        aria-label={`Phase ${index + 1} turns${suffix}`}
        type="number"
        min={-maxTurns}
        max={maxTurns}
        step="1"
        value={Number.isNaN(key.turns) ? "" : key.turns}
        onChange={(e) => onChange(e.target.valueAsNumber)}
      />
    </Field>
  );
}

export function TesseractPhraseEditor({
  config,
  phrase,
  onChange,
  problem,
  drawn,
  onShow,
}: {
  config: Config;
  phrase: TesseractPhrase;
  // Applied to the latest phrase, as a functional update.
  onChange: (change: (phrase: TesseractPhrase) => TesseractPhrase) => void;
  problem?: string;
  // A pane's manual view, as the drawing shows it now.
  drawn: (pane: PhrasePane) => View;
  onShow: (pane: PhrasePane, view: View) => void;
}) {
  const panes = phrasePanes(config);
  const selection = objects[config.object].selection;
  const selecting = selection?.visible(config);
  const patchPhase = (
    i: number,
    change: (p: TesseractPhrasePhase) => TesseractPhrasePhase,
  ) =>
    onChange((p) => ({
      ...p,
      phases: p.phases.map((phase, j) => (j === i ? change(phase) : phase)),
    }));
  const camera = (pane: PhrasePane) => ({
    label: panes.length > 1 ? `Camera: ${paneLabel(config, pane)}` : undefined,
    drawn: (): TesseractPhraseView => ({ ...drawn(pane), turns: 0 }),
    keep: (old: TesseractPhraseView, view: TesseractPhraseView) => ({
      ...view,
      turns: old.turns,
    }),
    onShow: ({ turns: _, ...view }: TesseractPhraseView) => onShow(pane, view),
    describe: describeTesseractView,
    help: tesseractPhraseCameraHelp,
    after: (i: number) => (
      <Turns
        phase={phrase.phases[i]}
        index={i}
        pane={pane}
        onChange={(turns) =>
          patchPhase(i, (p) => {
            const key = p[pane];
            return typeof key === "object"
              ? { ...p, [pane]: { ...key, turns } }
              : p;
          })
        }
      />
    ),
  });
  return (
    <PhraseTimelineEditor<
      TesseractTarget,
      TesseractPhraseView,
      TesseractPhrasePhase,
      TesseractPhrase
    >
      phrase={phrase}
      targets={tesseractPhraseTargets(config)}
      label={tesseractTargetLabel}
      current={(t) => constantText(tesseractTargetValue(config, t))}
      onChange={onChange}
      problem={problem}
      problemField={tesseractPhraseProblemField}
      parameterHelp={(_, track) =>
        track === 0 ? phraseParameterHelp : undefined
      }
      // A study without a spatial pane offers no camera key; none of the
      // admitted objects lacks one, but the editor still needs a camera.
      camera={camera(panes[0] ?? "view")}
      companion={
        panes.includes("companionView") ? camera("companionView") : undefined
      }
      extra={(phase, i, patch) =>
        selecting &&
        selection && (
          <Field
            label={selection.label}
            topic={`Phase ${i + 1} ${selection.label.toLowerCase()}`}
            help={i === 0 ? tesseractPhraseSelectionHelp : undefined}
          >
            <select
              aria-label={`Phase ${i + 1} ${selection.label.toLowerCase()}`}
              value={phase.selected === undefined ? "keep" : phase.selected}
              onChange={(e) => {
                const v = e.target.value;
                patch(({ selected: _, ...p }) =>
                  v === "keep" ? p : { ...p, selected: Number(v) },
                );
              }}
            >
              <option value="keep">Keep</option>
              {/* A cut beyond a reduced count stays shown, and Play
                  names it, as an unavailable parameter is. */}
              {phase.selected !== undefined &&
                !(phase.selected < selection.count(config)) && (
                  <option value={phase.selected}>
                    Unavailable: {formatCount(phase.selected + 1)}
                  </option>
                )}
              {Array.from({ length: selection.count(config) }, (_, k) => (
                <option key={k} value={k}>
                  {formatCount(k + 1)}
                </option>
              ))}
            </select>
          </Field>
        )
      }
    />
  );
}
