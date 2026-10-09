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
};
export const surfaceNames: Record<SurfaceKind, string> = {
  ellipsoid: "Ellipsoid · sphere",
  torus: "Torus",
  cylinder: "Elliptic cylinder",
  paraboloid: "Paraboloid · saddle",
  monkey: "Monkey saddle",
};
// The equation of each chart, as shown beside its controls.
export const surfaceCharts: Record<SurfaceKind, string> = {
  ellipsoid: "X = (a cos v cos u, b cos v sin u, c sin v)",
  torus: "X = ((R + r cos v) cos u, (R + r cos v) sin u, r sin v)",
  cylinder: "X = (a cos u, b sin u, v)",
  paraboloid: "X = (u, v, (k₁u² + k₂v²)/2)",
  monkey: "X = (u, v, k(u³ − 3uv²))",
};
// The shape fields each kind reads, with their labels and help.
export const surfaceShape: Record<
  SurfaceKind,
  { key: "a" | "b" | "c"; label: string; help?: string }[]
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
      help: "Axis to tube centre, 0–100000; below r it crosses its axis.",
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
};
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
            ? `; at ${count(f.clipped, "sample", "samples")} its centre of curvature is beyond 100 surface radii, treated as at infinity`
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
  ];
}
