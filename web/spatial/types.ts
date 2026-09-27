export type Vec3 = { x: number; y: number; z: number };
export type SpatialConfig = {
  radius: number;
  tube: number;
  length: number;
  p: number;
  q: number;
  samples: number;
  lines: number;
};
export type SpatialResult = {
  base: Vec3[];
  minus: Vec3[];
  plus: Vec3[];
  mesh: { position: Vec3; normal: Vec3; phase: number }[];
  rulings: { from: Vec3; to: Vec3 }[];
  radius: number;
  omitted: number;
};
