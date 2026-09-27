export type Vec = { x: number; y: number };
export type Kind =
  "evolute" | "involute" | "catacaustic" | "diacaustic" | "offset" | PoleKind;
// Constructions that project an independent geometric pole onto the tangent
// or normal. They share one tab and one pole, never the optical source.
export const poleKinds = ["pedal", "contrapedal", "orthotomic"] as const;
export type PoleKind = (typeof poleKinds)[number];
export const usesPole = (kind: Kind): kind is PoleKind =>
  (poleKinds as readonly Kind[]).includes(kind);
export type Config = {
  kind: Kind;
  curve: {
    format: "parametric" | "cartesian" | "polar";
    x: string;
    y: string;
    r: string;
    min: number;
    max: number;
    a: number;
  };
  source: {
    kind: "point" | "parallel";
    position: Vec;
    angle: number;
    coordinates?: "cartesian" | "polar";
    radius?: number;
    theta?: number;
  };
  nIncident: number;
  pole: Vec;
  nTransmitted: number;
  // Involute string length c at the domain start.
  offset: number;
  // Signed normal offset d, positive toward the left of travel.
  distance: number;
  // When enabled, count offsets evenly spaced from `from` to `to` replace the
  // single distance.
  stack: { enabled: boolean; from: number; to: number; count: number };
  // Offset circles of the largest distance, centered at representative samples.
  circles: boolean;
  samples: number;
  lines: number;
};
export type Ray = {
  sampleIndex: number;
  origin: Vec;
  direction: Vec;
  incident: Vec;
  target: Vec | null;
  virtual: boolean;
  tir: boolean;
};

export type OffsetPath = { distance: number; points: (Vec | null)[] };
export type Circle = { sampleIndex: number; center: Vec; radius: number };

export type Bounds = { min: string; max: string };
export type Frame = { config: Config; result: Result };
export type Result = {
  sourcePosition?: Vec;
  base: (Vec | null)[];
  derived: (Vec | null)[];
  virtual: boolean[];
  rays: Ray[];
  // Offset stack members, indexed like base; empty for other results.
  family: OffsetPath[];
  circles: Circle[];
  warnings: string[];
  invalid: number;
};
