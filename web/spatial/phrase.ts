// Spatial animation phrases: one fixed 3D study revealed, moved and flown
// through named phases on one timeline (docs/architecture.md, Spatial
// animation phrases). The timeline, its arrangement and its limits are
// shared with planar phrases (../phrase-timeline.ts); this module adds what
// a spatial phase reveals, shows and flies through, compiles boundary
// states from the immutable entry study, and samples any absolute time.
// Nothing here parses expressions: Go resolves each key beforehand.
import {
  locatePhase,
  phraseKeys,
  phraseTrackTargets,
  timelineError,
  type Timeline,
  type TimelinePhase,
} from "../phrase-timeline";
import type { Pace } from "../timing";
import { conform, LinkError } from "../study-link";
import { count as formatCount } from "../number-format";
import { viewZoom } from "../refinement";
import { roundedGenerated } from "../atlas-queue";
import {
  applyTracks,
  availableTargets,
  integerTargets,
  reveal,
  targetLabel,
  targetValue,
  type AnimationView,
  type Target,
} from "./animation";
import { carries, transportHold } from "./geodesic-path";
import {
  flightPieces,
  keyFromView,
  maxTurns,
  pathView,
  pieceAt,
  pitchRange,
  zoomRange,
  type CameraPath,
  type KeyView,
  type Piece,
} from "./path";
import { defaultLayers, refinementView, type Layers, type View } from "./scene";
import type {
  Bounds3,
  Frame,
  HarmonicChainTrack,
  RefinementView,
  SpatialConfig,
  SpatialResult,
} from "./types";

// A camera key, as a camera path's view about the study's bounds when Play
// is pressed, with the whole turns added on the way to it.
export type SpatialPhraseView = Omit<KeyView, "name" | "leg">;
export type SpatialPhrasePhase = TimelinePhase<Target> & {
  // Shown (true) or hidden (false) from the phase's start.
  layers?: Partial<Layers>;
  // The share of the study drawn at the phase's end; omitted keeps it.
  reveal?: number;
  // The view reached at the phase's end; omitted holds the preceding view.
  view?: SpatialPhraseView | "entry";
};
export type SpatialPhrase = Timeline<Target, SpatialPhrasePhase> & {
  // The share drawn as the phrase opens.
  opening: number;
};

export const spatialPhraseKeys = (phrase: SpatialPhrase) => phraseKeys(phrase);

const usesA = (texts: string[]) => texts.some((e) => /\ba\b/.test(e));
// Counts are excluded, and a coefficient a is offered only when an
// expression the study evaluates consumes it.
export function spatialPhraseTargets(config: SpatialConfig): Target[] {
  const curve =
    config.format === "parametric"
      ? [config.curve.x, config.curve.y, config.curve.z]
      : config.format === "field"
        ? [config.field.x, config.field.y, config.field.z]
        : [];
  return availableTargets(config).filter(
    (t) =>
      !integerTargets.includes(t) &&
      (t !== "a" || usesA(curve)) &&
      (t !== "implicitA" || usesA([config.implicit.f])),
  );
}

const share = (v: unknown) =>
  typeof v === "number" && Number.isFinite(v) && v >= 0 && v <= 1;
