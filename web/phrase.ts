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
import { progressAt, type Pace } from "./timing";
import type { Config, Result, Frame, ViewRect } from "./types";

export const maxPhases = 12;
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
};
export type Phrase = {
  target: Target;
  opening: PhraseReveal;
  phases: PhrasePhase[];
};
type Boundary = { value: number; layers: Layers; reveal: PhraseReveal };
export type CompiledPhrase = {
  config: Config;
  length: number;
  target: Target;
  duration: number;
  phases: {
    name: string;
    start: number;
    end: number;
    pace: Pace;
    from: Boundary;
    to: Boundary;
  }[];
};

// A starter composition acts on the current study; only choosing an authored
// preset replaces its formulas, source or construction.
export function defaultPhrase(
  config: Config,
  length: number,
  target = phraseTargets(config)[0] ?? "a",
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
        layers: { base: true, lines: false, incident: false, derived: false },
      },
      {
        name: "Reveal the construction",
        duration: 2,
        pace: "ease",
        layers: { lines: true, incident: true },
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
  }
  const duration = phrase.phases.reduce((sum, p) => sum + p.duration, 0);
  return !Number.isFinite(duration) || duration > 3600
    ? "Total phrase duration must be between 0.1 and 3600 seconds."
    : null;
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
): CompiledPhrase {
  const error = phraseError(config, phrase);
  if (error) throw new Error(error);
  if (
    keys.length !== phrase.phases.filter((p) => p.key !== undefined).length ||
    !keys.every(Number.isFinite)
  )
    throw new Error("Every phase key must resolve to a finite constant.");
  let previous: Boundary = {
    value: targetValue(config, phrase.target, length),
    layers: { ...layers },
    reveal: { ...phrase.opening },
  };
  let duration = 0,
    k = 0;
  const phases = phrase.phases.map((p, i) => {
    const from: Boundary = {
      ...previous,
      layers: { ...previous.layers, ...p.layers },
    };
    const to: Boundary = {
      value: p.key === undefined ? from.value : keys[k++],
      layers: { ...from.layers },
      reveal: { ...from.reveal, ...p.reveal },
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
    phases,
  };
}

// Absolute seconds, clamped to the phrase. A boundary belongs to the phase on
// its right; the exact final time uses the explicitly compiled final state.
export function phraseAt(phrase: CompiledPhrase, seconds: number) {
  const time = Math.max(0, Math.min(phrase.duration, seconds));
  const index = Math.max(
    0,
    phrase.phases.findIndex((p) => time < p.end),
  );
  const phase =
    time === phrase.duration
      ? phrase.phases[phrase.phases.length - 1]
      : phrase.phases[index];
  const p = progressAt(
    (time - phase.start) / (phase.end - phase.start),
    "once",
    phase.pace,
  );
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
  };
}

type PhraseEngine = Pick<EngineClient, "compute">;
// One reusable renderer-input sampler for playback, direct seeks, stills and
// export. The caller maps repeat time into absolute phrase seconds and owns
// cancellation. Each engine retains only its last geometry/pending request;
// fixed holds and reveal-only phases perform no repeated numerical work.
export function createPhraseSampler(options: {
  phrase: CompiledPhrase;
  original: Frame;
  view: Viewport;
  stop: boolean;
  focus?: ViewRect;
  probe?: PlanarProbe;
}) {
  const { phrase, original, view, stop, focus, probe } = options;
  const frames = new WeakMap<
    PhraseEngine,
    { value: number; frame: Promise<Frame> }
  >();
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
    let cached = frames.get(engine);
    if (!cached || cached.value !== state.value) {
      const unchanged =
        phrase.target === "rayLength" ||
        state.value ===
          targetValue(original.config, phrase.target, phrase.length);
      const within = t >= state.config.curve.min && t <= state.config.curve.max;
      const frame =
        unchanged && !between
          ? Promise.resolve(original)
          : engine.compute(state.config, undefined, {
              diagnostics: !!probe,
              ...(focus && { view: focus }),
              ...(between && within && { probe: { t } }),
            });
      cached = { value: state.value, frame };
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
      heldView: view,
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
