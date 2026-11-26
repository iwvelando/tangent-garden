// The planar topology events: implicit curves whose critical levels, and
// the loops on either side of them, are known analytically
// (docs/mathematics.md, Planar events). A story names the recipe it
// applies to; the study keeps its own level, window, grid, layers and
// camera, and the traced curve at each level is compared with the
// analysis, never taken for it. A level's class is the nesting of its
// loops, each marked by the side F is higher on, as Go codes it
// (engine.LevelTopology): a surface's genus has no planar counterpart.
import {
  bracket as storyBracket,
  criticalAt,
  shownEvent,
  sideAt,
  stateAt,
  type Bracket,
  type EventState,
  type StoryContextOf,
  type StoryShape,
} from "./event-story";
import { plural, readout } from "./number-format";
import type { Config, ContourResult } from "./types";

export type PlanarStoryId = "two-pools" | "four-pools" | "three-pools";
export const planarStoryIds: PlanarStoryId[] = [
  "two-pools",
  "four-pools",
  "three-pools",
];
// What narrows toward an event, as a subject: "the gap between them", or
// "its necks", which takes "are".
type Feature = { what: string; are?: true };
// One side of the story's critical levels: what the curve is for every
// regular level there, the code of its loops' nesting (engine.
// LevelTopology), the strip's regular level on this side and its short
// name, and the feature that narrows toward the event below this side and
// toward the one above it.
export type PlanarSide = {
  name: string;
  class: string;
  level: number;
  title: string;
  toward: { below?: Feature; above?: Feature };
};
// One critical level: its short name on the strip, its label in the
// event chooser, and what happens there, as a clause.
export type PlanarEvent = {
  critical: number;
  title: string;
  label: string;
  meeting: string;
};
export type PlanarStory = StoryShape<PlanarSide> & {
  id: PlanarStoryId;
  // The recipe, matched exactly: another expression, even one drawing the
  // same curve, is an ordinary study.
  f: string;
  // The levels the story covers.
  range: [number, number];
  events: PlanarEvent[];
  // Half-widths of the rectangle about the origin that holds the region
  // F ≤ c, and so the curve F = c; each grows with c.
  extent: (c: number) => { x: number; y: number };
  // The explanation below the drawing: its title, formula and an aside,
  // and a short paragraph.
  explanation: { title: string; formula: [string, string]; text: string };
};

