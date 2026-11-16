// A 3D engraving phrase (../engraving-phrase.ts) over a finite spatial
// family: phases show a span of the frozen members, show or hide layers and
// fly the camera about the members' shared bounds. Each frame is composed
// from the members already held, as reveal and moving-window motion are;
// nothing here asks the engine for geometry.
import {
  compileEngravingPhrase,
  defaultEngravingPhrase,
  engravingPhraseAt,
  engravingPhraseError,
  type CompiledEngravingPhrase,
  type EngravingPhrase,
} from "../engraving-phrase";
import { tiered } from "../help";
import { count as formatCount } from "../number-format";
import { spatialPlainZoom } from "../refinement";
import { sharedBounds } from "./atlas-paint";
import {
  composeSpatialFamily,
  type SpatialFamilyMember,
  type SpatialFamilySettings,
} from "./family";
import { maxTurns, pitchRange, zoomRange } from "./path";
import {
  spatialCameraStates,
  spatialLegView,
  spatialPhraseKeyView,
  type SpatialPhraseView,
} from "./phrase";
import { maxPhases } from "../phrase-timeline";
import {
  conform,
  LinkError,
  withPhaseViews,
  type SchemaOf,
} from "../study-link";
import { defaultLayers, type Layers, type View } from "./scene";
import type { AnimationView } from "./animation";
import type { Bounds3, SpatialConfig } from "./types";

export type SpatialEngravingPhrase = EngravingPhrase<Layers, SpatialPhraseView>;
type CameraState = { view: View; key: SpatialPhraseView };
export type CompiledSpatialEngraving = CompiledEngravingPhrase<
  Layers,
  SpatialPhraseView,
  CameraState
> & { camera: { around: Bounds3; entry: View } };

export const spatialEngravingCameraHelp = tiered(
  "Hold the view, fly to a key view, or return to the opening view.",
  `The camera arrives as the phase ends, at the phase's pace, turning about the page's middle the shorter way plus any whole turns. Set to drawing takes the drawing's orbit, pan and zoom. Views zoom up to ${spatialPlainZoom}×, since members are not recalculated for a closer view.`,
);
export const spatialEngravingLayersHelp = tiered(
  "Show or hide layers from the phase's start; Keep leaves each as it was.",
  "A change lasts into later phases until another phase changes it. Sheets and guides belong to the selected member while it is shown. Stop restores the study's own layers.",
);

const layerNames = new Set(Object.keys(defaultLayers));
// Members are held at the family's own refinement, so a key never zooms
// past the plain drawing's limit.
export function spatialEngravingError(
  phrase: SpatialEngravingPhrase,
  count: number,
): string | null {
  return engravingPhraseError(phrase, count, {
    phase: (p, i) => {
      for (const [name, shown] of Object.entries(p.layers ?? {})) {
        if (!layerNames.has(name))
          return `Phase ${i + 1} layer ${name} is not a layer of the 3D notebook.`;
        if (typeof shown !== "boolean")
          return `Phase ${i + 1} layer ${name} must be shown or hidden.`;
      }
      if (p.view === undefined || p.view === "entry") return null;
      const v = p.view;
      if (
        ![v.yaw, v.pitch, v.zoom, v.panX, v.panY].every(
          (x) => typeof x === "number" && Number.isFinite(x),
        ) ||
        v.pitch < pitchRange[0] ||
        v.pitch > pitchRange[1] ||
        v.zoom < zoomRange[0] ||
        v.zoom > spatialPlainZoom
      )
        return `Phase ${i + 1} view must stay within the orbit and zoom ${formatCount(zoomRange[0])}–${formatCount(spatialPlainZoom)}×, or return to the opening view.`;
      if (!Number.isInteger(v.turns) || Math.abs(v.turns) > maxTurns)
        return `Phase ${i + 1} turns must be a whole number from −${maxTurns} to ${maxTurns}.`;
      return null;
    },
  });
}

// What the selected member explains: its construction's guides, or a
// surface member's sheet and normals, among the layers the study offers.
export function spatialEngravingConstruction(
  config: SpatialConfig,
  offered: readonly (keyof Layers)[],
): (keyof Layers)[] {
  const guides: (keyof Layers)[] =
    config.format === "surface"
      ? ["surface", "normals"]
      : config.construction === "inversion"
        ? ["correspondences", "sphere"]
        : config.construction === "none"
          ? []
          : ["connectors", "pole"];
  return guides.filter((key) => offered.includes(key));
}

