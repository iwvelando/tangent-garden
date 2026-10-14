// A camera flown through key views, shared by the 2D and 3D notebooks: the
// list of views, each leg's time, where progress stands among them, and the
// monotone interpolation the smooth style uses. Each notebook's own module
// says what a view is and how the camera moves between two of them (2D:
// planar-path.ts; 3D: spatial/path.ts). See mathematics.md#spatial-camera-paths.
import { tiered } from "./help";

export type PathStyle = "steady" | "smooth";
// A key view as both notebooks keep it: a name, and the time of the leg
// that arrives at it, relative to the others: each leg takes its share of
// the duration in proportion to its time. Absent, it is 1, so paths without
// times fly their views equally spaced. The first view has no leg before
// it.
export type KeyBase = { name: string; leg?: number };
export type KeyPath = { keys: KeyBase[] };
export const maxKeys = 12;
export const maxKeyName = 60;
export const legRange: [number, number] = [0.1, 10];
export const pathStyles: { value: PathStyle; label: string }[] = [
  { value: "steady", label: "Steady" },
  { value: "smooth", label: "Smooth" },
];
export const keyLabel = (path: KeyPath, k: number) =>
  path.keys[k]?.name.trim() || `View ${k + 1}`;

// Moves view k to place `to`. Each view keeps the leg arriving at it, and
// whatever else asFirst clears, unless it becomes the first.
export function moveKeys<K extends KeyBase>(
  keys: K[],
  k: number,
  to: number,
  asFirst: (key: K) => K,
): K[] {
  const n = keys.length;
  if (k === to || k < 0 || k >= n || to < 0 || to >= n) return keys;
  const moved = keys.slice();
  const [key] = moved.splice(k, 1);
  moved.splice(to, 0, key);
  return moved.map((key, j) => (j ? key : asFirst(key)));
}
// Removes view k; a view that becomes the first is cleared by asFirst.
export const removeKeys = <K extends KeyBase>(
  keys: K[],
  k: number,
  asFirst: (key: K) => K,
): K[] =>
  keys.filter((_, j) => j !== k).map((key, j) => (j ? key : asFirst(key)));

export type PathError = { field: string; message: string };
// Why a path's list of views cannot play, naming the field, or null: its
// count, each name and each leg time. A notebook checks its own camera
// fields; check is called with each view and its name, View k.
export function keysError<K extends KeyBase>(
  keys: K[],
  check: (key: K, name: string, k: number) => PathError | null,
): PathError | null {
  if (keys.length < 2)
    return {
      field: "Key views",
      message: "need at least two views to fly between.",
    };
  if (keys.length > maxKeys)
    return {
      field: "Key views",
      message: `hold at most ${maxKeys} views.`,
    };
  for (let k = 0; k < keys.length; k++) {
    const key = keys[k],
      name = `View ${k + 1}`;
    if (key.name.length > maxKeyName)
      return {
        field: `${name} name`,
        message: `must be at most ${maxKeyName} characters.`,
      };
    const own = check(key, name, k);
    if (own) return own;
    if (k === 0 && key.leg !== undefined && key.leg !== 1)
      return {
        field: `${name} leg time`,
        message: "must be 1: the first view has no leg before it.",
      };
    const leg = key.leg ?? 1;
    if (!(leg >= legRange[0] && leg <= legRange[1]))
      return {
        field: `${name} leg time`,
        message: `must be from ${legRange[0]} to ${legRange[1]}.`,
      };
  }
  return null;
}

// The help both notebooks give a leg's time.
export const legHelp = tiered(
  `The leg's share of the duration, from ${legRange[0]} to ${legRange[1]}.`,
  "Each leg is the one arriving at its view. A leg of 2 takes twice as long as a leg of 1. To linger at a view, add it again and give the leg between the two its time.",
);

// Each leg's time, and the instant each view is reached, in those times.
function knots(path: KeyPath) {
  const h = path.keys.slice(1).map((key) => key.leg ?? 1),
    t = [0];
  for (const leg of h) t.push(t[t.length - 1] + leg);
  return { h, t };
}
// The progress at which the camera stands at each view.
export function keyTimes(path: KeyPath) {
  if (path.keys.length < 2) return path.keys.map(() => 0);
  const { t } = knots(path),
    total = t[t.length - 1];
  return t.map((x, k) => (k === t.length - 1 ? 1 : x / total));
}

