import { tiered } from "../help";
import type { LineWeight } from "../line-weight";
import type { PlotCamera } from "../planar-link";
import type { Vec } from "../types";

// The Apollonian garden: a finite packing grown in Go from one enclosing
// Descartes configuration (engine/apollonian.go, docs/mathematics.md).
export const gardenSeed = "-1,2,2,3" as const;
export const gardenLimits = {
  depth: 12,
  circles: 5000,
  configurations: 20000,
} as const;
export type GardenRequest = {
  seed: typeof gardenSeed;
  depth: number;
  // In model units: the enclosing circle has radius 1.
  minRadius: number;
  maxCircles: number;
};
// Breadth-first parallel arrays; circle 0 encloses, 1–3 are the other
// seeds. Curvature and weighted center b·(x, y) are exact integers.
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
  omitted: { radius: number; depth: number };
  stopped: "" | "count" | "configurations";
  pending: number;
  processed: number;
  duplicates: number;
};
// A circle's identity: its integer curvature and weighted center. It is
// the same circle under any cutoffs, unlike its breadth-first index.
export type GardenCircle = { curvature: number; x: number; y: number };
export type GardenPresentation = "complete" | "selected";
export type GardenStudy = GardenRequest & {
  selected?: GardenCircle;
  presentation: GardenPresentation;
  view: PlotCamera;
  weight: LineWeight;
  // Whether each new selection is framed, and the view to return to when
  // following is turned off; both absent while off.
  follow?: boolean;
  viewBeforeFollow?: PlotCamera;
};
export const gardenRequest = (s: GardenStudy): GardenRequest => ({
  seed: s.seed,
  depth: s.depth,
  minRadius: s.minRadius,
  maxCircles: s.maxCircles,
});
export const identity = (r: GardenResult, i: number): GardenCircle => ({
  curvature: r.curvature[i],
  x: r.weightedX[i],
  y: r.weightedY[i],
});
export function indexOf(r: GardenResult, c: GardenCircle | undefined) {
  if (!c) return -1;
  for (let i = 0; i < r.curvature.length; i++)
    if (
      r.curvature[i] === c.curvature &&
      r.weightedX[i] === c.x &&
      r.weightedY[i] === c.y
    )
      return i;
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
export const gardenPresets = [
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
] as const satisfies readonly {
  title: string;
  note: string;
  study: GardenStudy;
}[];
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
  if (r.generation[selected] === 0) for (const i of [1, 2, 3]) set.add(i);
  else for (const p of r.parents[selected]) set.add(p);
  return [...set].sort((a, b) => a - b);
}

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

const number = (v: number) =>
  Number.isInteger(v) ? v.toLocaleString("en-US") : String(v);
// A circle's number in the reader's terms: one-based breadth-first order.
export const circleName = (i: number) => `Circle ${number(i + 1)}`;
const radiusText = (r: number) =>
  r >= 0.01 ? r.toPrecision(3) : r.toExponential(2);
const centerText = (r: GardenResult, i: number) =>
  `(${r.x[i].toFixed(4)}, ${r.y[i].toFixed(4)})`;
const signed = (v: number) => (v < 0 ? `(−${number(-v)})` : number(v));
// One line describing a circle, for lists and buttons.
export const describeCircle = (r: GardenResult, i: number) =>
  `${circleName(i)} · curvature ${number(r.curvature[i])}`;
// The explanation shown beside the drawing for the selected circle.
export function explain(r: GardenResult, i: number) {
  const b = r.curvature[i];
  const facts = `Curvature ${number(b)} · radius ${radiusText(r.radius[i])} · center ${centerText(r, i)} · generation ${r.generation[i]}`;
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
    text: `It fills the gap between ${circleName(j)}, ${circleName(k)} and ${circleName(l)}, tangent to all three. Descartes' theorem gives its curvature from theirs and from ${circleName(o)} on the gap's other side: 2 × (${[j, k, l].map((p) => signed(r.curvature[p])).join(" + ")}) − ${signed(r.curvature[o])} = ${number(2 * sum - r.curvature[o])}.`,
  };
}

// What finite cutoffs left out, outside the artwork: the counts, and when
// a ceiling ended generation, a notice that the packing is incomplete.
export function cutoffSummary(r: GardenResult, q: GardenRequest) {
  const n = r.curvature.length;
  const deepest = n ? Math.max(...r.generation) : 0;
  let smallest = Infinity;
  for (const v of r.radius) smallest = Math.min(smallest, v);
  const parts = [
    `${number(n)} circles in generations 0–${deepest}; smallest radius ${radiusText(smallest)}.`,
  ];
  const cut = [
    r.omitted.radius &&
      `${number(r.omitted.radius)} ${r.omitted.radius === 1 ? "gap" : "gaps"} below the minimum radius ${q.minRadius}`,
    r.omitted.depth &&
      `${number(r.omitted.depth)} ${r.omitted.depth === 1 ? "gap" : "gaps"} beyond depth ${q.depth}`,
  ].filter(Boolean);
  if (cut.length) parts.push(`Left unfilled: ${cut.join("; ")}.`);
  const stopped =
    r.stopped === "count"
      ? `Stopped at the ${number(q.maxCircles)}-circle limit with ${number(r.pending)} configurations unexpanded, so the last generation is incomplete.`
      : r.stopped === "configurations"
        ? `Stopped at the ${number(gardenLimits.configurations)}-gap work limit with ${number(r.pending)} configurations unexpanded, so the last generation is incomplete.`
        : "";
  return { text: parts.join(" "), stopped };
}

export const gardenHelp = {
  minRadius: tiered(
    "Smallest circle generated, in enclosing radii: above 0, at most 1.",
    "A gap whose circle is smaller is left unfilled, with every circle inside it, since a gap's first circle is its largest. The four seed circles always remain. Zooming in enlarges the same circles; it does not add detail.",
  ),
  depth: tiered(
    `Generations after the four seed circles: 0–${gardenLimits.depth}.`,
    "Each generation fills the gaps the previous one made. Near points of tangency, chains of circles shrink slowly, so depth can stop them before the minimum radius does.",
  ),
  maxCircles: tiered(
    `Most circles kept, seeds included: 4–${number(gardenLimits.circles)}.`,
    `Circles are generated breadth-first. Reaching this count stops generation, leaving the last generation incomplete; the summary says so. Generation also stops after examining ${number(gardenLimits.configurations)} gaps.`,
  ),
  presentation:
    "Show the whole packing, or only the selected circle and the three that generated it.",
  follow: tiered(
    "Center each newly selected circle, zoomed to a quarter of the drawing's height.",
    "Pan and zoom freely while following; the next selection frames again. Turning this off returns to the view from before you turned it on. A circle too small to fill a quarter at the 100× zoom limit is centered at that limit. With reduced motion requested, the view moves at once.",
  ),
  circle: tiered(
    "Choose a circle by its breadth-first number.",
    "Or click or tap near a circle in the drawing. Numbers follow generation order and change when the cutoffs change; the selection follows the circle itself.",
  ),
};
