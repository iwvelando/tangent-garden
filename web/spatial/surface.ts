import { tiered, type Help } from "../help";
import { edgesNote, ridgesNote } from "./cuspidal";
import type {
  FocalShape,
  SurfaceConfig,
  SurfaceKind,
  SurfaceResult,
} from "./types";

type Shape = Pick<
  SurfaceConfig,
  "a" | "b" | "c" | "uMin" | "uMax" | "vMin" | "vMax"
>;
const turn = 2 * Math.PI;
// Each kind's shape and whole chart, used when the kind is chosen.
export const surfaceDefaults: Record<SurfaceKind, Shape> = {
  ellipsoid: {
    a: 1.4,
    b: 1,
    c: 0.7,
    uMin: 0,
    uMax: turn,
    vMin: -Math.PI / 2,
    vMax: Math.PI / 2,
  },
  torus: { a: 2, b: 0.8, c: 0, uMin: 0, uMax: turn, vMin: 0, vMax: turn },
  cylinder: { a: 1.4, b: 0.8, c: 0, uMin: 0, uMax: turn, vMin: -1, vMax: 1 },
  paraboloid: { a: 1, b: -1, c: 0, uMin: -1, uMax: 1, vMin: -1, vMax: 1 },
  monkey: { a: 0.5, b: 0, c: 0, uMin: -1, uMax: 1, vMin: -1, vMax: 1 },
  // The helicoid, one turn of its stair: a patch, not a whole chart.
  "helicoid-catenoid": {
    a: 1,
    b: 0,
    c: 0,
    uMin: -Math.PI,
    uMax: Math.PI,
    vMin: -1.5,
    vMax: 1.5,
  },
};
export const surfaceNames: Record<SurfaceKind, string> = {
  ellipsoid: "Ellipsoid · sphere",
  torus: "Torus",
  cylinder: "Elliptic cylinder",
  paraboloid: "Paraboloid · saddle",
  monkey: "Monkey saddle",
  "helicoid-catenoid": "Helicoid · catenoid family",
};
// The equation of each chart, as shown beside its controls.
export const surfaceCharts: Record<SurfaceKind, string> = {
  ellipsoid: "X = (a cos v cos u, b cos v sin u, c sin v)",
  torus: "X = ((R + r cos v) cos u, (R + r cos v) sin u, r sin v)",
  cylinder: "X = (a cos u, b sin u, v)",
  paraboloid: "X = (u, v, (k₁u² + k₂v²)/2)",
  monkey: "X = (u, v, k(u³ − 3uv²))",
  "helicoid-catenoid":
    "X = s(cos θ sinh v sin u + sin θ cosh v cos u, −cos θ sinh v cos u + sin θ cosh v sin u, u cos θ + v sin θ)",
};
// The shape fields each kind reads, with their labels and help.
export const surfaceShape: Record<
  SurfaceKind,
  { key: "a" | "b" | "c"; label: string; help?: Help<string> }[]
