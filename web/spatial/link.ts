// The 3D notebook's study in a portable link (see ../study-link.ts).
import {
  animationSettings,
  conform,
  flags,
  LinkError,
  type AnimationSettings,
  type SchemaOf,
} from "../study-link";
import {
  maxHarmonicTerms,
  maxSpatialPursuers,
  maxSpatialSeeds,
  type SpatialConfig,
  type Vec3,
} from "./types";
import { spatialPresets } from "./presets";
import { defaultLayers, initialView, type Layers } from "./renderer";
import { availableTargets, type AnimationMode, type Target } from "./animation";

// The manual camera: orbit angles in radians, zoom, and pan, about the
// bounds the study itself determines.
export type SpatialCamera = typeof initialView;
export type SpatialAnimation = AnimationSettings<AnimationMode, Target>;
export type SpatialStudy = {
  config: SpatialConfig;
  layers: Layers;
  view: SpatialCamera;
  animation: SpatialAnimation;
};
export const defaultAnimation: SpatialAnimation = {
  mode: "reveal",
  camera: "hold",
  duration: 10,
  tracks: [],
};

const vec3 = {
  fields: { x: "number", y: "number", z: "number" },
} satisfies SchemaOf<Vec3>;
const family = {
  fields: { enabled: "boolean", from: "number", to: "number", count: "number" },
} as const;
const config: SchemaOf<SpatialConfig> = {
  fields: {
    format: {
      options: {
        torus: true,
        parametric: true,
        harmonic: true,
        field: true,
        pursuit: true,
        surface: true,
        rays: true,
        implicit: true,
      },
    },
    construction: {
      options: {
        developable: true,
        involute: true,
        "tangent-foot": true,
        orthotomic: true,
        inversion: true,
        framed: true,
        ruled: true,
        canal: true,
        none: true,
      },
    },
    pole: vec3,
    inversion: {
      fields: {
        center: vec3,
        radius: "number",
        input: {
          options: { base: true, "tangent-foot": true, orthotomic: true },
        },
      },
    },
    involute: { fields: { anchor: "number", offset: "number", family } },
    harmonic: {
      fields: {
        center: vec3,
        terms: {
          list: { fields: { frequency: "number", cosine: vec3, sine: vec3 } },
          max: maxHarmonicTerms,
        },
        min: "number",
        max: "number",
      },
    },
    frame: {
      fields: {
        kind: { options: { "rotation-minimizing": true, frenet: true } },
        reference: vec3,
        angle: "number",
        twist: "number",
        offset: "number",
        width: "number",
        strands: "number",
        closure: { options: { seam: true, distribute: true } },
      },
    },
    ruled: {
      fields: {
        partner: { options: { chord: true, thread: true } },
        thread: { fields: { x: "text", y: "text", z: "text" } },
        rate: "number",
        shift: "number",
      },
    },
    canal: {
      fields: { radius: "number", profile: "text", meridians: "number" },
    },
    field: {
      fields: {
        x: "text",
        y: "text",
        z: "text",
        seeds: { list: vec3, max: maxSpatialSeeds },
        escape: "number",
        min: "number",
        max: "number",
        a: "number",
      },
    },
    pursuit: {
      fields: {
        pursuers: {
          list: {
            fields: { x: "number", y: "number", z: "number", speed: "number" },
          },
          max: maxSpatialPursuers,
        },
        capture: "number",
        min: "number",
        max: "number",
      },
    },
    surface: {
      fields: {
        kind: {
          options: {
            ellipsoid: true,
            torus: true,
            cylinder: true,
            paraboloid: true,
            monkey: true,
          },
        },
        a: "number",
        b: "number",
        c: "number",
        uMin: "number",
        uMax: "number",
        vMin: "number",
        vMax: "number",
        uSamples: "number",
        vSamples: "number",
        curves: "number",
        reverse: "boolean",
        offset: "number",
        reach: "number",
      },
    },
    rays: {
      fields: {
        interaction: { options: { reflect: true, refract: true } },
        n1: "number",
        n2: "number",
        light: { options: { parallel: true, point: true } },
        azimuth: "number",
        elevation: "number",
        source: vec3,
        length: "number",
        receiver: {
          fields: {
            plane: { options: { none: true, x: true, y: true, z: true } },
            at: "number",
            c1: "number",
            c2: "number",
            size: "number",
            bins: "number",
          },
        },
      },
    },
    implicit: {
      fields: {
        f: "text",
        a: "number",
        level: "number",
        box: {
          fields: {
            xMin: "number",
            xMax: "number",
            yMin: "number",
            yMax: "number",
            zMin: "number",
            zMax: "number",
          },
        },
        cells: "number",
        sections: {
          fields: {
            normal: vec3,
            from: "number",
            to: "number",
            count: "number",
          },
        },
      },
    },
    curve: {
      fields: {
        x: "text",
        y: "text",
        z: "text",
        min: "number",
        max: "number",
        a: "number",
      },
    },
    radius: "number",
    tube: "number",
    length: "number",
    p: "number",
    q: "number",
    samples: "number",
    lines: "number",
  },
};

// The orbit and zoom limits of the drawing's own controls.
const view: SchemaOf<SpatialCamera> = {
  fields: {
    yaw: "number",
    pitch: { range: [-1.5, 1.5] },
    zoom: { range: [0.2, 8] },
    panX: "number",
    panY: "number",
  },
};

export function spatialStudy(value: unknown): SpatialStudy {
  if (typeof value !== "object" || value === null || Array.isArray(value))
    throw new LinkError(
      "study",
      "This link's study must be a group of fields.",
    );
  const raw = value as Record<string, unknown>;
  for (const key of Object.keys(raw))
    if (!["config", "layers", "view", "animation"].includes(key))
      throw new LinkError(key, `${key} is not a known field.`);
  const study = {
    config: conform(raw.config, config, spatialPresets[0].config, "config"),
    layers: conform(raw.layers, flags(defaultLayers), defaultLayers, "layers"),
    view: conform(raw.view, view, initialView, "view"),
  };
  const animation = animationSettings(
    raw.animation,
    { reveal: true, parameters: true, orbit: true, trace: true },
    availableTargets(study.config),
    defaultAnimation,
  );
  if (animation.mode === "trace" && study.config.format !== "rays")
    throw new LinkError(
      "animation.mode",
      "animation.mode traces light only in a mirror or interface study.",
    );
  return { ...study, animation };
}
