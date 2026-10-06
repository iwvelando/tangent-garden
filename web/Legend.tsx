// A drawing's legend, shared by the 2D, 3D and 4D notebooks. Each entry
// stands for geometry that one layer draws, and is shown exactly when that
// layer is on and the drawn study has that geometry. Every entry the study
// could show keeps its place: hidden ones follow the shown ones, invisible
// and out of the accessibility tree, so that hiding or showing a layer
// never reflows the legend or moves anything beside or below it.
import { Fragment, type HTMLAttributes, type ReactNode } from "react";

export type LegendEntry = {
  // The layer (or other drawn part) the entry stands for.
  key: string;
  shown: boolean;
  content: ReactNode;
  // Further attributes of the entry's element, such as a section's id.
  attributes?: HTMLAttributes<HTMLSpanElement> &
    Record<`data-${string}`, unknown>;
};

// The entries, separated by spaces that read as words but take no room
// between a flex legend's items.
export function LegendEntries({ entries }: { entries: LegendEntry[] }) {
  return [
    ...entries.filter((e) => e.shown),
    ...entries.filter((e) => !e.shown),
  ].map((e, i) => (
    <Fragment key={e.key}>
      {i > 0 && " "}
      <span
        {...e.attributes}
        className={e.shown ? "legend-entry" : "legend-entry legend-off"}
        data-legend={e.key}
        aria-hidden={e.shown ? undefined : true}
      >
        {e.content}
      </span>
    </Fragment>
  ));
}
