import type { Config, Object4, Result, Motion } from "./types";
export const modes = {
  perspective: "Perspective shadow",
  orthographic: "Orthogonal shadow",
  stereo: "Stereographic loom",
  section: "Parallel cross-sections",
};
const explanations: Record<Config["mode"], readonly [string, string, string]> =
  {
    perspective: [
      "A shadow from four dimensions",
      "The vertices of [−1, 1]⁴ are joined when they differ in one coordinate. Look from the fourth axis toward w = 0: nearer cells grow, farther cells shrink. The nested cubes are a projection of eight connected cubic cells.",
      "P(x, y, z, w) = d(x, y, z) / (d − w)",
    ],
    orthographic: [
      "Four directions, one shadow",
      "Rotate in four dimensions, then drop w. Edge lengths change in the shadow, although every edge in four dimensions remains exactly 2 units long. Dragging changes only your 3D viewpoint; the six angle fields rotate the tesseract itself.",
      "P(x, y, z, w) = (x, y, z)",
    ],
    stereo: [
      "A sphere woven from a cube",
      "First carry the edges and face grids radially onto the unit 3-sphere in four dimensions. Stereographic projection opens that sphere into space: straight face lines become circular arcs or lines. Every thread comes from a line on a square face.",
      "p = v / |v|,   P(p) = (pₓ, pᵧ, p_z) / (1 − p_w)",
    ],
    section: [
      "A world passing through ours",
      "Intersect the rotated tesseract with w = h. Each cubic cell contributes a polygonal face. A diagonal passage grows from a point through tetrahedra to an octahedron, then shrinks again. Multiple slices share the same xyz coordinates; they are superimposed, not spaced into a new solid.",
      "R[−1, 1]⁴ ∩ {w = h}",
    ],
  };

