// Named views of the turntable camera the 3D and 4D notebooks share: yaw ψ
// about the vertical y axis and pitch φ toward it, whose rows are right
// (cos ψ, 0, sin ψ), up (sin φ sin ψ, cos φ, −sin φ cos ψ) and toward the
// viewer (−cos φ sin ψ, sin φ, cos φ cos ψ). Each view sets only yaw and
// pitch, so zoom, pan and the projection are kept, and a link carries the
// resulting camera, never the name.
export type NamedView = "front" | "side" | "top" | "isometric";
// The turntable stops short of looking straight down or up.
export const pitchLimit = 1.5;
export const namedViews: Record<
  NamedView,
  { label: string; help: string; yaw: number; pitch: number }
> = {
  front: {
    label: "Front",
    help: "Look along −z: x to the right, y up.",
    yaw: 0,
    pitch: 0,
  },
  side: {
    label: "Side",
    help: "Look along +x: z to the right, y up.",
    yaw: Math.PI / 2,
    pitch: 0,
  },
  top: {
    label: "Top",
    help: "Look down along −y, x to the right: 4° short of overhead, where the turntable stops.",
    yaw: 0,
    pitch: pitchLimit,
  },
  isometric: {
    label: "Isometric",
    help: "Look from the (+x, +y, +z) side, at equal angles to all three axes.",
    yaw: -Math.PI / 4,
    pitch: Math.asin(1 / Math.sqrt(3)),
  },
};
export function turnTo<V extends { yaw: number; pitch: number }>(
  view: V,
  name: NamedView,
): V {
  return { ...view, yaw: namedViews[name].yaw, pitch: namedViews[name].pitch };
}
// The turntable's rows, as the orientation indicator draws them.
export type Basis = {
  right: [number, number, number];
  up: [number, number, number];
  back: [number, number, number];
};
export function turntableBasis(yaw: number, pitch: number): Basis {
  const c = Math.cos(yaw),
    s = Math.sin(yaw),
    a = Math.cos(pitch),
    b = Math.sin(pitch);
  return {
    right: [c, 0, s],
    up: [b * s, a, -b * c],
    back: [-a * s, b, a * c],
  };
}
