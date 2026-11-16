// A planar engraving phrase (engraving-phrase.ts) over a finite planar
// family: phases show a span of the frozen members, change the drawing's
// layers and fly the camera about the family's held framing. Frames are
// composed from the members already held; nothing here computes geometry.
import {
  compileEngravingPhrase,
  defaultEngravingPhrase,
  engravingPhraseAt,
  engravingPhraseError,
  type CompiledEngravingPhrase,
  type EngravingPhrase,
} from "./engraving-phrase";
import { count as formatCount } from "./number-format";
import { keyViewport, type Fit } from "./planar-path";
import { phraseLegView, validView, type PhraseView } from "./phrase";
import {
  constructionLayerChange,
  defaultLayers,
  planarLayerChoices,
  type Layers,
} from "./planar-layers";
import { plainZoom } from "./refinement";
import { tiered } from "./help";
import type { AnimationView, Viewport } from "./animation";
import type { FamilyMember, FamilySettings } from "./planar-family";
import type { Config, Frame } from "./types";

export type PlanarEngravingPhrase = EngravingPhrase<Layers, PhraseView>;
export type CompiledPlanarEngraving = CompiledEngravingPhrase<
  Layers,
  PhraseView,
  Viewport
> & { fit: Fit };

export const engravingLayersHelp = tiered(
  "Show or hide layers from the phase's start; Keep leaves each as it was.",
  "A change lasts into later phases until another phase changes it. Construction layers apply to the selected member unless every member's construction is shown. Stop restores the study's own layers.",
);
export const engravingCameraHelp = tiered(
  "Hold the view, move to a key view, or return to the opening view.",
  `The camera arrives as the phase ends, at the phase's pace. Set to drawing takes the drawing's pan and zoom. Views zoom up to ${plainZoom}×, since members are not recalculated for a closer view.`,
);

const layerNames = new Set(Object.keys(defaultLayers));
// Members are held at the family's own refinement, so a key never zooms
// past the plain drawing's limit.
export function planarEngravingError(
  phrase: PlanarEngravingPhrase,
  count: number,
): string | null {
  return engravingPhraseError(phrase, count, {
    phase: (p, i) => {
      for (const [name, shown] of Object.entries(p.layers ?? {})) {
        if (!layerNames.has(name))
          return `Phase ${i + 1} layer ${name} is not a layer of the drawing.`;
        if (typeof shown !== "boolean")
          return `Phase ${i + 1} layer ${name} must be shown or hidden.`;
      }
      if (p.view === undefined || p.view === "entry") return null;
      if (!validView(p.view) || p.view.zoom > plainZoom)
        return `Phase ${i + 1} view must be a finite center with a zoom of 0.1–${formatCount(plainZoom)}×, or the opening view.`;
      return null;
    },
  });
}

// The construction a selected member explains: what the study offers under
// Construction, apart from virtual extensions, which belong to every member.
export const planarEngravingConstruction = (config: Config) =>
  planarLayerChoices(config)
    .construction.map((c) => c.key)
    .filter((key) => key !== "virtual");

export const defaultPlanarEngraving = (
  config: Config,
  family: Pick<FamilySettings, "count" | "selected">,
  layers: Layers,
): PlanarEngravingPhrase =>
  defaultEngravingPhrase(
    family.count,
    family.selected,
    layers,
    planarEngravingConstruction(config),
  );

// Keys are taken about fit, the family's held framing; the phrase opens at
// entry, that framing or the current view.
export function compilePlanarEngraving(
  phrase: PlanarEngravingPhrase,
  count: number,
  layers: Layers,
  fit: Fit,
  entry: Viewport,
): CompiledPlanarEngraving {
  const error = planarEngravingError(phrase, count);
  if (error) throw new Error(error);
  return {
    ...compileEngravingPhrase(
      phrase,
      count,
      layers,
      { entry, key: (view) => keyViewport({ name: "", ...view }, fit) },
      constructionLayerChange,
    ),
    fit: { ...fit },
  };
}

// The frame at absolute phrase seconds: the visible span of the frozen
// members, the phase's layers and the camera on its leg. progress and time
// are the playback's own, for the slider and completion.
export function samplePlanarEngraving(
  phrase: CompiledPlanarEngraving,
  family: { settings: FamilySettings; members: readonly FamilyMember[] },
  frame: Frame,
  seconds: number,
  timing: { progress: number; time: number; complete: boolean },
  length: number,
  stop: boolean,
  owner: string,
): AnimationView {
  const at = engravingPhraseAt(phrase, seconds);
  return {
    frame,
    final: frame,
    mode: "phrase",
    camera: "current",
    heldView: phraseLegView(phrase.fit, at.from, at.to, at.p),
    progress: timing.progress,
    time: timing.time,
    length,
    stop,
    owner,
    complete: timing.complete,
    family: {
      settings: family.settings,
      members: family.members,
      motion: { mode: "phrase", ...at.span, progress: timing.progress },
    },
    engraving: {
      phase: at.phase,
      layers: at.layers,
      ...at.span,
      count: phrase.count,
    },
  };
}
