// The control a 4D validation error is about. Go names the field by its
// request path (engine4.FieldError); the notebook shows the message under
// the control with that label. An object's own fields are labeled by its
// descriptor; the controls every object shares are labeled here.
import { objects } from "./objects";
import { vertexLabel } from "../sphere-polygon";
import type { Config } from "./types";

export const axes = ["xy", "xz", "yz", "xw", "yw", "zw"] as const;
export const labels = {
  object: "4D object",
  distance: "4D eye distance",
  clip: "Projection window radius",
  slice: "Slice offset h",
  spread: "Section spread",
  count: "Section count",
  grid: "Face grid lines",
  arcSamples: "Arc samples",
  curves: "Curves per direction",
  curveSamples: "Curve samples",
};

export function fieldLabel(c: Config, path: string): string | undefined {
  const d = objects[c.object];
  const curved = d.legend === "sections";
  switch (path) {
    case "object":
      return labels.object;
    case "mode":
      return d.viewLabel;
    case "radius":
    case "tube":
      return d.radiusFields.find((f) => f.key === path)?.label;
    case "distance":
    case "clip":
    case "slice":
    case "spread":
    case "grid":
      return labels[path];
    case "count":
    case "curves":
    case "samples": {
      const counted = d.countFields?.(c).find((f) => f.key === path);
      if (counted) return counted.label;
      if (path === "samples")
        return (
          d.sampleLabel ?? (curved ? labels.curveSamples : labels.arcSamples)
        );
      return path === "count" ? labels.count : labels.curves;
    }
  }
  let m = /^angles\.(\d)$/.exec(path);
  if (m) return `${axes[+m[1]]} angle`;
  // A polygon's vertex coordinate is its own field; its vertex count is
  // shown under the path that has the vertices.
  m = /^(\w+)\.vertices\.(\d+)\.([uv])$/.exec(path);
  if (m && m[1] === d.parameterKey && d.vertexList)
    return vertexLabel(+m[2] + 1, m[3] as "u" | "v");
  m = /^(lift|bypass|weave|cell24|cell16|root)\.(\w+)(?:\.(\d))?$/.exec(path);
  if (!m || m[1] !== d.parameterKey) return undefined;
  if (m[2] === "selected") return d.selection?.label;
  // The root journey's turn of the initial sheet is shown under its choice.
  if (m[2] === "branch")
    return d.choices?.find((f) => f.key === "sheet")?.label;
  if (m[2] === "vertices" && d.vertexList)
    return d.choices?.find((f) => f.key === "path")?.label;
  const index = m[3] === undefined ? undefined : +m[3];
  return (
    d.numericFields?.find((f) => f.key === m[2] && f.index === index)?.label ??
    d.choices?.find((f) => f.key === m[2])?.label
  );
}
