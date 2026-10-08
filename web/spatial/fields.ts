// The control a 3D validation error is about. Go names the field by its
// configuration path (engine3.FieldError); the notebook shows the message
// under the control with that label.
import { targetLabel, type Target } from "./animation";
import { receiverAxes } from "./rays";
import type { SpatialConfig } from "./types";

// Fields whose control is labelled as its animation track is.
const tracked: Record<string, Target> = {
  samples: "samples",
  lines: "lines",
  length: "length",
  radius: "radius",
  tube: "tube",
  "involute.anchor": "anchor",
  "involute.offset": "offset",
  "unwinding.anchor": "inputAnchor",
  "unwinding.offset": "inputOffset",
  "strand.offset": "inputDistance",
  "strand.angle": "inputAngle",
  "strand.twist": "inputTwist",
  "pole.x": "poleX",
  "pole.y": "poleY",
  "pole.z": "poleZ",
  "harmonic.center.x": "c0x",
  "harmonic.center.y": "c0y",
  "harmonic.center.z": "c0z",
  "frame.angle": "angle",
  "frame.twist": "twist",
  "frame.width": "width",
  "frame.offset": "distance",
  "frame.strands": "strands",
  "frame.reference.x": "normalX",
  "frame.reference.y": "normalY",
  "frame.reference.z": "normalZ",
  "ruled.rate": "rate",
  "ruled.shift": "shift",
  "canal.radius": "sphereRadius",
  "canal.meridians": "meridians",
  "field.escape": "escape",
  "pursuit.capture": "capture",
  "surface.a": "surfaceA",
  "surface.b": "surfaceB",
  "surface.c": "surfaceC",
  "surface.uMin": "uMin",
  "surface.uMax": "uMax",
  "surface.vMin": "vMin",
  "surface.vMax": "vMax",
  "surface.offset": "surfaceOffset",
  "surface.reach": "reach",
  "surface.uSamples": "uSamples",
  "surface.vSamples": "vSamples",
  "surface.curves": "curves",
  "rays.azimuth": "azimuth",
  "rays.elevation": "elevation",
  "rays.source.x": "sourceX",
  "rays.source.y": "sourceY",
  "rays.source.z": "sourceZ",
  "rays.length": "rayLength",
  "rays.n1": "n1",
  "rays.n2": "n2",
  "rays.receiver.at": "receiverAt",
  "rays.receiver.size": "receiverSize",
  "implicit.level": "level",
  "implicit.a": "implicitA",
  "implicit.cells": "cells",
  "implicit.sections.count": "sectionCount",
  "implicit.sections.from": "sectionFrom",
  "implicit.sections.to": "sectionTo",
};
// Fields whose control has a label of its own.
const labelled: Record<string, string> = {
  construction: "Construction",
  format: "Spatial definition",
  input: "Built on",
  p: "Knot winding",
  q: "Knot winding",
  "curve.min": "t from",
  "curve.max": "to",
  "harmonic.min": "t from",
  "harmonic.max": "to",
  "field.min": "t from",
  "field.max": "to",
  "pursuit.min": "t from",
  "pursuit.max": "to",
  "involute.family.from": "c from",
  "involute.family.to": "c to",
  "involute.family.count": "Involutes",
  "inversion.radius": "Sphere radius R",
  "inversion.center.x": "Center x",
  "inversion.center.y": "Center y",
  "inversion.center.z": "Center z",
  "inversion.input": "Curve to invert",
  "frame.kind": "Frame",
  "frame.closure": "Closed-loop seam",
  "ruled.partner": "Partner",
  "canal.profile": "Profile ρ(t)",
  "surface.kind": "Surface",
  "rays.interaction": "Interaction",
  "rays.light": "Light",
  "rays.receiver.plane": "Receiver",
  "rays.receiver.bins": "Bins",
  "implicit.f": "F(x, y, z)",
  "implicit.refine": "Refinement levels",
};

export function fieldLabel(c: SpatialConfig, path: string): string | undefined {
  if (path in labelled) return labelled[path];
  if (path in tracked) return targetLabel(c, tracked[path]);
  let m = /^(curve|field|ruled\.thread)\.([xyz])$/.exec(path);
  if (m)
    return m[1] === "curve"
      ? `${m[2]}(t)`
      : m[1] === "field"
        ? `d${m[2]}/dt`
        : `b ${m[2]}(t)`;
  m = /^harmonic\.terms\.(\d+)\.(frequency|cosine|sine)(?:\.([xyz]))?$/.exec(
    path,
  );
  if (m) {
    const field =
      m[2] === "frequency"
        ? "Frequency"
        : `${m[2] === "cosine" ? "A" : "B"}${m[3]}`;
    return targetLabel(c, `harmonic${+m[1] + 1}${field}` as Target);
  }
  m = /^field\.seeds\.(\d+)\.([xyz])$/.exec(path);
  if (m)
    return targetLabel(c, `seed${+m[1] + 1}${m[2].toUpperCase()}` as Target);
  m = /^pursuit\.pursuers\.(\d+)\.(x|y|z|speed)$/.exec(path);
  if (m)
    return targetLabel(
      c,
      `pursuer${+m[1] + 1}${m[2] === "speed" ? "Speed" : m[2].toUpperCase()}` as Target,
    );
  m = /^rays\.receiver\.c([12])$/.exec(path);
  if (m) {
    const plane =
      c.rays.receiver.plane === "none" ? "z" : c.rays.receiver.plane;
    return `Centre ${receiverAxes[plane][+m[1] - 1]}`;
  }
  m = /^implicit\.box\.([xyz])(Min|Max)$/.exec(path);
  if (m) return `${m[1]} ${m[2] === "Min" ? "from" : "to"}`;
  m = /^implicit\.sections\.normal\.([xyz])$/.exec(path);
  if (m) return `Normal ${m[1]}`;
  return undefined;
}
