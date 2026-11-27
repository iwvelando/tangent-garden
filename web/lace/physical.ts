// #543 research: a plaque made from a lace study (physical/lace.go),
// shown only with ?research=543. Nothing here is a public contract.
import type { LaceRequest } from "./model";

export const researchPhysical = () =>
  typeof location !== "undefined" &&
  new URLSearchParams(location.search).getAll("research").includes("543");

// Mirrors physical.Profile: machine, process, calibrated limits and the
// object's requested minima, kept apart, with their sources.
export type Profile = {
  version: 1;
  id: string;
  name: string;
  envelope: [number, number, number];
  nozzle: number;
  extrusionWidth: number;
  layerHeight: number;
  firstLayer: number;
  xyDetail: number;
  xyGap: number;
  zDetail: number;
  calibrated: boolean;
  wall: number;
  strut: number;
  floor: number;
  gap: number;
  sources: {
    fields: string;
    value: string;
    document: string;
    revision: string;
  }[];
};

export type Treatment = "raised" | "recessed";
export type Rim = "motif" | "rim" | "crop";

export type LaceSolidRequest = {
  lace: LaceRequest;
  diameter: number;
  design: { treatment: Treatment; line: number; floor: number; relief: number };
  rim: Rim;
  clip?: number;
  border?: number;
  grid?: number;
  profile: Profile;
};

export type CheckItem = {
  id: string;
  label: string;
  required: boolean;
  status: "pass" | "fail" | "unresolved" | "warn";
  evidence: "exact" | "conservative" | "sampled" | "measured";
  value: number;
  limit: number;
  detail: string;
};

export type LaceSolid = {
  validated: boolean;
  checks: CheckItem[];
  mesh: {
    closed: boolean;
    oriented: boolean;
    components: number;
    volume: number;
    area: number;
    min: [number, number, number];
    max: [number, number, number];
    selfIntersections: number;
    touching: number;
    pairTests: number;
    unresolved: boolean;
  };
  cells: {
    need: number;
    allowance: number;
    count: number;
    failed: number;
    unresolved: number;
    vanished: number;
    fused: number[][] | null;
    narrowArea: number;
  };
  problems:
    | {
        x: number;
        y: number;
        radius: number;
        status: string;
        vanished: boolean;
      }[]
    | null;
  narrow: number[] | null;
  fusedAt: number[] | null;
  source: {
    tiles: number;
    strokes: number;
    pieces: number;
    beyondDepth: number;
    nearRim: number;
    stopped: string;
    pending: number;
    coverage: number;
  };
  cutoff: {
    admitted: number;
    tiles: number[] | null;
    reason: "manufacturing" | "clip" | "source";
    radius: number;
    rounds: number;
    failedRounds: number;
    unresolved: number;
    leastScale: number;
  };
  stats: {
    strokes: number;
    nodes: number;
    evaluations: number;
    vertices: number;
    triangles: number;
    pairTests: number;
    meshBytes: number;
    packageBytes: number;
    workingBytes: number;
    millis: Record<string, number>;
    deviation: number;
    specks: number;
    chord: number;
    // The worker's Go memory after the build, its peak (WebAssembly
    // memory only grows).
    memory?: number;
  };
  scale: number;
  clip: number;
  radius: number;
  levels: { Plan: number; Rest: number };
  vertices: Float64Array;
  triangles: Int32Array;
  package: Uint8Array;
};

// The research defaults (physical.DefaultProfiles): the profiles arrive
// from Go only inside a prepared solid's record, so these mirror them for
// the controls. Edits are kept per profile while the workshop is open.
const bambuSources: Profile["sources"] = [
  {
    fields: "envelope x, y",
    value: "256 × 256 mm",
    document: "Bambu Lab X1-Carbon Technical Specifications",
    revision: "manufacturer PDF",
  },
  {
    fields: "envelope z, process",
    value: "250 mm; 0.42, 0.2, 0.2 mm",
    document:
      "Bambu Studio profiles: X1 Carbon 0.4 nozzle, 0.20mm Standard @BBL X1C",
    revision: "bambulab/BambuStudio@23a33758933e712c6041e1f8f135f7d6b50004aa",
  },
  {
    fields: "xyDetail, xyGap, zDetail",
    value: "0.84, 0.4, 0.2 mm",
    document: "uncalibrated estimates",
    revision: "#543 research default",
  },
];
const prusaSources: Profile["sources"] = [
  {
    fields: "envelope, process",
    value: "250 × 210 × 210 mm; 0.45, 0.15, 0.2 mm",
    document:
      "PrusaSlicer: Original Prusa i3 MK3S & MK3S+, 0.15mm QUALITY @MK3",
    revision:
      "prusa3d/PrusaSlicer-settings-prusa-fff@058c542282d5a512dcc73fc8be9288fc253ddcfd, PrusaResearch/2.5.16.ini",
  },
  {
    fields: "walls, positioning",
    value: "0.45 / 0.9 mm perimeters; accurate to at least 0.2 mm",
    document: "Prusa Knowledge Base, Modeling with 3D printing in mind",
    revision:
      "help.prusa3d.com/article/modeling-with-3d-printing-in-mind_164135",
  },
  {
    fields: "xyDetail, xyGap, zDetail",
    value: "0.9, 0.4, 0.15 mm",
    document: "uncalibrated estimates",
    revision: "#543 research default",
  },
];
export const defaultProfiles: Profile[] = [
  {
    version: 1,
    id: "bambu-x1c-0.4",
    name: "Bambu Lab X1-Carbon, 0.4 mm nozzle, 0.20 mm Standard",
    envelope: [256, 256, 250],
    nozzle: 0.4,
    extrusionWidth: 0.42,
    layerHeight: 0.2,
    firstLayer: 0.2,
    xyDetail: 0.84,
    xyGap: 0.4,
    zDetail: 0.2,
    calibrated: false,
    wall: 2,
    strut: 2,
    floor: 1.2,
    gap: 1,
    sources: bambuSources,
  },
  {
    version: 1,
    id: "prusa-mk3s-0.4",
    name: "Original Prusa i3 MK3S+, 0.4 mm nozzle, 0.15 mm QUALITY",
    envelope: [250, 210, 210],
    nozzle: 0.4,
    extrusionWidth: 0.45,
    layerHeight: 0.15,
    firstLayer: 0.2,
    xyDetail: 0.9,
    xyGap: 0.4,
    zDetail: 0.15,
    calibrated: false,
    wall: 2,
    strut: 2,
    floor: 1.2,
    gap: 1,
    sources: prusaSources,
  },
];

// The plaque's source: the lace's generation settings and static
// isometry. The view's window and zoom detail never reach the solid.
export const frozenSource = (q: LaceRequest): LaceRequest => {
  const { window: _w, minRadius: _m, ...rest } = q;
  return structuredClone(rest);
};
