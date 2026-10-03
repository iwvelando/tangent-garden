// The 2D notebook's study in a portable link (see study-link.ts).
import {
  animationSettings,
  conform,
  flags,
  LinkError,
  type AnimationSettings,
  type SchemaOf,
} from "./study-link";
import {
  maxPursuers,
  maxSeeds,
  maxTerms,
  type Bounds,
  type Config,
  type Kind,
  type PoleKind,
  type Vec,
  type Window,
} from "./types";
import { presets } from "./presets";
import {
  availableTargets,
  canTrace,
  type AnimationMode,
  type Target,
} from "./animation";
import type { Layers } from "./Plot";

// The manual camera, offset from the fitted framing, which the drawing
// derives deterministically from the study: pixels of pan and a zoom factor.
export type PlotCamera = { x: number; y: number; zoom: number };
export const zoomRange: [number, number] = [0.1, 20];
export type PlanarAnimation = AnimationSettings<AnimationMode, Target>;
export type PlanarStudy = {
  config: Config;
  // Domain bounds as entered, so constant expressions such as 2*pi survive.
  bounds: Bounds;
  // Ray length in optical studies, as a multiple of the drawing's span.
  length: number;
  // The pole construction remembered while another tab is chosen.
  poleKind: PoleKind;
  layers: Layers;
  camera: PlotCamera;
  animation: PlanarAnimation;
};
export const defaultLayers: Layers = {
  base: true,
  derived: true,
  lines: true,
  incident: true,
  virtual: true,
  axes: false,
};
export const defaultAnimation: PlanarAnimation = {
  mode: "reveal",
  camera: "hold",
  duration: 10,
  tracks: [],
};

const vec = { fields: { x: "number", y: "number" } } satisfies SchemaOf<Vec>;
const window = {
  fields: { xMin: "number", xMax: "number", yMin: "number", yMax: "number" },
} satisfies SchemaOf<Window>;
const family = {
  fields: { enabled: "boolean", from: "number", to: "number", count: "number" },
} as const;
const kinds = {
  evolute: true,
  involute: true,
  catacaustic: true,
  diacaustic: true,
  offset: true,
  rolling: true,
  envelope: true,
  inversion: true,
  pedal: true,
  contrapedal: true,
  orthotomic: true,
} satisfies Record<Kind, true>;
const poleKinds = {
  pedal: true,
  contrapedal: true,
  orthotomic: true,
} satisfies Record<PoleKind, true>;
const config: SchemaOf<Config> = {
  fields: {
    kind: { options: kinds },
    curve: {
      fields: {
        format: {
          options: {
            parametric: true,
            cartesian: true,
            polar: true,
            roulette: true,
            lissajous: true,
            fourier: true,
            pursuit: true,
            field: true,
            implicit: true,
            attractor: true,
          },
        },
        x: "text",
        y: "text",
        r: "text",
        min: "number",
        max: "number",
        a: "number",
        roulette: {
          fields: {
            roll: { options: { inside: true, outside: true, line: true } },
            fixedRadius: "number",
            radius: "number",
            arm: "number",
            phase: "number",
          },
        },
        lissajous: {
          fields: {
            amplitudeX: "number",
            amplitudeY: "number",
            frequencyX: "number",
            frequencyY: "number",
            phase: "number",
          },
        },
        terms: {
          list: {
            fields: { frequency: "number", radius: "number", phase: "number" },
          },
          max: maxTerms,
        },
        pursuit: {
          fields: {
            pursuers: {
              list: { fields: { x: "number", y: "number", speed: "number" } },
              max: maxPursuers,
            },
            capture: "number",
          },
        },
        field: {
          fields: {
            x: "text",
            y: "text",
            seeds: { list: vec, max: maxSeeds },
            escape: "number",
          },
        },
        implicit: {
          fields: {
            f: "text",
            level: "number",
            family,
            window,
            cells: "number",
          },
        },
        attractor: {
          fields: {
            map: { options: { clifford: true, dejong: true, henon: true } },
            a: "number",
            b: "number",
            c: "number",
            d: "number",
            start: vec,
            discard: "number",
            iterates: "number",
            fit: "boolean",
            window,
            cells: "number",
          },
        },
      },
    },
    source: {
      fields: {
        kind: { options: { point: true, parallel: true } },
        position: vec,
        angle: "number",
        coordinates: {
          optional: { options: { cartesian: true, polar: true } },
        },
        radius: { optional: "number" },
        theta: { optional: "number" },
      },
    },
    nIncident: "number",
    pole: vec,
    nTransmitted: "number",
    offset: "number",
    distance: "number",
    stack: family,
    circles: "boolean",
    rolling: {
      fields: {
        side: { options: { left: true, right: true } },
        shape: { options: { circle: true, curve: true } },
        radius: "number",
        arm: "number",
        phase: "number",
        curve: {
          fields: {
            x: "text",
            y: "text",
            min: "number",
            max: "number",
            start: "number",
          },
        },
        point: vec,
      },
    },
    envelope: {
      fields: {
        mode: { options: { angle: true, chord: true, circle: true } },
        angle: "text",
        x: "text",
        y: "text",
        extend: "boolean",
        radius: "text",
      },
    },
    inversion: { fields: { center: vec, radius: "number" } },
    input: {
      options: {
        curve: true,
        evolute: true,
        offset: true,
        ...poleKinds,
      },
    },
    samples: "number",
    lines: "number",
  },
};

// The study a link describes, or a LinkError naming the first bad field.
export function planarStudy(value: unknown): PlanarStudy {
  if (typeof value !== "object" || value === null || Array.isArray(value))
    throw new LinkError(
      "study",
      "This link's study must be a group of fields.",
    );
  const raw = value as Record<string, unknown>;
  for (const key of Object.keys(raw))
    if (
      ![
        "config",
        "bounds",
        "length",
        "poleKind",
        "layers",
        "camera",
        "animation",
      ].includes(key)
    )
      throw new LinkError(key, `${key} is not a known field.`);
  const conformed = conform(raw.config, config, presets[0].config, "config");
  // A polar source's radius or angle that the link leaves out reads as 0, as
  // its field shows it and as Go takes it; a Cartesian source keeps them
  // absent.
  const source = conformed.source;
  const study = {
    config:
      source.coordinates === "polar"
        ? {
            ...conformed,
            source: {
              ...source,
              radius: source.radius ?? 0,
              theta: source.theta ?? 0,
            },
          }
        : conformed,
    bounds: conform<Bounds>(
      raw.bounds,
      { fields: { min: "text", max: "text" } },
      undefined,
      "bounds",
    ),
    length: conform<number>(raw.length, { range: [0.1, 3] }, 0.8, "length"),
    poleKind: conform<PoleKind>(
      raw.poleKind,
      { options: poleKinds },
      "pedal",
      "poleKind",
    ),
    layers: conform(raw.layers, flags(defaultLayers), defaultLayers, "layers"),
    camera: conform<PlotCamera>(
      raw.camera,
      { fields: { x: "number", y: "number", zoom: { range: zoomRange } } },
      { x: 0, y: 0, zoom: 1 },
      "camera",
    ),
  };
  const animation = animationSettings(
    raw.animation,
    { reveal: true, parameters: true, trace: true },
    availableTargets(study.config),
    defaultAnimation,
  );
  if (animation.mode === "trace" && !canTrace(study.config))
    throw new LinkError(
      "animation.mode",
      "animation.mode traces light only in a catacaustic or diacaustic.",
    );
  return { ...study, animation };
}
