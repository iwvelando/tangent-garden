// The topology theater's curated events: implicit studies whose one
// critical level, and the surface on either side of it, are known
// analytically (docs/mathematics.md, Curated events). A story names the
// recipe it applies to; the study keeps its own level, resolution, layers
// and camera, and the mesh at each level is compared with the analysis,
// never taken for it.
import type { NumericTrack } from "./animation";
import type { ImplicitResult, SpatialConfig, Vec3 } from "./types";
import { readout } from "../number-format";
import {
  bracket as storyBracket,
  criticalAt,
  eventFor,
  eventOrder,
  eventStates,
  shownEvent,
  sideAt,
  stateAt,
  type Bracket as StoryBracket,
  type EventState,
  type StoryContextOf,
} from "../event-story";

// The navigation every story shares (event-story.ts).
export {
  criticalAt,
  eventFor,
  eventOrder,
  eventStates,
  sideAt,
  stateAt,
  type EventState,
};
export type StoryId = "two-drops" | "handle" | "tanglecube" | "two-handles";
// What narrows toward an event, as a subject: "the gap between them", or
// "its necks", which takes "are".
type Feature = { what: string; are?: true };
// One side of the story's critical levels: what the surface is for every
// regular level there, the Euler characteristics of its closed pieces in
// ascending order, the strip's regular level on this side and its short
// name, and the feature that narrows toward the event below this side and
// toward the one above it (absent when nothing narrows).
export type Side = {
  name: string;
  pieces: number[];
  level: number;
  title: string;
  toward: { below?: Feature; above?: Feature };
};
// One critical level: its short name on the strip, its label in the
// event chooser, and what happens there, as a clause.
export type StoryEvent = {
  critical: number;
  title: string;
  label: string;
  meeting: string;
};
export type Story = {
  id: StoryId;
  // The recipe, matched exactly: another expression, even one drawing the
  // same surface, is an ordinary study.
  f: string;
  // The levels the story covers.
  range: [number, number];
  // The critical levels, ascending, and the k + 1 sides between them:
  // sides[i] lies below events[i] and sides[i + 1] above it, so a side
  // between two events belongs to both their brackets.
  events: StoryEvent[];
  sides: Side[];
  // The order the strip and the film reach the events in: as c rises, or
  // as it falls.
  order: "up" | "down";
  // Half-widths of the box about the origin that holds the solid F ≤ c,
  // and so the level set F = c; each grows with c.
  extent: (c: number) => Vec3;
  // How much closer than the story's view the strip's previews are drawn
  // (event-previews.ts; 1.5 when absent): less for a surface that fills
  // its box.
  previewZoom?: number;
  // The explanation below the drawing: its title, formula and an aside,
  // and a short paragraph.
  explanation: { title: string; formula: [string, string]; text: string };
};