export const defaultSpatialEngraving = (
  config: SpatialConfig,
  family: Pick<SpatialFamilySettings, "count" | "selected">,
  layers: Layers,
  offered: readonly (keyof Layers)[],
): SpatialEngravingPhrase =>
  defaultEngravingPhrase(
    family.count,
    family.selected,
    layers,
    spatialEngravingConstruction(config, offered),
  );

// The members' shared bounds, which key views are taken about.
export const engravingBounds = (members: readonly SpatialFamilyMember[]) =>
  sharedBounds(
    members.flatMap((m) => (m.frame ? [m.frame.result.bounds] : [])),
  );

// Keys are taken about the members' shared bounds; the phrase opens at the
// manual view, whose projection every frame keeps.
export function compileSpatialEngraving(
  phrase: SpatialEngravingPhrase,
  count: number,
  layers: Layers,
  camera: { around: Bounds3; entry: View },
): CompiledSpatialEngraving {
  const error = spatialEngravingError(phrase, count);
  if (error) throw new Error(error);
  return {
    ...compileEngravingPhrase(
      phrase,
      count,
      layers,
      spatialCameraStates(camera),
    ),
    camera: { around: camera.around, entry: camera.entry },
  };
}

// The frame at absolute phrase seconds: the visible span of the frozen
// members composed as the family's still is, the phase's layers and the
// camera on its leg.
export function sampleSpatialEngraving(
  phrase: CompiledSpatialEngraving,
  config: SpatialConfig,
  settings: SpatialFamilySettings,
  members: readonly SpatialFamilyMember[],
  seconds: number,
  timing: { progress: number; time: number; complete: boolean },
  length: number,
): AnimationView {
  const at = engravingPhraseAt(phrase, seconds);
  const phase = phrase.phases[at.index];
  const visible = Array.from(
    { length: at.span.last - at.span.first + 1 },
    (_, i) => at.span.first - 1 + i,
  );
  const view = spatialLegView(
    phrase.camera,
    {
      from: phase.from.view,
      to: phase.to.view,
      turns: typeof phase.key === "object" ? phase.key.turns : 0,
    },
    at.p,
  );
  return {
    frame: composeSpatialFamily(config, settings, members, undefined, visible),
    final: composeSpatialFamily(config, settings, members),
    camera: "current",
    heldView: phrase.camera.entry,
    length,
    progress: timing.progress,
    time: timing.time,
    mode: "phrase",
    complete: timing.complete,
    phrase: {
      phase: at.phase,
      view,
      layers: at.layers,
      reveal: 1,
      tracks: [],
      members: { ...at.span, count: phrase.count },
    },
  };
}

// An engraving phrase in a link, over a family of count members: spans,
// the 3D notebook's layer events and key views, with no parameter tracks.
export function spatialEngravingLink(
  value: unknown,
  count: number,
  path: string,
): SpatialEngravingPhrase {
  type Phases = Omit<SpatialEngravingPhrase, "phases"> & {
    phases: Omit<SpatialEngravingPhrase["phases"][number], "view">[];
  };
  const span = { fields: { first: "number", last: "number" } } as const;
  const schema: SchemaOf<Phases> = {
    fields: {
      opening: span,
      phases: {
        list: {
          fields: {
            name: "text",
            duration: { range: [0.1, 3600] },
            pace: { options: { steady: true, ease: true } },
            members: { optional: span },
            layers: {
              optional: {
                fields: Object.fromEntries(
                  Object.keys(defaultLayers).map((k) => [
                    k,
                    { optional: "boolean" },
                  ]),
                ) as SchemaOf<Partial<Layers>> extends { fields: infer F }
                  ? F
                  : never,
              },
            },
          },
        },
        max: maxPhases,
      },
    },
  };
  const phrase = withPhaseViews<SpatialEngravingPhrase>(
    value,
    path,
    (rest) => conform<Phases>(rest, schema, undefined, path),
    (view, field) => spatialPhraseKeyView(view, field, spatialPlainZoom),
  );
  const error = spatialEngravingError(phrase, count);
  if (error) throw new LinkError(path, error);
  return phrase;
}
