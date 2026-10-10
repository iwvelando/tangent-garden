import { HelpText, HelpToggle, useHelp } from "../Field";
import { tiered } from "../help";

// Restarting arc length past a break of the base, for the involute
// construction (`involute.restart`) and the involute input
// (`unwinding.restart`). Absent means off, as in links made before it.
export const restartHelp = tiered(
  "Starts arc length again past each break, from the middle of each further stretch.",
  "Each stretch of the base past a break gets its own anchor, halfway between its first and last regular samples, with the same string length c. A lone regular sample between two breaks stays unreached.",
);

const short = (t: number) => String(+t.toPrecision(4));

// Names a result's restarted anchors, in order, as the notes show them.
export const restartedAt = (restarts: number[]) =>
  `${restarts.length === 1 ? "an anchor" : "anchors"} at t = ${restarts.map(short).join(", ")}`;

// The checkbox and its help. Unchecking drops the field, so the link is
// the one made before restarts existed.
export function RestartCheck({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (on: boolean) => void;
}) {
  const help = useHelp();
  return (
    <>
      <div className="probe-switch restart-switch">
        <label className="check">
          <input
            type="checkbox"
            checked={checked}
            onChange={(e) => onChange(e.target.checked)}
          />
          {label}
        </label>
        <HelpToggle topic={label.toLowerCase()} help={help} />
      </div>
      <HelpText help={help}>{restartHelp}</HelpText>
    </>
  );
}