// F = d₁² d₂², the product of the squared distances to (±1, 0, 0). Its
// only critical points are the foci (F = 0) and the origin (F = 1), a
// saddle: two drops below 1, one above.
const drops: Story = {
  id: "two-drops",
  f: "((x-1)^2+y^2+z^2)*((x+1)^2+y^2+z^2)",
  range: [0.64, 1.44],
  events: [
    {
      critical: 1,
      title: "Touching at a point",
      label: "The drops touch",
      meeting: "the drops touch at the origin",
    },
  ],
  sides: [
    {
      name: "two separate drops",
      pieces: [2, 2],
      level: 0.84,
      title: "Two drops",
      toward: { above: { what: "the gap between them" } },
    },
    {
      name: "one drop",
      pieces: [2],
      level: 1.16,
      title: "One drop",
      toward: { below: { what: "its neck" } },
    },
  ],
  order: "up",
  explanation: {
    title: "Two drops that meet at one point.",
    formula: ["F = d₁² d₂² = c", "d₁, d₂ to (±1, 0, 0)"],
    text: "F multiplies the squared distances to two foci. Its gradient vanishes only at the foci, where F = 0, and at the origin, where F = 1 and its Hessian, diag(−4, 4, 4), makes a saddle. Between critical levels a level set only deforms, so every level between 0 and 1 is two drops and every level above 1 one drop. At c = 1 the drops touch at the origin, where the surface is not a manifold. The plane z = 0 cuts them in Cassini ovals, with Bernoulli's lemniscate at the event.",
  },
  // With u = x² and v = y² + z², F = (u + v + 1)² − 4u. On F = c,
  // u ≤ 1 + √c, and v = √(c + 4u) − u − 1 is greatest, c/4, at u = 1 − c/4.
  extent: (c) => {
    const x = Math.sqrt(1 + Math.sqrt(c)),
      r = Math.sqrt(c) / 2;
    return { x, y: r, z: r };
  },
};
// F = (ρ² − 1)² + z² with ρ² = x² + y²: in the (ρ², z) half-plane each
// level is a circle of radius √c about (1, 0). Below 1 it misses the axis
// and turns into a torus; above, it crosses the axis and turns into a
// sphere; at 1 it touches the axis at the origin, where F's only nonzero
// critical value lies.
const handle: Story = {
  id: "handle",
  f: "(x^2+y^2-1)^2+z^2",
  range: [0.64, 1.44],
  events: [
    {
      critical: 1,
      title: "Pinched at the center",
      label: "A handle appears",
      meeting: "the dimples meet at the origin",
    },
  ],
  sides: [
    {
      name: "a torus",
      pieces: [0],
      level: 0.84,
      title: "A torus",
      toward: { above: { what: "its hole" } },
    },
    {
      name: "a sphere",
      pieces: [2],
      level: 1.16,
      title: "A sphere",
      toward: { below: { what: "the gap between its dimples" } },
    },
  ],
  // Descending: the sphere comes first.
  order: "down",
  explanation: {
    title: "The instant a handle appears.",
    formula: ["(ρ² − 1)² + z² = c", "ρ² = x² + y²"],
    text: "In the half-plane of ρ² and z each level is a circle of radius √c about (1, 0), and the surface is that circle turned about the z axis. Above c = 1 the circle crosses the axis: a sphere, dimpled at its poles. Below 1 it misses the axis: a torus. At c = 1 it touches the axis at the origin, where ∇F = 0 and the Hessian is diag(−4, −4, 2): the dimples meet in a point, and the surface is pinched there. The plane y = 0 holds the axis, so it cuts the surface in its meridian: a peanut, a figure eight at the event, then two ovals.",
  },
  // ρ² ≤ 1 + √c, greatest at z = 0, and z² ≤ c, at ρ² = 1.
  extent: (c) => {
    const r = Math.sqrt(1 + Math.sqrt(c));
    return { x: r, y: r, z: Math.sqrt(c) };
  },
};
// The tanglecube F = g(x) + g(y) + g(z) with g(t) = t⁴ − 5t², whose
// critical points are 0 (g = 0, g″ = −10) and ±√(5/2) (g = −25/4,
// g″ = 20). F's critical points are their products: with k coordinates
// nonzero, F = −25k/4 and the index is 3 − k. Eight drops about the
// minima at −75/4 join along the cube's twelve edges at −25/2, its six
// windows close at −25/4, and the hollow about the maximum at the origin
// vanishes at 0 (docs/mathematics.md, Curated events).
const tanglecube: Story = {
  id: "tanglecube",
  f: "x^4 - 5*x^2 + y^4 - 5*y^2 + z^4 - 5*z^2",
  range: [-18, 4],
  events: [
    {
      critical: -12.5,
      title: "Touching at twelve points",
      label: "Drops join",
      meeting:
        "the eight drops touch at the midpoints of the cube's twelve edges",
    },
    {
      critical: -6.25,
      title: "Closing at six points",
      label: "Windows close",
      meeting: "the six windows close at the centers of the cube's faces",
    },
    {
      critical: 0,
      title: "A point inside",
      label: "The hollow vanishes",
      meeting: "the hollow inside shrinks to the origin",
    },
  ],
  sides: [
    {
      name: "eight separate drops",
      pieces: [2, 2, 2, 2, 2, 2, 2, 2],
      level: -15,
      title: "Eight drops",
      toward: { above: { what: "the gaps between them", are: true } },
    },
    {
      name: "one surface of genus 5",
      pieces: [-8],
      level: -10,
      title: "Genus 5",
      toward: {
        below: { what: "its necks", are: true },
        above: { what: "its windows", are: true },
      },
    },
    {
      name: "two nested spheres",
      pieces: [2, 2],
      level: -3,
      title: "A hollow shell",
      toward: {
        below: { what: "the shell's wall at the face centers" },
        above: { what: "the hollow" },
      },
    },
    {
      name: "one sphere",
      pieces: [2],
      level: 2,
      title: "One sphere",
      toward: {},
    },
  ],
  order: "up",
  // The surface fills its box above the first event.
  previewZoom: 1,
  explanation: {
    title: "Eight drops, a cage, a shell, a ball.",
    formula: ["Σ (xᵢ⁴ − 5xᵢ²) = c", "each term g(t) = t⁴ − 5t²"],
    text: "Each term g has critical points at 0 and ±√(5/2), so F's critical points are the 27 points whose coordinates are those: 8 minima at −18.75, 12 saddles at −12.5, 6 at −6.25 and a maximum at the origin. Between critical levels a level set only deforms. Eight drops join along the cube's edges into one surface of genus 5, its six windows close into a hollow shell, and the hollow shrinks to the origin and vanishes. The plane z = 0 cuts four tubes, then a ring, then a disk.",
  },
  // g(x) ≤ c − g(y) − g(z) ≤ c + 25/2, reached with y, z = ±√(5/2).
  extent: (c) => {
    const r = Math.sqrt((5 + Math.sqrt(75 + 4 * c)) / 2);
    return { x: r, y: r, z: r };
  },
};
// The double torus F = h² + z² with h = (x² + y²)² − x² + y², whose zero
// set in the plane is a lemniscate. Away from it ∇F vanishes only at the
// centers of its loops, (±1/√2, 0, 0), where h = −1/4, F = 1/16 and the
// Hessian is diag(−2, −2, 2): both holes open at one level.
const twoHandles: Story = {
  id: "two-handles",
  f: "((x^2 + y^2)^2 - x^2 + y^2)^2 + z^2",
  range: [0.01, 0.1],
  events: [
    {
      critical: 0.0625,
      title: "Pinched at two points",
      label: "Two handles appear",
      meeting: "the dimples meet at (±1/√2, 0, 0), the centers of both holes",
    },
  ],
  sides: [
    {
      name: "a surface of genus 2",
      pieces: [-2],
      level: 0.04,
      title: "A double torus",
      toward: { above: { what: "its holes", are: true } },
    },
    {
      name: "a sphere",
      pieces: [2],
      level: 0.09,
      title: "A sphere",
      toward: { below: { what: "the gaps between its dimples", are: true } },
    },
  ],
  order: "down",
  explanation: {
    title: "Two handles appear at once.",
    formula: ["h² + z² = c", "h = (x² + y²)² − x² + y²"],
    text: "h vanishes on a lemniscate, and each level is the double of the plane region where |h| ≤ √c. Below c = 1/16 that region has two holes, one in each loop: a surface of genus 2. Above it the holes are gone: a sphere, dimpled twice. At c = 1/16 both dimples meet at once, at the loops' centers, where ∇F = 0 and the Hessian is diag(−2, −2, 2). The plane z = 0 cuts the outline, and below the event the two holes inside it.",
  },
  // With u = x², v = y² and s = √c, |h| ≤ s: u is greatest on v = 0,
  // v is greatest, (1 + 4s)/8, where u = (1 − 2v)/2, and z² = c − h² is
  // greatest on h = 0.
  extent: (c) => {
    const s = Math.sqrt(c);
    return {
      x: Math.sqrt((1 + Math.sqrt(1 + 4 * s)) / 2),
      y: Math.sqrt((1 + 4 * s) / 8),
      z: s,
    };
  },
};
export const stories: Record<StoryId, Story> = {
  "two-drops": drops,
  handle,
  tanglecube,
  "two-handles": twoHandles,
};
export const storyIds = Object.keys(stories) as StoryId[];

