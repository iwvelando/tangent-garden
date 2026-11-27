// A printable plaque made from a lace study (physical/lace.go): the
// request and report Go exchanges with the workshop, the default printer
// profiles, and the physical settings a study link carries.
import type { LaceRequest } from "./model";

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
// A profile as a link carries it: every value, without the citations,
// which belong to the default profile with its id.
export type ProfileValues = Omit<Profile, "sources">;
// The length fields of a profile, each one control.
export type ProfileLength = Exclude<
  keyof ProfileValues,
  "version" | "id" | "name" | "calibrated" | "envelope"
>;

export type Treatment = "raised" | "recessed";
export type Lines = "motif" | "sides" | "both";
export type Rim = "motif" | "rim" | "crop";

// The physical settings version a link and a package record
// (physical.SettingsVersion).
export const physicalVersion = 1;

// What a study link saves of the workshop (docs/permalinks.md): the
// plaque's design and the profile's values, and whether the workshop is
// open. Clip is absent for an automatic clean rim and the grid for an
// automatic step. Lengths are millimeters; clip is a fraction of the
// disk's radius.
export type LacePhysical = {
  version: 1;
  open?: boolean;
  treatment: Treatment;
  diameter: number;
  line: number;
  floor: number;
  relief: number;
  lines: Lines;
  rim: Rim;
  clip?: number;
  simplify?: boolean;
  faceDown?: boolean;
  grid?: number;
  profile: ProfileValues;
};

export type LaceSolidRequest = {
  version: 1;
  lace: LaceRequest;
  diameter: number;
  design: {
    treatment: Treatment;
    line: number;
    floor: number;
    relief: number;
    simplify?: boolean;
    faceDown?: boolean;
  };
  lines: Lines;
  rim: Rim;
  clip?: number;
  grid?: number;
  profile: Profile;
};

export type CheckItem = {
  id: string;
  label: string;
  required: boolean;
  status: "pass" | "fail" | "unresolved" | "warn";
  evidence: "exact" | "conservative" | "sampled" | "measured";
  hint?: string;
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
  // The solid was turned over for printing: (x, y, z) → (x, −y, H − z).
  faceDown: boolean;
  grid: number;
  simplified: { removedArea: number; filledArea: number };
  simplifiedAt: number[] | null;
  clip: number;
  radius: number;
  levels: { Plan: number; Rest: number };
  vertices: Float64Array;
  triangles: Int32Array;
  package: Uint8Array;
};

// physical.DefaultProfiles, mirrored for the controls: Go sees only the
// profile a request carries.
const bambuSources: Profile["sources"] = [
  {
    fields: "envelope x, y",
    value: "256 × 256 mm",
    document:
      "Bambu Lab X1-Carbon Technical Specifications (build volume 256 × 256 × 256 mm³)",
    revision: "manufacturer PDF",
  },
  {
    fields: "envelope z",
    value: "250 mm",
    document:
      "Bambu Studio machine profile fdm_machine_common printable_height, inherited by Bambu Lab X1 Carbon 0.4 nozzle (printable_area 256×256, bed_exclude_area 18×28 at the origin)",
    revision: "bambulab/BambuStudio@23a33758933e712c6041e1f8f135f7d6b50004aa",
  },
  {
    fields: "nozzle",
    value: "0.4 mm",
    document:
      "Technical Specifications (included nozzle); machine profile nozzle_diameter",
    revision:
      "manufacturer PDF; bambulab/BambuStudio@23a33758933e712c6041e1f8f135f7d6b50004aa",
  },
  {
    fields: "extrusion width, layer, first layer",
    value: "0.42, 0.2, 0.2 mm",
    document:
      "process 0.20mm Standard @BBL X1C → fdm_process_single_0.20 → fdm_process_common: outer_wall_line_width, layer_height, initial_layer_print_height",
    revision: "bambulab/BambuStudio@23a33758933e712c6041e1f8f135f7d6b50004aa",
  },
  {
    fields: "positioning",
    value: "not published",
    document:
      "Technical Specifications list tool-head speed 500 mm/s and acceleration 20 m/s², and a Micro Lidar without a resolution; no positioning precision",
    revision: "manufacturer PDF",
  },
  {
    fields: "xyDetail, xyGap, zDetail",
    value: "0.84, 0.4, 0.2 mm",
    document:
      "uncalibrated estimates: two extrusion widths, the nozzle, one layer",
    revision: "#543 research default",
  },
];
const prusaSettings =
  "prusa3d/PrusaSlicer-settings-prusa-fff@058c542282d5a512dcc73fc8be9288fc253ddcfd, PrusaResearch/2.5.16.ini";
