import { HelpText, HelpToggle, useHelp } from "./Field";
import type { Help } from "./help";

// Whether a caustic study's rays stop where they reach the caustic, in the
// 2D and 3D notebooks, with its help in line beside it.
export function StopAtCaustic({
  checked,
  onChange,
  help: text,
}: {
  checked: boolean;
  onChange: (on: boolean) => void;
  help: Help;
}) {
  const help = useHelp();
  return (
    <>
      <div className="probe-switch caustic-switch">
        <label className="check">
          <input
            type="checkbox"
            checked={checked}
            onChange={(e) => onChange(e.target.checked)}
          />
          Stop rays at the caustic
        </label>
        <HelpToggle topic="stopping rays at the caustic" help={help} />
      </div>
      <HelpText help={help}>{text}</HelpText>
    </>
  );
}
