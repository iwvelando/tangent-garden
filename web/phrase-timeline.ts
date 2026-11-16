// A phrase's timeline, shared by the planar and spatial notebooks: named
// phases on one clock, each with optional end values for up to three
// parameters (tracks). Each notebook adds what its phases reveal, show and
// fly through, and owns its targets and their labels; nothing here parses
// expressions or touches geometry.
import { progressAt, type Pace } from "./timing";

export const maxPhases = 12;
// The phrase's own parameter and up to two more, moving on one timeline.
export const maxPhraseTracks = 3;
export const maxPhraseSeconds = 3600;
export const maxPhaseName = 60;

export type TimelinePhase<T extends string> = {
  name: string;
  duration: number;
  pace: Pace;
  // An omitted key holds the preceding value; keys are Go scalar expressions.
  key?: string;
  // The further parameters' keys, by target; an omitted one holds that
  // parameter alone.
  keys?: Partial<Record<T, string>>;
};
export type Timeline<T extends string, P extends TimelinePhase<T>> = {
  target: T;
  // Further parameters moving with the first: distinct targets, each owning
  // one scalar of the study. Omitted in a single-parameter phrase.
  also?: T[];
  phases: P[];
};

// The phases' total for readouts and links, without the binary tail their sum
// can accumulate (0.1 + 6.1 + …). Sampling keeps the exact compiled phase ends.
export const phraseDuration = (phrase: { phases: { duration: number }[] }) =>
  Number(phrase.phases.reduce((sum, p) => sum + p.duration, 0).toPrecision(12));

// Every track's target: the phrase's own parameter, then the further ones.
export const phraseTrackTargets = <T extends string>(phrase: {
  target: T;
  also?: T[];
}): T[] => [phrase.target, ...(phrase.also ?? [])];
// The control and error name of a phase's key: the first parameter's is
// "Phase 2 key", the others' "Phase 2 key 2" and "Phase 2 key 3".
export const phraseKeyField = (phase: number, track: number) =>
  `Phase ${phase + 1} key${track ? ` ${track + 1}` : ""}`;
// A phase's key text for a track, or undefined while it holds.
export const phaseKey = <T extends string>(
  phrase: { also?: T[] },
  phase: TimelinePhase<T>,
  track: number,
) => (track === 0 ? phase.key : phase.keys?.[phrase.also![track - 1]]);
// Every explicit key, in phase order and within a phase in track order: the
// order a notebook's compiler takes their resolved values in.
export function phraseKeys<T extends string>(
  phrase: Timeline<T, TimelinePhase<T>>,
) {
  const targets = phraseTrackTargets(phrase);
  return phrase.phases.flatMap((p, phase) =>
    targets.flatMap((_, track) => {
      const text = phaseKey(phrase, p, track);
      return text === undefined ? [] : [{ phase, track, text }];
    }),
  );
}

// Arranging a phrase. Each returns the same phrase when the change is not
// available, and never alters another phase or track.
// A one-second hold after a phase, at that phase's pace.
export function insertPhase<
  T extends string,
  P extends TimelinePhase<T>,
  F extends Timeline<T, P>,
>(phrase: F, after: number): F {
  if (phrase.phases.length >= maxPhases || !phrase.phases[after]) return phrase;
  const hold = { name: "Hold", duration: 1, pace: phrase.phases[after].pace };
  return {
    ...phrase,
    phases: [
      ...phrase.phases.slice(0, after + 1),
      hold as P,
      ...phrase.phases.slice(after + 1),
    ],
  };
}
export function removePhase<F extends Timeline<string, TimelinePhase<string>>>(
  phrase: F,
  index: number,
): F {
  if (phrase.phases.length <= 1 || !phrase.phases[index]) return phrase;
  return { ...phrase, phases: phrase.phases.filter((_, i) => i !== index) };
}
export function movePhase<F extends Timeline<string, TimelinePhase<string>>>(
  phrase: F,
  from: number,
  to: number,
): F {
  if (from === to || !phrase.phases[from] || !phrase.phases[to]) return phrase;
  const phases = [...phrase.phases];
  phases.splice(to, 0, ...phases.splice(from, 1));
  return { ...phrase, phases };
}
// An empty text holds the preceding value.
export function setPhaseKey<
  T extends string,
  P extends TimelinePhase<T>,
  F extends Timeline<T, P>,
>(phrase: F, index: number, track: number, text: string): F {
  const target = phraseTrackTargets(phrase)[track];
  if (!phrase.phases[index] || !target) return phrase;
  const held = !text.trim();
  return {
    ...phrase,
    phases: phrase.phases.map((p, i) => {
      if (i !== index) return p;
      const { key, keys, ...rest } = p;
      if (track === 0)
        return {
          ...rest,
          ...(!held && { key: text }),
          ...(keys && { keys }),
        } as P;
      const { [target]: _, ...others } = (keys ?? {}) as Record<string, string>;
      const next = { ...others, ...(!held && { [target]: text }) };
      return {
        ...rest,
        ...(key !== undefined && { key }),
        ...(Object.keys(next).length > 0 && { keys: next }),
      } as P;
    }),
  };
}
// A further parameter, holding through every phase until given end values.
export function addPhraseTrack<
  T extends string,
  F extends Timeline<T, TimelinePhase<T>>,
