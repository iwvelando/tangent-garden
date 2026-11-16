import { count as formatCount } from "./number-format";
import {
  applyTracks,
  availableTargets,
  integerTargets,
  reveal,
  ridesHead,
  targetLabel,
  targetValue,
  type Target,
  type AnimationView,
  type Viewport,
} from "./animation";
import type { EngineClient } from "./engine-client";
import { roundedGenerated } from "./atlas";
import {
  parameterAt,
  probeBetween,
  sampleProbe,
  type PlanarProbe,
} from "./planar-probe";
import { heldCurveSample, unreached } from "./probe";
import type { Layers } from "./Plot";
import { constructionLayerChange, defaultLayers } from "./planar-layers";
import {
  flightPieces,
  keyFromViewport,
  keyViewport,
  pieceAt,
  planarPathView,
  type Fit,
  type Piece,
  type PlanarPath,
} from "./planar-path";
import { viewZoom } from "./refinement";
import type { Pace } from "./timing";
import {
  locatePhase,
  phraseKeyField,
  phraseKeys,
  phraseTrackTargets,
  timelineError,
} from "./phrase-timeline";
import type {
  Config,
  ConstructionTrack,
  Result,
  Frame,
  ViewRect,
} from "./types";

export {
  addPhraseTrack,
  insertPhase,
  maxPhases,
  maxPhraseTracks,
  movePhase,
  phaseKey,
  phraseDuration,
  phraseKeyField,
  phraseKeys,
  phraseTrackTargets,
  removePhase,
  removePhraseTrack,
  retargetPhraseTrack,
  setPhaseKey,
} from "./phrase-timeline";

// A camera key: the point of the plane in the middle of the page and the
// zoom relative to the opening study's fitted framing, as a planar camera
// path's view (planar-path.ts), or the phrase's own opening view.
export type PhraseView = { x: number; y: number; zoom: number };
export type PhraseReveal = {
  base: number;
  construction: number;
  derived: number;
};
export type PhrasePhase = {
  name: string;
  duration: number;
  pace: Pace;
  // An omitted key holds the preceding value; keys are Go scalar expressions.
  key?: string;
  // The further parameters' keys, by target; an omitted one holds that
  // parameter alone.
  keys?: Partial<Record<Target, string>>;
  layers?: Partial<Layers>;
  reveal?: Partial<PhraseReveal>;
  // The view reached at the phase's end; omitted holds the preceding view.
  view?: PhraseView | "entry";
};
export type Phrase = {
  target: Target;
  // Further parameters moving with the first: distinct targets, each owning
  // one scalar of the study. Omitted in a single-parameter phrase.
  also?: Target[];
  opening: PhraseReveal;
  phases: PhrasePhase[];
};
type Boundary = {
  // The first parameter's value, and every parameter's in track order.
  value: number;
  values: number[];
  layers: Layers;
  reveal: PhraseReveal;
  // Present only in a phrase that moves its camera.
  view?: Viewport;
};
// The opening study's fitted framing, which keys are taken about, and the
// view the phrase opens at: the fitted one, or the effective manual view.
export type PhraseCamera = { fit: Fit; entry: Viewport };
export type CompiledPhrase = {
  config: Config;
  length: number;
  target: Target;
  // Every track's target, the first parameter's first.
  targets: Target[];
  duration: number;
  camera?: PhraseCamera;
  phases: {
    name: string;
    start: number;
    end: number;
    pace: Pace;
    from: Boundary;
    to: Boundary;
  }[];
};

