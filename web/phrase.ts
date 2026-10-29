import {
  applyTracks,
  availableTargets,
  integerTargets,
  reveal,
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
import { progressAt, type Pace } from "./timing";
import type { Config, Result, Frame, ViewRect } from "./types";

export const maxPhases = 12;
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
  layers?: Partial<Layers>;
  reveal?: Partial<PhraseReveal>;
  // The view reached at the phase's end; omitted holds the preceding view.
  view?: PhraseView | "entry";
};
export type Phrase = {
  target: Target;
  opening: PhraseReveal;
  phases: PhrasePhase[];
};
type Boundary = {
  value: number;
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

// The phases' total for readouts and links, without the binary tail their sum
// can accumulate (0.1 + 6.1 + …). Sampling keeps the exact compiled phase ends.
export const phraseDuration = (phrase: Phrase) =>
  Number(phrase.phases.reduce((sum, p) => sum + p.duration, 0).toPrecision(12));

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
  if (!phraseTargets(config).includes(phrase.target))
    return "Phrase parameter must be a consumed continuous target available in this study.";
  if (!phrase.phases.length || phrase.phases.length > maxPhases)
    return "A phrase must contain 1–12 phases.";
  const fraction = (v: number) => Number.isFinite(v) && v >= 0 && v <= 1;
  if (!Object.values(phrase.opening).every(fraction))
    return "Opening reveal fractions must be between 0 and 1.";
  for (const [i, p] of phrase.phases.entries()) {
    if (!p.name.trim() || p.name.length > 60)
      return `Phase ${i + 1} name must contain 1–60 characters.`;
    if (!Number.isFinite(p.duration) || p.duration < 0.1)
      return `Phase ${i + 1} duration must be at least 0.1 seconds.`;
    if (p.pace !== "steady" && p.pace !== "ease")
      return `Phase ${i + 1} pace must be steady or eased.`;
    if (p.key !== undefined && !p.key.trim())
      return `Phase ${i + 1} key must be a finite constant.`;
    if (p.reveal && !Object.values(p.reveal).every(fraction))
      return `Phase ${i + 1} reveal fractions must be between 0 and 1.`;
    if (p.view !== undefined && p.view !== "entry" && !validView(p.view))
      return `Phase ${i + 1} view must be a finite center with a zoom of 0.1–${viewZoom.toLocaleString("en-US")}×, or the opening view.`;
  }
  const duration = phrase.phases.reduce((sum, p) => sum + p.duration, 0);
  return !Number.isFinite(duration) || duration > 3600
    ? "Total phrase duration must be between 0.1 and 3600 seconds."
    : null;
}

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
  if (
    keys.length !== phrase.phases.filter((p) => p.key !== undefined).length ||
    !keys.every(Number.isFinite)
  )
    throw new Error("Every phase key must resolve to a finite constant.");
  const flies = !!camera && phraseFlies(phrase);
  let previous: Boundary = {
    value: targetValue(config, phrase.target, length),
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
    const to: Boundary = {
      value: p.key === undefined ? from.value : keys[k++],
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
    if (phrase.target === "rayLength" && (to.value < 0.01 || to.value > 100))
      throw new Error(`Phase ${i + 1} key: Ray length keys must be 0.01–100.`);
    const start = duration;
    duration += p.duration;
    previous = to;
    return { name: p.name, start, end: duration, pace: p.pace, from, to };
  });
  return {
    config: structuredClone(config),
    length,
    target: phrase.target,
    duration,
    ...(flies && { camera: { fit: { ...camera.fit }, entry: camera.entry } }),
    phases,
  };
}

// Absolute seconds, clamped to the phrase. A boundary belongs to the phase on
// its right; the exact final time uses the explicitly compiled final state.
// p is the phase's eased progress, which inputs, reveal and camera share.
function locatePhase(phrase: CompiledPhrase, seconds: number) {
  const time = Math.max(0, Math.min(phrase.duration, seconds));
  const index =
    time === phrase.duration
      ? phrase.phases.length - 1
      : Math.max(
          0,
          phrase.phases.findIndex((p) => time < p.end),
        );
  const phase = phrase.phases[index];
  const p = progressAt(
    (time - phase.start) / (phase.end - phase.start),
    "once",
    phase.pace,
  );
  return { index, phase, p };
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
  const value = mix(phase.from.value, phase.to.value);
  const values = applyTracks(
    phrase.config,
    [{ target: phrase.target, from: value, to: value }],
    0,
    phrase.length,
  );
  return {
    ...values,
    value,
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

type PhraseEngine = Pick<EngineClient, "compute">;
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
    { value: number; area: string; frame: Promise<Frame> }
  >();
  // Each camera-only phase's pieces, cut when first needed: a few per
  // doubling of zoom, bounded by the phase count.
  const pieces = new Map<number, Piece[]>();
  const area = (index: number, p: number, shown: Viewport) => {
    if (!camera || !refine || !rect || !(shown.scale > camera.fit.scale))
      return camera ? undefined : focus;
    const phase = phrase.phases[index];
    if (phase.from.value !== phase.to.value) return rect(shown);
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
    let cached = frames.get(engine);
    if (!cached || cached.value !== state.value || cached.area !== key) {
      const unchanged =
        phrase.target === "rayLength" ||
        state.value ===
          targetValue(original.config, phrase.target, phrase.length);
      const within = t >= state.config.curve.min && t <= state.config.curve.max;
      const frame =
        unchanged && !between && !key
          ? Promise.resolve(camera && refine ? plain : original)
          : engine.compute(state.config, undefined, {
              diagnostics: !!probe,
              ...(refined && { view: refined }),
              ...(between && within && { probe: { t } }),
            });
      cached = { value: state.value, area: key, frame };
      frames.set(engine, cached);
      const entry = cached;
      frame.catch(() => {
        if (frames.get(engine) === entry) frames.delete(engine);
      });
    }
    const current = await cached.frame;
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
        result: revealPhrase(current.result, state.reveal),
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
export function revealPhrase(result: Result, fractions: PhraseReveal): Result {
  if (
    fractions.base === 1 &&
    fractions.construction === 1 &&
    fractions.derived === 1
  )
    return result;
  const base = reveal(result, fractions.base);
  const construction = reveal(result, fractions.construction);
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
