import { sectionHue, type ColorScheme } from "../color-schemes";
import { objects } from "./objects";
import { axisInks, plotPalette } from "../palette";
import { svgStroke } from "../line-weight";
import type { Config, Result, View, Layers, Vec3 } from "./types";
export const inks = axisInks;
// Index colors separate coincident levels without reusing coordinate inks.
export const sectionInk = (
  index: number,
  dark: boolean,
  scheme: ColorScheme = "default",
) =>
  `hsl(${(sectionHue(scheme) + index * 137.508) % 360} 55% ${dark ? 72 : 36}%)`;
// The accent of a moving point and its fiber: the palette's second ink,
// distinct from every latitude ink in each scheme.
export const movingInk = (dark: boolean, scheme: ColorScheme = "default") =>
  plotPalette(dark, scheme).derived;
// The sample a weave path or base marker belongs to, from its source id
// (weave/latitude/0/fiber/j or weave/latitude/0/base/j), or the selection
// for a collapsed latitude's single circle and point.
export function sampleOf(source: string, result: Result): number | undefined {
  const c = result.weave?.correspondence;
  const m = /^weave\/latitude\/0\/(?:fiber|base)\/(\d+)$/.exec(source);
  if (m) return Number(m[1]);
  if (/^weave\/latitude\/0\/(?:core|base\/core)$/.test(source))
    return c?.selected;
  return undefined;
}
// The camera's projection of a drawing's 3D points into the 1000 × 760
// panel, with depth third. Drawing and selection share it.
export function projector(
  result: Result,
  config: Config,
  view: View,
): (p: Vec3) => [number, number, number] {
  const scale = (310 * view.zoom) / result.radius,
    flat = objects[config.object].flat?.(config);
  return (p: Vec3) => {
    if (flat)
      return [
        500 + scale * p[0] + view.panX,
        380 - scale * p[1] + view.panY,
        p[2],
      ];
    const cy = Math.cos(view.yaw),
      sy = Math.sin(view.yaw),
      cp = Math.cos(view.pitch),
      sp = Math.sin(view.pitch);
    const x = cy * p[0] + sy * p[2],
      z = -sy * p[0] + cy * p[2],
      y = cp * p[1] - sp * z;
    return [
      500 + scale * x + view.panX,
      380 - scale * y + view.panY,
      sp * p[1] + cp * z,
    ];
  };
}
// Whether these layers draw a path or marker: guides, the missing region's
// guide, displacement connectors and comparison points have their own
// layers, and edges draw the rest.
const pathShown = (p: Result["paths"][number], layers: Layers) =>
  p.role === "missing-guide"
    ? !!layers.missingGuide
    : p.role === "displacement"
      ? !!layers.connectors
      : p.guide
        ? layers.guides
        : layers.edges;
