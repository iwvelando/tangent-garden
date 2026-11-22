import {
  readout as formatNumber,
  count as formatCount,
  plural,
} from "../number-format";
import { tiered } from "../help";
import type { LineWeight } from "../line-weight";
import type { PlotCamera } from "../planar-link";
import type { Repeat } from "../timing";
import type { Vec } from "../types";
import { rootText, rootValue, seedOf, type GardenSeedId } from "./seeds";

// The Apollonian garden: a finite packing grown in Go from a seed of
// tangent circles inside an enclosing one (engine/apollonian.go,
// web/garden/seeds.ts, docs/mathematics.md).
export const gardenSeed = "-1,2,2,3" as const;
export const gardenLimits = {
  depth: 12,
  circles: 5000,
  configurations: 20000,
} as const;
// A rectangle in model units, sides parallel to the axes.
export type GardenWindow = {
  xMin: number;
  xMax: number;
  yMin: number;
  yMax: number;
};
// A study's generation settings.
export type GardenCutoffs = {
  // The seed the packing grows from (web/garden/seeds.ts).
  seed: GardenSeedId;
  depth: number;
  // In model units: the enclosing circle has radius 1.
  minRadius: number;
  maxCircles: number;
};
export type GardenRequest = GardenCutoffs & {
  // Detail for a view: only gaps reaching into the window are filled, and
  // those holding the kept circle (see detailFor).
  window?: GardenWindow;
  keep?: GardenCircle;
};
// Breadth-first parallel arrays; circle 0 encloses, and the other seed
// circles follow it. For the original seed, curvature and weighted center
// b·(x, y) are exact integers; other seeds give their exact values in
// exact.
export type GardenResult = {
  seed: string;
  x: number[];
  y: number[];
  radius: number[];
  curvature: number[];
  weightedX: number[];
  weightedY: number[];
  generation: number[];
  // The generating triple and the circle replaced; −1 for seeds.
  parents: [number, number, number][];
  opposite: number[];
  omitted: { radius: number; depth: number; view: number };
  stopped: "" | "count" | "configurations";
  pending: number;
  processed: number;
  duplicates: number;
  // Seeds other than the original: six exact integers per circle, p and q of
  // its curvature and of its center numerators X and Y, each p + q√3, with
  // weighted center (X, Y)/denominator; and the number of seed circles.
  exact?: number[];
  seeds?: number;
  denominator?: number;
  root?: number;
};
// A circle's identity: its integer curvature and weighted center. It is
// the same circle under any cutoffs, unlike its breadth-first index. Another
// seed's circle gives the rational parts here and the √3 coefficients in
// root, when any is nonzero, with the center numerators scaled by the
// seed's denominator.
export type GardenCircle = {
  curvature: number;
  x: number;
  y: number;
  root?: [number, number, number];
};
// The number of seed circles, the enclosing one included.
export const seedCount = (r: Pick<GardenResult, "seeds">) => r.seeds ?? 4;
export type GardenPresentation = "complete" | "selected";
export type GardenStudy = GardenCutoffs & {
  selected?: GardenCircle;
  presentation: GardenPresentation;
  view: PlotCamera;
  weight: LineWeight;
  // Whether each new selection is framed, and the view to return to when
  // following is turned off; both absent while off.
  follow?: boolean;
  viewBeforeFollow?: PlotCamera;
  // Finer circles when zoomed in (detailFor); absent or false, zoom only
  // enlarges. Saved only while on.
  detail?: boolean;
  // The reveal's duration and repeat; absent, defaultReveal.
  reveal?: GardenReveal;
};
export type GardenReveal = { duration: number; repeat: Repeat };
export const defaultReveal: GardenReveal = { duration: 8, repeat: "once" };