// What a phase reveals: nothing new, or roles drawn in full or erased. A
// link may carry fractions these do not name ("custom"), which stay until
// another choice replaces them.
type Role = keyof PhraseReveal;
export const revealChoices = {
  keep: {},
  "draw-base": { base: 1 },
  "draw-construction": { construction: 1 },
  "draw-derived": { derived: 1 },
  "draw-base-construction": { base: 1, construction: 1 },
  "draw-construction-derived": { construction: 1, derived: 1 },
  "draw-all": { base: 1, construction: 1, derived: 1 },
  "erase-construction": { construction: 0 },
  "erase-derived": { derived: 0 },
  "erase-construction-derived": { construction: 0, derived: 0 },
} satisfies Record<string, Partial<PhraseReveal>>;
export type RevealChoice = keyof typeof revealChoices;
const roles: Role[] = ["base", "construction", "derived"];
export function phaseRevealChoice(phase: PhrasePhase): RevealChoice | "custom" {
  const reveal = phase.reveal ?? {};
  const found = (Object.keys(revealChoices) as RevealChoice[]).find((choice) =>
    roles.every(
      (role) =>
        reveal[role] === (revealChoices[choice] as Partial<PhraseReveal>)[role],
    ),
  );
  return found ?? "custom";
}
// The layers that show a role. Drawing a role turns them on at the phase's
// start, so it appears even where the study opens with it hidden; the
// construction keeps the study's chosen subsets.
const roleLayers = (role: Role, entry: Layers): Partial<Layers> =>
  role === "base"
    ? { base: true }
    : role === "derived"
      ? { derived: true }
      : {
          lines: true,
          definitionGuides: entry.definitionGuides,
          rollingGuides: entry.rollingGuides,
          incident: true,
        };
export function withPhaseReveal(
  phase: PhrasePhase,
  choice: RevealChoice | "custom",
  entry: Layers,
): PhrasePhase {
  if (choice === "custom") return phase;
  const { reveal: before = {}, layers: events = {}, ...rest } = phase;
  const reveal: Partial<PhraseReveal> = revealChoices[choice];
  // Drop the layer events the previous choice drew with; others stay.
  const layers: Partial<Layers> = { ...events };
  for (const role of roles)
    if (before[role] === 1)
      for (const key of Object.keys(roleLayers(role, entry)))
        delete layers[key as keyof Layers];
  for (const role of roles)
    if (reveal[role] === 1) Object.assign(layers, roleLayers(role, entry));
  return {
    ...rest,
    ...(Object.keys(layers).length > 0 && { layers }),
    ...(Object.keys(reveal).length > 0 && { reveal: { ...reveal } }),
  };
}

// A starter composition acts on the current study; only choosing an authored
// preset replaces its formulas, source or construction.
export function defaultPhrase(
  config: Config,
  length: number,
  target = phraseTargets(config)[0] ?? "a",
  layers: Layers = defaultLayers,
): Phrase {
  const start = targetValue(config, target, length);
  const computed =
    target === "min" || target === "max"
      ? start
      : target === "sourceX" && start === 1
        ? 0.5
        : target.endsWith("Phase") || target === "sourceTheta"
          ? start + Math.PI / 2
          : start === 0
            ? 0.5
            : start * 0.75;
  const end =
    computed === start
      ? start
      : roundedGenerated(
          computed,
          Math.max(Math.abs(start), Math.abs(computed)),
        );
  const middle =
    end === start
      ? start
      : roundedGenerated(
          start / 2 + end / 2,
          Math.max(Math.abs(start), Math.abs(end)),
        );
  return {
    target,
    opening: { base: 1, construction: 0, derived: 0 },
    phases: [
      {
        name: "Establish the base",
        duration: 1,
        pace: "ease",
        layers: {
          base: true,
          lines: false,
          definitionGuides: false,
          rollingGuides: false,
          incident: false,
          derived: false,
        },
      },
      {
        name: "Reveal the construction",
        duration: 2,
        pace: "ease",
        layers: {
          lines: true,
          definitionGuides: layers.definitionGuides,
          rollingGuides: layers.rollingGuides,
          incident: true,
        },
        reveal: { construction: 1 },
      },
      {
        name: "Find the envelope",
        duration: 2,
        pace: "ease",
        layers: { derived: true },
        reveal: { derived: 1 },
      },
      {
        name: "Move the parameter",
        duration: 3,
        pace: "ease",
        key: String(middle),
      },
      { name: "Reach the detail", duration: 3, pace: "ease", key: String(end) },
      { name: "Hold the detail", duration: 2, pace: "ease" },
      { name: "Return", duration: 3, pace: "ease", key: String(start) },
    ],
  };
}