// F = |z² − 1|², the product of the squared distances to (±1, 0): Cassini's
// ovals. Its critical points are the foci (F = 0) and the origin (F = 1),
// a saddle: two loops below 1, one above, Bernoulli's lemniscate at 1.
const twoPools: PlanarStory = {
  id: "two-pools",
  f: "((x-1)^2+y^2)*((x+1)^2+y^2)",
  range: [0.49, 1.69],
  events: [
    {
      critical: 1,
      title: "Crossing at the origin",
      label: "The loops touch",
      meeting:
        "the two loops touch at the origin, where ∇F vanishes, and the curve crosses itself there: Bernoulli's lemniscate",
    },
  ],
  sides: [
    {
      name: "two separate loops, one about each focus",
      class: "-()-()",
      level: 0.81,
      title: "Two loops",
      toward: { above: { what: "the gap between them" } },
    },
    {
      name: "one loop about both foci",
      class: "-()",
      level: 1.21,
      title: "One loop",
      toward: { below: { what: "its waist" } },
    },
  ],
  order: "up",
  explanation: {
    title: "Two loops that join at a crossing.",
    formula: ["F = d₁² d₂² = c", "d₁, d₂ to (±1, 0)"],
    text: "F multiplies the squared distances to two foci, so it is |z² − 1|². Its gradient vanishes only at the foci, where F = 0, and at the origin, where F = 1 and its Hessian, diag(−4, 4), makes a saddle. Between critical levels a level set only deforms, so every level between 0 and 1 is two loops and every level above 1 one loop. At c = 1 the loops touch at the origin and the curve crosses itself: Bernoulli's lemniscate. F has no maximum, so no loop ever holds a hill.",
  },
  // On F = c, x² ≤ 1 + √c, on the axis, and y² is greatest, c/4, where
  // x² = 1 − c/4 (for c ≤ 4).
  extent: (c) => ({ x: Math.sqrt(1 + Math.sqrt(c)), y: Math.sqrt(c) / 2 }),
};
// F = g(x) + g(y) with g(t) = t⁴ − 4t², whose critical points are 0
// (g = 0, g″ = −8) and ±√2 (g = −4, g″ = 16). F's are their products:
// four minima at −8, four saddles at −4 and a maximum at the origin at 0.
// Four loops join along the axes into a ring at −4, and the ring's hollow
// shrinks to the maximum at 0.
const fourPools: PlanarStory = {
  id: "four-pools",
  f: "x^4-4*x^2+y^4-4*y^2",
  range: [-7.5, 4],
  events: [
    {
      critical: -4,
      title: "Crossing at four points",
      label: "Loops join",
      meeting:
        "the four loops touch at the saddles (0, ±√2) and (±√2, 0), where ∇F vanishes, and the curve crosses itself at each",
    },
    {
      critical: 0,
      title: "A point inside",
      label: "The hollow closes",
      meeting:
        "the ring's inner loop shrinks to a point at the origin, F's maximum, where ∇F vanishes",
    },
  ],
  sides: [
    {
      name: "four separate loops, one about each well",
      class: "-()-()-()-()",
      level: -6,
      title: "Four loops",
      toward: { above: { what: "the gaps between them", are: true } },
    },
    {
      name: "a ring: one loop inside another, about the hill at the origin",
      class: "-(+())",
      level: -2,
      title: "A ring",
      toward: {
        below: { what: "its necks", are: true },
        above: { what: "its hollow" },
      },
    },
    {
      name: "one loop",
      class: "-()",
      level: 2,
      title: "One loop",
      toward: {},
    },
  ],
  order: "up",
  explanation: {
    title: "Four pools, a moat, a lake.",
    formula: ["g(x) + g(y) = c", "g(t) = t⁴ − 4t²"],
    text: "Each term g has critical points at 0 and ±√2, so F's critical points are the nine points whose coordinates are those: four minima at −8, four saddles at −4 and a maximum at the origin. Read the region F ≤ c as water rising in a landscape. Four pools fill until they touch at the four saddles and join into a moat about the hill at the origin; the moat's inner shore shrinks onto the hilltop at c = 0, leaving one lake.",
  },
  // g(x) ≤ c − g(y) ≤ c + 4, reached at y = ±√2.
  extent: (c) => {
    const r = Math.sqrt(2 + Math.sqrt(8 + c));
    return { x: r, y: r };
  },
};
// F = |z³ − 1|². Its gradient vanishes at the cube roots of 1 (F = 0) and
// at the origin (F = 1), where its Hessian vanishes too: a degenerate,
// monkey saddle, where three loops meet at once.
const threePools: PlanarStory = {
  id: "three-pools",
  f: "(x^3-3*x*y^2-1)^2+(3*x^2*y-y^3)^2",
  range: [0.25, 2.25],
  events: [
    {
      critical: 1,
      title: "Crossing in six arms",
      label: "Three loops meet",
      meeting:
        "the three loops meet at the origin, where ∇F and the Hessian both vanish, and the curve crosses itself in six arms",
    },
  ],
  sides: [
    {
      name: "three separate loops, one about each cube root of 1",
      class: "-()-()-()",
      level: 0.64,
      title: "Three loops",
      toward: { above: { what: "the gaps between them", are: true } },
    },
    {
      name: "one loop about all three",
      class: "-()",
      level: 1.44,
      title: "One loop",
      toward: { below: { what: "its three waists", are: true } },
    },
  ],
  order: "up",
  explanation: {
    title: "Three loops meet at once.",
    formula: ["|z³ − 1|² = c", "z = x + iy"],
    text: "F vanishes at the three cube roots of 1, and its only other critical point is the origin, where F = 1. There the Hessian vanishes too: not an ordinary saddle but a monkey saddle, with three valleys and three ridges. Below 1 each root has its own loop; above it one loop holds all three. At c = 1 the three loops meet at once and the curve crosses itself in six arms. F has no maximum, so no loop ever holds a hill.",
  },
  // |z|³ − 1 ≤ |z³ − 1| ≤ √c: the disk |z| ≤ (1 + √c)^⅓ holds the curve.
  extent: (c) => {
    const r = Math.cbrt(1 + Math.sqrt(c));
    return { x: r, y: r };
  },
};
export const planarStories: Record<PlanarStoryId, PlanarStory> = {
  "two-pools": twoPools,
  "four-pools": fourPools,
  "three-pools": threePools,
};

export type PlanarBracket = Bracket<PlanarSide>;
export const planarBracket = (story: PlanarStory, event: number) =>
  storyBracket(story, event);
export type PlanarStoryContext = StoryContextOf<PlanarStory>;

