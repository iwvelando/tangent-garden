// The topology theater's curated events: implicit studies whose one
// critical level, and the surface on either side of it, are known
// analytically (docs/mathematics.md, Curated events). A story names the
// recipe it applies to; the study keeps its own level, resolution, layers
// and camera, and the mesh at each level is compared with the analysis,
// never taken for it.
import type { NumericTrack } from "./animation";
import type { ImplicitResult, SpatialConfig, Vec3 } from "./types";

export type StoryId = "two-drops" | "handle";
export type EventState = "before" | "critical" | "after";
export const eventStates: EventState[] = ["before", "critical", "after"];
// One side of the critical level: what the surface is for every regular
// level there, the Euler characteristics of its closed pieces in
// ascending order, and the feature that narrows toward the event.
type Side = { name: string; pieces: number[]; feature: string };
export type Story = {
  id: StoryId;
  // The recipe, matched exactly: another expression, even one drawing the
  // same surface, is an ordinary study.
  f: string;
  critical: number;
  // The levels the story covers, and its bracket: a regular level on each
  // side and the critical level itself.
  range: [number, number];
  levels: Record<EventState, number>;
  // Short names for the strip's states, shown outside the artwork.
  names: Record<EventState, string>;
  below: Side;
  above: Side;
  // What happens at the critical level, as a clause.
  meeting: string;
  // Half-widths of the box about the origin that holds the solid F ≤ c,
  // and so the level set F = c; each grows with c.
  extent: (c: number) => Vec3;
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
  critical: 1,
  range: [0.64, 1.44],
  levels: { before: 0.84, critical: 1, after: 1.16 },
  names: {
    before: "Two drops",
    critical: "Touching at a point",
    after: "One drop",
  },
  below: {
    name: "two separate drops",
    pieces: [2, 2],
    feature: "the gap between them",
  },
  above: { name: "one drop", pieces: [2], feature: "its neck" },
  meeting: "the drops touch at the origin",
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
  critical: 1,
  range: [0.64, 1.44],
  // Descending: the sphere comes first.
  levels: { before: 1.16, critical: 1, after: 0.84 },
  names: {
    before: "A sphere",
    critical: "Pinched at the center",
    after: "A torus",
  },
  below: { name: "a torus", pieces: [0], feature: "its hole" },
  above: {
    name: "a sphere",
    pieces: [2],
    feature: "the gap between its dimples",
  },
  meeting: "the dimples meet at the origin",
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
export const stories: Record<StoryId, Story> = {
  "two-drops": drops,
  handle,
};
export const storyIds = Object.keys(stories) as StoryId[];

export type StoryContext =
  | { story: Story; eligible: true; state: EventState | null }
  | { story: Story; eligible: false; reason: string };

// Whether a study is its story's recipe in a box that holds every level
// the story covers, and which of the strip's states it stands at. The
// level, resolution, refinement, sections, the shape parameter (which
// neither recipe uses), layers, camera and animation keep the story; null
// when the study has none or is not a level set.
export function storyContext(
  config: SpatialConfig,
  id: StoryId | undefined,
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
      reason: `The box no longer holds the surface at every level up to ${story.range[1]}, so it could cut the surface open.`,
    };
  return { story, eligible: true, state: stateAt(story, q.level) };
}
export const stateAt = (story: Story, level: number) =>
  eventStates.find((s) => story.levels[s] === level) ?? null;

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
// compared, or does not resolve it. At the critical level the surface is
// singular, so no genus is given (implicitNote's genus: false).
export function storyNote(
  story: Story,
  level: number,
  r: ImplicitResult,
): string[] {
  const [low, high] = story.range;
  if (level === story.critical)
    return [
      `At the critical level c = ${story.critical} ${story.meeting}, where ∇F vanishes: the surface is not a manifold there, so it has no genus. The mesh is a finite picture of it and can look smooth.`,
    ];
  if (!(level >= low && level <= high))
    return [
      `The story's analysis covers levels from ${low} to ${high}; at c = ${level.toLocaleString()} the notes describe the mesh alone.`,
    ];
  const side = level < story.critical ? story.below : story.above;
  const where = `${level < story.critical ? "Below" : "Above"} the critical level c = ${story.critical} the surface is ${side.name}`;
  const seen = observedClass(r);
  if (!seen.complete)
    return [`${where}, but this mesh ${seen.why}, so it cannot confirm that.`];
  if (sameClass(seen.pieces, side.pieces))
    return [`${where}, and the mesh agrees.`];
  return [
    `${where}, but the mesh reads otherwise: ${side.feature} is finer than this grid resolves at this level. Use more cells or refinement, or a level farther from ${story.critical}.`,
  ];
}
const sameClass = (a: number[], b: number[]) =>
  a.length === b.length && a.every((e, i) => e === b[i]);

// Whether the mesh at one of the strip's states agrees with the analysis,
// differs from it, cannot be compared, or (at the critical level) is
// singular, which no finite mesh shows faithfully.
export function stateReading(
  story: Story,
  state: EventState,
  r: ImplicitResult,
): "agrees" | "differs" | "incomplete" | "singular" {
  if (state === "critical") return "singular";
  const seen = observedClass(r);
  if (!seen.complete) return "incomplete";
  const level = story.levels[state];
  const side = level < story.critical ? story.below : story.above;
  return sameClass(seen.pieces, side.pieces) ? "agrees" : "differs";
}

// The level's rests beside the event: while the level track passes one of
// the bracket's regular levels, it rests there for `share` of the
// duration, and moves at a steady rate between. `at` holds the motion's
// progress at each rest, ascending, and `levels` the levels themselves.
export type Holds = {
  from: number;
  to: number;
  at: number[];
  levels: number[];
  share: number;
};
export const holdShare = 0.15;
export function holdPlan(
  track: NumericTrack,
  story: Story,
  share = holdShare,
): Holds | null {
  if (track.target !== "level") return null;
  const { from, to } = track;
  if (!(Number.isFinite(from) && Number.isFinite(to)) || from === to)
    return null;
  const rests = [story.levels.before, story.levels.after]
    .map((level) => ({ level, u: (level - from) / (to - from) + 0 }))
    .filter(({ u }) => u >= 0 && u <= 1)
    .sort((a, b) => a.u - b.u);
  if (!rests.length) return null;
  return {
    from,
    to,
    at: rests.map((r) => r.u),
    levels: rests.map((r) => r.level),
    share,
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