// Counts are excluded even where the ordinary parameter player offers them.
// The coefficient a is offered only when an expression actually consumes it.
export function phraseTargets(config: Config): Target[] {
  if (config.curve.format === "attractor") return [];
  const c = config.curve;
  const expressions =
    c.format === "parametric"
      ? [c.x, c.y]
      : c.format === "cartesian"
        ? [c.y]
        : c.format === "polar"
          ? [c.r]
          : c.format === "implicit"
            ? [c.implicit.f]
            : c.format === "field"
              ? [c.field.x, c.field.y]
              : [];
  if (c.format !== "implicit" && config.kind === "envelope")
    expressions.push(
      ...(config.envelope.mode === "angle"
        ? [config.envelope.angle]
        : config.envelope.mode === "chord"
          ? [config.envelope.x, config.envelope.y]
          : [config.envelope.radius]),
    );
  if (
    c.format !== "implicit" &&
    config.kind === "rolling" &&
    config.rolling.shape === "curve"
  )
    expressions.push(config.rolling.curve.x, config.rolling.curve.y);
  return availableTargets(config).filter(
    (t) =>
      !integerTargets.includes(t) &&
      (t !== "a" || expressions.some((e) => /\ba\b/.test(e))),
  );
}

export function phraseError(config: Config, phrase: Phrase): string | null {
  return timelineError(phrase, phraseTargets(config), targetLabel, {
    opening: () =>
      Object.values(phrase.opening).every(fraction)
        ? null
        : "Opening reveal fractions must be between 0 and 1.",
    phase: (p, i) => {
      if (p.reveal && !Object.values(p.reveal).every(fraction))
        return `Phase ${i + 1} reveal fractions must be between 0 and 1.`;
      if (p.view !== undefined && p.view !== "entry" && !validView(p.view))
        return `Phase ${i + 1} view must be a finite center with a zoom of 0.1–${formatCount(viewZoom)}×, or the opening view.`;
      return null;
    },
  });
}
const fraction = (v: number) => Number.isFinite(v) && v >= 0 && v <= 1;

const validView = (view: unknown) => {
  if (typeof view !== "object" || view === null) return false;
  const { x, y, zoom } = view as PhraseView;
  return (
    [x, y, zoom].every((v) => typeof v === "number" && Number.isFinite(v)) &&
    zoom >= 0.1 &&
    zoom <= viewZoom
  );
};
export const phraseFlies = (phrase: Phrase) =>
  phrase.phases.some((p) => p.view !== undefined);
// A view deeper than the drawing allows: 20×, unless the study is refined
// to its view (as for camera paths).
export function phraseViewError(phrase: Phrase, zoomLimit: number) {
  const i = phrase.phases.findIndex(
    (p) => typeof p.view === "object" && p.view.zoom > zoomLimit,
  );
  return i < 0
    ? null
    : `Phase ${i + 1} view zooms past ${zoomLimit}×${zoomLimit < viewZoom ? "; refine the study to its view to zoom further" : ""}.`;
}

