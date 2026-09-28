import type { SpatialPursuer, SpatialPursuitResult } from "./types";

const time = (t: number) => String(Number(t.toPrecision(6)));

// Why the chase stopped where it did, with pursuers numbered from 1.
// `carried` says whether a construction is built on the first path.
export function pursuitNote(
  pursuit: SpatialPursuitResult,
  min: number,
  carried: boolean,
) {
  const c = pursuit.capture;
  const notes = [
    c && c.time === min
      ? `Pursuer ${c.pursuer + 1} starts within the capture distance of pursuer ${c.target + 1}, so the chase ends at once.`
      : c
        ? `Pursuer ${c.pursuer + 1} comes within the capture distance of pursuer ${c.target + 1} at t = ${time(c.time)}, and the chase stops there for everyone: later samples are left empty.`
        : pursuit.exhausted
          ? `The chase ran out of integration steps at t = ${time(pursuit.end)}: later samples are left empty. A shorter interval or a larger capture distance needs fewer steps.`
          : "No pursuer comes within the capture distance of its target by the end of the interval.",
  ];
  if (carried) notes.push("The construction is built on pursuer 1’s path.");
  return notes.join(" ");
}

// A pursuer to add after the last: halfway back to the first, which it will
// chase, at the last one's speed.
export function nextSpatialPursuer(pursuers: SpatialPursuer[]): SpatialPursuer {
  const last = pursuers.at(-1)!;
  const first = pursuers[0];
  const mid = (a: number, b: number) =>
    Number.isFinite(a) && Number.isFinite(b) ? (a + b) / 2 : 0;
  return {
    x: mid(last.x, first.x),
    y: mid(last.y, first.y),
    z: mid(last.z, first.z),
    speed: Number.isFinite(last.speed) ? last.speed : 1,
  };
}