const layerNames = new Set(Object.keys(defaultLayers));
// A key view's own limits; its zoom against the drawing's is
// spatialPhraseViewError's.
function viewError(view: unknown, phase: number): string | null {
  if (view === "entry") return null;
  const v = (typeof view === "object" && view) as SpatialPhraseView | false;
  if (
    !v ||
    ![v.yaw, v.pitch, v.zoom, v.panX, v.panY].every(
      (x) => typeof x === "number" && Number.isFinite(x),
    ) ||
    v.pitch < pitchRange[0] ||
    v.pitch > pitchRange[1] ||
    v.zoom < zoomRange[0] ||
    v.zoom > viewZoom
  )
    return `Phase ${phase + 1} view is outside the drawing's orbit and zoom limits.`;
  if (!Number.isInteger(v.turns) || Math.abs(v.turns) > maxTurns)
    return `Phase ${phase + 1} turns must be a whole number from −${maxTurns} to ${maxTurns}.`;
  return null;
}
export function spatialPhraseError(
  config: SpatialConfig,
  phrase: SpatialPhrase,
): string | null {
  return timelineError(
    phrase,
    spatialPhraseTargets(config),
    (t) => targetLabel(config, t),
    {
      opening: () =>
        share(phrase.opening)
          ? null
          : "Opening reveal must be between 0 and 1.",
      phase: (p, i) => {
        if (p.reveal !== undefined && !share(p.reveal))
          return `Phase ${i + 1} reveal must be between 0 and 1.`;
        for (const [name, shown] of Object.entries(p.layers ?? {})) {
          if (!layerNames.has(name))
            return `Phase ${i + 1} layer ${name} is not a layer of the 3D notebook.`;
          if (typeof shown !== "boolean")
            return `Phase ${i + 1} layer ${name} must be shown or hidden.`;
        }
        return p.view === undefined ? null : viewError(p.view, i);
      },
    },
  );
}
// A view deeper than the drawing allows: 8×, unless the study is refined
// to its view (as for camera paths).
export function spatialPhraseViewError(
  phrase: SpatialPhrase,
  zoomLimit: number,
) {
  const i = phrase.phases.findIndex(
    (p) => typeof p.view === "object" && p.view.zoom > zoomLimit,
  );
  return i < 0
    ? null
    : `Phase ${i + 1} view zooms past ${formatCount(zoomLimit)}×${zoomLimit < viewZoom ? "; refine the study to its view to zoom further" : ""}.`;
}
export const spatialPhraseFlies = (phrase: SpatialPhrase) =>
  phrase.phases.some((p) => p.view !== undefined);

// A starter for a study without a phrase: draw it, move its first
// parameter, hold and return, at the view it opens with.
export function defaultSpatialPhrase(
  config: SpatialConfig,
  target = spatialPhraseTargets(config)[0] ?? "a",
): SpatialPhrase {
  const start = targetValue(config, target);
  // A generated default without a binary tail (see contributing.md,
  // Generated numeric defaults).
  const end =
    start === 0
      ? 0.5
      : roundedGenerated(
          start * 0.75,
          Math.max(Math.abs(start), Math.abs(start * 0.75)),
        );
  return {
    target,
    opening: 0,
    phases: [
      { name: "Draw the study", duration: 3, pace: "ease", reveal: 1 },
      {
        name: "Move the parameter",
        duration: 3,
        pace: "ease",
        key: String(end),
      },
      { name: "Hold", duration: 1, pace: "ease" },
      { name: "Return", duration: 3, pace: "ease", key: String(start) },
    ],
  };
}

type Boundary = {
  values: number[];
  layers: Layers;
  reveal: number;
  view: View;
  // The boundary's view as a key about the study's bounds, for legs.
  key: SpatialPhraseView;
};
// The study's bounds when Play is pressed, which key views are taken
// about, and the view the phrase opens at: the manual camera's, whose
// projection the whole phrase draws in.
export type SpatialPhraseCamera = { around: Bounds3; entry: View };
export type CompiledSpatialPhrase = {
  config: SpatialConfig;
  length: number;
  target: Target;
  // Every track's target, the first parameter's first, and its label.
  targets: Target[];
  labels: string[];
  duration: number;
  camera: SpatialPhraseCamera;
  // Whether any phase moves the camera.
  flies: boolean;
  phases: {
    name: string;
    start: number;
    end: number;
    pace: Pace;
    from: Boundary;
    to: Boundary;
    // Whether the phase moves a computed track, or the camera.
    moves: boolean;
    turns: number;
  }[];
};

// The projection a phrase flies in: the opening view's.
const lensOf = (view: View): Pick<View, "projection" | "lensAngle"> => ({
  ...(view.projection && { projection: view.projection }),
  ...(view.projection === "chosen" && { lensAngle: view.lensAngle }),
});
// A key view as drawn about the bounds, through the lens.
const keyedView = (
  key: SpatialPhraseView,
  around: Bounds3,
  lens: Pick<View, "projection" | "lensAngle">,
) =>
  pathView(
    { style: "steady", keys: [{ name: "", ...key }] },
    around,
    0,
    false,
    undefined,
    lens,
  );

