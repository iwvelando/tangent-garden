// What the topology theater's stories share, in either notebook: a field
// whose critical levels, and what lies on either side of them, are known
// analytically (docs/mathematics.md, Curated events and Planar events).
// A story's k critical levels divide its covered levels into k + 1 sides;
// each event is shown as three states, the side it is reached from, the
// critical level and the side it leads to. The notebooks' own descriptors
// (spatial/story.ts, planar-story.ts) say what a side is and how a
// calculation is compared with it.
export type EventState = "before" | "critical" | "after";
export const eventStates: EventState[] = ["before", "critical", "after"];
// One side: its regular level on the strip and its short name.
export type StorySide = { level: number; title: string };
// One critical level: its short name on the strip and its label in the
// event chooser.
export type StoryEvent = { critical: number; title: string; label: string };
export type StoryShape<Side extends StorySide = StorySide> = {
  id: string;
  // The critical levels, ascending, and the k + 1 sides between them:
  // sides[i] lies below events[i] and sides[i + 1] above it, so a side
  // between two events belongs to both their brackets.
  events: StoryEvent[];
  sides: Side[];
  // The order the strip and the film reach the events in: as the level
  // rises, or as it falls.
  order: "up" | "down";
};

// The events in the order the story reaches them.
export const eventOrder = (story: StoryShape): number[] => {
  const order = story.events.map((_, i) => i);
  return story.order === "up" ? order : order.reverse();
};
// An event's three states: the side it is reached from, its critical
// level and the side it leads to, in the story's order.
export type Bracket<Side extends StorySide = StorySide> = {
  critical: number;
  levels: Record<EventState, number>;
  names: Record<EventState, string>;
  sides: Record<"before" | "after", Side>;
};
export function bracket<Side extends StorySide>(
  story: StoryShape<Side>,
  event: number,
): Bracket<Side> {
  const e = story.events[event],
    below = story.sides[event],
    above = story.sides[event + 1];
  const [before, after] =
    story.order === "up" ? [below, above] : [above, below];
  return {
    critical: e.critical,
    levels: { before: before.level, critical: e.critical, after: after.level },
    names: { before: before.title, critical: e.title, after: after.title },
    sides: { before, after },
  };
}
export const stateAt = (story: StoryShape, event: number, level: number) => {
  const { levels } = bracket(story, event);
  return eventStates.find((s) => levels[s] === level) ?? null;
};

// The event the strip shows once the level moves to a new value: the one
// shown already when the level is one of its states or none's; otherwise
// the event whose state the level is, a side between two leading to the
// next in the story's order. With none shown, a level on no state opens at
// the nearest event.
export function eventFor(
  story: StoryShape,
  level: number,
  shown?: number,
): number {
  const known =
    shown !== undefined && shown >= 0 && shown < story.events.length;
  if (known && stateAt(story, shown, level)) return shown;
  const order = eventOrder(story);
  const holding = order.filter((i) => stateAt(story, i, level));
  // A side's level is "before" one event and "after" the previous one.
  const leads = holding.find((i) => stateAt(story, i, level) !== "after");
  if (leads !== undefined) return leads;
  if (holding.length) return holding[0];
  if (known) return shown;
  if (!Number.isFinite(level)) return order[0];
  let nearest = order[0];
  for (const i of order)
    if (
      Math.abs(story.events[i].critical - level) <
      Math.abs(story.events[nearest].critical - level)
    )
      nearest = i;
  return nearest;
}
// The event a study opens at: the one shown, while it is one of the
// story's, or else the level's.
export const shownEvent = (story: StoryShape, level: number, shown?: number) =>
  shown !== undefined && shown >= 0 && shown < story.events.length
    ? shown
    : eventFor(story, level);
// The critical level a level is, if any.
export const criticalAt = <Event extends StoryEvent>(
  story: { events: Event[] },
  level: number,
) => story.events.find((e) => e.critical === level) ?? null;
// The side a regular level lies on.
export const sideAt = (story: StoryShape, level: number) =>
  story.events.filter((e) => e.critical < level).length;

// Whether a study is its story's, and if so which event the strip shows
// and which of its states the study stands at; if not, why not.
export type StoryContextOf<Story extends StoryShape> =
  | { story: Story; eligible: true; event: number; state: EventState | null }
  | { story: Story; eligible: false; reason: string };