// The request a study's drawing needs: its cutoffs, and with detail at a
// zoom past the whole packing, the finer cutoff and window for its view.
export function gardenRequest(s: GardenStudy): GardenRequest {
  const q: GardenRequest = {
    seed: s.seed,
    depth: s.depth,
    minRadius: s.minRadius,
    maxCircles: s.maxCircles,
  };
  const d = detailFor(s);
  if (!d) return q;
  const k = s.selected;
  const disk = k && keptDisk(s.seed, k);
  const keep = disk && disk.b > 0 && !diskMeets(disk, d.window);
  return {
    ...q,
    minRadius: d.minRadius,
    window: d.window,
    ...(keep && { keep: { ...k } }),
  };
}
// A selection's disk in drawing units, from its identity and its seed's
// normalization: for the original, exactly x/b, y/b and 1/b.
function keptDisk(seed: string, k: GardenCircle) {
  const { scale, denominator } = seedOf(seed);
  const [rb, rx, ry] = k.root ?? [0, 0, 0];
  const b = rootValue(k.curvature, rb),
    s = rootValue(...scale);
  return {
    b,
    x: (rootValue(k.x, rx) / denominator / b) * s,
    y: (rootValue(k.y, ry) / denominator / b) * s,
    r: s / b,
  };
}
const diskMeets = (c: { x: number; y: number; r: number }, w: GardenWindow) =>
  Math.hypot(
    c.x - Math.max(w.xMin, Math.min(w.xMax, c.x)),
    c.y - Math.max(w.yMin, Math.min(w.yMax, c.y)),
  ) <= c.r;

// Detail for a view (docs/mathematics.md, Apollonian garden). Zoom snaps
// down to half-octave levels, factor f = 2^(level/2) ≥ √2, and the cutoff
// is the minimum radius over f: on screen the smallest circle stays the
// minimum radius's size at 1× zoom, to at most √2 times it. The window is
// the view snapped outward to a grid of quarter-view cells, plus one cell,
// so small pans and a revisited view ask for the same request. At zoom
// below √2, or with detail off, there is none: the static request.
export const detailLevel = (zoom: number) =>
  Math.max(0, Math.floor(2 * Math.log2(zoom)));
export function detailFor(s: GardenStudy) {
  if (!s.detail) return undefined;
  const level = detailLevel(s.view.zoom);
  if (level === 0) return undefined;
  const factor = 2 ** (level / 2);
  const cell = gardenPage.width / (gardenScale * factor) / 4;
  const k = gardenScale * s.view.zoom,
    v = s.view;
  // Cells covering the enclosing circle, and one more on each side; a
  // view beyond them keeps a one-cell window there, outside the packing.
  const reach = Math.ceil(1 / cell) + 1;
  const index = (value: number, round: (v: number) => number, by: number) =>
    Math.max(-reach, Math.min(reach, round(value / cell) + by));
  const span = (lo: number, hi: number) => {
    const a = index(lo, Math.floor, -1);
    return [a, Math.max(a + 1, index(hi, Math.ceil, 1))];
  };
  const [i0, i1] = span((-500 - v.x) / k, (500 - v.x) / k);
  const [j0, j1] = span((v.y - 380) / k, (v.y + 380) / k);
  return {
    level,
    factor,
    minRadius: s.minRadius / factor,
    window: {
      xMin: i0 * cell,
      xMax: i1 * cell,
      yMin: j0 * cell,
      yMax: j1 * cell,
    },
  };
}

// The reveal (docs/mathematics.md): a frame at motion progress p shows
// the first revealCount circles in breadth-first order, true circles only.
// The seed circles hold for the opening, the count then grows exponentially,
// so each roughly tripling generation takes about the same time, and the
// whole packing holds for the end.
export const revealHold = { start: 0.06, end: 0.14 } as const;
export function revealCount(total: number, p: number, seedCircles = 4) {
  const seeds = Math.min(seedCircles, total);
  const s = (p - revealHold.start) / (1 - revealHold.start - revealHold.end);
  if (!(s > 0)) return seeds;
  if (s >= 1) return total;
  return Math.min(
    total,
    Math.max(seeds, Math.floor(seeds * (total / seeds) ** s)),
  );
}
// A loop joins the end to the start, so it is seamless only when both
// show the same circles: a packing of the seeds alone.
export const revealLoops = (total: number, seeds = 4) =>
  revealCount(total, 0, seeds) === revealCount(total, 1, seeds);
// The membership rule an exported reveal records, for n₀ seed circles.
export const revealMembership = (n0: number) =>
  `the first n circles in breadth-first order; n = ${n0} for progress p ≤ 0.06, n = floor(${n0}·(N/${n0})^s) with s = (p − 0.06)/0.8, n = N for p ≥ 0.86`;
