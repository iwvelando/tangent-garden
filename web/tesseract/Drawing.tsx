import { plotPalette } from "../palette";
import type { Config, Result, View, Layers, Vec3 } from "./types";
export const inks = (dark: boolean) =>
  dark
    ? ["#7ddbcc", "#ecc47d", "#bdacf0", "#ec9fa8"]
    : ["#147669", "#a16b1d", "#7050a2", "#ad5265"];
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
  const project = (p: Vec3) => {
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
    .filter((p) => (p.guide ? layers.guides : layers.edges))
    .map((p) => ({ ...p, points: p.points.map(project) }));
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
      <title>
        Tangent Garden —{" "}
        {config.mode === "section"
          ? "tesseract cross-sections"
          : config.mode === "stereo"
            ? "stereographic tesseract"
            : "tesseract projection"}
      </title>
      <desc>
        {JSON.stringify({
          config,
          view,
          layers,
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
      {mapped.map((p, i) => (
        <path
          key={i}
          data-family={p.family}
          data-guide={p.guide}
          d={d(p.points)}
          fill="none"
          stroke={colors[p.family]}
          strokeWidth={p.guide ? 1.25 : 2.1}
          strokeOpacity={p.guide ? (dark ? 0.6 : 0.5) : 0.94}
          strokeLinejoin="round"
          strokeLinecap="round"
        />
      ))}
      {layers.edges &&
        result.points.map((p, i) => {
          const [x, y] = project(p);
          return <circle key={i} cx={x} cy={y} r="3" fill={colors[0]} />;
        })}
    </>
  );
}
