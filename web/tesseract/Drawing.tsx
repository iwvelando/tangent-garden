import { objects } from "./objects";
import { plotPalette } from "../palette";
import type { Config, Result, View, Layers, Vec3 } from "./types";
export const inks = (dark: boolean) =>
  dark
    ? ["#7ddbcc", "#ecc47d", "#bdacf0", "#ec9fa8"]
    : ["#147669", "#a16b1d", "#7050a2", "#ad5265"];
// Index colours separate coincident levels without reusing coordinate inks.
export const sectionInk = (index: number, dark: boolean) =>
  `hsl(${(170 + index * 137.508) % 360} 55% ${dark ? 72 : 36}%)`;
// Only the ordinary 3D viewing camera is evaluated here. Go owns all 4D
// rotations, clipping, intersections and curve samples. Equal axis scale.
export function Drawing({
  result,
  config,
  view,
  layers,
  dark,
}: {
  result: Result;
  config: Config;
  view: View;
  layers: Layers;
  dark: boolean;
}) {
  const colors = inks(dark),
    scale = (310 * view.zoom) / result.radius;
  const descriptor = objects[config.object];
  const curved = descriptor.legend === "sections";
  // Latitude studies share the section key's colours, without its selection.
  const latitudes = descriptor.legend === "latitudes";
  const flat = descriptor.flat?.(config);
  const selected = Math.min(
    layers.selectedSection ?? 0,
    result.sections.length - 1,
  );
  const sectionIndex = (id?: string) =>
    result.sections.findIndex((s) => s.id === id);
  const project = (p: Vec3) => {
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
  const mapped = result.paths
    .filter((p) =>
      p.role === "missing-guide"
        ? layers.missingGuide
        : p.role === "displacement"
          ? layers.connectors
          : p.guide
            ? layers.guides
            : layers.edges,
    )
    .map((p) => ({ ...p, points: p.points.map(project) }));
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
      <rect width="1000" height="760" fill={plotPalette(dark).bg} />
      {faces.map((f, i) => (
        <path
          key={`f${i}`}
          d={d(f.points) + " Z"}
          fill={colors[f.family]}
          fillOpacity={dark ? 0.17 : 0.12}
          stroke="none"
        />
      ))}
      {mapped.map((p) => (
        <path
          key={`${p.sectionId ?? "base"}/${p.source}/${p.role}/${p.branch}`}
          data-source={p.source}
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
            curved || (latitudes && p.sectionId)
              ? sectionInk(sectionIndex(p.sectionId), dark)
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
          strokeWidth={
            curved
              ? sectionIndex(p.sectionId) === selected
                ? 3
                : 1.8
              : p.guide
                ? 1.25
                : 2.1
          }
          strokeOpacity={
            p.role === "route-context"
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
      ))}
      {result.markers
        ?.filter((m) =>
          m.role === "comparison" ? layers.comparison : layers.edges,
        )
        .map((m) => {
          const [x, y] = project(m.point);
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
              strokeWidth="2.5"
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
              fill={curved ? sectionInk(index, dark) : colors[0]}
            />
          );
        })}
    </>
  );
}