type Section = Result["sections"][number];
type Explanation = readonly [string, string, string];
export type ObjectDescriptor = {
  name: string;
  noun: string;
  modes: readonly Config["mode"][];
  rotations: boolean;
  viewLabel: string;
  selectorNote: string;
  constructionNumber: string;
  explanation: (config: Config) => Explanation;
  colorNote: (config: Config) => string;
  radiusFields: { key: "radius" | "tube"; label: string; help: string }[];
  support: (config: Config) => number;
  familyPassage: boolean;
  passageHelp: string;
  sliceHelp: string;
  spreadHelp: string;
  legend: "directions" | "sections";
  sectionDetail: (section: Section) => string;
  diagnostics: (result: Result) => string;
  title: (config: Config) => string;
  limitations: string;
  defaults: (previous: Config) => Config;
  motion: Motion;
};
export const defaultConfig: Config = {
  object: "tesseract",
  radius: 2,
  tube: 0.65,
  curves: 5,
  mode: "perspective",
  angles: [0, 0, 0, 0, 0, 0],
  distance: 4,
  slice: 0,
  spread: 3.4,
  count: 1,
  grid: 0,
  samples: 64,
  clip: 4,
};
export function curvedSectionDetail(s: Section): string {
  return `h = ${s.level.toPrecision(5).replace("-", "−")} · ${s.dimension === -1 ? "Empty section" : s.dimension === 0 ? "Point contact" : s.kind === "core-circle" ? "Core circle · section dimension 1" : `Solid section · dimension 3 · boundary radius ${(s.radius ?? 0).toPrecision(5)}`}`;
}
function tesseractSectionDetail(s: Section): string {
  return `h = ${s.level.toFixed(3)} · ${s.dimension === -1 ? "Empty section" : s.dimension === 0 ? "Point contact" : s.dimension === 1 ? "Line contact" : `${s.vertices} vertices · ${s.edges} edges · ${s.faces} faces`}`;
}
function diagnostics(noun: string, detail: (s: Section) => string) {
  return (result: Result): string =>
    result.sections.length > 1
      ? `${result.sections.filter((s) => s.dimension >= 0).length} of ${result.sections.length} sections intersect the ${noun}.`
      : result.sections[0]
        ? detail(result.sections[0])
        : "";
}
function curvedDefaults(object: Object4, support: (c: Config) => number) {
  return (previous: Config): Config => {
    const radius = Number.isFinite(previous.radius)
      ? Math.max(0.002, Math.min(100, previous.radius))
      : 2;
    const tube = Math.max(0.001, Math.min(0.65, radius / 2));
    const config: Config = {
      ...structuredClone(defaultConfig),
      object,
      radius,
      tube,
      mode: "section",
    };
    return { ...config, spread: 1.6 * support(config) };
  };
}
const ballSupport = (c: Config) => c.radius;
const tubeSupport = (c: Config) => c.tube;
const curvedCommon = {
  modes: ["section"] as const,
  rotations: false,
  viewLabel: "View operation",
  selectorNote: "Axis-aligned sections · ordinary 3D orbit",
  constructionNumber: "02",
  legend: "sections" as const,
  sectionDetail: curvedSectionDetail,
  familyPassage: true,
  motion: "slice" as const,
  passageHelp:
    "The endpoints include a 2.5% support margin and half the family spread, so every section is empty there. Sections retain their entered spacing.",
  sliceHelp:
    "Intersect w = h without 4D rotation. Offset within ±4 times this object's support radius. Outside support the section is empty.",
  spreadHelp:
    "Total distance between the first and last slice, up to four times the support radius. All slices share xyz coordinates. A single slice ignores spread.",
  colorNote: () =>
    "Each numbered section has its own colour and h in the key. Negative h is dashed; nonnegative h is solid. The selected section is stronger and appears last. Rotations in 4D are unavailable for these axis-aligned sections; dragging orbits the 3D drawing.",
  limitations:
    "axis-aligned finite sections; representative boundary circles only; no interior or fourth-coordinate projection",
};
export const objects: Record<Object4, ObjectDescriptor> = {
  tesseract: {
    name: "Tesseract",
    noun: "tesseract",
    modes: ["perspective", "orthographic", "stereo", "section"],
    rotations: true,
    viewLabel: "View of the tesseract",
    selectorNote: "16 vertices · 32 edges · 24 squares · 8 cubes",
    constructionNumber: "03",
    radiusFields: [],
    support: () => 2,
    familyPassage: false,
    passageHelp:
      "The centre moves beyond the tesseract's circumradius 2 at both endpoints. Sections retain their entered spacing.",
    sliceHelp:
      "Intersect w = h after rotation. From −3 to 3; beyond the rotated cube there is no section.",
    spreadHelp:
      "Total distance between first and last slice, from 0 to 4. A single slice ignores spread.",
    explanation: (c) => explanations[c.mode],
    colorNote: (c) =>
      c.mode === "section"
        ? "Colours identify the original cell axis. Faces are translucent; all contours remain visible."
        : "Colours identify the original edge direction, before 4D rotation. Thin threads subdivide square faces; they are construction lines, not additional tesseract edges.",
    legend: "directions",
    sectionDetail: tesseractSectionDetail,
    diagnostics: diagnostics("tesseract", tesseractSectionDetail),
    title: (c) =>
      `Tangent Garden — ${c.mode === "section" ? "tesseract cross-sections" : c.mode === "stereo" ? "stereographic tesseract" : "tesseract projection"}`,
    limitations: "transparent illustrative faces; no opaque visibility",
    defaults: () => structuredClone(defaultConfig),
    motion: "double",
  },
  ball: {
    ...curvedCommon,
    name: "4-ball",
    noun: "4-ball",
    support: ballSupport,
    radiusFields: [
      {
        key: "radius",
        label: "4-ball radius R",
        help: "From 0.001 to 100. Support along w is ±R. Framing remains fixed across the slice passage.",
      },
    ],
    defaults: curvedDefaults("ball", ballSupport),
    title: () => "Tangent Garden — 4-ball sections",
    diagnostics: diagnostics("4-ball", curvedSectionDetail),
    explanation: () => [
      "A sphere is a section of a 4-ball",
      "The object is the solid x² + y² + z² + w² ≤ R². At w = h its section is a 3-ball; these circles illustrate the boundary sphere. At tangency only a point remains. A finite family overlays original xyz coordinates: +h and −h have the same outline, but occupy different slices. The drawing omits the interior and unsampled levels.",
      "ρ(h) = √(R² − h²),   |h| ≤ R",
    ],
  },
  tube: {
    ...curvedCommon,
    name: "Circular 4D tube",
    noun: "circular 4D tube",
    support: tubeSupport,
    radiusFields: [
      {
        key: "radius",
        label: "Core radius R",
        help: "From 0.001 to 100, strictly larger than r. Framing remains fixed across the slice passage.",
      },
      {
        key: "tube",
        label: "Tube radius r",
        help: "At least 0.001 and strictly smaller than R. The support along w is ±r; the core radius stays R.",
      },
    ],
    defaults: curvedDefaults("tube", tubeSupport),
    title: () => "Tangent Garden — Circular 4D tube sections",
    diagnostics: diagnostics("circular 4D tube", curvedSectionDetail),
    explanation: () => [
      "A ring with depth",
      "This circular 4D tube is the solid (√(x² + y²) − R)² + z² + w² ≤ r², with 0 < r < R. Its axis-aligned section is a solid torus. Representative fixed-u and fixed-v circles illustrate its boundary. At |h| = r the section becomes its core circle, then disappears. Coincident outlines at opposite offsets retain different slice identities; the drawing omits interior points and unsampled levels.",
      "ρ(h) = √(r² − h²),   p(u,v) = ((R + ρ cos v) cos u, (R + ρ cos v) sin u, ρ sin v)",
    ],
  },
};