export function identity(r: GardenResult, i: number): GardenCircle {
  const e = r.exact;
  if (!e)
    return { curvature: r.curvature[i], x: r.weightedX[i], y: r.weightedY[i] };
  const [b, rb, x, rx, y, ry] = e.slice(6 * i, 6 * i + 6);
  return {
    curvature: b,
    x,
    y,
    ...((rb || rx || ry) && { root: [rb, rx, ry] }),
  };
}
const sameCircle = (a: GardenCircle, b: GardenCircle) =>
  a.curvature === b.curvature &&
  a.x === b.x &&
  a.y === b.y &&
  (a.root ?? [0, 0, 0]).every((v, k) => v === (b.root ?? [0, 0, 0])[k]);
export function indexOf(r: GardenResult, c: GardenCircle | undefined) {
  if (!c) return -1;
  for (let i = 0; i < r.curvature.length; i++)
    if (sameCircle(identity(r, i), c)) return i;
  return -1;
}

export const defaultGarden: GardenStudy = {
  seed: gardenSeed,
  depth: 12,
  minRadius: 0.002,
  maxCircles: 5000,
  presentation: "complete",
  view: { x: 0, y: 0, zoom: 1 },
  weight: "regular",
};
// The authored gardens, in the 2D examples gallery. Each opens the garden
// over the notebook's study without replacing it, and takes nothing from it.
// The original seed's come first, then the other seeds'.
export const gardenPresets: readonly {
  title: string;
  note: string;
  study: GardenStudy;
}[] = [
  {
    title: "A rose window made only of circles",
    note: "Every gap between three tangent circles holds one more, down to a finite cutoff",
    study: { ...defaultGarden, weight: "fine" },
  },
  // Curvature 23 at (8/23, 12/23) fills the gap between the radius-1/6
  // circle at the upper right and the right and top seeds.
  {
    title: "One circle and the three that made it",
    note: "A small circle explained by the three tangent circles around its gap",
    study: {
      ...defaultGarden,
      weight: "fine",
      selected: { curvature: 23, x: 8, y: 12 },
      presentation: "selected",
    },
  },
  // Zoomed 24× onto (0.32, 0.485), in the gap below the curvature-23
  // circle, with finer circles for the view: detail level 9, so the cutoff
  // is the minimum radius over 2^4.5 and the smallest circles stay 0.74
  // drawing units in radius.
  {
    title: "Finer circles in one gap",
    note: "Zooming in fills the view's gaps with smaller circles, down to a finite cutoff",
    study: {
      ...defaultGarden,
      weight: "fine",
      detail: true,
      view: { x: -2688, y: 4074, zoom: 24 },
    },
  },
  // The other seeds open with the original's cutoffs, under which each
  // stops at the minimum radius and depth together (docs/mathematics.md).
  {
    title: "Six circles around a seventh",
    note: "Seven equal circles inside an eighth: a six-fold window grown from twelve gaps",
    study: { ...defaultGarden, seed: "-1,3,3,3,3,3,3,3", weight: "fine" },
  },
  {
    title: "A three-fold rose window",
    note: "Three equal circles in a circle: every curvature is exact as p + q√3",
    study: { ...defaultGarden, seed: "3-2r3,1,1,1", weight: "fine" },
  },
  {
    title: "A window with one mirror",
    note: "Curvatures −2, 3, 6, 7: three seed circles share one diameter",
    study: { ...defaultGarden, seed: "-2,3,6,7", weight: "fine" },
  },
  {
    title: "A five and two eights",
    note: "Curvatures −3, 5, 8, 8: one mirror, through the five",
    study: { ...defaultGarden, seed: "-3,5,8,8", weight: "fine" },
  },
  {
    title: "A window with no symmetry",
    note: "Curvatures −6, 11, 14, 15: every curvature an integer, no two sides alike",
    study: { ...defaultGarden, seed: "-6,11,14,15", weight: "fine" },
  },
  // Zoomed 24× onto (0, 0.0718), where the top seed circle touches the
  // central one, curvature 3 + 2√3 and radius 0.0718 at the origin.
  {
    title: "Finer circles in a three-fold gap",
    note: "Zoom detail on the three-fold seed, where the top circle touches the central one",
    study: {
      ...defaultGarden,
      seed: "3-2r3,1,1,1",
      weight: "fine",
      detail: true,
      view: { x: 0, y: 603, zoom: 24 },
    },
  },
];
export const presetGarden = (index: number): GardenStudy =>
  structuredClone(gardenPresets[index].study) as GardenStudy;