// Compile all carried values once from the immutable entry study. No seek or
// playback history contributes to a boundary. Only scalar keys are supplied by
// the caller, after Go resolves them; this module never parses expressions.
export function compilePhrase(
  config: Config,
  layers: Layers,
  length: number,
  phrase: Phrase,
  keys: number[],
  // The reference framing and opening view, taken once per session. A
  // phrase without views keeps its fixed camera and compiles none.
  camera?: PhraseCamera,
): CompiledPhrase {
  const error = phraseError(config, phrase);
  if (error) throw new Error(error);
  const texts = phraseKeys(phrase);
  if (keys.length !== texts.length || !keys.every(Number.isFinite))
    throw new Error("Every phase key must resolve to a finite constant.");
  const targets = phraseTrackTargets(phrase);
  const flies = !!camera && phraseFlies(phrase);
  const entry = targets.map((t) => targetValue(config, t, length));
  let previous: Boundary = {
    value: entry[0],
    values: entry,
    layers: { ...layers },
    reveal: { ...phrase.opening },
    ...(flies && { view: camera.entry }),
  };
  let duration = 0,
    k = 0;
  const phases = phrase.phases.map((p, i) => {
    const from: Boundary = {
      ...previous,
      layers: {
        ...previous.layers,
        ...constructionLayerChange(p.layers ?? {}),
      },
    };
    const values = from.values.map((held, track) =>
      texts[k]?.phase === i && texts[k].track === track ? keys[k++] : held,
    );
    const to: Boundary = {
      value: values[0],
      values,
      layers: { ...from.layers },
      reveal: { ...from.reveal, ...p.reveal },
      ...(flies && {
        view:
          p.view === undefined
            ? from.view
            : p.view === "entry"
              ? camera.entry
              : keyViewport({ name: "", ...p.view }, camera.fit),
      }),
    };
    const ray = targets.indexOf("rayLength");
    if (ray >= 0 && (values[ray] < 0.01 || values[ray] > 100))
      throw new Error(
        `${phraseKeyField(i, ray)}: Ray length keys must be 0.01–100.`,
      );
    const start = duration;
    duration += p.duration;
    previous = to;
    return { name: p.name, start, end: duration, pace: p.pace, from, to };
  });
  return {
    config: structuredClone(config),
    length,
    target: phrase.target,
    targets,
    duration,
    ...(flies && { camera: { fit: { ...camera.fit }, entry: camera.entry } }),
    phases,
  };
}

const sameView = (a: Viewport, b: Viewport) =>
  a === b ||
  (a.cx === b.cx && a.cy === b.cy && a.scale === b.scale && a.span === b.span);
// A phase's camera as a two-view planar path about the reference fit.
const legPath = (from: Viewport, to: Viewport, fit: Fit): PlanarPath => ({
  style: "steady",
  keys: [keyFromViewport(from, fit), keyFromViewport(to, fit)],
});
// The camera within a phase: exactly its stored views at both ends and
// throughout a hold, and otherwise a steady planar leg at the phase's eased
// progress: log zoom linear, and the framed point moving straight to the
// middle (mathematics.md#planar-camera-paths).
function viewAt(
  phrase: CompiledPhrase,
  from: Viewport,
  to: Viewport,
  p: number,
): Viewport {
  if (p === 0 || sameView(from, to)) return from;
  if (p === 1) return to;
  const fit = phrase.camera!.fit;
  return planarPathView(legPath(from, to, fit), fit, p);
}
export function phraseAt(phrase: CompiledPhrase, seconds: number) {
  const { phase, p } = locatePhase(phrase, seconds);
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
    value: values[0],
    values,
    phase: phase.name,
    layers: { ...phase.from.layers },
    reveal: {
      base: mix(phase.from.reveal.base, phase.to.reveal.base),
      construction: mix(
        phase.from.reveal.construction,
        phase.to.reveal.construction,
      ),
      derived: mix(phase.from.reveal.derived, phase.to.reveal.derived),
    },
    ...(phase.from.view && {
      view: viewAt(phrase, phase.from.view, phase.to.view!, p),
    }),
  };
}

// An engine without tracks draws a construction stage's representative
// samples alone.
type PhraseEngine = Pick<EngineClient, "compute"> &
  Partial<Pick<EngineClient, "track">>;