>(phrase: F, target: T): F {
  const targets = phraseTrackTargets(phrase);
  if (targets.length >= maxPhraseTracks || targets.includes(target))
    return phrase;
  return { ...phrase, also: [...(phrase.also ?? []), target] };
}
// Removes a further parameter with its keys; the last leaves a
// single-parameter phrase exactly.
export function removePhraseTrack<
  T extends string,
  P extends TimelinePhase<T>,
  F extends Timeline<T, P>,
>(phrase: F, target: T): F {
  if (!phrase.also?.includes(target)) return phrase;
  const { also, ...rest } = phrase;
  const remaining = also.filter((t) => t !== target);
  return {
    ...rest,
    ...(remaining.length > 0 && { also: remaining }),
    phases: phrase.phases.map((p) => {
      if (!p.keys) return p;
      const { keys, ...phase } = p;
      const { [target]: _, ...others } = keys as Record<string, string>;
      return (
        Object.keys(others).length ? { ...phase, keys: others } : phase
      ) as P;
    }),
  } as F;
}
// Gives a track another target. Its explicit keys start again from the
// study's current value, as text; the other tracks' keys stay.
export function retargetPhraseTrack<
  T extends string,
  P extends TimelinePhase<T>,
  F extends Timeline<T, P>,
>(phrase: F, track: number, target: T, value: string): F {
  const targets = phraseTrackTargets(phrase);
  const old = targets[track];
  if (!old || old === target || targets.includes(target)) return phrase;
  if (track === 0)
    return {
      ...phrase,
      target,
      phases: phrase.phases.map((p) =>
        p.key === undefined ? p : { ...p, key: value },
      ),
    };
  return {
    ...phrase,
    also: phrase.also!.map((t) => (t === old ? target : t)),
    phases: phrase.phases.map((p) => {
      if (!p.keys) return p;
      // In track order, so a link reads the same however it was edited.
      const keys = Object.fromEntries(
        Object.entries(p.keys).map(([t, text]) =>
          t === old ? [target, value] : [t, text],
        ),
      );
      return { ...p, keys };
    }),
  };
}

// The checks every notebook's phrase shares, in the order planar phrases
// have always reported them: tracks, phase count, then each phase's name,
// duration, pace and keys, and finally the total. A notebook's own checks
// run after the phase count (`opening`) and after each phase's keys
// (`phase`). available lists the targets a phrase may move.
export function timelineError<T extends string, P extends TimelinePhase<T>>(
  phrase: Timeline<T, P>,
  available: readonly T[],
  label: (target: T) => string,
  checks: {
    opening?: () => string | null;
    phase?: (phase: P, index: number) => string | null;
  } = {},
): string | null {
  if (!available.includes(phrase.target))
    return "Phrase parameter must be a consumed continuous target available in this study.";
  const also = phrase.also ?? [];
  if (also.length > maxPhraseTracks - 1)
    return `A phrase varies at most ${maxPhraseTracks} parameters.`;
  if (new Set([phrase.target, ...also]).size !== also.length + 1)
    return "Phrase parameters must be distinct: each owns one value of the study.";
  if (!also.every((t) => available.includes(t)))
    return "Every phrase parameter must be a consumed continuous target available in this study.";
  if (!phrase.phases.length || phrase.phases.length > maxPhases)
    return `A phrase must contain 1–${maxPhases} phases.`;
  const opening = checks.opening?.();
  if (opening) return opening;
  for (const [i, p] of phrase.phases.entries()) {
    if (!p.name.trim() || p.name.length > maxPhaseName)
      return `Phase ${i + 1} name must contain 1–${maxPhaseName} characters.`;
    if (!Number.isFinite(p.duration) || p.duration < 0.1)
      return `Phase ${i + 1} duration must be at least 0.1 seconds.`;
    if (p.pace !== "steady" && p.pace !== "ease")
      return `Phase ${i + 1} pace must be steady or eased.`;
    if (p.key !== undefined && !p.key.trim())
      return `Phase ${i + 1} key must be a finite constant.`;
    for (const [target, text] of Object.entries(p.keys ?? {})) {
      const track = also.indexOf(target as T);
      if (track < 0)
        return `Phase ${i + 1} has a key for ${label(target as T)}, which is not one of the phrase's further parameters.`;
      if (typeof text !== "string" || !text.trim())
        return `${phraseKeyField(i, track + 1)} must be a finite constant.`;
    }
    const own = checks.phase?.(p, i);
    if (own) return own;
  }
  const duration = phrase.phases.reduce((sum, p) => sum + p.duration, 0);
  return !Number.isFinite(duration) || duration > maxPhraseSeconds
    ? `Total phrase duration must be between 0.1 and ${maxPhraseSeconds} seconds.`
    : null;
}

// Absolute seconds, clamped to the phrase. A boundary belongs to the phase on
// its right; the exact final time uses the explicitly compiled final state.
// p is the phase's eased progress, which inputs, reveal and camera share.
export function locatePhase<
  Q extends { start: number; end: number; pace: Pace },
>(phrase: { duration: number; phases: Q[] }, seconds: number) {
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
