import { HelpText, HelpToggle, useHelp } from "../Field";
import { tiered } from "../help";
import type { PreviewSlot, PreviewSlots } from "./event-previews";
import { eventStates, type EventState, type StoryContext } from "./story";
import { count } from "../number-format";

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

// The strip of a story's three states, beside the drawing: each a preview
// of the study at that level, its analytic name and what its mesh reads,
// all outside the artwork. Choosing one changes only the level.
export function EventStrip({
  context,
  slots,
  waiting,
  onSelect,
}: {
  context: StoryContext;
  slots: PreviewSlots | null;
  // Whether the study is in error, so previews wait for a valid one.
  waiting: boolean;
  onSelect: (state: EventState) => void;
}) {
  const help = useHelp();
  const { story } = context;
  const selected = context.eligible ? context.state : null;
  const ready = slots
    ? eventStates.filter((s) => slots[s].status !== "pending").length
    : 0;
  return (
    <section
      className="event-strip"
      aria-label="The event"
      data-story={story.id}
      data-previews={context.eligible ? ready : undefined}
      aria-busy={context.eligible && ready < eventStates.length}
    >
      <div className="event-heading">
        <span className="section-label">THE EVENT</span>
        <span className="event-critical">
          Critical level c = {story.critical}
        </span>
        <HelpToggle topic="the event's states" help={help} />
      </div>
      <HelpText help={help}>{eventStripHelp}</HelpText>
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
                {stateLabels[state]} · c = {story.levels[state]}
              </span>
              <span className="event-name">{story.names[state]}</span>
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
