import { backAndForthHelp, onceHelp, type Repeat } from "../timing";
import type {
  Config,
  Object4,
  Result,
  Motion,
  Lift,
  Bypass,
  Weave,
} from "./types";
export const modes = {
  perspective: "Perspective shadow",
  orthographic: "Orthogonal shadow",
  stereo: "Stereographic loom",
  section: "Parallel cross-sections",
  reference: "Reference slice",
  lifted: "Lifted construction",
  shadow: "XYZ shadow",
  diagram: "Coordinate diagram",
  paired: "Side-by-side views",
};
const explanations: Record<
  "perspective" | "orthographic" | "stereo" | "section",
  readonly [string, string, string]
> = {
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
// Rotation choices shared by every study that turns in four dimensions.
// A motion that loops ends where it starts (see ../timing.ts): a whole
// turn, or a passage from empty to empty. Others offer back and forth.
export type MotionChoice = {
  value: Motion;
  label: string;
  help: string;
  loops?: boolean;
};
export const repeatHelp: Record<Repeat, string> = {
  once: onceHelp,
  loop: "Plays again and again, its end joining its start, which needs the last frame to match the first. Play compares the drawing at both ends and says what differs. A rotation turns one whole revolution, so it returns, and a slice passage returns when no section cuts the shape at its ends; other motions start and end in different places, so they offer Back and forth instead. Exports leave out the last frame, which is the first again, and loop forever.",
  "back-and-forth": backAndForthHelp,
};
export const rotationMotions: MotionChoice[] = [
  {
    value: "double",
    label: "Double rotation · xw + yz",
    help: "Turn through one full revolution in two independent planes. The three-dimensional camera stays fixed while the shape rotates in four dimensions.",
    loops: true,
  },
  {
    value: "xw",
    label: "One plane · xw",
    help: "Turn through one full revolution in the xw plane. The three-dimensional camera stays fixed.",
    loops: true,
  },
];
type Explanation = readonly [string, string, string];
export type ObjectDescriptor = {
  name: string;
  noun: string;
  modes: readonly Config["mode"][];
  rotations: boolean;
  controls: "polyhedral" | "curved" | "lift" | "route" | "weave";
  linkedViews?: boolean;
  motionChoices?: MotionChoice[];
  legendItems?:
    | { label: string; family: number }[]
    | ((c: Config) => { label: string; family: number }[]);
  parameterKey?: "lift" | "bypass" | "weave";
  numericFields?: {
    key:
      keyof Lift | keyof Omit<Bypass, "obstacle"> | keyof Omit<Weave, "family">;
    index?: number;
    label: string;
    help: string;
    group?: string;
    endpoint?: boolean;
    visible?: (c: Config) => boolean;
  }[];
  // Whole-number counts; studies without them use one sample count.
  countFields?: (c: Config) => {
    key: "count" | "curves" | "samples";
    label: string;
    min: number;
    max: number;
  }[];
  countNote?: string;
  choicesFirst?: boolean;
  choices?: {
    key: "obstacle" | "family";
    label: string;
    help: string;
    values: { value: string; label: string }[];
  }[];
  flat?: (c: Config) => boolean;
  pairedModes?: readonly [Config["mode"], Config["mode"]];
  animationFramingHelp?: (c: Config) => string;
  viewingHelp?: (c: Config) => string;
  viewingLabel?: (c: Config) => string;
  comparisonReadouts?: (r: Result) => { label: string; value: string }[];
  comparisonLabel?: string;
  comparisonNote?: string;
  layerOptions?: (c: Config) => {
    key: "edges" | "guides" | "missingGuide" | "connectors" | "comparison";
    label: string;
  }[];
  readouts?: (r: Result) => { label: string; value: string }[];
  sampleLabel?: string;
  motionEndpointsLabel?: string;
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
  legend: "directions" | "sections" | "threads" | "latitudes";
  // Number, level and suffix columns of an indexed section or latitude key.
  sectionKey?: (s: Section, index: number) => readonly [string, string, string];
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
  controls: "curved" as const,
  modes: ["section"] as const,
  rotations: false,
  viewLabel: "View operation",
  selectorNote: "Axis-aligned sections · ordinary 3D orbit",
  constructionNumber: "02",
  legend: "sections" as const,
  sectionDetail: curvedSectionDetail,
  sectionKey: (s: Section, i: number) =>
    [
      `${i + 1}: h = `,
      s.level.toPrecision(3).replace("-", "−"),
      s.level < 0 ? " (dashed)" : " (solid)",
    ] as const,
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
    controls: "polyhedral",
    viewLabel: "View of the tesseract",
    selectorNote: "16 vertices · 32 edges · 24 squares · 8 cubes",
    constructionNumber: "03",
    radiusFields: [],
    support: () => 2,
    familyPassage: true,
    passageHelp:
      "The endpoints lie 2.5% beyond the tesseract's circumradius 2, and half the family spread further, so every section is empty there. Sections retain their entered spacing.",
    sliceHelp:
      "Intersect w = h after rotation. From −4.05 to 4.05, the end of the widest passage; beyond the rotated cube there is no section.",
    spreadHelp:
      "Total distance between first and last slice, from 0 to 4. A single slice ignores spread.",
    explanation: (c) => explanations[c.mode as keyof typeof explanations],
    colorNote: (c) =>
      c.mode === "section"
        ? "Colours identify the original cell axis. Faces are translucent; all contours remain visible."
        : "Colours identify the original edge direction, before 4D rotation. Thin threads subdivide square faces; they are construction lines, not additional tesseract edges.",
    legend: "directions",
    sectionDetail: tesseractSectionDetail,
    diagnostics: (r) =>
      r.operation === "stereo"
        ? `${r.clipped} source curves clipped at the projection window. Open ends are intentional.`
        : diagnostics("tesseract", tesseractSectionDetail)(r),
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
  lift: {
    name: "Localized thread lift",
    noun: "lifted threads",
    controls: "lift",
    parameterKey: "lift",
    modes: ["reference", "lifted"],
    rotations: false,
    linkedViews: true,
    sampleLabel: "Thread samples",
    motionEndpointsLabel: "Lift motion endpoints",
    readouts: (r) =>
      r.lift
        ? [
            {
              label: "Missing radius",
              value: r.lift.missingRadius.toPrecision(5),
            },
            { label: "Slab half-thickness ε", value: String(r.lift.thickness) },
            {
              label: "Present intervals",
              value: String(r.lift.visibleIntervals),
            },
            { label: "Absent sources", value: String(r.lift.absentSources) },
          ]
        : [],
    viewLabel: "View operation",
    selectorNote:
      "Six connected curves · two linked representations · fixed slab half-thickness ε = 0.02",
    constructionNumber: "02",
    radiusFields: [],
    support: (c) => c.lift!.support,
    familyPassage: false,
    passageHelp: "",
    sliceHelp: "",
    spreadHelp: "",
    legend: "threads",
    sectionDetail: () => "",
    legendItems: [
      { label: "Straight threads", family: 0 },
      { label: "Circular strand", family: 1 },
      { label: "Missing-region guide", family: 2 },
      { label: "Displacement connectors", family: 3 },
    ],
    numericFields: [
      ...["x", "y", "z"].map((axis, index) => ({
        key: "center" as const,
        index,
        label: `Lift center ${axis}`,
        group: "Lift center",
        help: "From −20 to 20. Moving the center changes which source intervals meet the reference slice.",
      })),
      {
        key: "support",
        label: "Lift support radius L",
        help: "From 0.05 to 20. The bump vanishes outside L; the derived missing radius is smaller.",
      },
      {
        key: "height",
        label: "Lift height A",
        help: "From 0 to 10. Fixed slab half-thickness ε = 0.02: nothing is missing when A ≤ ε. Lifting changes lengths.",
      },
      {
        key: "angle",
        label: "Presentation xw angle",
        help: "Radians within ±1000000. A positive turn carries x toward w; x′ = x cos θ − w sin θ. This explanatory rotation never changes reference-slice membership.",
        visible: (c) => c.mode === "lifted",
      },
      ...(["from", "to"] as const).flatMap((key) =>
        ["x", "y", "z"].map((axis, index) => ({
          key,
          index,
          label: `Drift ${key === "from" ? "start" : "end"} ${axis}`,
          group: `Drift ${key === "from" ? "start" : "end"}`,
          help: "From −20 to 20. Playback interpolates the center between the entered endpoints with A and ε held fixed.",
          endpoint: true,
        })),
      ),
      {
        key: "radiusFrom",
        label: "Support start",
        help: "From 0.05 to 20. The first value of L for Change lift support.",
        endpoint: true,
      },
      {
        key: "radiusTo",
        label: "Support end",
        help: "From 0.05 to 20. The final value of L for Change lift support; descending ranges reverse the same construction.",
        endpoint: true,
      },
    ],
    layerOptions: (c) => [
      {
        key: "edges",
        label:
          c.mode === "reference"
            ? "Present thread intervals"
            : "Lifted centerlines",
      },
      { key: "missingGuide", label: "Missing-region guide" },
      ...(c.mode === "lifted"
        ? [{ key: "connectors" as const, label: "Displacement connectors" }]
        : []),
    ],
    diagnostics: () =>
      "6 connected source curves; reference-slice gaps do not cut the lifted curves.",
    colorNote: (c) =>
      `The guide marks the derived missing region, not the lift's whole support. ${c.mode === "lifted" ? "Connectors explain displacement along w; they are not material threads. " : ""}Apparent screen crossings add no connections.`,
    title: (c) => `Tangent Garden — ${modes[c.mode]}`,
    explanation: (c) =>
      c.mode === "reference"
        ? [
            "The missing middle",
            "The middle of each thread has left the reference slice. The drawing keeps the parts of its slab present at w = 0, with ε = 0.02. The lift's support radius L is larger than the missing radius. Changing the boundary changes what appears without cutting the connected centerline. This declared embedding is a connectivity model; it does not preserve lengths or model physical tension.",
            "H(p) = A(1 − |p − c|²/L²)² inside L; present when H(p) ≤ ε",
          ]
        : [
            "Still attached to both ends",
            "This explanatory projection shows the entire lifted centerline (p, H(p)). A declared xw rotation exposes the displacement before dropping w. It is additional mathematical information unavailable in the reference slice. The slab can meet w = 0 even when its centerline is up to ε away; the projection is not the intersection. Switching views keeps the same animation position.",
            "x′ = x cos θ − H(p) sin θ,   y′ = y,   z′ = z",
          ],
    limitations:
      "fixed analytic threads and circle; reference slab w = 0 only; explanatory xw projection; no physical dynamics or length preservation",
    defaults: () => ({
      ...structuredClone(defaultConfig),
      object: "lift",
      mode: "reference",
      lift: {
        center: [0, 0, 0],
        support: 2,
        height: 0.32,
        angle: Math.PI / 4,
        from: [-1.5, 0, 0],
        to: [1.5, 0, 0],
        radiusFrom: 0.05,
        radiusTo: 2,
      },
    }),
    motion: "drift",
    motionChoices: [
      {
        value: "drift",
        label: "Move lift center",
        help: "Interpolate the center from Drift start to Drift end. Height A and slab half-thickness ε stay fixed; Stop restores your entered center.",
      },
      {
        value: "support",
        label: "Change lift support",
        help: "Interpolate L from Support start to Support end. Center, height A and slab half-thickness ε stay fixed. The apparent missing radius follows from L; Stop restores your entered support.",
      },
    ],
  },
  bypass: {
    name: "Shell bypass",
    noun: "shell bypass",
    controls: "route",
    parameterKey: "bypass",
    modes: ["shadow", "diagram", "paired"],
    pairedModes: ["shadow", "diagram"],
    rotations: false,
    linkedViews: true,
    viewLabel: "View operation",
    selectorNote:
      "One closed shell · three complete route legs · two linked representations",
    constructionNumber: "03",
    radiusFields: [],
    support: (c) => c.bypass!.outer,
    familyPassage: false,
    passageHelp: "",
    sliceHelp: "",
    spreadHelp: "",
    sectionDetail: () => "",
    legend: "threads",
    sampleLabel: "Shell samples",
    // The radial shell's XYZ shadow is a filled ball: no inner boundary.
    legendItems: (c) =>
      [
        { label: "Route (solid clear / dashed blocked)", family: 0 },
        { label: "Inner boundary", family: 1 },
        { label: "Outer boundary", family: 2 },
        { label: "Coordinate guides", family: 2 },
        { label: "Collision intervals", family: 3 },
      ].filter(
        (item) =>
          item.family !== 1 ||
          !(c.mode === "shadow" && c.bypass!.obstacle === "radial"),
      ),
    flat: (c) => c.mode === "diagram",
    animationFramingHelp: (c) =>
      c.mode === "paired"
        ? "Both views share one timeline. Orbit the XYZ shadow and pan the coordinate diagram independently before playback; animation holds both views."
        : "Animation holds your current view. Drag, pan, or zoom before playback to choose the framing.",
    viewingHelp: (c) =>
      c.mode === "paired"
        ? "1: XYZ shadow · drag to orbit · shift-drag to pan · 2: diagram · drag or arrows to pan · horizontal: |p| · vertical: w · each view zooms independently"
        : c.mode === "diagram"
          ? "Coordinate diagram · horizontal: radial position |p| · vertical: w · drag or arrows to pan · scroll or pinch to zoom"
          : "XYZ shadow · drag to orbit · shift-drag or two fingers to pan · scroll or pinch to zoom · keys: arrows, + / −, Home",
    viewingLabel: (c) =>
      c.mode === "diagram"
        ? "Radial position and fourth coordinate diagram. Drag or arrow keys to pan; scroll or pinch to zoom; Home resets."
        : "Interactive shell bypass XYZ shadow. Drag to orbit; shift-drag or two fingers to pan; scroll or pinch to zoom.",
    numericFields: [
      {
        key: "inner",
        label: "Inner radius a",
        help: "From 0.05 to 10. The cavity is |p| < a in the embedded shell.",
      },
      {
        key: "outer",
        label: "Outer radius b",
        help: "At most 20, exceeding a by at least 0.001. The outside point must have radius greater than b.",
      },
      {
        key: "extent",
        label: "Fourth-coordinate extent ε",
        help: "From 0 to 5. The embedded shell occupies |w| ≤ ε. The radial 4D shell ignores this field.",
        visible: (c) => c.bypass!.obstacle === "embedded",
      },
      {
        key: "height",
        label: "Route height H",
        help: "From 0 to 20. H > ε clears the embedded shell; equality is contact. A radial 4D shell still blocks the route.",
      },
      ...["x", "y", "z"].map((axis, index) => ({
        key: "outside" as const,
        index,
        group: "Outside point",
        label: `Outside point ${axis}`,
        help: "Each coordinate is within ±20. The point's radius must exceed b and be at most 40; it stays fixed throughout traversal.",
      })),
      {
        key: "position",
        label: "Route position s",
        help: "From 0 to 1. Equal thirds traverse the three linear legs; the exact corners occur at 1/3 and 2/3. The full route is checked at every position.",
      },
      {
        key: "w1",
        label: "First comparison w",
        help: "Within ±20. q₁ = (a/2, 0, 0, w₁) and q₂ share xyz; their fourth coordinates determine their 4D separation.",
      },
      {
        key: "w2",
        label: "Second comparison w",
        help: "Within ±20. q₂ = (a/2, 0, 0, w₂). Their XYZ shadows coincide even when their actual positions differ.",
      },
    ],
    choices: [
      {
        key: "obstacle",
        label: "Obstacle",
        help: "Embedded shell: a ≤ |p| ≤ b and |w| ≤ ε. Radial 4D shell: a ≤ |q| ≤ b, which every outside-to-origin path must meet.",
        values: [
          { value: "embedded", label: "Embedded 3D shell" },
          { value: "radial", label: "Radial 4D shell" },
        ],
      },
    ],
    layerOptions: () => [
      { key: "edges", label: "Route and moving point" },
      { key: "guides", label: "Shell and coordinate guides" },
      { key: "comparison", label: "Comparison points" },
    ],
    diagnostics: (r) =>
      r.bypass?.state === "clear"
        ? "Complete route is clear of the embedded shell."
        : r.bypass?.state === "contact"
          ? "Complete route contacts the shell boundary."
          : "Complete route crosses the shell.",
    readouts: (r) =>
      r.bypass
        ? [
            { label: "Current w", value: r.bypass.current[3].toPrecision(5) },
            { label: "Route state", value: r.bypass.state },
            { label: "4D clearance", value: r.bypass.clearance.toPrecision(5) },
          ]
        : [],
    comparisonLabel: "Same shadow, different points",
    comparisonNote:
      "q₁ is the small ring; q₂ is the larger ring. Both have xyz = (a/2, 0, 0). Coincident rings in the XYZ shadow retain separate identities; the coordinate diagram reveals their w separation.",
    comparisonReadouts: (r) =>
      r.bypass && r.markers
        ? [
            {
              label: "q₁: w",
              value: r.markers
                .find((m) => m.id === "bypass/q1")!
                .fourPoint[3].toPrecision(5),
            },
            {
              label: "q₂: w",
              value: r.markers
                .find((m) => m.id === "bypass/q2")!
                .fourPoint[3].toPrecision(5),
            },
            { label: "XYZ separation", value: String(r.bypass.shadowDistance) },
            { label: "4D separation", value: r.bypass.distance.toPrecision(5) },
          ]
        : [],
    colorNote: (c) => {
      const shadow =
        c.bypass!.obstacle === "radial"
          ? "The radial shell's shadow fills the ball |p| ≤ b, because every cavity point lifts in w into the shell; only its outer boundary is drawn."
          : "Boundary circles outline the embedded shell's shadow, a ≤ |p| ≤ b, which is also its w = 0 section.";
      return c.mode === "paired"
        ? `Both panels show the same route position. Panel 1, the XYZ shadow, drops w. ${shadow} Panel 2, the coordinate diagram, retains radial position |p| and w at equal scale; its outlines represent the defining inequalities. Each view has its own framing. Solid means clear; dashed route and red intervals indicate contact or crossing.`
        : c.mode === "diagram"
          ? `A coordinate diagram, not another 3D camera. Horizontal distance is radial position |p|; vertical distance is w, at equal scale. Shell outlines represent the defining inequalities. In the XYZ shadow, ${c.bypass!.obstacle === "radial" ? "this shell fills the ball |p| ≤ b" : "this shell covers a ≤ |p| ≤ b"}. Dashed route and red intervals indicate contact or crossing.`
          : `The shadow drops w. ${shadow} The full route may look as though it crosses the wall; dashed styling and the state readout report its actual 4D intersections.`;
    },
    explanation: (c) => [
      "Beside the wall",
      c.bypass!.obstacle === "embedded"
        ? "This wall encloses the center within its three-dimensional slice. The route (p_out,0) → (p_out,H) → (0,H) → (0,0) leaves that slice, travels beside the wall along a fourth coordinate, and returns inside. It clears the complete shell exactly when H > ε. This is a geometric path, with no collision simulation or physical passage model."
        : "A genuinely four-dimensional shell surrounds the origin in all four coordinates. Its radial distance must pass from greater than b to zero, so it must cross [a,b]. Increasing route height cannot evade this shell. The defining inequality establishes containment; a wireframe alone does not.",
      c.bypass!.obstacle === "embedded"
        ? "K = {(p,w): a ≤ |p| ≤ b, |w| ≤ ε}"
        : "K₄ = {q: a ≤ |q| ≤ b}",
    ],
    title: (c) => `Tangent Garden — Shell bypass / ${modes[c.mode]}`,
    limitations:
      "one fixed three-leg route; canonical embedded or radial shell; exact segment events; sparse linework; coordinate diagram is not a camera; no general obstacle editor or physical collision simulation",
    defaults: () => ({
      ...structuredClone(defaultConfig),
      object: "bypass",
      mode: "shadow",
      bypass: {
        inner: 1,
        outer: 2,
        extent: 0.15,
        outside: [3, 0, 0],
        height: 1.2,
        position: 0.5,
        obstacle: "embedded",
        w1: 0,
        w2: 1.2,
      },
    }),
    motion: "route",
    motionChoices: [
      {
        value: "route",
        label: "Traverse route",
        help: "Move from the entered outside point to the origin. Each linear leg receives one third of the progress. Both representations show the same exact point; Stop restores the entered route position.",
      },
      {
        value: "return",
        label: "Return along route",
        help: "Reverse the same route from the origin to the outside point. Height and shell parameters stay fixed; Stop restores the entered route position.",
      },
    ],
  },
  weave: {
    name: "Spherical ring weave",
    noun: "spherical ring weave",
    controls: "weave",
    parameterKey: "weave",
    modes: ["stereo"],
    rotations: true,
    viewLabel: "View operation",
    selectorNote:
      "Circles on the unit 3-sphere · stereographic projection through a fixed window",
    constructionNumber: "03",
    radiusFields: [],
    support: (c) => c.clip,
    familyPassage: false,
    passageHelp: "",
    sliceHelp: "",
    spreadHelp: "",
    sectionDetail: () => "",
    legend: "latitudes",
    sectionKey: (s, i) =>
      [
        `${i + 1}: α = `,
        s.level.toPrecision(3),
        s.kind === "circle" ? " (one circle)" : " (torus)",
      ] as const,
    countFields: (c) => [
      { key: "count", label: "Latitudes", min: 1, max: 9 },
      {
        key: "curves",
        label:
          c.weave!.family === "fibers"
            ? "Fibers per latitude"
            : "Curves per direction",
        min: 1,
        max: 16,
      },
      { key: "samples", label: "Arc samples", min: 8, max: 256 },
    ],
    countNote:
      "Arc samples subdivide each full circle; exact window crossings are added. A study may emit at most 65,536 points: latitudes × circles per latitude × (samples + 2), plus the window guides. Reduce counts if the budget is exceeded.",
    choicesFirst: true,
    choices: [
      {
        key: "family",
        label: "Weave family",
        help: "Clifford tori: fixed-u and fixed-v circles on each latitude torus. Hopf fibers: great circles (e^{it}z₁, e^{it}z₂) spaced evenly in phase around each latitude.",
        values: [
          { value: "tori", label: "Clifford tori" },
          { value: "fibers", label: "Hopf fibers" },
        ],
      },
    ],
    numericFields: [
      {
        key: "alpha",
        label: "Central latitude α",
        help: "Radians. Every latitude α ± spread/2 must lie within 0 and π/2 (pi/2). At 0 or π/2 a torus collapses to one circle; pi/4 gives the Clifford torus with equal radii.",
      },
      {
        key: "spread",
        label: "Latitude spread",
        help: "Radians from 0 to π/2 between the first and last latitude, positive when there is more than one. A single latitude ignores spread.",
      },
      {
        key: "alphaFrom",
        label: "Latitude start",
        help: "Radians. The first central α for Sweep latitudes; the whole family must stay within 0 and π/2 here too.",
        endpoint: true,
      },
      {
        key: "alphaTo",
        label: "Latitude end",
        help: "Radians. The final central α for Sweep latitudes; the whole family must stay within 0 and π/2 here too.",
        endpoint: true,
      },
    ],
    motionEndpointsLabel: "Latitude motion endpoints",
    layerOptions: () => [
      { key: "edges", label: "Circles and open arcs" },
      { key: "guides", label: "Projection window" },
    ],
    diagnostics: (r) =>
      r.weave
        ? `${r.weave.sources} source circles on the unit 3-sphere. Open ends mark the projection window, not broken curves.`
        : "",
    readouts: (r) =>
      r.weave
        ? [
            {
              label: "Complete circles",
              value: String(r.weave.completeCircles),
            },
            { label: "Open arcs", value: String(r.weave.retainedArcs) },
            { label: "Window contacts", value: String(r.weave.contacts) },
            {
              label: "Outside the window",
              value: String(r.weave.absentSources),
            },
            {
              label: "Retained where w ≤",
              value: r.weave.window.toPrecision(5),
            },
          ]
        : [],
    colorNote: (c) =>
      `Each numbered latitude has its own colour and α in the key${c.weave!.family === "tori" ? "; fixed-u and fixed-v circles share it" : ""}. Thin circles mark the projection window |P| = C, where open ends stop. Screen crossings are not intersections, and a clipped arc does not have the linking of its complete circle.`,
    explanation: (c) =>
      c.weave!.family === "tori"
        ? [
            "Tori on a sphere",
            "Each latitude α of the unit 3-sphere is a torus, with |(x, y)| = cos α and |(z, w)| = sin α. Fixed-u and fixed-v circles expose its two directions. At α = 0 or π/2 the torus collapses to one circle, drawn once. The declared 4D rotation turns the whole sphere; stereographic projection from (0, 0, 0, 1) then opens it into space, where each circle stays a circle, or becomes a line through the pole. A Clifford torus is a two-dimensional surface, not a solid.",
            "q(u, v, α) = (cos α cos u, cos α sin u, sin α cos v, sin α sin v),   P(q) = q_xyz / (1 − q_w)",
          ]
        : [
            "Rings from a sphere",
            "These curves lie on a sphere in four dimensions. Stereographic projection turns them into a weave of circles and open arcs. Open ends mark the drawing's finite window, not broken connections. Each Hopf fiber is a great circle that the Hopf map sends to a single point of S², and any two distinct fibers link once. Fibers over one latitude lie on its torus; at α = 0 or π/2 they coincide and are drawn once. The declared 4D rotation turns the whole sphere before projection. Fibers are circles, not sealed solids.",
            "H(z₁, z₂) = (2 Re z₁z̄₂, 2 Im z₁z̄₂, |z₁|² − |z₂|²),   z₁ = x + iy, z₂ = z + iw",
          ],
    title: (c) =>
      `Tangent Garden — ${c.weave!.family === "fibers" ? "Hopf fibers" : "Clifford tori"} on the 3-sphere`,
    limitations:
      "finite selected circles on the unit 3-sphere; analytic stereographic window clipping; transparent linework; screen crossings are not intersections; clipped arcs do not carry the complete circles' linking",
    defaults: () => ({
      ...structuredClone(defaultConfig),
      object: "weave",
      mode: "stereo",
      count: 4,
      curves: 10,
      samples: 96,
      clip: 3.2,
      weave: {
        family: "fibers",
        alpha: 0.72,
        spread: 0.66,
        alphaFrom: 0.33,
        alphaTo: Math.PI / 2 - 0.33,
      },
    }),
    motion: "double",
    motionChoices: [
      ...rotationMotions.map((m) => ({
        ...m,
        help: `${m.help} The projection window stays fixed, so circles open into arcs as they pass the pole.`,
      })),
      {
        value: "latitude",
        label: "Sweep latitudes",
        help: "Move the central α from Latitude start to Latitude end with spread and rotation fixed. A latitude reaching 0 or π/2 collapses to one circle. Stop restores your entered α.",
      },
    ],
  },
};