// An event's three states (event-story.ts).
export type Bracket = StoryBracket<Side>;
export const bracket = (story: Story, event: number): Bracket =>
  storyBracket(story, event);

export type StoryContext = StoryContextOf<Story>;

// Whether a study is its story's recipe in a box that holds every level
// the story covers, which event the strip shows (the one shown, or with
// none, the level's: eventFor), and which of its states the study stands
// at. The level,
// resolution, refinement, sections, the shape parameter (which no recipe
// uses), layers, camera and animation keep the story; null when the study
// has none or is not a level set.
export function storyContext(
  config: SpatialConfig,
  id: StoryId | undefined,
  shown?: number,
): StoryContext | null {
  const story = id && stories[id];
  if (!story || config.format !== "implicit") return null;
  const q = config.implicit;
  if (q.f !== story.f)
    return {
      story,
      eligible: false,
      reason:
        "F is no longer the story's expression, so its event is not claimed.",
    };
  const e = story.extent(story.range[1]),
    b = q.box;
  // Strictly inside, so no level the story covers reaches a face; NaN
  // bounds fail every comparison.
  if (!(
    b.xMin < -e.x &&
    b.xMax > e.x &&
    b.yMin < -e.y &&
    b.yMax > e.y &&
    b.zMin < -e.z &&
    b.zMax > e.z
  ))
    return {
      story,
      eligible: false,
      reason: `The box no longer holds the surface at every level up to ${readout(story.range[1])}, so it could cut the surface open.`,
    };
  const event = shownEvent(story, q.level, shown);
  return {
    story,
    eligible: true,
    event,
    state: stateAt(story, event, q.level),
  };
}