// The zoom range of the manual camera.
export const gardenZoom: [number, number] = [0.1, 100];
// The view that frames circle i: centered, with its radius an eighth of the
// page's height (its diameter a quarter), never zoomed out past the whole
// packing nor in past the zoom limit.
export function followView(
  r: Pick<GardenResult, "x" | "y" | "radius">,
  i: number,
): PlotCamera {
  const zoom = Math.min(
    gardenZoom[1],
    Math.max(1, gardenPage.height / 8 / (r.radius[i] * gardenScale)),
  );
  const k = gardenScale * zoom;
  // Adding zero keeps a centered view's pan free of negative zeros.
  return { x: -r.x[i] * k + 0, y: r.y[i] * k + 0, zoom };
}

// Every drawing frames the enclosing circle the same way: the model's unit
// circle centered in the 1000 × 760 page with a margin. The manual camera
// pans and zooms from there; nothing is refitted, since this slice never
// regenerates for the view.
export const gardenPage = { width: 1000, height: 760 };
export const gardenScale = 350;
export function toScreen(v: Vec, camera: PlotCamera) {
  return {
    x: 500 + v.x * gardenScale * camera.zoom + camera.x,
    y: 380 - v.y * gardenScale * camera.zoom + camera.y,
  };
}
export function toModel(p: Vec, camera: PlotCamera) {
  return {
    x: (p.x - 500 - camera.x) / (gardenScale * camera.zoom),
    y: (380 + camera.y - p.y) / (gardenScale * camera.zoom),
  };
}

// The circles a presentation draws: everything, or the selected circle
// with its generators (for a seed, the seed configuration; with nothing
// selected, the enclosing circle alone). The enclosing circle is drawn once
// in either.
export function presented(
  r: GardenResult,
  presentation: GardenPresentation,
  selected: number,
): number[] {
  if (presentation === "complete") return r.curvature.map((_, i) => i);
  if (selected < 0) return [0];
  const set = new Set<number>([0, selected]);
  if (r.generation[selected] === 0)
    for (let i = 1; i < seedCount(r); i++) set.add(i);
  else for (const p of r.parents[selected]) set.add(p);
  return [...set].sort((a, b) => a - b);
}

// The circles a reveal frame draws: those of the presentation among the
// first count in breadth-first order.
export const revealed = (
  r: GardenResult,
  presentation: GardenPresentation,
  selected: number,
  count: number,
) => presented(r, presentation, selected).filter((i) => i < count);

// The circle a pointer means. Inside a packing circle, that circle: every
// other circle lies outside it, so none has a nearer boundary. Elsewhere,
// the nearest drawn boundary within tolerance page units, the smaller
// circle on a tie; the enclosing circle only by its boundary. Otherwise −1.
// The test is arithmetic, so no hit geometry enters the drawing or exports.
export function hitCircle(
  r: GardenResult,
  among: number[],
  at: Vec,
  camera: PlotCamera,
  tolerance: number,
): number {
  const p = toModel(at, camera),
    scale = gardenScale * camera.zoom;
  let best = -1,
    bestGap = Infinity;
  for (const i of among) {
    const d = Math.hypot(p.x - r.x[i], p.y - r.y[i]);
    if (r.curvature[i] > 0 && d < r.radius[i]) return i;
    const gap = Math.abs(d - r.radius[i]) * scale;
    if (
      gap <= tolerance &&
      (gap < bestGap || (gap === bestGap && r.radius[i] < r.radius[best]))
    ) {
      best = i;
      bestGap = gap;
    }
  }
  return best;
}

// A circle's number in the reader's terms: one-based breadth-first order.
export const circleName = (i: number) => `Circle ${formatCount(i + 1)}`;
const centerText = (r: GardenResult, i: number) =>
  `(${formatNumber(r.x[i])}, ${formatNumber(r.y[i])})`;
const signed = (v: number) =>
  v < 0 ? `(−${formatNumber(-v)})` : formatNumber(v);
// One line describing a circle, for lists and buttons.
export const describeCircle = (r: GardenResult, i: number) =>
  `${circleName(i)} · curvature ${formatNumber(r.curvature[i])}`;