// Compiles every boundary once from the immutable entry study. keys are
// the Go-resolved values of spatialPhraseKeys, in that order.
export function compileSpatialPhrase(
  config: SpatialConfig,
  layers: Layers,
  length: number,
  phrase: SpatialPhrase,
  keys: number[],
  camera: SpatialPhraseCamera,
): CompiledSpatialPhrase {
  const error = spatialPhraseError(config, phrase);
  if (error) throw new Error(error);
  const texts = spatialPhraseKeys(phrase);
  if (keys.length !== texts.length || !keys.every(Number.isFinite))
    throw new Error("Every phase key must resolve to a finite constant.");
  const targets = phraseTrackTargets(phrase);
  const lens = lensOf(camera.entry);
  // The opening view as a key, without clamping it to a zoom limit: legs
  // leave from it, and boundaries keep the view itself.
  const { name: _, ...entryKey } = keyFromView(
    camera.entry,
    camera.around,
    "",
    Infinity,
  );
  let previous: Boundary = {
    values: targets.map((t) => targetValue(config, t, length)),
    layers: { ...layers },
    reveal: phrase.opening,
    view: camera.entry,
    key: entryKey,
  };
  let duration = 0,
    k = 0;
  const phases = phrase.phases.map((p, i) => {
    const from: Boundary = {
      ...previous,
      layers: { ...previous.layers, ...p.layers },
    };
    const values = from.values.map((held, track) =>
      texts[k]?.phase === i && texts[k].track === track ? keys[k++] : held,
    );
    const [view, key] =
      p.view === undefined
        ? [from.view, from.key]
        : p.view === "entry"
          ? [camera.entry, entryKey]
          : [keyedView(p.view, camera.around, lens), { ...p.view, turns: 0 }];
    const to: Boundary = {
      values,
      layers: { ...from.layers },
      reveal: p.reveal ?? from.reveal,
      view,
      key,
    };
    const start = duration;
    duration += p.duration;
    previous = to;
    return {
      name: p.name,
      start,
      end: duration,
      pace: p.pace,
      from,
      to,
      moves: values.some((v, track) => v !== from.values[track]),
      turns: typeof p.view === "object" ? p.view.turns : 0,
    };
  });
  return {
    config: structuredClone(config),
    length,
    target: phrase.target,
    targets,
    labels: targets.map((t) => targetLabel(config, t)),
    duration,
    camera: { around: camera.around, entry: camera.entry },
    flies: spatialPhraseFlies(phrase),
    phases,
  };
}

// What a phase's camera leg needs: its two boundaries' views and keys, and
// the whole turns added on the way.
type Leg = {
  from: Pick<Boundary, "view" | "key">;
  to: Pick<Boundary, "view" | "key">;
  turns: number;
};
// A phase's camera as a steady two-view path about the study's bounds.
const legPath = (phase: Leg): CameraPath => ({
  style: "steady",
  keys: [
    { name: "", ...phase.from.key, turns: 0 },
    { name: "", ...phase.to.key, turns: phase.turns },
  ],
});
// Whether a phase's camera stands still.
const holds = (phase: Leg) =>
  phase.from.view === phase.to.view && phase.turns === 0;
// The camera within a phase: exactly its stored views at both ends and
// throughout a hold, and otherwise a steady leg at the phase's eased
// progress (mathematics.md#spatial-camera-paths).
export function spatialLegView(
  camera: SpatialPhraseCamera,
  phase: Leg,
  p: number,
) {
  if (p === 0 || holds(phase)) return phase.from.view;
  if (p === 1) return phase.to.view;
  return pathView(
    legPath(phase),
    camera.around,
    p,
    false,
    undefined,
    lensOf(camera.entry),
  );
}
const viewAt = (phrase: CompiledSpatialPhrase, phase: Leg, p: number) =>
  spatialLegView(phrase.camera, phase, p);