// What the mesh shows, when it is whole enough to compare: the Euler
// characteristics of its pieces, ascending; otherwise why not, as a
// clause after "this mesh".
export function observedClass(
  r: ImplicitResult,
): { complete: true; pieces: number[] } | { complete: false; why: string } {
  const why = !r.triangles.length
    ? "has no surface"
    : r.cut.length
      ? "is cut open by the box"
      : r.open.length || r.nonfinite
        ? "is open beside cells left out"
        : r.refinement.exhausted
          ? "stopped refining at its budget"
          : r.crossingsUnresolved
            ? "has tetrahedra left out where sheets meet"
            : r.crossingsExhausted
              ? "was meshed without its crossings"
              : r.discontinuities
                ? "changes sign across a pole or a jump"
                : r.components.some((c) => !c.closed || !c.orientable)
                  ? "has a piece that is open or one-sided"
                  : "";
  if (why) return { complete: false, why };
  return {
    complete: true,
    pieces: r.components.map((c) => c.euler).sort((a, b) => a - b),
  };
}

// The story's sentences for the main note, before the mesh's own: the
// analytic surface at this level, and whether the mesh agrees, cannot be
// compared, or does not resolve it. At a critical level the surface is
// singular, so no genus is given (implicitNote's genus: false).
export function storyNote(
  story: Story,
  level: number,
  r: ImplicitResult,
): string[] {
  const [low, high] = story.range;
  const event = criticalAt(story, level);
  if (event)
    return [
      `At the critical level c = ${readout(event.critical)} ${event.meeting}, where ∇F vanishes: the surface is not a manifold there, so it has no genus. The mesh is a finite picture of it and can look smooth.`,
    ];
  if (!(level >= low && level <= high))
    return [
      `The story's analysis covers levels from ${readout(low)} to ${readout(high)}; at c = ${readout(level)} the notes describe the mesh alone.`,
    ];
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
  } the surface is ${side.name}`;
  const seen = observedClass(r);
  if (!seen.complete)
    return [`${where}, but this mesh ${seen.why}, so it cannot confirm that.`];
  if (sameClass(seen.pieces, side.pieces))
    return [`${where}, and the mesh agrees.`];
  // What narrows toward the nearer event.
  const nearBelow =
    !above ||
    (below !== undefined && level - below.critical < above.critical - level);
  const near = nearBelow ? below : above,
    feature = nearBelow ? side.toward.below : side.toward.above;
  if (!feature)
    return [
      `${where}, but the mesh reads otherwise. Use more cells or refinement.`,
    ];
  return [
    `${where}, but the mesh reads otherwise: ${feature.what} ${feature.are ? "are" : "is"} finer than this grid resolves at this level. Use more cells or refinement, or a level farther from ${readout(near.critical)}.`,
  ];
}
const sameClass = (a: number[], b: number[]) =>
  a.length === b.length && a.every((e, i) => e === b[i]);

// Whether the mesh at one of the strip's states agrees with the analysis,
// differs from it, cannot be compared, or (at the critical level) is
// singular, which no finite mesh shows faithfully.
export function stateReading(
  story: Story,
  event: number,
  state: EventState,
  r: ImplicitResult,
): "agrees" | "differs" | "incomplete" | "singular" {
  if (state === "critical") return "singular";
  const seen = observedClass(r);
  if (!seen.complete) return "incomplete";
  const side = bracket(story, event).sides[state];
  return sameClass(seen.pieces, side.pieces) ? "agrees" : "differs";
}

// The level's rests beside the events: while the level track passes one
// of the sides' regular levels, it rests there for `share` of the
// duration, and moves at a steady rate between. `at` holds the motion's
// progress at each rest, ascending, and `levels` the levels themselves.
// Rests take at most `restsAtMost` of the timeline between them.
export type Holds = {
  from: number;
  to: number;
  at: number[];
  levels: number[];
  share: number;
};
export const holdShare = 0.15;
export const restsAtMost = 0.6;
export function holdPlan(
  track: NumericTrack,
  story: Story,
  share = holdShare,
): Holds | null {
  if (track.target !== "level") return null;
  const { from, to } = track;
  if (!(Number.isFinite(from) && Number.isFinite(to)) || from === to)
    return null;
  const rests = story.sides
    .map(({ level }) => ({ level, u: (level - from) / (to - from) + 0 }))
    .filter(({ u }) => u >= 0 && u <= 1)
    .sort((a, b) => a.u - b.u);
  if (!rests.length) return null;
  return {
    from,
    to,
    at: rests.map((r) => r.u),
    levels: rests.map((r) => r.level),
    share: Math.min(share, restsAtMost / rests.length),
  };
}
// The level at time q of the timeline, in [0, 1]: exactly `from` at 0,
// `to` at 1, and each rest's own level while it rests.
export function heldLevel(h: Holds, q: number): number {
  if (q >= 1) return h.to;
  if (!(q > 0)) return h.from;
  const moving = 1 - h.at.length * h.share;
  const at = (u: number) => h.from * (1 - u) + h.to * u;
  let t = 0,
    previous = 0;
  for (const [i, u] of h.at.entries()) {
    const span = (u - previous) * moving;
    if (q < t + span) return at(previous + (q - t) / moving);
    t += span;
    if (q < t + h.share) return h.levels[i];
    t += h.share;
    previous = u;
  }
  return at(Math.min(1, previous + (q - t) / moving));
}
