import { HelpText, HelpToggle, useHelp } from "../Field";
import { tiered } from "../help";
import type { SurfaceResult } from "./types";

// Locating an offset's cuspidal edges (`surface.edges`). Absent means off,
// as in links made before it.
export const edgesHelp = tiered(
  "Traces where the offset folds sharply, along curves where d = 1/κ₁ or 1/κ₂.",
  "Each point is found between samples on the patch itself, where a grid edge crosses the curve; a loop within one cell is missed. An edge stops beside a chart singularity, and crosses a seam where the patch closes on itself.",
);

// The checkbox and its help. Unchecking drops the field, so the link is the
// one made before the setting existed.
export function CuspidalEdgesCheck({
  checked,
  onChange,
}: {
  checked: boolean;
  onChange: (on: boolean) => void;
}) {
  const help = useHelp();
  return (
    <>
      <div className="probe-switch">
        <label className="check">
          <input
            type="checkbox"
            checked={checked}
            onChange={(e) => onChange(e.target.checked)}
          />
          Locate cuspidal edges
        </label>
        <HelpToggle topic="locating cuspidal edges" help={help} />
      </div>
      <HelpText help={help}>{edgesHelp}</HelpText>
    </>
  );
}

const count = (n: number, one: string, many: string) =>
  `${n.toLocaleString()} ${n === 1 ? one : many}`;

// How many cuspidal edges the offset has, and on which focal sheets.
export function edgesNote(s: SurfaceResult): string[] {
  if (!s.offset || !s.edges) return [];
  if (s.edges.length === 0)
    return [
      "The offset has no cuspidal edge: d is neither radius of curvature anywhere on the patch.",
    ];
  const on = ([1, 2] as const)
    .map((b) => [b, s.edges!.filter((e) => e.branch === b).length] as const)
    .filter(([, n]) => n > 0)
    .map(([b, n]) => `${n.toLocaleString()} on focal sheet ${b}`);
  const closed = s.edges.filter((e) => e.closed).length;
  return [
    `The offset folds along ${count(s.edges.length, "cuspidal edge", "cuspidal edges")} (${on.join(", ")})${
      closed === s.edges.length
        ? s.edges.length === 1
          ? ", a closed curve"
          : ", each a closed curve"
        : closed > 0
          ? `, ${count(closed, "closed", "closed")}`
          : ""
    }, where it touches the focal sheet.`,
  ];
}
