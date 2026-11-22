import { EventStrip as Strip } from "../EventStrip";
import { tiered } from "../help";
import type { PreviewSlots } from "./event-previews";
import type { EventState, StoryContext } from "./story";
import { count } from "../number-format";

const euler = (pieces: number[]) => pieces.map((e) => count(e)).join(", ");
type Ready = Extract<PreviewSlots[EventState], { status: "ready" }>;
// What the mesh at a state shows, beside the analysis: a short reading,
// with the full statement in the study's note once it is chosen.
function reading(slot: Ready) {
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

// The 3D notebook's strip (../EventStrip.tsx): each state's preview is an
// image of the mesh, read by its pieces' Euler characteristics.
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
  return (
    <Strip
      context={context}
      slots={slots}
      waiting={waiting}
      onSelect={onSelect}
      onShow={onShow}
      image={(slot) => <img src={slot.url} alt="" />}
      read={reading}
      computing="Meshing…"
      help={{ one: eventStripHelp, several: eventsStripHelp }}
    />
  );
}
