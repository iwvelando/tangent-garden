// The control a 2D validation error is about. Go names the field by its
// configuration path (engine.FieldError); the notebook shows the message
// under the control with that name: its help topic, or else its label.
import { pursuerLabels, seedLabels, termLabels } from "./animation";
import type { Config } from "./types";

const named: Record<string, string> = {
  input: "construction input",
  "pole.x": "Pole x",
  "pole.y": "Pole y",
  distance: "offset distance",
  offset: "initial string offset",
  samples: "Numerical samples",
  lines: "Construction lines",
  "source.kind": "Source",
  "source.coordinates": "Source coordinates",
  "source.radius": "Source radius r",
  "source.theta": "Source theta θ (radians)",
  "source.position.x": "Source x",
  "source.position.y": "Source y",
  "source.angle": "Travel direction (degrees)",
  nIncident: "Incident index n₁",
  nTransmitted: "Transmitted n₂",
  "stack.count": "Number of offsets",
  "stack.from": "offset stack distances",
  "stack.to": "Last offset distance",
  "rolling.shape": "Rolling shape",
  "rolling.side": "Side of the curve",
  "rolling.curve.x": "rolling curve",
  "rolling.curve.y": "Rolling y(t)",
  "rolling.curve.min": "Rolling t from",
  "rolling.curve.max": "Rolling t to",
  "rolling.curve.start": "rolling curve start",
  "rolling.point.x": "rolling curve tracing point",
  "rolling.point.y": "Tracing point y",
  "rolling.radius": "rolling circle radius",
  "rolling.arm": "rolling tracing distance",
  "rolling.phase": "rolling phase",
  "envelope.mode": "Family",
  "envelope.angle": "direction angle",
  "envelope.x": "second point",
  "envelope.y": "Second point y(t)",
  "envelope.radius": "circle radius",
  "inversion.center.x": "Inversion center x",
  "inversion.center.y": "Inversion center y",
  "inversion.radius": "inversion radius",
  "curve.format": "Definition",
  "curve.x": "x(t)",
  "curve.r": "r(t)",
  "curve.max": "to",
  "curve.roulette.roll": "Rolling",
  "curve.roulette.fixedRadius": "Fixed radius R",
  "curve.roulette.radius": "roulette radii",
  "curve.roulette.arm": "tracing distance",
  "curve.roulette.phase": "roulette phase",
  "curve.lissajous.amplitudeX": "Lissajous amplitudes",
  "curve.lissajous.amplitudeY": "Amplitude B",
  "curve.lissajous.frequencyX": "Lissajous frequencies",
  "curve.lissajous.frequencyY": "Frequency n",
  "curve.lissajous.phase": "Lissajous phase",
  "curve.pursuit.capture": "capture distance",
  "curve.field.x": "dx/dt",
  "curve.field.y": "dy/dt",
  "curve.field.escape": "escape radius",
  "curve.implicit.f": "F(x, y)",
  "curve.implicit.level": "level c",
  "curve.implicit.window.xMin": "Window x from",
  "curve.implicit.window.xMax": "window",
  "curve.implicit.window.yMin": "Window y from",
  "curve.implicit.window.yMax": "Window y to",
  "curve.implicit.cells": "grid cells",
  "curve.implicit.family.from": "Levels from",
  "curve.implicit.family.to": "family of levels",
  "curve.implicit.family.count": "Level count",
  "curve.attractor.map": "iterated map",
  "curve.attractor.a": "Coefficient a",
  "curve.attractor.b": "map coefficients",
  "curve.attractor.c": "Coefficient c",
  "curve.attractor.d": "Coefficient d",
  "curve.attractor.start.x": "Start x₀",
  "curve.attractor.start.y": "start",
  "curve.attractor.discard": "Discarded iterates",
  "curve.attractor.iterates": "iterates",
  "curve.attractor.cells": "density grid",
  "curve.attractor.window.xMin": "Window x from",
  "curve.attractor.window.xMax": "density window",
  "curve.attractor.window.yMin": "Window y from",
  "curve.attractor.window.yMax": "Window y to",
};

export function fieldLabel(c: Config, path: string): string | undefined {
  if (path in named) return named[path];
  const format = c.curve.format;
  if (path === "curve.y") return format === "cartesian" ? "f(x)" : "y(t)";
  if (path === "curve.min")
    return format === "roulette"
      ? "rolling parameter t"
      : format === "lissajous" ||
          format === "fourier" ||
          format === "pursuit" ||
          format === "field"
        ? "time parameter t"
        : format === "cartesian"
          ? "x from"
          : "t from";
  let m = /^curve\.terms\.(\d+)\.(frequency|radius|phase)$/.exec(path);
  if (m)
    return termLabels[
      (m[2][0].toUpperCase() + m[2].slice(1)) as keyof typeof termLabels
    ](+m[1] + 1);
  m = /^curve\.pursuit\.pursuers\.(\d+)\.(x|y|speed)$/.exec(path);
  if (m)
    return pursuerLabels[
      m[2] === "speed" ? "Speed" : (m[2].toUpperCase() as "X" | "Y")
    ](+m[1] + 1);
  m = /^curve\.field\.seeds\.(\d+)\.(x|y)$/.exec(path);
  if (m) return seedLabels[m[2].toUpperCase() as "X" | "Y"](+m[1] + 1);
  return undefined;
}
