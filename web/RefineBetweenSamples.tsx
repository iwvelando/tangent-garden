import { HelpText, HelpToggle, useHelp } from "./Field";
import type { Help } from "./help";
import { refinementReadout, type RefinedPath } from "./refinement";

// The control that refines a study's drawn curves between their samples,
// with a readout of what refinement did, in the 2D and 3D notebooks. The 2D
// notebook also offers refinement to the view, beneath it while it is on.
export function RefineBetweenSamples({
  checked,
  onChange,
  refined,
  view,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  // The refined curves of the drawing shown, once refinement has run.
  refined?: (RefinedPath<unknown> | undefined)[];
  view?: { checked: boolean; onChange: (on: boolean) => void; help: Help };
}) {
  const help = useHelp();
  return (
    <>
      <label className="check">
        <input
          type="checkbox"
          checked={checked}
          onChange={(e) => onChange(e.target.checked)}
        />
        Refine between samples
      </label>
      {checked && view && (
        <>
          <div className="probe-switch view-switch">
            <label className="check">
              <input
                type="checkbox"
                checked={view.checked}
                onChange={(e) => view.onChange(e.target.checked)}
              />
              Refine to the view as you zoom
            </label>
            <HelpToggle topic="refining to the view" help={help} />
          </div>
          <HelpText help={help}>{view.help}</HelpText>
        </>
      )}
      {checked && refined && (
        <p className="refinement-readout">{refinementReadout(refined)}</p>
      )}
    </>
  );
}
