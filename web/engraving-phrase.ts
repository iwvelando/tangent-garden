// Engraving phrases: a finite engraving's frozen members shown through named
// phases on the shared phrase timeline (docs/architecture.md, Engraving
// phrases). A phase sets which consecutive members are visible, shows or
// hides layers from its start, and moves the camera. The family owns its
// parameter, so a phrase has no scalar tracks and never asks the engine for
// anything: every frame is composed from the members already held.
//
// Layers and camera keys belong to each notebook; this module carries them
// as opaque values. The notebook resolves a key to its camera state when
// compiling and draws the leg between two states itself.
import { count as formatCount } from "./number-format";
import { locatePhase, phasesError } from "./phrase-timeline";
import type { Pace } from "./timing";

// Consecutive member numbers, from 1, both ends included.
export type MemberSpan = { first: number; last: number };
export type EngravingPhase<L, V> = {
  name: string;
  duration: number;
  pace: Pace;
  // The span shown as the phase ends; omitted holds the preceding span.
  members?: MemberSpan;
  // Layers shown (true) or hidden (false) from the phase's start.
  layers?: Partial<L>;
  // The view reached as the phase ends; omitted holds the preceding view.
  view?: V | "entry";
};
export type EngravingPhrase<L, V> = {
  // The span shown as the phrase opens.
  opening: MemberSpan;
  phases: EngravingPhase<L, V>[];
};

// Each end of the span moves on its own, a whole member at a time at evenly
// spaced points of the phase's progress, and reaches its end value only as
// the phase ends. Both ends move monotonically, so first ≤ last throughout.
export function spanAt(
  from: MemberSpan,
  to: MemberSpan,
  p: number,
): MemberSpan {
  if (p <= 0) return from;
  if (p >= 1) return to;
  const end = (a: number, b: number) =>
    a + Math.sign(b - a) * Math.floor(Math.abs(b - a) * p);
  return { first: end(from.first, to.first), last: end(from.last, to.last) };
}

// A span with one end entered (NaN while its field is empty). An end typed
// alone completes the span it held; clearing both ends of a phase's span
// (holds) holds again, while an opening span always keeps both.
export function setSpanEnd(
  span: MemberSpan | undefined,
  held: MemberSpan,
  end: keyof MemberSpan,
  value: number,
  holds: boolean,
): MemberSpan | undefined {
  const other = end === "first" ? "last" : "first";
  if (holds && Number.isNaN(value) && (!span || Number.isNaN(span[other])))
    return undefined;
  return { ...(span ?? held), [end]: value };
}
// The span in force before phase index: the opening's, or the last a phase
// before it set.
export const spanBefore = <L, V>(
  phrase: EngravingPhrase<L, V>,
  index: number,
) =>
  phrase.phases
    .slice(0, index)
    .reduce<MemberSpan>((span, p) => p.members ?? span, phrase.opening);

// The control and error names of a span's two ends.
export const memberField = (phase: number | "opening", end: keyof MemberSpan) =>
  `${phase === "opening" ? "Opening" : `Phase ${phase + 1}`} ${end} member`;
function spanError(
  span: MemberSpan,
  count: number,
  phase: number | "opening",
): string | null {
  const whole = (v: unknown): v is number =>
    typeof v === "number" && Number.isInteger(v);
  if (!whole(span.first) || span.first < 1 || span.first > count)
    return `${memberField(phase, "first")} must be a whole number from 1 to ${count}.`;
  if (!whole(span.last) || span.last < span.first || span.last > count)
    return `${memberField(phase, "last")} must be a whole number from the first member to ${count}.`;
  return null;
}

// The first refused field, in timeline order: phases, opening span, then
// each phase's name, duration, pace, span and the notebook's own checks
// (layers and camera), and finally the total.
export function engravingPhraseError<L, V>(
  phrase: EngravingPhrase<L, V>,
  count: number,
  checks: {
    phase?: (phase: EngravingPhase<L, V>, index: number) => string | null;
  } = {},
): string | null {
  return phasesError(phrase.phases, {
    opening: () => spanError(phrase.opening, count, "opening"),
    phase: (p, i) =>
      (p.members && spanError(p.members, count, i)) ??
      checks.phase?.(p, i) ??
      null,
  });
}

