import type { SpatialFieldResult, Vec3 } from "./types";

const time = (t: number) => String(Number(t.toPrecision(6)));

// Where and why each trajectory that stopped early did, numbered from 1;
// which seeds rest; and whether the field reads t. `carried` says whether a
// construction is built on the first trajectory.
export function fieldNote(
  field: SpatialFieldResult,
  min: number,
  carried: boolean,
) {
  const notes = field.ends.flatMap(({ time: t, reason }, i) => {
    const n = i + 1;
    if (reason === "escape" && t === min)
      return [`Seed ${n} is outside the escape sphere, so it has no path.`];
    if (reason === "escape")
      return [`Trajectory ${n} leaves the escape sphere at t = ${time(t)}.`];
    if (reason === "singular" && t === min)
      return [`The field is not finite at seed ${n}, so it has no path.`];
    if (reason === "singular")
      return [
        `Trajectory ${n} stops at t = ${time(t)}, where the field stops being finite or changes too fast to follow.`,
      ];
    if (reason === "exhausted")
      return [
        `Trajectory ${n} ran out of integration steps at t = ${time(t)}; a shorter interval needs fewer.`,
      ];
    return [];
  });
  if (!notes.length)
    notes.push(
      field.ends.length === 1
        ? "The trajectory runs to the end of the interval."
        : "Every trajectory runs to the end of the interval.",
    );
  else if (notes.length < field.ends.length)
    notes.push("The others run to the end of the interval.");
  const resting = field.resting.flatMap((r, i) => (r ? [i + 1] : []));
  if (resting.length)
    notes.push(
      resting.length === 1
        ? `Seed ${resting[0]} sits at an equilibrium, where the field's speed is below 10⁻⁹, so its trajectory stays put.`
        : `Seeds ${resting.join(", ")} sit at equilibria, where the field's speed is below 10⁻⁹, so their trajectories stay put.`,
    );
  if (field.timed)
    notes.push(
      "The field changes with t, so arrows show it at their own time.",
    );
  if (carried) notes.push("The construction is built on trajectory 1.");
  return notes.join(" ");
}

// A seed to add after the last: one more step along the line through the
// last two, or half a unit along x from a single seed.
export function nextSpatialSeed(seeds: Vec3[]): Vec3 {
  const last = seeds.at(-1)!;
  const before = seeds.at(-2);
  const next = before
    ? {
        x: 2 * last.x - before.x,
        y: 2 * last.y - before.y,
        z: 2 * last.z - before.z,
      }
    : { x: last.x + 0.5, y: last.y, z: last.z };
  return [next.x, next.y, next.z].every(Number.isFinite)
    ? next
    : { x: 0, y: 0, z: 0 };
}
