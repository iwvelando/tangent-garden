// The 3D notebook's own parts of the phrase editor: its reveal, camera,
// turns and layer events, and their help. The timeline, tracks and
// arrangement are the shared PhraseTimelineEditor's.
import { count as formatCount } from "../number-format";
import { Field } from "../Field";
import { PhaseLayers as SharedPhaseLayers } from "../PhaseLayers";
import { tiered } from "../help";
import { spatialPlainZoom, viewZoom } from "../refinement";
import type { PhraseEditorReveal } from "../PhraseEditor";
import { maxTurns } from "./path";
import type { Layers } from "./scene";
import type { SpatialPhrasePhase } from "./phrase";

export const spatialPhraseHelp = tiered(
  "Reveal, move, show and fly one study through labeled phases you arrange.",
  "Add, remove, rename and reorder phases; edit their durations, end values, reveals, layers and camera views. Empty end values hold the preceding value. Each phase lasts at least 0.1 seconds, with 1–12 phases and at most 3600 seconds in total. Geometry is never blended. Stop restores your study and manual view.",
);
export const spatialPhraseRevealHelp = tiered(
  "Draw or erase the study along its reveal during the phase.",
  "Drawing follows the curve's samples, a surface's rows, a level surface's box or geodesic threads, at the phase's pace; a carried arrow travels with them. Erasing runs back the same way. A linked phrase's partial reveal stays until another choice replaces it.",
);
export const spatialPhraseCameraHelp = tiered(
  "Hold the view, fly to a key view, or return to the opening view.",
  `The camera arrives as the phase ends, at the phase's pace, turning about the page's middle the shorter way plus any whole turns. Set to drawing takes the drawing's orbit, pan and zoom. Views zoom up to ${spatialPlainZoom}×, or ${formatCount(viewZoom)}× in a study refined to its view.`,
);
export const spatialPhraseTurnsHelp = `Whole turns added on the way to this view, −${maxTurns} to ${maxTurns}; positive turns as the orbit does.`;
export const spatialPhraseLayersHelp = tiered(
  "Show or hide layers from the phase's start; Keep leaves each as it was.",
  "A change lasts into later phases until another phase changes it. The legend follows the drawing. Stop restores the study's own layers.",
);

// Drawing, erasing, or neither; a link's other shares are shown as such.
export const spatialReveal: PhraseEditorReveal<SpatialPhrasePhase> = {
  value: (phase) =>
    phase.reveal === undefined
      ? "keep"
      : phase.reveal === 1
        ? "draw"
        : phase.reveal === 0
          ? "erase"
          : "custom",
  options: [
    ["keep", "Keep what is drawn"],
    ["draw", "Draw the study"],
    ["erase", "Erase the study"],
  ],
  custom: "Partly drawn, as linked",
  apply: (phase, choice) => {
    if (choice === "custom") return phase;
    const { reveal: _, ...rest } = phase;
    return choice === "keep"
      ? rest
      : { ...rest, reveal: choice === "draw" ? 1 : 0 };
  },
  help: spatialPhraseRevealHelp,
};

export function PhaseTurns({
  phase,
  index,
  onChange,
}: {
  phase: SpatialPhrasePhase;
  index: number;
  onChange: (turns: number) => void;
}) {
  if (typeof phase.view !== "object") return null;
  return (
    <Field
      label="Turns"
      topic={`Phase ${index + 1} turns`}
      help={spatialPhraseTurnsHelp}
    >
      <input
        aria-label={`Phase ${index + 1} turns`}
        type="number"
        min={-maxTurns}
        max={maxTurns}
        step="1"
        value={Number.isNaN(phase.view.turns) ? "" : phase.view.turns}
        onChange={(e) => onChange(e.target.valueAsNumber)}
      />
    </Field>
  );
}

// The 3D notebook's layer events, with its help.
export const PhaseLayers = (
  props: Omit<Parameters<typeof SharedPhaseLayers<keyof Layers>>[0], "help">,
) => <SharedPhaseLayers {...props} help={spatialPhraseLayersHelp} />;
