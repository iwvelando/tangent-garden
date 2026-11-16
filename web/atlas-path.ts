// A path through atlas cells, shared by the three notebooks' atlases: its
// stops and limits, and the ordinary phrase timeline it becomes. Each
// notebook maps its atlas axes to phrase parameters (AtlasAxis.track) and
// supplies what its phrase adds (an opening reveal); motion is then the
// notebook's own phrase, evaluated at full quality, never interpolated
// preview pictures.
import type { AtlasAxis } from "./atlas-queue";
import type { TimelinePhase } from "./phrase-timeline";

// Twelve stops and the return make twelve phases, the timeline's limit, and
// at most 24 keys of its 36.
export const maxPathStops = 12;
export const stepSeconds: readonly [number, number] = [0.1, 300];
export type AtlasPath = {
  // Cell indexes, row-major, in the order they are visited.
  stops: number[];
  // Whether the path returns to its first stop.
  closed: boolean;
  // Each move's duration.
  seconds: number;
};
export const emptyPath = (): AtlasPath => ({
  stops: [],
  closed: false,
  seconds: 2,
});

// The same path when full, or when the cell is the stop it would leave.
export function addStop(path: AtlasPath, index: number): AtlasPath {
  if (path.stops.length >= maxPathStops || path.stops.at(-1) === index)
    return path;
  return { ...path, stops: [...path.stops, index] };
}
// Neighbors that become equal merge, so every move changes a value.
export function removeStop(path: AtlasPath, position: number): AtlasPath {
  if (!(position in path.stops)) return path;
  const stops = path.stops
    .filter((_, i) => i !== position)
    .filter((stop, i, all) => i === 0 || stop !== all[i - 1]);
  return { ...path, stops };
}
export const pathCloses = (path: AtlasPath) =>
  path.stops.length >= 2 &&
  (path.closed || path.stops[0] === path.stops.at(-1));

type PathCell = { values: [number, number]; frame?: unknown };
export function pathError(
  path: AtlasPath,
  cells: readonly PathCell[],
): string | null {
  if (path.stops.length < 2) return "Choose at least two cells for a path.";
  const lost = path.stops.findIndex((i) => !cells[i]?.frame);
  if (lost >= 0) return `Stop ${lost + 1} is unavailable; remove it.`;
  const [least, most] = stepSeconds;
  if (!(path.seconds >= least && path.seconds <= most))
    return `Seconds per step must be ${least}–${most}.`;
  return null;
}

// A value's text, which Go reads back as the same number.
const keyText = (v: number) => (Object.is(v, -0) ? "-0" : String(v));
// One eased phase per move. A key is the destination cell's exact value; an
// axis the move leaves alone holds.
export function pathTimeline<T extends string>(
  path: AtlasPath,
  cells: readonly PathCell[],
  [first, second]: readonly [T, T],
): { target: T; also: T[]; phases: TimelinePhase<T>[] } {
  const visits = path.stops.map((index, i) => ({
    index,
    name: `To stop ${i + 1}`,
  }));
  if (pathCloses(path) && path.stops[0] !== path.stops.at(-1))
    visits.push({ index: path.stops[0], name: "Return to stop 1" });
  const phases = visits.slice(1).map(({ index, name }, i) => {
    const [x, y] = cells[index].values;
    const [px, py] = cells[visits[i].index].values;
    return {
      name,
      duration: path.seconds,
      pace: "ease" as const,
      ...(!Object.is(x, px) && { key: keyText(x) }),
      ...(!Object.is(y, py) && {
        keys: { [second]: keyText(y) } as Partial<Record<T, string>>,
      }),
    };
  });
  return { target: first, also: [second], phases };
}

// Why a pair cannot become a path in this study, or null: both axes must
// move phrase parameters the notebook offers for it.
export function pathRefusal(
  axes: readonly AtlasAxis[],
  available: readonly string[],
): string | null {
  const missing = axes.find((a) => !a.track || !available.includes(a.track));
  return missing
    ? `${missing.label} is not a phrase parameter in this study, so this pair has no path.`
    : null;
}