// The explanation shown beside the drawing for the selected circle.
export function explain(r: GardenResult, i: number) {
  if (r.exact) return explainExact(r, i);
  const b = r.curvature[i];
  const facts = `Curvature ${formatNumber(b)} · radius ${formatNumber(r.radius[i])} · center ${centerText(r, i)} · generation ${r.generation[i]}`;
  if (i === 0)
    return {
      facts,
      text: "The enclosing circle. Its curvature is negative because the other circles lie inside it.",
    };
  if (r.generation[i] === 0)
    return {
      facts,
      text: "A seed circle: one of the four mutually tangent circles the packing starts from. It has no generators.",
    };
  const [j, k, l] = r.parents[i];
  const o = r.opposite[i];
  const sum = r.curvature[j] + r.curvature[k] + r.curvature[l];
  return {
    facts,
    text: `It fills the gap between ${circleName(j)}, ${circleName(k)} and ${circleName(l)}, tangent to all three. Descartes' theorem gives its curvature from theirs and from ${circleName(o)} on the gap's other side: 2 × (${[j, k, l].map((p) => signed(r.curvature[p])).join(" + ")}) − ${signed(r.curvature[o])} = ${formatNumber(2 * sum - r.curvature[o])}.`,
  };
}

// Another seed's explanation: curvatures exactly, as p + q√3,
// in units where the enclosing circle's is the seed's; the arithmetic is
// in BigInt, since 2(a + b + c) can pass 2^53. A ring's first circles fill
// a gap whose other side holds no packing circle: the opposite circle is
// the other one tangent to all three.
function explainExact(r: GardenResult, i: number) {
  const e = r.exact!;
  const exact = (n: number): [bigint, bigint] => [
    BigInt(e[6 * n]),
    BigInt(e[6 * n + 1]),
  ];
  const text = ([p, q]: [bigint, bigint]) => rootText(p, q);
  const wrapped = (v: [bigint, bigint]) =>
    v[1] !== 0n || v[0] < 0n ? `(${text(v)})` : text(v);
  const value = rootText(e[6 * i], e[6 * i + 1]);
  const approx = e[6 * i + 1] ? ` ≈ ${formatNumber(r.curvature[i])}` : "";
  const facts = `Curvature ${value}${approx} · radius ${formatNumber(r.radius[i])} · center ${centerText(r, i)} · generation ${r.generation[i]}`;
  const seeds = seedCount(r);
  if (i === 0)
    return {
      facts,
      text: `The enclosing circle. Its curvature is negative because the other circles lie inside it; curvatures here are in units that make the seeds' exact, and radii in units of this circle's.`,
    };
  if (r.generation[i] === 0)
    return {
      facts,
      text: `A seed circle: one of the ${formatCount(seeds)} tangent circles the packing starts from. It has no generators.`,
    };
  const ps = r.parents[i].map(exact);
  const sum = ps.reduce<[bigint, bigint]>(
    (a, v) => [a[0] + v[0], a[1] + v[1]],
    [0n, 0n],
  );
  const mine = exact(i);
  const old: [bigint, bigint] = [2n * sum[0] - mine[0], 2n * sum[1] - mine[1]];
  const o = r.opposite[i];
  const [j, k, l] = r.parents[i];
  const other =
    o >= 0
      ? `from ${circleName(o)} on the gap's other side`
      : "from a virtual opposite, the other circle tangent to all three, which is not part of the packing (six around one is not a single Descartes seed)";
  return {
    facts,
    text: `It fills the gap between ${circleName(j)}, ${circleName(k)} and ${circleName(l)}, tangent to all three. Descartes' theorem gives its curvature from theirs and ${other}: 2 × (${ps.map(wrapped).join(" + ")}) − ${wrapped(old)} = ${value}.`,
  };
}