> = {
  ellipsoid: [
    {
      key: "a",
      label: "Axis a",
      help: "Semi-axes along x, y and z, each above 0, at most 100000.",
    },
    { key: "b", label: "Axis b" },
    { key: "c", label: "Axis c" },
  ],
  torus: [
    {
      key: "a",
      label: "Major radius R",
      help: "Axis to tube center, 0–100000; below r it crosses its axis.",
    },
    {
      key: "b",
      label: "Minor radius r",
      help: "The tube's radius, above 0 and at most 100000.",
    },
  ],
  cylinder: [
    {
      key: "a",
      label: "Semi-axis a",
      help: "Cross-section semi-axes along x and y, above 0, at most 100000.",
    },
    { key: "b", label: "Semi-axis b" },
  ],
  paraboloid: [
    {
      key: "a",
      label: "Curvature k₁",
      help: "Vertex curvatures, within ±100000; opposite signs give a saddle.",
    },
    { key: "b", label: "Curvature k₂" },
  ],
  monkey: [
    {
      key: "a",
      label: "Height k",
      help: "Scales the three valleys and ridges, within ±100000.",
    },
  ],
  "helicoid-catenoid": [
    {
      key: "a",
      label: "Scale s",
      help: "The patch's size, above 0 and at most 100000.",
    },
    {
      key: "b",
      label: "Associate angle θ",
      help: tiered(
        "0 is the helicoid, π/2 the catenoid; within 0–π/2.",
        "Every angle has the metric E = G = s²cosh²v, F = 0, so the grid's lengths never change.",
      ),
    },
  ],
};
// What each kind offers beyond its sheet, parameter curves, normal lines
// and curvatures, mirroring engine3's surfaceKinds; the controls, layers,
// legend, probe and animation read it. offset is the offset surface, its
// cuspidal edges, probe and track; focal the focal sheets, ridges and
// their probes; optics the kind as a mirror or interface; correspondence
// the parameter curves the probe draws through its point. domain is the
// help beside the u interval, note follows the chart, and title heads the
// drawing.
export type SurfaceCapabilities = {
  offset: boolean;
  focal: boolean;
  optics: boolean;
  correspondence: boolean;
  domain: Help<string>;
  note: string;
  title: string;
};
const analyticPatch: SurfaceCapabilities = {
  offset: true,
  focal: true,
  optics: true,
  correspondence: false,
  domain:
    "The parameter intervals the patch covers, each within ±1000000 and 0.000001–100000 wide.",
  note: "A domain shorter than the whole chart opens the surface, so what lies inside it shows.",
  title: "A surface and its centers of curvature",
};
export const surfaceCapabilities: Record<SurfaceKind, SurfaceCapabilities> = {
  ellipsoid: analyticPatch,
  torus: analyticPatch,
  cylinder: analyticPatch,
  paraboloid: analyticPatch,
  monkey: analyticPatch,
  // Its curvature is validated; its offsets, focal sheets and optics are
  // not offered.
  "helicoid-catenoid": {
    offset: false,
    focal: false,
    optics: false,
    correspondence: true,
    domain: tiered(
      "u within ±4π and v within ±4, each at least 0.000001 wide.",
      "The patch stays one open rectangle at every angle: its edges are never joined, even where the catenoid's ends meet.",
    ),
    note: "Every angle bends one patch without stretching it, so each grid curve keeps its length; the probe follows one (u, v).",
    title: "A minimal surface bent, not stretched",
  },
};
// The kinds a study can choose: a ray study only those offered as a
// mirror or interface, and the current kind, so that a link's choice
// shows with its refusal.
export const surfaceChoices = (rays: boolean, current: SurfaceKind) =>
  (Object.keys(surfaceNames) as SurfaceKind[]).filter(
    (kind) => !rays || surfaceCapabilities[kind].optics || kind === current,
  );
// A study's surface with what its kind does not offer turned off: no
// offset or cuspidal edges without an offset, and no ridges without focal
// sheets.
export function offered(s: SurfaceConfig): SurfaceConfig {
  const can = surfaceCapabilities[s.kind];
  const { edges, ridges, ...rest } = s;
  if (
    (can.offset || (s.offset === 0 && edges === undefined)) &&
    (can.focal || ridges === undefined)
  )
    return s;
  return {
    ...rest,
    offset: can.offset ? s.offset : 0,
    ...(edges !== undefined && can.offset && { edges }),
    ...(ridges !== undefined && can.focal && { ridges }),
  };
}
const shapes: Record<FocalShape, string> = {
  surface: "is a surface",
  curve: "collapses to a curve",
  point: "collapses to a point",
  none: "lies wholly at infinity",
};
const count = (n: number, one: string, many: string) =>
  `${n.toLocaleString()} ${n === 1 ? one : many}`;
// What the focal branches are, and every sample left without part of the
// study, with why.
export function surfaceNote(s: SurfaceResult): string[] {
  return [
    ...s.focal.map(
      (f, k) =>
        `Focal sheet ${k + 1} (κ${k === 0 ? "₁" : "₂"}) ${shapes[f.shape]}${
          f.clipped && f.shape !== "none"
            ? `; at ${count(f.clipped, "sample", "samples")} its center of curvature is beyond 100 surface radii, treated as at infinity`
            : ""
        }.`,
    ),
    ...(s.singular
      ? [
          `${count(s.singular, "sample is a chart singularity", "samples are chart singularities")}, where X_u × X_v vanishes: no normal, offset or focal point there.`,
        ]
      : []),
    ...(s.umbilics
      ? [
          `${count(s.umbilics, "sample is an umbilic", "samples are umbilics")} (κ₁ = κ₂), where the principal directions are undefined and the two sheets meet.`,
        ]
      : []),
    ...(s.offset && s.folded
      ? [
          `${count(s.folded, "offset sample lies", "offset samples lie")} beyond one focal sheet, where the offset turns inside out; it is drawn, not trimmed.`,
        ]
      : []),
    ...edgesNote(s),
    ...ridgesNote(s),
  ];
}
