// The 2D notebook's loop check (see loop-check.ts), loaded only when a loop
// is played, since it draws with React's static renderer as export does.
import { renderToStaticMarkup } from "react-dom/server";
import { Plot, type Layers } from "./Plot";
import type { AnimationView } from "./animation";
import { loopRefusal } from "./loop-check";
import { exportBaseSize } from "./export-quality";

// Why the drawing at the end of a parameter animation is not the drawing at
// its start, or null when a loop can join them. start and end are the
// frames at progress 0 and 1, drawn with these layers.
export function planarLoopGap(
  start: AnimationView,
  end: AnimationView,
  layers: Layers,
): Promise<string | null> {
  const draw = (view: AnimationView) =>
    renderToStaticMarkup(
      <Plot
        result={view.frame.result}
        config={view.frame.config}
        layers={layers}
        dark={false}
        length={view.length}
        animation={view}
        reset={0}
      />,
    );
  return loopRefusal(
    draw(start),
    draw(end),
    " End each track one period after it starts, for example a from 0 to 2*pi in cos(t + a), or choose Back and forth.",
    exportBaseSize(),
  );
}
