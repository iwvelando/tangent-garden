import { HelpText, HelpToggle, useHelp } from "./Field";
import type { Help } from "./help";
import { refinementReadout, type RefinedPath } from "./refinement";

// A setting beneath the control while refinement is on: its checkbox, in
// line with its help toggle, and its help.
type Option = { checked: boolean; onChange: (on: boolean) => void; help: Help };

// The control that refines a study's drawn curves between their samples,
// with a readout of what refinement did, in the 2D and 3D notebooks. Both
// also offer refinement to the view and framing by the points between
// samples beneath it while it is on.
export function RefineBetweenSamples({
  checked,
  onChange,
  refined,
  view,
  frame,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  // The refined curves of the drawing shown, once refinement has run.
  refined?: (RefinedPath<unknown> | undefined)[];
  view?: Option;
  frame?: Option;
}) {
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
        <Setting
          option={view}
          label="Refine to the view as you zoom"
          topic="refining to the view"
        />
      )}
      {checked && frame && (
        <Setting
          option={frame}
          label="Frame the points between samples"
          topic="framing between samples"
        />
      )}
      {checked && refined && (
        <p className="refinement-readout">{refinementReadout(refined)}</p>
      )}
    </>
  );
}

function Setting({
  option,
  label,
  topic,
}: {
  option: Option;
  label: string;
  topic: string;
}) {
  const help = useHelp();
  return (
    <>
      <div className="probe-switch view-switch">
        <label className="check">
          <input
            type="checkbox"
            checked={option.checked}
            onChange={(e) => option.onChange(e.target.checked)}
          />
          {label}
        </label>
        <HelpToggle topic={topic} help={help} />
      </div>
      <HelpText help={help}>{option.help}</HelpText>
    </>
  );
}