// What finite cutoffs left out, outside the artwork: the counts, and when
// a ceiling ended generation, a notice that the packing is incomplete.
// With detail, it also gives the view's cutoff and its size on screen at
// this zoom, the gaps left outside the view, and whether depth, rather
// than the view, limits what zooming further can add.
export function cutoffSummary(r: GardenResult, q: GardenRequest, zoom = 1) {
  const n = r.curvature.length;
  const deepest = n ? Math.max(...r.generation) : 0;
  let smallest = Infinity;
  for (const v of r.radius) smallest = Math.min(smallest, v);
  const parts = [
    `${formatCount(n)} circles in generations 0–${deepest}; smallest radius ${formatNumber(smallest)}.`,
  ];
  const gaps = (n: number) => plural(n, "gap");
  const cut = [
    r.omitted.radius &&
      (q.window
        ? `${gaps(r.omitted.radius)} below this view's radius ${formatNumber(q.minRadius)}`
        : `${gaps(r.omitted.radius)} below the minimum radius ${formatNumber(q.minRadius)}`),
    r.omitted.depth && `${gaps(r.omitted.depth)} beyond depth ${q.depth}`,
    r.omitted.view && `${gaps(r.omitted.view)} outside the view`,
  ].filter(Boolean);
  if (cut.length) parts.push(`Left unfilled: ${cut.join("; ")}.`);
  if (q.window) {
    // The smallest circles' radius on screen, in drawing units.
    const screen = q.minRadius * gardenScale * zoom;
    parts.push(
      `Finer circles for this view reach ${formatNumber(screen)} drawing units in radius${q.keep ? "; the selected circle and its generators are kept" : ""}.`,
    );
    if (r.omitted.depth)
      parts.push(
        `Zooming further adds nothing beyond depth ${q.depth}${q.depth < gardenLimits.depth ? "" : ", the most allowed"}.`,
      );
  }
  const stopped =
    r.stopped === "count"
      ? `Stopped at the ${formatCount(q.maxCircles)}-circle limit with ${formatCount(r.pending)} configurations unexpanded, so the last generation is incomplete.`
      : r.stopped === "configurations"
        ? `Stopped at the ${formatCount(gardenLimits.configurations)}-gap work limit with ${formatCount(r.pending)} configurations unexpanded, so the last generation is incomplete.`
        : "";
  return { text: parts.join(" "), stopped };
}

export const gardenHelp = {
  minRadius: tiered(
    "Smallest circle generated, in enclosing radii: above 0, at most 1.",
    "A gap whose circle is smaller is left unfilled, with every circle inside it, since a gap's first circle is its largest. The seed circles always remain. Unless Finer circles is on, zooming in enlarges the same circles.",
  ),
  depth: tiered(
    `Generations after the seed circles: 0–${gardenLimits.depth}.`,
    "Each generation fills the gaps the previous one made. Near points of tangency, chains of circles shrink slowly, so depth can stop them before the minimum radius does.",
  ),
  // From the seed's own circle count: 4, or 8 for six around one.
  maxCircles: (seeds: number) =>
    tiered(
      `Most circles kept, seeds included: ${formatCount(seeds)}–${formatCount(gardenLimits.circles)}.`,
      `Circles are generated breadth-first. Reaching this count stops generation, leaving the last generation incomplete; the summary says so. Generation also stops after examining ${formatCount(gardenLimits.configurations)} gaps.`,
    ),
  seed: tiered(
    "The tangent circles the packing grows from, inside its enclosing circle.",
    "Curvatures are in each seed's own units, which make every circle's exact: an integer, or p + q√3. The drawing scales the enclosing radius to 1. A new seed clears the selection and keeps the cutoffs, raising the circle limit to its seed circles.",
  ),
  presentation:
    "Show the whole packing, or only the selected circle and the three that generated it.",
  follow: tiered(
    "Center each newly selected circle, zoomed to a quarter of the drawing's height.",
    "Pan and zoom freely while following; the next selection frames again. Turning this off returns to the view from before you turned it on. A circle too small to fill a quarter at the 100× zoom limit is centered at that limit. With reduced motion requested, the view moves at once.",
  ),
  detail: tiered(
    "Generate smaller circles for the view as you zoom past 1.4×.",
    "Zoom snaps down to steps of √2, and the cutoff becomes the minimum radius over that step, so the smallest circles stay their 1× size, to 1.4 times it. Only gaps reaching the view, or holding the selection, are filled; depth and the circle and gap limits still apply. A reveal keeps its circles until stopped.",
  ),
  progress:
    "Seek the reveal by its time; the same time always shows the same circles.",
  duration: tiered(
    "Seconds for the whole reveal: 0.1–3,600.",
    "The reveal holds the seed circles for its first 6%, adds circles in breadth-first order, and holds the whole packing for its last 14%. Export makes at most 7,200 frames.",
  ),
  repeat: tiered(
    "Once, or back and forth; Loop needs matching ends.",
    "Loop joins the end to the start, which only a packing of the seed circles alone does seamlessly. Back and forth reveals the circles, then removes them in reverse, within the duration. Repeating playback continues until paused; a repeating export leaves out its last frame, which is its first.",
  ),
  circle: tiered(
    "Choose a circle by its breadth-first number.",
    "Or click or tap near a circle in the drawing. Numbers follow generation order and change when the cutoffs change; the selection follows the circle itself.",
  ),
};
