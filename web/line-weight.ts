// Line weights, shared by every notebook: how wide lines are drawn. Fine,
// regular and bold strokes are a share of the drawing, each ink's regular
// width times a scale, so they keep their proportion in the live drawing,
// stills and videos at any size. A hairline is one pixel at any size. The 3D
// notebook draws them as WebGL strokes (spatial/sight.ts); the 2D and 4D
// notebooks as SVG strokes (svgStroke).
import { tiered } from "./help";
import type { SchemaOf } from "./study-link";

export type LineWeight = "hairline" | "fine" | "regular" | "bold";
export const lineWeights: { value: LineWeight; label: string }[] = [
  { value: "hairline", label: "Hairline" },
  { value: "fine", label: "Fine" },
  { value: "regular", label: "Regular" },
  { value: "bold", label: "Bold" },
];
export const weightScale: Record<Exclude<LineWeight, "hairline">, number> = {
  fine: 0.6,
  regular: 1,
  bold: 1.6,
};
export const lineWeightSchema: SchemaOf<LineWeight> = {
  options: { hairline: true, fine: true, regular: true, bold: true },
};

// An SVG stroke's attributes at a weight, given its regular width in the
// drawing's units. Regular returns that width unchanged, so a drawing at
// regular is exactly the drawing made before weights. A hairline does not
// scale with the drawing (vector-effect), so it is one pixel of whatever
// it is drawn on: the screen, a still or a video frame. An unstroked mark,
// of width 0, stays unstroked.
export type SvgStroke = {
  strokeWidth: number;
  vectorEffect?: "non-scaling-stroke";
};
export function svgStroke(weight: LineWeight) {
  return (width: number): SvgStroke => {
    if (weight === "regular" || !(width > 0)) return { strokeWidth: width };
    if (weight === "hairline")
      return { strokeWidth: 1, vectorEffect: "non-scaling-stroke" };
    return {
      strokeWidth: Math.round(width * weightScale[weight] * 1e4) / 1e4,
    };
  };
}

// Help for the SVG notebooks' control, stating the scale the drawing uses.
export const svgWeightHelp = tiered(
  "How wide lines are drawn. Fine, regular and bold scale with the drawing; a hairline is always one pixel.",
  `Fine, regular and bold keep their proportion in the live drawing, stills, videos and SVG files at any size; fine is ${weightScale.fine}× and bold ${weightScale.bold}× regular. A hairline stays one pixel wide at any size, so it looks fainter in larger exports, and in an SVG file at any zoom.`,
);
