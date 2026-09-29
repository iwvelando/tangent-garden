export type Vec3 = [number, number, number];
export type Config = {
  mode: "perspective" | "orthographic" | "stereo" | "section";
  angles: [number, number, number, number, number, number];
  distance: number;
  slice: number;
  spread: number;
  count: number;
  grid: number;
  samples: number;
  clip: number;
};
export type Result = {
  paths: { points: Vec3[]; family: number; guide: boolean }[];
  faces: { points: Vec3[]; family: number }[];
  points: Vec3[];
  sections: {
    level: number;
    vertices: number;
    edges: number;
    faces: number;
    dimension: number;
  }[];
  clipped: number;
  radius: number;
};
export type View = {
  yaw: number;
  pitch: number;
  zoom: number;
  panX: number;
  panY: number;
};
export const initialView: View = {
  yaw: 0.32,
  pitch: 0.35,
  zoom: 1,
  panX: 0,
  panY: 0,
};
export type Layers = { edges: boolean; guides: boolean; faces: boolean };
export type Motion = "double" | "xw" | "slice";
// Playback and export use this exact sampler. The base definition is immutable.
export function sample(
  config: Config,
  motion: Motion,
  progress: number,
): Config {
  const q = structuredClone(config),
    p = Math.max(0, Math.min(1, progress));
  if (motion === "slice") q.slice = -2.05 + 4.1 * p;
  else {
    q.angles[3] += 2 * Math.PI * p;
    if (motion === "double") q.angles[2] += 2 * Math.PI * p;
  }
  return q;
}
