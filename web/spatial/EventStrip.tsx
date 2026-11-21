import { HelpText, HelpToggle, useHelp } from "../Field";
import { tiered } from "../help";
import type { PreviewSlot, PreviewSlots } from "./event-previews";
import {
  bracket,
  eventOrder,
  eventStates,
  type EventState,
  type Story,
  type StoryContext,
} from "./story";
import { count, readout } from "../number-format";

const stateLabels: Record<EventState, string> = {
  before: "Before",
  critical: "At the event",
  after: "After",
};
const euler = (pieces: number[]) => pieces.map((e) => count(e)).join(", ");
// What the mesh at a state shows, beside the analysis: a short reading,
// with the full statement in the study's note once it is chosen.
function reading(slot: PreviewSlot | undefined, waiting: boolean) {
  if (!slot || slot.status === "pending")
    return waiting ? "Waiting for a valid study" : "Meshing…";
  if (slot.status === "failed") return "No preview";
  switch (slot.reading) {
    case "agrees":
      return "Mesh agrees";
    case "differs":
      return `Mesh reads χ ${euler(slot.pieces)}`;
    case "incomplete":
      return "Mesh incomplete";
    case "singular":
      return `Singular · mesh χ ${euler(slot.pieces)}`;
  }
}
export const eventStripHelp = tiered(
  "Each state is the study at one level; choose one to draw it at full quality.",
  "Before and after are regular levels, where the analysis says what the surface is and the mesh is compared with it; the event is singular. Previews follow the theme, layers, cut and sight, seen from the story's view. Choosing changes only the level.",
);
// With several events, the chooser decides whose states are shown.
export const eventsStripHelp = tiered(
  "Choose an event to preview its three states, then a state to draw the study at that level.",
  "Before and after are regular levels, where the analysis says what the surface is and the mesh is compared with it; each event is singular. A level between two events is one's after and the next one's before. Previews follow the theme, layers, cut and sight. Choosing changes only the level.",
);
const criticalLevel = (story: Story) =>
  `Critical level c = ${readout(story.events[0].critical)}`;

// The strip of a story's states, beside the drawing: with several events,
// a chooser of the event shown, then that event's three states, each a
// preview of the study at that level, its analytic name and what its mesh
// reads, all outside the artwork. Choosing a state changes only the level;
// choosing an event changes only what the strip shows.
export function EventStrip({
  context,
  slots,
  waiting,
  onSelect,
  onShow,
}: {
  context: StoryContext;
  slots: PreviewSlots | null;
  // Whether the study is in error, so previews wait for a valid one.
  waiting: boolean;
  onSelect: (state: EventState) => void;
  onShow: (event: number) => void;
}) {
  const help = useHelp();
  const { story } = context;
  const selected = context.eligible ? context.state : null;
  const shown = context.eligible ? context.event : eventOrder(story)[0];
  const { levels, names } = bracket(story, shown);
  const several = story.events.length > 1;
  const ready = slots
    ? eventStates.filter((s) => slots[s].status !== "pending").length
    : 0;
  return (
    <section
      className="event-strip"
      aria-label={several ? "The events" : "The event"}
      data-story={story.id}
      data-event={several ? shown : undefined}
      data-previews={context.eligible ? ready : undefined}
      aria-busy={context.eligible && ready < eventStates.length}
    >
      <div className="event-heading">
        <span className="section-label">
          {several ? "THE EVENTS" : "THE EVENT"}
        </span>
        {several && <HelpToggle topic="the event's states" help={help} />}
        {several ? (
          <div className="event-choices" role="group" aria-label="Events">
            {eventOrder(story).map((i, n) => (
              <button
                type="button"
                key={i}
                className="event-choice"
                data-event={i}
                aria-pressed={shown === i}
                disabled={!context.eligible}
                onClick={() => onShow(i)}
              >
                <span className="event-choice-label">
                  {count(n + 1)} · {story.events[i].label}
                </span>
                <span className="event-choice-level">
                  c = {readout(story.events[i].critical)}
                </span>
              </button>
            ))}
          </div>
        ) : (
          <span className="event-critical">{criticalLevel(story)}</span>
        )}
        {!several && <HelpToggle topic="the event's states" help={help} />}
      </div>
      <HelpText help={help}>
        {several ? eventsStripHelp : eventStripHelp}
      </HelpText>
      {!context.eligible && <p className="event-refusal">{context.reason}</p>}
      <div className="event-states" role="group" aria-label="Event states">
        {eventStates.map((state) => {
          const slot = context.eligible ? slots?.[state] : undefined;
          return (
            <button
              type="button"
              key={state}
              className="event-state"
              data-state={state}
              aria-pressed={selected === state}
              disabled={!context.eligible}
              onClick={() => onSelect(state)}
            >
              <span className="event-image">
                {slot?.status === "ready" && <img src={slot.url} alt="" />}
              </span>
              <span className="event-label">
                {stateLabels[state]} · c = {readout(levels[state])}
              </span>
              <span className="event-name">{names[state]}</span>
              <span className="event-reading">
                {context.eligible
                  ? reading(slot, waiting)
                  : "Not this story's study"}
              </span>
            </button>
          );
        })}
      </div>
    </section>
  );
}