// Whether a study is its story's recipe in a window that holds every level
// the story covers, which event the strip shows (the one shown, or with
// none, the level's) and which of its states the study stands at. The
// level, grid, family, normals, the shape parameter (which no recipe
// reads), layers, camera and animation keep the story; null when the study
// has none or is not an implicit curve.
export function planarStoryContext(
  config: Config,
  id: PlanarStoryId | undefined,
  shown?: number,
): PlanarStoryContext | null {
  const story = id && planarStories[id];
  if (!story || config.curve.format !== "implicit") return null;
  const q = config.curve.implicit;
  if (q.f !== story.f || q.disk || q.diskMix)
    return {
      story,
      eligible: false,
      reason:
        "F is no longer the story's expression, so its events are not claimed.",
    };
  const e = story.extent(story.range[1]),
    w = q.window;
  // Strictly inside, so no level the story covers reaches an edge; NaN
  // bounds fail every comparison.
  if (!(w.xMin < -e.x && w.xMax > e.x && w.yMin < -e.y && w.yMax > e.y))
    return {
      story,
      eligible: false,
      reason: `The window no longer holds the curve at every level up to ${readout(story.range[1])}, so it could cut the curve open.`,
    };
  const event = shownEvent(story, q.level, shown);
  return {
    story,
    eligible: true,
    event,
    state: stateAt(story, event, q.level),
  };
}

// What the trace shows, when it is whole enough to compare: its loops'
// code; otherwise why not, as a clause after "this trace".
export function observedClass(
  r: ContourResult,
): { complete: true; class: string } | { complete: false; why: string } {
  const top = r.topology;
  const why = !top
    ? "was not classified"
    : !r.curve.contours.length
      ? "has no curve"
      : top.rejected
        ? "changes sign across a pole or a jump"
        : top.open && r.nonfinite
          ? "is open beside cells left out"
          : top.open
            ? "is cut by the window's edge"
            : r.nonfinite
              ? "leaves out cells where F is not a number"
              : top.unclassified
                ? "has more loops than are classified"
                : "";
  if (why) return { complete: false, why };
  return { complete: true, class: top!.class };
}
// A class in words: its loops, and how many lie inside another.
export function describeClass(code: string) {
  let depth = 0,
    loops = 0,
    nested = 0;
  for (const ch of code) {
    if (ch === "(") {
      loops++;
      if (depth > 0) nested++;
      depth++;
    } else if (ch === ")") depth--;
  }
  return nested
    ? `${plural(loops, "loop")}, ${plural(nested, "loop")} inside another`
    : plural(loops, "loop");
}

// The story's sentences for the curve's note, before the trace's own: the
// analytic curve at this level, and whether the trace agrees, cannot be
// compared, or does not resolve it. At a critical level the curve is
// singular, so no class is claimed.
export function planarStoryNote(
  story: PlanarStory,
  level: number,
  r: ContourResult,
): string {
  const [low, high] = story.range;
  const event = criticalAt(story, level);
  if (event)
    return `At the critical level c = ${readout(event.critical)} ${event.meeting}. The curve is singular there, so no count of loops is claimed; the trace is a finite picture of it.`;
  if (!(level >= low && level <= high))
    return `The story's analysis covers levels from ${readout(low)} to ${readout(high)}; at c = ${readout(level)} the note describes the trace alone.`;
  const i = sideAt(story, level),
    side = story.sides[i];
  const below = story.events[i - 1],
    above = story.events[i];
  const where = `${
    below && above
      ? `Between the critical levels c = ${readout(below.critical)} and c = ${readout(above.critical)}`
      : below
        ? `Above the critical level c = ${readout(below.critical)}`
        : `Below the critical level c = ${readout(above.critical)}`
  } the curve is ${side.name}`;
  const seen = observedClass(r);
  if (!seen.complete)
    return `${where}, but this trace ${seen.why}, so it cannot confirm that.`;
  if (seen.class === side.class) return `${where}, and the trace agrees.`;
  const nearBelow =
    !above ||
    (below !== undefined && level - below.critical < above.critical - level);
  const near = nearBelow ? below : above,
    feature = nearBelow ? side.toward.below : side.toward.above;
  const reads = `the trace reads ${describeClass(seen.class)}`;
  if (!feature) return `${where}, but ${reads}. Use more cells.`;
  return `${where}, but ${reads}: ${feature.what} ${feature.are ? "are" : "is"} finer than this grid resolves at this level. Use more cells, or a level farther from ${readout(near.critical)}.`;
}

// Whether the trace at one of the strip's states agrees with the analysis,
// differs from it, cannot be compared, or (at the critical level) is
// singular, which no finite trace shows faithfully.
export function planarStateReading(
  story: PlanarStory,
  event: number,
  state: EventState,
  r: ContourResult,
): "agrees" | "differs" | "incomplete" | "singular" {
  if (state === "critical") return "singular";
  const seen = observedClass(r);
  if (!seen.complete) return "incomplete";
  return seen.class === planarBracket(story, event).sides[state].class
    ? "agrees"
    : "differs";
}
// The study at another level, as the strip's previews and states draw it.
export const atLevel = (config: Config, level: number): Config => ({
  ...config,
  curve: {
    ...config.curve,
    implicit: { ...config.curve.implicit, level },
  },
});
