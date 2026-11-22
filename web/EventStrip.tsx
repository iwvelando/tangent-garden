import type { ReactNode } from "react";
import { HelpText, HelpToggle, useHelp } from "./Field";
import type { Help } from "./help";
import {
  bracket,
  eventOrder,
  eventStates,
  type EventState,
  type StoryContextOf,
  type StoryShape,
} from "./event-story";
import { count, readout } from "./number-format";
import "./event-strip.css";

const stateLabels: Record<EventState, string> = {
  before: "Before",
  critical: "At the event",
  after: "After",
};
// A state's preview: waiting, drawn with what its calculation reads, or
// refused.
export type StripSlot<Ready> =
  | { status: "pending" }
  | ({ status: "ready" } & Ready)
  | { status: "failed"; message: string };

// The strip of a story's states, beside the drawing, for either notebook:
// with several events, a chooser of the event shown, then that event's
// three states, each a preview of the study at that level, its analytic
// name and what its calculation reads, all outside the artwork. Choosing a
// state changes only the level; choosing an event changes only what the
// strip shows. The notebook supplies each ready preview's image and
// reading, the text shown while one computes, and the help.
export function EventStrip<Story extends StoryShape, Ready>({
  context,
  slots,
  waiting,
  onSelect,
  onShow,
  image,
  read,
  computing,
  help: helpText,
}: {
  context: StoryContextOf<Story>;
  slots: Record<EventState, StripSlot<Ready>> | null;
  // Whether the study is in error, so previews wait for a valid one.
  waiting: boolean;
  onSelect: (state: EventState) => void;
  onShow: (event: number) => void;
  image: (slot: Ready) => ReactNode;
  read: (slot: Ready, state: EventState) => string;
  computing: string;
  help: { one: Help<string>; several: Help<string> };
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
  const reading = (state: EventState, slot?: StripSlot<Ready>) =>
    !slot || slot.status === "pending"
      ? waiting
        ? "Waiting for a valid study"
        : computing
      : slot.status === "failed"
        ? "No preview"
        : read(slot, state);
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
          <span className="event-critical">
            Critical level c = {readout(story.events[0].critical)}
          </span>
        )}
        {!several && <HelpToggle topic="the event's states" help={help} />}
      </div>
      <HelpText help={help}>
        {several ? helpText.several : helpText.one}
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
                {slot?.status === "ready" && image(slot)}
              </span>
              <span className="event-label">
                {stateLabels[state]} · c = {readout(levels[state])}
              </span>
              <span className="event-name">{names[state]}</span>
              <span className="event-reading">
                {context.eligible
                  ? reading(state, slot)
                  : "Not this story's study"}
              </span>
            </button>
          );
        })}
      </div>
    </section>
  );
}