// One reusable renderer-input sampler for playback, direct seeks, stills and
// export. The caller maps repeat time into absolute phrase seconds and owns
// cancellation. Each engine retains only its last geometry/pending request,
// keyed by the input value and the area it is refined to; fixed holds and
// reveal-only phases perform no repeated numerical work.
//
// A phrase that moves its camera draws each frame at its sampled view. In a
// study refined to its view (refine), a frame zoomed past the reference fit
// is refined to its own view while the input moves, and to its planar
// flight piece while only the camera moves, so that phase refines once per
// piece rather than once per frame; frames at the fitted zoom or wider at
// the opening value draw plain, the study refined to no view.
export function createPhraseSampler(options: {
  phrase: CompiledPhrase;
  original: Frame;
  view: Viewport;
  stop: boolean;
  focus?: ViewRect;
  probe?: PlanarProbe;
  refine?: boolean;
  plain?: Frame;
  // The rectangle a view shows (Plot's viewRect).
  rect?: (view: Viewport) => ViewRect;
}) {
  const { phrase, original, view, stop, focus, probe, refine, rect } = options;
  const camera = phrase.camera;
  const plain = options.plain ?? original;
  const frames = new WeakMap<
    PhraseEngine,
    { value: string; area: string; frame: Promise<Frame> }
  >();
  // Each engine's last construction track, by input value: the track is the
  // study's samples, which the area a frame is refined to leaves alone.
  const tracks = new WeakMap<
    PhraseEngine,
    { value: string; track: Promise<ConstructionTrack> }
  >();
  // Each camera-only phase's pieces, cut when first needed: a few per
  // doubling of zoom, bounded by the phase count.
  const pieces = new Map<number, Piece[]>();
  const area = (index: number, p: number, shown: Viewport) => {
    if (!camera || !refine || !rect || !(shown.scale > camera.fit.scale))
      return camera ? undefined : focus;
    const phase = phrase.phases[index];
    if (phase.from.values.some((v, track) => v !== phase.to.values[track]))
      return rect(shown);
    if (!pieces.has(index))
      pieces.set(
        index,
        flightPieces(
          legPath(phase.from.view!, phase.to.view!, camera.fit),
          camera.fit,
          false,
          rect,
        ),
      );
    const cut = pieces.get(index)!;
    return cut.length ? cut[pieceAt(cut, p)].view : rect(shown);
  };
  const between = !!probe && probeBetween(original.config, probe);
  const t = probe
    ? parameterAt(
        original.config.curve.min,
        original.config.curve.max,
        probe.position,
      )
    : 0;
  // Ray length is drawn, not computed; every other track at its entry value
  // is the entry study.
  const opening = phrase.targets.map((target) =>
    targetValue(original.config, target, phrase.length),
  );
  // Each track's extent over the phrase, for its readout's fixed columns.
  const ranges = phrase.targets.map((_, track) => {
    const all = phrase.phases.flatMap((p) => [
      p.from.values[track],
      p.to.values[track],
    ]);
    return [Math.min(...all), Math.max(...all)] as const;
  });
  return async (
    seconds: number,
    engine: PhraseEngine,
  ): Promise<AnimationView> => {
    const state = phraseAt(phrase, seconds);
    const shown = state.view ?? view;
    const { index, p } = locatePhase(phrase, seconds);
    const refined = area(index, p, shown);
    // A held frame refined to the fixed entry view reuses the original.
    const key =
      camera && refined
        ? [
            refined.x0,
            refined.y0,
            refined.x1,
            refined.y1,
            refined.radius,
          ].join()
        : "";
    // The numerical input: every track's value. One number is a value
    // itself, so a single-parameter phrase keys as it always has.
    const input = state.values.join();
    let cached = frames.get(engine);
    if (!cached || cached.value !== input || cached.area !== key) {
      const unchanged = phrase.targets.every(
        (target, track) =>
          target === "rayLength" || state.values[track] === opening[track],
      );
      const within = t >= state.config.curve.min && t <= state.config.curve.max;
      const frame =
        unchanged && !between && !key
          ? Promise.resolve(camera && refine ? plain : original)
          : engine.compute(state.config, undefined, {
              diagnostics: !!probe,
              ...(refined && { view: refined }),
              ...(between && within && { probe: { t } }),
            });
      cached = {
        value: input,
        area: key,
        frame,
      };
      frames.set(engine, cached);
      const entry = cached;
      frame.catch(() => {
        if (frames.get(engine) === entry) frames.delete(engine);
      });
    }
    const current = await cached.frame;
    // While the construction is being drawn, the constructions at the
    // curve's head move with it, as in a reveal.
    const drawing =
      state.reveal.construction > 0 &&
      state.reveal.construction < 1 &&
      !!engine.track &&
      ridesHead(current.result);
    let followed = drawing ? tracks.get(engine) : undefined;
    if (drawing && followed?.value !== input) {
      followed = {
        value: input,
        track: engine.track!(current.config),
      };
      tracks.set(engine, followed);
      const entry = followed;
      followed.track.catch(() => {
        if (tracks.get(engine) === entry) tracks.delete(engine);
      });
    }
    const track = followed && (await followed.track);
    const position =
      probe && current.result.diagnostics && original.result.diagnostics
        ? heldCurveSample(
            original.result.diagnostics,
            probe.position,
            "stays",
            current.result.diagnostics,
            0,
          )
        : null;
    const held = between
      ? current.result.probe
      : typeof position === "number"
        ? sampleProbe(current.result, position)
        : undefined;
    const reached = !probe || state.reveal.base >= probe.position;
    return {
      frame: {
        config: current.config,
        result: revealPhrase(current.result, state.reveal, track),
      },
      final: original,
      camera: "current",
      heldView: shown,
      length: state.length,
      stop,
      progress: Math.max(0, Math.min(1, seconds / phrase.duration)),
      mode: "phrase",
      complete: seconds >= phrase.duration,
      phrase: {
        phase: state.phase,
        layers: state.layers,
        reveal: state.reveal,
        target: phrase.target,
        value: state.value,
        range: ranges[0],
        ...(phrase.targets.length > 1 && {
          also: phrase.targets.slice(1).map((target, k) => ({
            target,
            value: state.values[k + 1],
            range: ranges[k + 1],
          })),
        }),
      },
      ...(held && reached && { probe: held }),
      ...(!reached
        ? { probeAway: unreached }
        : typeof position === "string"
          ? { probeAway: position }
          : {}),
    };
  };
}

