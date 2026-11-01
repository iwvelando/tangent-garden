// The 3D notebook's legend: what each kind of study can draw, each entry
// tied to the layer that draws it (scene.ts), with the swatch that matches
// that layer's ink (spatial.css). SpatialApp shows an entry exactly when
// its layer is on and the drawn scene has geometry for it (sceneLayers in
// scene.ts); the cut's edge joins them while it is drawn.
import { composes, type SpatialConfig } from "./types";
import { curveInputs } from "./inputs";
import { shadowLegend } from "./shadow";
import type { Pass } from "./scene";
import { locatesEdges } from "./cuspidal";
import { surfaceCapabilities } from "./surface";

export type SpatialLegendEntry = {
  layer: Pass["layer"];
  swatch: string;
  label: string;
};

export function spatialLegend(c: SpatialConfig): SpatialLegendEntry[] {
  if (c.format === "implicit")
    return [
      { layer: "surface", swatch: "surface-dot", label: "Level surface" },
      { layer: "sections", swatch: "thread-dot", label: "Section curves" },
    ];
  const caustics = [
    { layer: "focal1", swatch: "focal-dot", label: "Caustic 1" },
    { layer: "focal2", swatch: "focal-dot second", label: "Caustic 2" },
  ] as const;
  if (c.format === "rays") {
    const refracting = c.rays.interaction === "refract";
    return [
      {
        layer: "surface",
        swatch: "surface-dot",
        label: refracting ? "Interface" : "Mirror",
      },
      {
        layer: "reflected",
        swatch: "thread-dot",
        label: refracting ? "Transmitted rays" : "Reflected rays",
      },
      ...caustics,
      ...(c.rays.edges
        ? [
            {
              layer: "cusps",
              swatch: "thread-dot",
              label: "Cuspidal edges",
            } as const,
          ]
        : []),
    ];
  }
  if (c.format === "surface")
    return [
      { layer: "surface", swatch: "surface-dot", label: "Surface" },
      ...(surfaceCapabilities[c.surface.kind].focal
        ? ([
            { layer: "focal1", swatch: "focal-dot", label: "Focal sheet 1" },
            {
              layer: "focal2",
              swatch: "focal-dot second",
              label: "Focal sheet 2",
            },
          ] as const)
        : []),
      ...(c.surface.ridges
        ? [{ layer: "ridges", swatch: "ridge-dot", label: "Ridges" } as const]
        : []),
      ...(locatesEdges(c.surface)
        ? [
            {
              layer: "cusps",
              swatch: "thread-dot",
              label: "Cuspidal edges",
            } as const,
          ]
        : []),
      ...(c.surface.geodesics
        ? ([
            {
              layer: "threads",
              swatch: "ribbon-dot",
              label: "Geodesic threads",
            },
            {
              layer: "selected",
              swatch: "thread-dot",
              label: "Selected thread",
            },
          ] as const)
        : []),
      // A carried arrow: the triangle in the curves' ink, the arrow in
      // rust and its references in slate.
      ...(c.surface.geodesics?.transport
        ? ([
            ...(c.surface.geodesics.transport.path === "triangle"
              ? ([
                  {
                    layer: "route",
                    swatch: "thread-dot",
                    label: "Octant triangle",
                  },
                ] as const)
              : []),
            { layer: "carried", swatch: "focal-dot", label: "Carried arrow" },
            {
              layer: "references",
              swatch: "focal-dot second",
              label: "Reference arrows",
            },
          ] as const)
        : []),
    ];
  // A curve study: the curve (a derived input drawn as the curve, or a
  // field's or pursuit's first path), what its construction draws in the
  // ribbon's ink, and the base curve beneath a derived input.
  const flowing = c.format === "field",
    chasing = c.format === "pursuit",
    composing = composes(c);
  const construction: SpatialLegendEntry | null =
    c.construction === "none"
      ? flowing || chasing
        ? {
            layer: "trajectories",
            swatch: "ribbon-dot",
            label: flowing ? "Other trajectories" : "Other pursuers",
          }
        : null
      : {
          swatch: "ribbon-dot",
          ...(
            {
              developable: {
                layer: "surface",
                label: "Tangent developable",
              },
              canal: { layer: "surface", label: "Canal surface" },
              ruled: { layer: "surface", label: "Ruled surface" },
              framed: { layer: "surface", label: "Framed ribbon" },
              inversion: { layer: "inverse", label: "Inverted curve" },
              "tangent-foot": {
                layer: "projection",
                label: "Tangent-foot curve",
              },
              orthotomic: {
                layer: "projection",
                label: "Tangent-line orthotomic",
              },
              involute: { layer: "filaments", label: "Involute filaments" },
            } as const
          )[c.construction],
        };
  return [
    {
      layer: "base",
      swatch: "thread-dot",
      label: composing
        ? curveInputs[c.input].name
        : flowing
          ? "Trajectory 1"
          : chasing
            ? "Pursuer 1"
            : "Base curve",
    },
    ...(construction ? [construction] : []),
    ...(composing
      ? [
          {
            layer: "parent",
            swatch: "parent-dot",
            label: "Base curve",
          } as const,
        ]
      : []),
    ...shadowLegend(c),
  ];
}