// A phrase camera's boundary states: the opening view with its key, and a
// key view as drawn about the bounds through the opening lens. The opening
// key is not clamped to a zoom limit: legs leave from it, and boundaries
// keep the view itself.
export function spatialCameraStates(camera: SpatialPhraseCamera) {
  const lens = lensOf(camera.entry);
  const { name: _, ...entryKey } = keyFromView(
    camera.entry,
    camera.around,
    "",
    Infinity,
  );
  return {
    entry: { view: camera.entry, key: entryKey },
    key: (view: SpatialPhraseView) => ({
      view: keyedView(view, camera.around, lens),
      key: { ...view, turns: 0 },
    }),
  };
}

export function spatialPhraseAt(
  phrase: CompiledSpatialPhrase,
  seconds: number,
) {
  const { index, phase, p } = locatePhase(phrase, seconds);
  const mix = (a: number, b: number) => (a === b ? a : a * (1 - p) + b * p);
  // Each track between its own endpoints, at the phase's one progress.
  const values = phase.from.values.map((from, track) =>
    mix(from, phase.to.values[track]),
  );
  const applied = applyTracks(
    phrase.config,
    phrase.targets.map((target, track) => ({
      target,
      from: values[track],
      to: values[track],
    })),
    0,
    phrase.length,
  );
  return {
    ...applied,
    index,
    p,
    values,
    phase: phase.name,
    layers: { ...phase.from.layers },
    reveal: mix(phase.from.reveal, phase.to.reveal),
    view: viewAt(phrase, phase, p),
  };
}

// The study drawn to a share of its reveal order. A carried arrow travels
// with the share itself: the reveal mode's own hold at its arrival is the
// phrase's to author. The whole share is the study's own result.
export function revealShare(
  result: SpatialResult,
  drawn: number,
  chains?: HarmonicChainTrack,
): SpatialResult {
  if (drawn >= 1) return result;
  const p = carries(result.surface?.geodesics)
    ? drawn * (1 - transportHold)
    : drawn;
  return reveal(result, p, chains);
}

