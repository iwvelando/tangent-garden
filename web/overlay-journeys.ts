import type { IconName } from "./icons";
import type { PlanarStudy } from "./planar-link";
import { loomPresets, presetLoom, maps } from "./loom/model";
import { gardenPresets, presetGarden } from "./garden/model";
import { lacePresets, presetLace } from "./lace/model";
import { shortenPresets, presetShorten } from "./shorten/model";

export type OverlayKind = "loom" | "garden" | "lace" | "shorten";
export type OverlayJourneyStep = {
  overlay: OverlayKind;
  preset: number;
  note: string;
  suggestion: string;
};
export type OverlayJourney = {
  kind: "overlay";
  title: string;
  icon: IconName;
  steps: OverlayJourneyStep[];
};

// Explicit adapters keep each workspace's complete settings and its own
// underlying notebook. A link opens exactly one overlay.
export function withOverlay<K extends OverlayKind>(
  study: PlanarStudy,
  kind: K,
  settings: NonNullable<PlanarStudy[K]>,
): PlanarStudy {
  const { loom: _l, garden: _g, lace: _h, shorten: _s, ...base } = study;
  return { ...base, [kind]: settings };
}
const adapters = {
  loom: {
    presets: loomPresets,
    study: (i: number, base: PlanarStudy) => presetLoom(i, base.config),
  },
  garden: { presets: gardenPresets, study: presetGarden },
  lace: { presets: lacePresets, study: presetLace },
  shorten: { presets: shortenPresets, study: presetShorten },
};
export function overlayJourneyStudy(
  step: OverlayJourneyStep,
  base: PlanarStudy,
) {
  const adapter = adapters[step.overlay];
  return structuredClone(
    withOverlay(base, step.overlay, adapter.study(step.preset, base)),
  );
}
export const overlayJourneyTitle = (step: OverlayJourneyStep) =>
  adapters[step.overlay].presets[step.preset].title;
export const overlayJourneyPaneLabels = (step: OverlayJourneyStep) =>
  step.overlay === "loom"
    ? ["Source plane · z", maps.square.imageHeading]
    : undefined;

export const overlayJourney: OverlayJourney = {
  kind: "overlay",
  title: "Rules that grow a garden",
  icon: "garden",
  steps: [
    {
      overlay: "loom",
      preset: 0,
      note: "Squaring carries circles through the origin into a rosette of cardioids. The two planes show the same selected thread before and after the map.",
      suggestion:
        "Try Circle radius at 1/2 to shrink both families within the opening frame, then play to follow one point.",
    },
    {
      overlay: "garden",
      preset: 0,
      note: "A different rule fills the gaps between tangent circles. Every small circle has three neighbors that determine it; the packing stops at a finite cutoff.",
      suggestion:
        "Try Minimum radius at 1/50 to leave more gaps open, then play the generation-by-generation reveal.",
    },
    {
      overlay: "lace",
      preset: 0,
      note: "Reflection repeats a motif across heptagons in the hyperbolic plane. The disk's rim is infinitely far away; the smaller tiles are not smaller in that geometry.",
      suggestion:
        "Try Star point at 1/10 to reshape every motif, then play to glide the finite patch inside the fixed rim and back.",
    },
    {
      overlay: "shorten",
      preset: 0,
      note: "Now the rule moves the curve itself: each point follows its inward curvature. Petal tips retreat and notches fill as the flower shrinks toward a round point.",
      suggestion:
        "Try Petal depth at 1/5, then play and seek to compare the loops as they smooth.",
    },
  ],
};
