import type { FieldResult, Vec } from "./types";

const time = (t: number) => String(Number(t.toPrecision(6)));

// Where and why each trajectory that stopped early did, numbered from 1,
// and why a field with t has no direction field.
export function endNote(field: FieldResult, min: number) {
  const ends = trajectoryNote(field, min);
  return field.timed
    ? `${ends} The field changes with t, so no single direction field is drawn.`
    : ends;
}

function trajectoryNote(field: FieldResult, min: number) {
  const notes = field.ends.flatMap(({ time: t, reason }, i) => {
    const n = i + 1;
    if (reason === "escape" && t === min)
      return [`Seed ${n} is outside the escape circle, so it has no path.`];
    if (reason === "escape")
      return [`Trajectory ${n} leaves the escape circle at t = ${time(t)}.`];
    if (reason === "singular" && t === min)
      return [`The field is not finite at seed ${n}, so it has no path.`];
    if (reason === "singular")
      return [
        `Trajectory ${n} stops at t = ${time(t)}, where the field stops being finite or changes too fast to follow.`,
      ];
    if (reason === "exhausted")
      return [
        `Trajectory ${n} ran out of integration steps at t = ${time(t)}; a shorter domain needs fewer.`,
      ];
    return [];
  });
  if (!notes.length)
    return field.ends.length === 1
      ? "The trajectory runs to the end of the domain."
      : "Every trajectory runs to the end of the domain.";
  if (notes.length < field.ends.length)
    notes.push("The others run to the end of the domain.");
  return notes.join(" ");
}

// A seed to add after the last: one more step along the line through the
// last two, or half a unit to the right of a single seed.
export function nextSeed(seeds: Vec[]): Vec {
  const last = seeds.at(-1)!;
  const before = seeds.at(-2);
  const next = before
    ? { x: 2 * last.x - before.x, y: 2 * last.y - before.y }
    : { x: last.x + 0.5, y: last.y };
  return Number.isFinite(next.x) && Number.isFinite(next.y)
    ? next
    : { x: 0, y: 0 };
}