type PhraseEngine = {
  computeSpatial: (
    config: SpatialConfig,
    options?: { view?: RefinementView; views?: RefinementView[] },
  ) => Promise<Frame>;
};
export type SpatialPhrasePresentation = {
  phase: string;
  view: View;
  layers: Layers;
  reveal: number;
  tracks: { label: string; value: number; range: readonly [number, number] }[];
  // An engraving phrase's span of members, for its readout (engraving.ts).
  members?: { first: number; last: number; count: number };
};
// One renderer-input sampler for playback, seeks, loop checks and export.
// The caller maps repeat time into absolute phrase seconds and owns
// cancellation. Each engine keeps only its latest geometry, keyed by every
// track's value and the area it is refined to: holds, reveals and camera
// moves make no new request, and a frame with every track at its entry
// value is the study as drawn.
//
// In a study refined to its view (page), a flown frame zoomed past the
// fitted framing is refined to its own view while a track moves, or to its
// camera-only phase's flight piece, each refined once; frames at the
// fitted zoom or wider with every track at its entry value draw plain, the
// study refined to no view. A phrase that holds its view refines every
// computed frame to the opening view's focus, as the still is.
export function createSpatialPhraseSampler(options: {
  phrase: CompiledSpatialPhrase;
  original: Frame;
  plain?: Frame;
  page?: { width: number; height: number };
  focus?: RefinementView;
  chains?: HarmonicChainTrack;
  // Applied to a computed frame's study while playing coarsely.
  coarse?: (config: SpatialConfig) => SpatialConfig;
}) {
  const { phrase, original, page, focus, chains } = options;
  const plain = options.plain ?? original;
  const frames = new WeakMap<
    PhraseEngine,
    { input: string; frame: Promise<Frame> }
  >();
  // Each camera-only phase's pieces, cut when first needed, and each
  // piece's refined study, kept for the session: bounded by the phases.
  const pieces = new Map<number, Piece[]>();
  const refined = new Map<string, Promise<Frame>>();
  const opening = phrase.targets.map((t) =>
    targetValue(original.config, t, phrase.length),
  );
  const ranges = phrase.targets.map((_, track) => {
    const all = phrase.phases.flatMap((p) => [
      p.from.values[track],
      p.to.values[track],
    ]);
    return [Math.min(...all), Math.max(...all)] as const;
  });
  const lens = lensOf(phrase.camera.entry);
  const flown = (view: View) => !!page && phrase.flies && view.zoom > 1;
  return async (
    seconds: number,
    engine: PhraseEngine,
    coarse = false,
  ): Promise<AnimationView> => {
    const state = spatialPhraseAt(phrase, seconds);
    const phase = phrase.phases[state.index];
    const entry = state.values.every((v, track) => v === opening[track]);
    let frame: Promise<Frame>;
    if (flown(state.view) && !phase.moves && !holds(phase)) {
      // A camera-only phase zoomed in: its piece's one refinement.
      if (!pieces.has(state.index))
        pieces.set(
          state.index,
          flightPieces(
            legPath(phase),
            phrase.camera.around,
            false,
            page!,
            undefined,
            lens,
          ),
        );
      const cut = pieces.get(state.index)!;
      const k = cut.length ? pieceAt(cut, state.p) : -1;
      const id = `${state.index}:${k}`;
      if (!refined.has(id)) {
        const config = applyTracks(
          phrase.config,
          phrase.targets.map((target, track) => ({
            target,
            from: phase.from.values[track],
            to: phase.from.values[track],
          })),
          0,
          phrase.length,
        ).config;
        const views =
          k < 0 ? [refinementView(state.view, page!)] : cut[k].views;
        const pending = engine.computeSpatial(config, { views });
        refined.set(id, pending);
        // A failed piece is tried again when a frame next needs it.
        pending.catch(() => refined.delete(id));
      }
      frame = refined.get(id)!;
    } else {
      const area = flown(state.view)
        ? refinementView(state.view, page!)
        : phrase.flies
          ? undefined
          : focus;
      const input = [
        state.values.join(),
        area ? JSON.stringify(area) : "",
        coarse && !entry ? "coarse" : "",
      ].join("|");
      let cached = frames.get(engine);
      if (!cached || cached.input !== input) {
        const config =
          coarse && options.coarse
            ? options.coarse(state.config)
            : state.config;
        const pending =
          entry && !flown(state.view)
            ? Promise.resolve(phrase.flies && page ? plain : original)
            : engine.computeSpatial(config, area ? { view: area } : {});
        cached = { input, frame: pending };
        frames.set(engine, cached);
        const mine = cached;
        pending.catch(() => {
          if (frames.get(engine) === mine) frames.delete(engine);
        });
      }
      frame = cached.frame;
    }
    const current = await frame;
    const drawn = revealShare(
      current.result,
      state.reveal,
      entry ? chains : undefined,
    );
    return {
      frame:
        drawn === current.result
          ? current
          : { config: current.config, result: drawn },
      final: original,
      camera: "current",
      heldView: phrase.camera.entry,
      length: state.length,
      progress: Math.max(0, Math.min(1, seconds / phrase.duration)),
      mode: "phrase",
      complete: seconds >= phrase.duration,
      phrase: {
        phase: state.phase,
        view: state.view,
        layers: state.layers,
        reveal: state.reveal,
        tracks: phrase.targets.map((_, track) => ({
          label: phrase.labels[track],
          value: state.values[track],
          range: ranges[track],
        })),
      },
    };
  };
}

// The field a phrase problem names, so it is shown under that control.
export const spatialPhraseProblemField = (problem?: string) =>
  /^Phase \d+ (duration|key \d|key|view|turns|name|reveal|layer)\b/.exec(
    problem ?? "",
  )?.[0];

// A key view in a link, conformed under its field: within the orbit, zoom
// up to zoomLimit and whole turns. The phrase's own check then applies the
// drawing's limits.
export function spatialPhraseKeyView(
  view: unknown,
  field: string,
  zoomLimit: number,
): SpatialPhraseView {
  const key = conform<SpatialPhraseView>(
    view,
    {
      fields: {
        yaw: "number",
        pitch: { range: pitchRange },
        zoom: { range: [zoomRange[0], zoomLimit] },
        panX: "number",
        panY: "number",
        turns: { range: [-maxTurns, maxTurns] },
      },
    },
    undefined,
    field,
  );
  if (!Number.isInteger(key.turns))
    throw new LinkError(
      `${field}.turns`,
      `${field}.turns must be a whole number.`,
    );
  return key;
}
