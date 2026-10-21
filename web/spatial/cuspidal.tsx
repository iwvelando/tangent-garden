import { HelpText, HelpToggle, useHelp } from "../Field";
import { tiered, type Help } from "../help";
import type {
  RaysConfig,
  RaysResult,
  SurfaceConfig,
  SurfaceResult,
} from "./types";

// Whether a surface study locates cuspidal edges, on its offset or over its
// ridges.
const offsetEdges = (s: SurfaceConfig) => !!s.edges && s.offset !== 0;
export const locatesEdges = (s: SurfaceConfig) => offsetEdges(s) || !!s.ridges;

// The sentence naming whose cuspidal edges are drawn in gold, if any.
export function goldEdges(s: SurfaceConfig) {
  const whose = [
    offsetEdges(s) && "the offset's",
    s.ridges && "the focal sheets'",
  ].filter(Boolean);
  return whose.length
    ? ` Gold curves are ${whose.join(" and ")} cuspidal edges.`
    : "";
}

// Locating an offset's cuspidal edges (`surface.edges`). Absent means off,
// as in links made before it.
export const edgesHelp = tiered(
  "Traces where the offset folds sharply, along curves where d = 1/κ₁ or 1/κ₂.",
  "Each point is found between samples on the patch itself, where a grid edge crosses the curve; a loop within one cell is missed. An edge stops beside a chart singularity, and crosses a seam where the patch closes on itself.",
);

// Locating the patch's ridges and the focal sheets' cuspidal edges over
// them (`surface.ridges`). Absent means off, as in links made before it.
export const ridgesHelp = tiered(
  "Draws ridges, where κᵢ is extremal along its line of curvature, and the focal sheets' cuspidal edges above them.",
  "Each point is found between samples on the patch itself, where a grid edge crosses a ridge; a loop within one cell is missed. A ridge stops beside a chart singularity, near an umbilic, and where its center lies beyond 100 surface radii. A sheet that collapses to a curve or a point has none.",
);

// Locating the caustics' cuspidal edges (`rays.edges`). Absent means off,
// as in links made before it.
export const causticEdgesHelp = tiered(
  "Draws the caustics' cuspidal edges, where each caustic sheet folds back sharply.",
  "Each point is found between samples, where a grid edge crosses it; a loop within one cell is missed. An edge stops where no light leaves, beside a stigmatic sample, and where its caustic lies beyond 100 surface radii. A caustic collapsing to a curve or point has none. Virtual edges show with the virtual caustics.",
);

// The sentence naming the caustics' cuspidal edges drawn in gold, if any.
export const goldCausticEdges = (r: RaysConfig) =>
  r.edges
    ? " Broad gold curves are the caustics' cuspidal edges, where they fold back."
    : "";

type CheckProps = { checked: boolean; onChange: (on: boolean) => void };

// A checkbox and its help. Unchecking drops the field, so the link is the
// one made before the setting existed.
function LocateCheck({
  label,
  topic,
  text,
  checked,
  onChange,
}: CheckProps & { label: string; topic: string; text: Help }) {
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
          {label}
        </label>
        <HelpToggle topic={topic} help={help} />
      </div>
      <HelpText help={help}>{text}</HelpText>
    </>
  );
}

export const CuspidalEdgesCheck = (props: CheckProps) => (
  <LocateCheck
    label="Locate cuspidal edges"
    topic="locating cuspidal edges"
    text={edgesHelp}
    {...props}
  />
);

export const CausticEdgesCheck = (props: CheckProps) => (
  <LocateCheck
    label="Locate cuspidal edges"
    topic="locating the caustics' cuspidal edges"
    text={causticEdgesHelp}
    {...props}
  />
);

export const RidgesCheck = (props: CheckProps) => (
  <LocateCheck
    label="Locate ridges"
    topic="locating ridges"
    text={ridgesHelp}
    {...props}
  />
);

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

// How many ridges the patch has, on which branches, and how many close.
export function ridgesNote(s: SurfaceResult): string[] {
  if (!s.ridges) return [];
  if (s.ridges.length === 0)
    return [
      "No ridge was found: neither focal sheet folds along a cuspidal edge.",
    ];
  const on = ([1, 2] as const)
    .map((b) => [b, s.ridges!.filter((e) => e.branch === b).length] as const)
    .filter(([, n]) => n > 0)
    .map(([b, n]) => `${n.toLocaleString()} of κ${b === 1 ? "₁" : "₂"}`);
  const closed = s.ridges.filter((e) => e.closed).length;
  return [
    `The patch has ${count(s.ridges.length, "ridge", "ridges")} (${on.join(", ")})${
      closed > 0 ? `, ${count(closed, "closed", "closed")}` : ""
    }, over which its focal sheets fold in cuspidal edges.`,
  ];
}

// How many cuspidal edges the caustics fold along, on which branches, and
// how many are virtual.
export function causticEdgesNote(r: RaysResult): string[] {
  if (!r.edges) return [];
  if (r.edges.length === 0) return ["No caustic folds along a cuspidal edge."];
  const on = ([1, 2] as const)
    .map((b) => [b, r.edges!.filter((e) => e.branch === b).length] as const)
    .filter(([, n]) => n > 0)
    .map(([b, n]) => `${n.toLocaleString()} on caustic ${b}`);
  const virtual = r.edges.filter((e) => e.virtual).length;
  return [
    `The caustics fold along ${count(r.edges.length, "cuspidal edge", "cuspidal edges")} (${on.join(", ")})${
      virtual === r.edges.length
        ? r.edges.length === 1
          ? ", virtual"
          : ", all virtual"
        : virtual > 0
          ? `, ${count(virtual, "virtual", "virtual")}`
          : ""
    }.`,
  ];
}
