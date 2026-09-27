export type Vec = { x: number; y: number };
export type Kind =
  "evolute" | "involute" | "catacaustic" | "diacaustic" | PoleKind;
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
  offset: number;
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

export type Bounds = { min: string; max: string };
export type Frame = { config: Config; result: Result };
export type Result = {
  sourcePosition?: Vec;
  base: (Vec | null)[];
  derived: (Vec | null)[];
  virtual: boolean[];
  rays: Ray[];
  warnings: string[];
  invalid: number;
};