const markerShown = (
  m: NonNullable<Result["markers"]>[number],
  layers: Layers,
) => (m.role === "comparison" ? !!layers.comparison : layers.edges);
// Everything a result (and a paired view's companion) draws with these
// layers, by ink family and role, so that the legend names only what is
// drawn.
export function drawnInks(result: Result, layers: Layers) {
  const inks: { family: number; role?: string }[] = [];
  for (const r of [result, result.companion]) {
    if (!r) continue;
    for (const p of r.paths)
      if (pathShown(p, layers)) inks.push({ family: p.family, role: p.role });
    for (const m of r.markers ?? [])
      if (markerShown(m, layers)) inks.push({ family: m.family, role: m.role });
    if (layers.faces) for (const f of r.faces) inks.push({ family: f.family });
    if (layers.edges && r.points.length) inks.push({ family: 0 });
  }
  return inks;
}
// Only the ordinary 3D viewing camera is evaluated here. Go owns all 4D
// rotations, clipping, intersections and curve samples. Equal axis scale.
export function Drawing({
  result,
  config,
  view,
  layers,
  dark,
  scheme = "default",
}: {
  result: Result;
  config: Config;
  view: View;
  layers: Layers;
  dark: boolean;
  scheme?: ColorScheme;
}) {
  const colors = inks(dark, scheme),
    stroke = svgStroke(layers.weight ?? "regular");
  const descriptor = objects[config.object];
  const curved = descriptor.legend === "sections";
  // Latitude studies share the section key's colors, without its selection.
  const latitudes = descriptor.legend === "latitudes";
  const selected = Math.min(
    layers.selectedSection ?? 0,
    result.sections.length - 1,
  );
  const sectionIndex = (id?: string) =>
    result.sections.findIndex((s) => s.id === id);
  const flat = descriptor.flat?.(config);
  const project = projector(result, config, view);
  // A correspondence's selected sample, and the sample the moving point
  // is on: that sample is drawn as the moving one.
  const correspondence = result.weave?.correspondence;
  const role = (source: string) => {
    if (!correspondence) return undefined;
    if (source === "weave/moving" || source === "weave/moving/base")
      return "moving";
    const sample = sampleOf(source, result);
    if (sample === undefined) return undefined;
    if (sample === correspondence.movingSample) return "moving";
    return sample === correspondence.selected ? "selected" : "sample";
  };
  const mapped = result.paths
    .filter((p) => pathShown(p, layers))
    .map((p) => ({ ...p, points: p.points.map(project) }));
  // The moving fiber is drawn last, over the selection, then the rest.
  if (correspondence) {
    const rank = (source: string) => {
      const r = role(source);
      return r === "moving" ? 2 : r === "selected" ? 1 : 0;
    };
    mapped.sort((a, b) => rank(a.source) - rank(b.source));
  }
  if (curved)
    mapped.sort((a, b) => {
      const rank = (id?: string) =>
        sectionIndex(id) === selected
          ? 2
          : (result.sections[sectionIndex(id)]?.level ?? 0) < 0
            ? 1
            : 0;
      return rank(a.sectionId) - rank(b.sectionId);
    });
  // Transparent mathematical drawing, not opaque hidden-surface rendering.
  const faces = layers.faces
    ? result.faces
        .map((f) => ({ ...f, points: f.points.map(project) }))
        .sort(
          (a, b) =>
            a.points.reduce((s, p) => s + p[2], 0) / a.points.length -
            b.points.reduce((s, p) => s + p[2], 0) / b.points.length,
        )
    : [];
  const d = (points: number[][]) =>
    points
      .map((p, i) => `${i ? "L" : "M"}${p[0].toFixed(3)},${p[1].toFixed(3)}`)
      .join(" ");
  return (
    <>
      <title>{descriptor.title(config)}</title>
      <desc>
        {JSON.stringify({
          config,
          view,
          layers,
          object: result.object,
          operation: result.operation,
          emittedPoints: result.emittedPoints,
          ...(result.lift || result.bypass || result.weave
            ? { framingRadius: result.radius }
            : {}),
          evaluations: result.evaluations,
          sections: result.sections,
          ...(result.bypass
            ? {
                bypass: result.bypass,
                markers: result.markers,
                representation: flat
                  ? "radial-position/w coordinate diagram"
                  : "orthographic XYZ shadow",
              }
            : {}),
          ...(result.operation === "base"
            ? {
                representation: "unit base sphere S², orthographic",
                markers: result.markers,
              }
            : {}),
          ...(result.weave
            ? {
                weave: result.weave,
                clipped: result.clipped,
                arcs: result.paths
                  .filter((p) => !p.guide)
                  .map((p) => ({
                    source: p.source,
                    latitude: p.sectionId,
                    role: p.role,
                    from: p.parameters?.[0],
                    to: p.parameters?.at(-1),
                  })),
              }
            : {}),
          ...(result.lift
            ? {
                lift: result.lift,
                intervals: result.paths
                  .filter((p) => !p.guide)
                  .map((p) => ({
                    source: p.source,
                    branch: p.branch,
                    role: p.role,
                    from: p.parameters?.[0],
                    to: p.parameters?.at(-1),
                  })),
              }
            : {}),
          limitations: descriptor.limitations,
          rendering: "transparent vector construction",
        })}
      </desc>
      <rect width="1000" height="760" fill={plotPalette(dark, scheme).bg} />
      {result.operation === "base" && layers.guides && (
        // The unit sphere's outline as the camera sees it.
        <circle
          data-role="outline"
          cx={500 + view.panX}
          cy={380 + view.panY}
          r={(310 * view.zoom) / result.radius}
          fill="none"
          stroke={colors[3]}
          strokeOpacity={dark ? 0.6 : 0.5}
          {...stroke(1.25)}
        />
      )}
      {faces.map((f, i) => (
        <path
          key={`f${i}`}
          d={d(f.points) + " Z"}
          fill={colors[f.family]}
          fillOpacity={dark ? 0.17 : 0.12}
          stroke="none"
        />
      ))}
      {mapped.map((p) => {
        const r = role(p.source);
        return (
          <path
            key={`${p.sectionId ?? "base"}/${p.source}/${p.role}/${p.branch}`}
            data-source={p.source}
            data-sample={r ? sampleOf(p.source, result) : undefined}
            data-correspondence={r}
            data-section={p.sectionId}
            data-role={p.role}
            data-family={p.family}
            data-guide={p.guide}
            data-selected={
              curved ? sectionIndex(p.sectionId) === selected : undefined
            }
            d={d(p.points)}
            fill="none"
            stroke={
              r === "moving"
                ? movingInk(dark, scheme)
                : curved || (latitudes && p.sectionId)
                  ? sectionInk(sectionIndex(p.sectionId), dark, scheme)
                  : colors[p.family]
            }
            strokeDasharray={
              p.dashed
                ? "7 5"
                : curved &&
                    (result.sections[sectionIndex(p.sectionId)]?.level ?? 0) < 0
                  ? "7 5"
                  : undefined
            }
            {...stroke(
              r === "moving"
                ? 3
                : r === "selected"
                  ? 2.6
                  : r === "sample"
                    ? 1.5
                    : curved
                      ? sectionIndex(p.sectionId) === selected
                        ? 3
                        : 1.8
                      : p.guide
                        ? 1.25
                        : 2.1,
            )}
            strokeOpacity={
              r === "sample"
                ? 0.72
                : p.role === "route-context"
                  ? 0.35
                  : curved
                    ? sectionIndex(p.sectionId) === selected
                      ? 1
                      : 0.65
                    : p.guide
                      ? dark
                        ? 0.6
                        : 0.5
                      : 0.94
            }
            strokeLinejoin="round"
            strokeLinecap="round"
          />
        );
      })}
      {result.markers
        ?.filter((m) => markerShown(m, layers))
        .map((m) => {
          const [x, y] = project(m.point);
          const r = role(m.id);
          if (r) {
            // A base point: the latitude's ink, ringed when selected; the
            // moving point in the accent.
            const ink =
              r === "moving"
                ? movingInk(dark, scheme)
                : sectionInk(0, dark, scheme);
            return (
              <g
                key={m.id}
                data-marker={m.id}
                data-role={m.role}
                data-sample={sampleOf(m.id, result)}
                data-correspondence={r}
              >
                {r !== "sample" && (
                  <circle
                    cx={x}
                    cy={y}
                    r={r === "moving" ? 11 : 9}
                    fill="none"
                    stroke={ink}
                    {...stroke(1.6)}
                  />
                )}
                <circle cx={x} cy={y} r={r === "moving" ? 6 : 4.5} fill={ink} />
              </g>
            );
          }
          return (
            <circle
              key={m.id}
              data-marker={m.id}
              data-role={m.role}
              cx={x}
              cy={y}
              r={m.role === "comparison" ? (m.family === 2 ? 9 : 6) : 5}
              fill={m.role === "comparison" ? "none" : colors[m.family]}
              stroke={colors[m.family]}
              {...stroke(2.5)}
            />
          );
        })}
      {layers.edges &&
        result.points.map((p, i) => {
          const [x, y] = project(p);
          const section = curved
            ? result.sections.filter((s) => s.kind === "point")[i]
            : undefined;
          const index = sectionIndex(section?.id);
          return (
            <circle
              key={section?.id ?? i}
              data-section={section?.id}
              data-selected={curved ? index === selected : undefined}
              cx={x}
              cy={y}
              r={curved && index === selected ? 4 : 3}
              fill={curved ? sectionInk(index, dark, scheme) : colors[0]}
            />
          );
        })}
    </>
  );
}