// A starter over the current family: single out the selected member (from
// 0), show its construction where the study has one, then return to the
// whole family with the study's own layers, so playback opens and ends on
// the drawing as it stands.
export function defaultEngravingPhrase<L extends object, V>(
  count: number,
  selected: number,
  layers: L,
  construction: readonly (keyof L)[],
): EngravingPhrase<L, V> {
  const one = { first: selected + 1, last: selected + 1 };
  const all = { first: 1, last: count };
  const set = (shown: boolean) =>
    Object.fromEntries(construction.map((k) => [k, shown])) as Partial<L>;
  const restore = Object.fromEntries(
    construction.map((k) => [k, layers[k]]),
  ) as Partial<L>;
  const has = construction.length > 0;
  return {
    opening: all,
    phases: [
      {
        name: "Single out one member",
        duration: 3,
        pace: "ease",
        members: one,
        ...(has && { layers: set(false) }),
      },
      ...(has
        ? [
            {
              name: "Show its construction",
              duration: 2,
              pace: "ease" as const,
              layers: set(true),
            },
          ]
        : []),
      { name: "Hold", duration: 1, pace: "ease" },
      {
        name: "Return to the family",
        duration: 3,
        pace: "ease",
        members: all,
        ...(has && { layers: restore }),
      },
    ],
  };
}

type Boundary<L, S> = { span: MemberSpan; layers: L; view: S };
export type CompiledEngravingPhrase<L, V, S> = {
  count: number;
  duration: number;
  phases: {
    name: string;
    start: number;
    end: number;
    pace: Pace;
    from: Boundary<L, S>;
    to: Boundary<L, S>;
    // The phase's own camera key, which a notebook may read more from
    // (a spatial key's whole turns).
    key?: V | "entry";
  }[];
};

// Compiles every boundary once from the family as Play is pressed: the
// entry layers, the entry camera state and each key resolved to its state.
// Nothing a draft holds is kept by reference.
export function compileEngravingPhrase<L extends object, V, S>(
  phrase: EngravingPhrase<L, V>,
  count: number,
  layers: L,
  camera: { entry: S; key: (view: V) => S },
  // How a phase's layer events apply, where a notebook expands them.
  events: (events: Partial<L>) => Partial<L> = (e) => e,
): CompiledEngravingPhrase<L, V, S> {
  const error = engravingPhraseError(phrase, count);
  if (error) throw new Error(error);
  const draft = structuredClone(phrase);
  let previous: Boundary<L, S> = {
    span: draft.opening,
    layers: { ...layers },
    view: camera.entry,
  };
  let duration = 0;
  const phases = draft.phases.map((p) => {
    const from: Boundary<L, S> = {
      ...previous,
      layers: { ...previous.layers, ...events(p.layers ?? {}) },
    };
    const to: Boundary<L, S> = {
      span: p.members ?? from.span,
      layers: { ...from.layers },
      view:
        p.view === undefined
          ? from.view
          : p.view === "entry"
            ? camera.entry
            : camera.key(p.view),
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
      ...(p.view !== undefined && { key: p.view }),
    };
  });
  return { count, duration, phases };
}

// The state at absolute seconds, from the boundaries alone: the phase, its
// eased progress, the span, the layers and the camera's two ends, which the
// notebook joins with its own leg.
export function engravingPhraseAt<L, V, S>(
  phrase: CompiledEngravingPhrase<L, V, S>,
  seconds: number,
) {
  const { index, phase, p } = locatePhase(phrase, seconds);
  return {
    index,
    p,
    phase: phase.name,
    span: spanAt(phase.from.span, phase.to.span, p),
    layers: phase.from.layers,
    from: phase.from.view,
    to: phase.to.view,
    key: phase.key,
  };
}

// The stage and span beside the timeline, never in the drawing.
export const engravingReadout = (at: {
  phase: string;
  first: number;
  last: number;
  count: number;
}) =>
  `${at.phase} · ${
    at.first === at.last
      ? `member ${formatCount(at.first)}`
      : `members ${formatCount(at.first)}–${formatCount(at.last)}`
  } of ${formatCount(at.count)}`;