// Monotone piecewise cubic Hermite slopes (Fritsch and Carlson, with
// Moler's end conditions as in MATLAB's pchip) at knots spaced by the legs'
// times h: a knot between a rise and a fall, or beside a flat leg, gets
// slope 0, so no leg leaves the range of its two ends. An interior slope is
// the weighted harmonic mean of the two legs' rates, weighted toward the
// shorter leg, and with equal times it is their plain harmonic mean. A
// cyclic path, whose last knot is its first again, has no ends: both take
// the interior slope between the last leg and the first, so a loop passes
// its seam as any other view.
export function slopes(y: number[], h: number[], cyclic: boolean) {
  const n = y.length,
    delta = h.map((w, i) => (y[i + 1] - y[i]) / w);
  if (n === 2) return [delta[0], delta[0]];
  const d = new Array<number>(n);
  const interior = (k0: number, k1: number) => {
    const [before, after] = [delta[k0], delta[k1]];
    if (before * after <= 0) return 0;
    const w0 = 2 * h[k1] + h[k0],
      w1 = h[k1] + 2 * h[k0],
      sum = w0 + w1;
    // As 1/(a/before + b/after) with a + b = 1, which equal times make
    // exactly the harmonic mean 2/(1/before + 1/after).
    return 1 / (w0 / sum / before + w1 / sum / after);
  };
  for (let k = 1; k < n - 1; k++) d[k] = interior(k - 1, k);
  if (cyclic) {
    d[0] = d[n - 1] = interior(n - 2, 0);
    return d;
  }
  const end = (k0: number, k1: number) => {
    const [d0, d1] = [delta[k0], delta[k1]];
    const t = ((2 * h[k0] + h[k1]) * d0 - h[k0] * d1) / (h[k0] + h[k1]);
    if (Math.sign(t) !== Math.sign(d0)) return 0;
    if (Math.sign(d0) !== Math.sign(d1) && Math.abs(t) > Math.abs(3 * d0))
      return 3 * d0;
    return t;
  };
  d[0] = end(0, 1);
  d[n - 1] = end(n - 2, n - 3);
  return d;
}
export function hermite(
  y: number[],
  d: number[],
  h: number,
  i: number,
  f: number,
) {
  const f2 = f * f,
    f3 = f2 * f;
  return (
    (2 * f3 - 3 * f2 + 1) * y[i] +
    (f3 - 2 * f2 + f) * h * d[i] +
    (-2 * f3 + 3 * f2) * y[i + 1] +
    (f3 - f2) * h * d[i + 1]
  );
}

// Where progress p ∈ [0, 1] stands: on leg i, a fraction f along it, with f
// exactly 0 at a view. A progress within rounding of a view's own time
// (keyTimes) is that view.
export function locate(path: KeyPath, p: number) {
  const { h, t } = knots(path),
    n = t.length,
    total = t[n - 1];
  const x = Math.max(0, Math.min(1, p)) * total;
  if (x >= total) return { h, i: n - 2, f: 1, end: true };
  let i = 0;
  while (i < n - 2 && x >= t[i + 1]) i++;
  const near = 4 * Number.EPSILON * total;
  if (Math.abs(x - t[i + 1]) <= near && i + 1 < n - 1)
    return { h, i: i + 1, f: 0, end: false };
  if (Math.abs(x - t[i + 1]) <= near) return { h, i, f: 1, end: true };
  return { h, i, f: x - t[i] <= near ? 0 : (x - t[i]) / h[i], end: false };
}

// The readout: the view the camera stands at, or the two a leg flies
// between.
export function pathLeg(path: KeyPath, p: number): string {
  const n = path.keys.length;
  if (n < 2) return n ? keyLabel(path, 0) : "";
  const { i, f, end } = locate(path, p);
  if (end) return keyLabel(path, n - 1);
  if (f === 0) return keyLabel(path, i);
  return `${keyLabel(path, i)} → ${keyLabel(path, i + 1)}`;
}

// A flight is refined in pieces: stretches of progress, [from, to), whose
// zoomed-in frames are all drawn from one refinement (planar-path.ts,
// spatial/path.ts). Refining a piece once, rather than every frame, keeps
// playback in time; playback and export cut the same pieces, so they draw
// the same curves. Progress is sampled pieceSteps times per leg to cut
// them, and a piece spans a zoom of at most pieceZoom.
export const pieceSteps = 512;
export const pieceZoom = 2;
export type PieceSpan = { from: number; to: number };

// The piece a frame at progress p is drawn from: the one containing p, or,
// for a frame just zoomed in between samples, the nearest.
export function pieceAt(pieces: PieceSpan[], p: number): number {
  let best = 0,
    gap = Infinity;
  pieces.forEach((piece, k) => {
    const last = k === pieces.length - 1;
    const d =
      p < piece.from
        ? piece.from - p
        : p < piece.to || (last && p <= piece.to)
          ? 0
          : p - piece.to;
    if (d < gap) {
      gap = d;
      best = k;
    }
  });
  return best;
}
