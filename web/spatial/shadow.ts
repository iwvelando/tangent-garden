// A curve study's shadow on a plane (engine3/shadow.go): the plane's
// choices, the 2D construction that corresponds to each 3D one, and the
// words the panel, the legend and the note use for them. Everything here
// is read by the panel and the legend alike; neither branches on a
// construction's name.
import { describeColors, type ColorScheme } from "../color-schemes";
import { tiered } from "../help";
import type { SpatialLegendEntry } from "./legend";
import {
  maxShadowAt,
  type Bounds3,
  type ShadowConfig,
  type ShadowPlane,
  type ShadowResult,
  type SpatialConfig,
} from "./types";

export const shadowPlanes: { value: ShadowPlane; label: string }[] = [
  { value: "x", label: "Plane x = c" },
  { value: "y", label: "Plane y = c" },
  { value: "z", label: "Plane z = c" },
];

// What each 3D construction reduces to on the plane, in the legend's and
// the note's words: the 3D name, and its 2D counterpart's. An involute of
// an involute or of a coil, and the surfaces, have none.
type Reduction = { own: string; planar: string };
const reductions: Partial<Record<SpatialConfig["construction"], Reduction>> = {
  involute: { own: "involutes", planar: "involutes" },
  "tangent-foot": { own: "tangent-foot curve", planar: "pedal" },
  orthotomic: { own: "orthotomic", planar: "orthotomic" },
  inversion: { own: "sphere inversion", planar: "circle inversion" },
};
// Built on an involute or a coil, an involute has nothing on the plane to
// correspond to: the plane has no such input. Mirrors engine3's
// planarKind.
export function shadowReduction(c: SpatialConfig): Reduction | undefined {
  if (
    c.construction === "involute" &&
    (c.input === "involute" || c.input === "coil")
  )
    return undefined;
  return reductions[c.construction];
}

// Whether the study can cast a shadow: every curve study can.
export const casts = (c: SpatialConfig) =>
  c.format !== "surface" && c.format !== "rays" && c.format !== "implicit";

export const shadowHelp = {
  plane: tiered(
    "Casts the curve's shadow on a plane, beside its 2D construction.",
    "The involute, tangent-foot curve, orthotomic and sphere inversion meet their 2D counterparts there: the involute, pedal, orthotomic and circle inversion of the shadow, with the pole and center projected onto the plane. Other constructions cast the curve's shadow alone. With Refine between samples, the plane's paths are refined too.",
  ),
  at: `Where the plane stands, within ±${maxShadowAt.toLocaleString("en-US")}.`,
};

// A plane just beyond the drawn study on its own axis's low side, so the
// shadow falls clear of what casts it: the bounds' center less 1.2 radii,
// to two significant figures, or −3 before anything is drawn.
export function shadowAt(plane: ShadowPlane, bounds?: Bounds3): number {
  if (!bounds) return -3;
  const at = bounds.center[plane] - 1.2 * bounds.radius;
  return Number(at.toPrecision(2));
}

// The layers a shadow draws, with their checkboxes' labels.
export function shadowLayers(c: SpatialConfig) {
  const r = shadowReduction(c);
  return [
    ["shadow", "Shadow & plane"],
    ...(r
      ? [
          ["planar", `2D ${r.planar} of the shadow`],
          ["cast", `Shadow of the 3D ${r.own}`],
        ]
      : []),
  ] as ["shadow" | "planar" | "cast", string][];
}

// The legend's entries for a study's shadow, none without one.
export function shadowLegend(c: SpatialConfig): SpatialLegendEntry[] {
  if (!c.shadow || !casts(c)) return [];
  return [
    { layer: "shadow", swatch: "shadow-dot", label: "Shadow" },
    ...(shadowReduction(c)
      ? ([
          { layer: "planar", swatch: "planar-dot", label: "2D construction" },
          {
            layer: "cast",
            swatch: "cast-dot",
            label: "3D construction's shadow",
          },
        ] as const)
      : []),
  ];
}

// A share of the shadow's size, as a percentage to two figures, or in
// powers of ten when it is under a millionth.
function share(x: number) {
  if (x >= 1e-6) return `${Number((100 * x).toPrecision(2))}%`;
  if (x === 0) return "0";
  let power = Math.floor(Math.log10(x)),
    digit = Math.round(x / 10 ** power);
  if (digit === 10) [digit, power] = [1, power + 1];
  const superscript = String(power).replace(
    /[-0-9]/g,
    (d) => "⁻⁰¹²³⁴⁵⁶⁷⁸⁹"["-0123456789".indexOf(d)],
  );
  return `${digit} × 10${superscript}`;
}

// Whether the shadow of the 3D construction lies on the 2D construction of
// the shadow: within a millionth of the shadow's size, about where the
// engines' own derivatives and arc lengths round.
export const reduces = (s: ShadowResult) =>
  s.deviation !== undefined && s.deviation <= 1e-6;

// The note under the panel: whether the reduction holds, and by how much
// it fails when it does not, with the 2D engine's own warnings.
export function shadowNote(
  c: SpatialConfig,
  s: ShadowResult,
  scheme: ColorScheme,
): string {
  const r = shadowReduction(c);
  const notes = s.notes.join(" ");
  if (!r)
    return [
      "This construction has no 2D counterpart; the plane shows the curve's shadow alone.",
      notes,
    ]
      .filter(Boolean)
      .join(" ");
  const verdict =
    s.deviation === undefined
      ? `The shadow of the 3D ${r.own} and the 2D ${r.planar} share no sample to compare.`
      : reduces(s)
        ? `The shadow of the 3D ${r.own} lies on the 2D ${r.planar} of the shadow, within ${share(s.deviation)} of its size.`
        : `The shadow of the 3D ${r.own} parts from the 2D ${r.planar} of the shadow, by up to ${share(s.deviation)} of its size.`;
  return [
    verdict,
    describeColors(
      "Rust is the 2D construction, slate the 3D one's shadow.",
      scheme,
    ),
    notes,
  ]
    .filter(Boolean)
    .join(" ");
}

// The study with its shadow's plane chosen: none removes the shadow, the
// same plane changes nothing, and a new one stands just beyond the drawn
// study (shadowAt).
export function withShadowPlane(
  c: SpatialConfig,
  plane: ShadowPlane | "none",
  bounds?: Bounds3,
): SpatialConfig {
  if (plane === "none") {
    const { shadow: _, ...rest } = c;
    return rest;
  }
  if (c.shadow?.plane === plane) return c;
  const shadow: ShadowConfig = { plane, at: shadowAt(plane, bounds) };
  return { ...c, shadow };
}