const prusaGuide =
  "help.prusa3d.com/article/modeling-with-3d-printing-in-mind_164135";
const prusaSources: Profile["sources"] = [
  {
    fields: "envelope",
    value: "250 × 210 × 210 mm",
    document:
      "PrusaSlicer printer Original Prusa i3 MK3S & MK3S+: bed_shape 0x0,250x0,250x210,0x210 and max_print_height 210",
    revision: prusaSettings,
  },
  {
    fields: "nozzle, layer, first layer, extrusion width",
    value: "0.4, 0.15, 0.2, 0.45 mm",
    document:
      "default_print_profile 0.15mm QUALITY @MK3, resolved through its inherits: layer_height, first_layer_height, external_perimeter_extrusion_width",
    revision: prusaSettings,
  },
  {
    fields: "walls",
    value: "1 perimeter 0.45 mm; 2 perimeters 0.9 mm",
    document:
      "Prusa Knowledge Base, Modeling with 3D printing in mind: walls under one perimeter are not printable; between one and two perimeters not printable",
    revision: prusaGuide,
  },
  {
    fields: "positioning",
    value: "accurate to at least 0.2 mm",
    document:
      "Prusa Knowledge Base, Modeling with 3D printing in mind (tolerances)",
    revision: prusaGuide,
  },
  {
    fields: "xyDetail, xyGap, zDetail",
    value: "0.9, 0.4, 0.15 mm",
    document: "uncalibrated estimates: two perimeters, the nozzle, one layer",
    revision: "#543 research default",
  },
];
export const defaultProfiles: readonly Profile[] = [
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

// The requested minima belong to the object: choosing another printer
// keeps them and takes the rest of its profile.
export const requestedMinima = ["wall", "strut", "floor", "gap"] as const;
export const profileValues = (p: Profile): ProfileValues => {
  const { sources: _, ...values } = structuredClone(p);
  return values;
};
export function withPrinter(
  current: ProfileValues,
  printer: Profile,
): ProfileValues {
  const next = profileValues(printer);
  for (const k of requestedMinima) next[k] = current[k];
  return next;
}
// The default a profile's values started from, if its id names one.
export const defaultProfile = (id: string) =>
  defaultProfiles.find((p) => p.id === id);
// Whether a profile's values differ from its default's.
export function profileEdited(p: ProfileValues) {
  const d = defaultProfile(p.id);
  if (!d) return true;
  const values = profileValues(d);
  return (Object.keys(values) as (keyof ProfileValues)[]).some(
    (k) => JSON.stringify(values[k]) !== JSON.stringify(p[k]),
  );
}

// A new workshop's settings: a 120 mm raised plaque of whole tiles on
// the first printer, its lines as the study draws them.
export const defaultPhysical = (lines: Lines): LacePhysical => ({
  version: physicalVersion,
  treatment: "raised",
  diameter: 120,
  line: 2,
  floor: 1.6,
  relief: 1.2,
  lines,
  rim: "motif",
  profile: profileValues(defaultProfiles[0]),
});
// What the study draws: the motif, the tile sides, or both.
export const studyLines = (s: { edges: boolean; motif: boolean }): Lines =>
  s.edges ? (s.motif ? "both" : "sides") : "motif";
// A crop needs a radius; one chosen without it starts at 0.8 of the disk.
export const cropClip = 0.8;

// The plaque's source: the lace's generation settings and static
// isometry. The view's window and zoom detail never reach the solid.
export const frozenSource = (q: LaceRequest): LaceRequest => {
  const { window: _w, minRadius: _m, ...rest } = q;
  return structuredClone(rest);
};

// The request Go builds the plaque from: the settings, with the profile's
// citations when its id names a default (they cite that default's
// values, which an edited value no longer matches).
export const solidRequest = (
  lace: LaceRequest,
  p: LacePhysical,
): LaceSolidRequest => ({
  version: physicalVersion,
  lace,
  diameter: p.diameter,
  design: {
    treatment: p.treatment,
    line: p.line,
    floor: p.floor,
    relief: p.relief,
    ...(p.simplify && { simplify: true }),
    ...(p.faceDown && { faceDown: true }),
  },
  lines: p.lines,
  rim: p.rim,
  ...(p.rim !== "motif" && p.clip !== undefined && { clip: p.clip }),
  ...(p.grid !== undefined && { grid: p.grid }),
  profile: {
    ...structuredClone(p.profile),
    sources: structuredClone(defaultProfile(p.profile.id)?.sources ?? []),
  },
});

// Each field's label, units included, by its request path: errors are
// shown under the control with that label.
export function physicalLabel(
  field: string,
  p: Pick<LacePhysical, "treatment" | "rim">,
): string | undefined {
  const raised = p.treatment === "raised";
  const labels: Record<string, string> = {
    diameter: "Diameter (mm)",
    "design.treatment": "Treatment",
    "design.line": raised ? "Line width (mm)" : "Groove width (mm)",
    "design.floor": "Floor (mm)",
    "design.relief": raised ? "Relief (mm)" : "Depth (mm)",
    lines: "Lines",
    rim: "Rim",
    clip:
      p.rim === "crop"
        ? "Crop radius (of the disk)"
        : "Rim radius (of the disk)",
    grid: "Grid step (mm)",
    "profile.envelope.0": "Bed width (mm)",
    "profile.envelope.1": "Bed depth (mm)",
    "profile.envelope.2": "Build height (mm)",
    "profile.nozzle": "Nozzle (mm)",
    "profile.extrusionWidth": "Extrusion width (mm)",
    "profile.layerHeight": "Layer height (mm)",
    "profile.firstLayer": "First layer (mm)",
    "profile.xyDetail": "Finest wall (mm)",
    "profile.xyGap": "Finest gap (mm)",
    "profile.zDetail": "Finest height step (mm)",
    "profile.wall": "Minimum wall (mm)",
    "profile.strut": "Minimum raised line (mm)",
    "profile.floor": "Minimum floor (mm)",
    "profile.gap": "Minimum gap (mm)",
  };
  return labels[field];
}

// The profile's length fields in the order the workshop shows them.
export const profileLengths: readonly ProfileLength[] = [
  "wall",
  "strut",
  "gap",
  "floor",
  "xyDetail",
  "xyGap",
  "zDetail",
  "nozzle",
  "extrusionWidth",
  "layerHeight",
  "firstLayer",
];

// A required value left empty, or not yet a number, found before Go is
// asked, by its field; Go checks every range.
export function physicalProblem(
  p: LacePhysical,
): { field: string; message: string } | undefined {
  const values: [string, number | undefined][] = [
    ["diameter", p.diameter],
    ["design.line", p.line],
    ["design.floor", p.floor],
    ["design.relief", p.relief],
    ...(p.rim === "crop"
      ? [["clip", p.clip] as [string, number | undefined]]
      : []),
    ...p.profile.envelope.map(
      (v, i) => [`profile.envelope.${i}`, v] as [string, number],
    ),
    ...profileLengths.map(
      (k) => [`profile.${k}`, p.profile[k]] as [string, number],
    ),
  ];
  for (const [field, v] of values)
    if (v === undefined || !Number.isFinite(v))
      return {
        field,
        message:
          field === "clip"
            ? "Enter a fraction of the disk's radius."
            : "Enter a length in millimeters.",
      };
  return undefined;
}