// Each role cuts the original ordered geometry independently. Existing gaps,
// refined sample indices and real/virtual flags stay attached to their points.
export function revealPhrase(
  result: Result,
  fractions: PhraseReveal,
  track?: ConstructionTrack,
): Result {
  if (
    fractions.base === 1 &&
    fractions.construction === 1 &&
    fractions.derived === 1
  )
    return result;
  const base = reveal(result, fractions.base);
  const construction = reveal(result, fractions.construction, track);
  const derived = reveal(result, fractions.derived);
  const b = fractions.base > 0,
    c = fractions.construction > 0,
    d = fractions.derived > 0;
  return {
    ...result,
    base: b ? base.base : [],
    input: b ? base.input : result.input?.slice(0, 0),
    second: b ? base.second : result.second?.slice(0, 0),
    derived: d ? derived.derived : [],
    virtual: d ? derived.virtual : [],
    family: derived.family.map((f) => ({ ...f, points: d ? f.points : [] })),
    rays: c ? construction.rays : [],
    circles: c ? construction.circles : [],
    rolling: c ? construction.rolling : [],
    roulette: construction.roulette && {
      ...construction.roulette,
      positions: c ? construction.roulette.positions : [],
    },
    harmonic: construction.harmonic && {
      ...construction.harmonic,
      positions: c ? construction.harmonic.positions : [],
    },
    moving: construction.moving && {
      ...construction.moving,
      positions: c ? construction.moving.positions : [],
    },
    pursuit: base.pursuit && {
      ...base.pursuit,
      paths: base.pursuit.paths.map((p) => (b ? p : [])),
      polygons: c ? construction.pursuit!.polygons : [],
    },
    field: base.field && {
      ...base.field,
      paths: base.field.paths.map((p) => (b ? p : [])),
      arrows: c ? construction.field!.arrows : [],
    },
    adaptive: result.adaptive && {
      base: b ? base.adaptive?.base : undefined,
      input: b ? base.adaptive?.input : undefined,
      derived: d ? derived.adaptive?.derived : undefined,
      family: d ? derived.adaptive?.family : undefined,
    },
    contours: result.contours && {
      ...result.contours,
      curve: {
        ...base.contours!.curve,
        contours: b ? base.contours!.curve.contours : [],
      },
      family: derived.contours!.family.map((f) => ({
        ...f,
        contours: d ? f.contours : [],
      })),
      normals: c ? construction.contours!.normals : [],
    },
  };
}
