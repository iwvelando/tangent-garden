// The 3D notebook's study in a portable link (see ../study-link.ts).
import {
  animationSettings,
  animationTiming,
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
import { lensAngles, projections, type Projection } from "./scene";
import {
  availableTargets,
  type AnimationMode,
  type CameraMode,
  type Target,
} from "./animation";
import {
  defaultProbe,
  gridded,
  probeSupport,
  probeTarget,
  type Probe,
  type ProbeMotion,
} from "./probe";
import { cutPlane, defaultCut, maxCutValue, type Cut } from "./cut";
import { defaultSight, legacyWeight, opacityRange, type Sight } from "./sight";
import { lineWeightSchema } from "../line-weight";
import { probeMotionSchema } from "../probe";
import {
  defaultPath,
  maxKeyName,
  maxKeys,
  maxTurns,
  pitchRange,
  zoomRange,
  type CameraPath,
} from "./path";
import { defaultRide, rideRange, type Ride } from "./ride";
import type { Pace, Repeat } from "../timing";
import { loops } from "./loop";

// The manual camera: orbit angles in radians, zoom, and pan, about the
// bounds the study itself determines.
export type SpatialCamera = typeof initialView;
// The camera path, flown by the path mode or as the animation camera while
// the geometry moves, travels with the animation setup; links made before
// it fly none.
export type SpatialAnimation = Omit<
  AnimationSettings<AnimationMode, Target>,
  "camera"
> & {
  camera: CameraMode;
  path: CameraPath;
  // The ray the camera rides while light is traced; links made before it
  // ride the default when asked to.
  ride: Ride;
  // How the duration is spent (see timing.ts); links made before it play
  // once, steadily.
  repeat: Repeat;
  pace: Pace;
  // How the probe moves while parameters vary; links made before it keep
  // it at its t, or its row and column.
  probeMotion: ProbeMotion;
};
export type SpatialStudy = {
  config: SpatialConfig;
  layers: Layers;
  view: SpatialCamera;
  animation: SpatialAnimation;
  // The parameter probe, off in links made before it.
  probe: Probe;
  // The cutaway plane, off in links made before it.
  cut: Cut;
  // Seeing through sheets, opaque and hiding hidden lines in links made
  // before it, and the line weight, hairlines in links made before it.
  sight: Sight;
  // The manual camera's projection, orthographic in links made before it.
  projection: Projection;
  // The chosen lens's angle in degrees, kept while a named lens is shown;
  // the normal lens's in links made before it.
  lensAngle: number;
};
export const defaultAnimation: SpatialAnimation = {
  mode: "reveal",
  camera: "hold",
  duration: 10,
  tracks: [],
  path: defaultPath,
  ride: defaultRide,
  repeat: "once",
  pace: "steady",
  probeMotion: "stays",
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
    input: {
      options: {
        base: true,
        "tangent-foot": true,
        orthotomic: true,
        involute: true,
      },
    },
    unwinding: { fields: { anchor: "number", offset: "number" } },
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
        refine: "number",
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
    adaptive: "boolean",
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

// The probe's place, as fractions along the base's samples (or a
// surface's rows) and across a surface's columns, and what it describes.
const probe: SchemaOf<Probe> = {
  fields: {
    enabled: "boolean",
    position: { range: [0, 1] },
    target: {
      options: { curve: true, surface: true, light: true, mirror: true },
    },
    across: { range: [0, 1] },
  },
};

// The cutaway plane, within the limits its fields enforce.
const bounded: { range: [number, number] } = {
  range: [-maxCutValue, maxCutValue],
};
const cut: SchemaOf<Cut> = {
  fields: {
    enabled: "boolean",
    normal: { fields: { x: bounded, y: bounded, z: bounded } },
    offset: bounded,
    cuts: { options: { surface: true, sheets: true, all: true } },
    edge: "boolean",
  },
};

// Key views within the drawing's own orbit and zoom limits; turns are
// checked to be whole below.
const path: SchemaOf<CameraPath> = {
  fields: {
    style: { options: { steady: true, smooth: true } },
    keys: {
      list: {
        fields: {
          name: "text",
          yaw: "number",
          pitch: { range: pitchRange },
          zoom: { range: zoomRange },
          panX: "number",
          panY: "number",
          turns: { range: [-maxTurns, maxTurns] },
        },
      },
      max: maxKeys,
    },
  },
};
function cameraPath(value: unknown): CameraPath {
  const out = conform(value, path, defaultPath, "animation.path");
  out.keys.forEach((key, k) => {
    const field = `animation.path.keys[${k}]`;
    if (key.name.length > maxKeyName)
      throw new LinkError(
        `${field}.name`,
        `${field}.name is too long (at most ${maxKeyName} characters).`,
      );
    if (!Number.isInteger(key.turns))
      throw new LinkError(
        `${field}.turns`,
        `${field}.turns must be a whole number.`,
      );
    if (k === 0 && key.turns !== 0)
      throw new LinkError(
        `${field}.turns`,
        `${field}.turns must be 0: the first view has no leg before it.`,
      );
  });
  return out;
}

// The ride's crossing, −1 for the middle one, and its distances within
// their limits; the lower limit itself is refused below.
const crossing: { range: [number, number] } = { range: [-1, 100000] };
const ride: SchemaOf<Ride> = {
  fields: {
    i: crossing,
    j: crossing,
    follow: { range: rideRange },
    turn: { range: rideRange },
  },
};
function riding(value: unknown): Ride {
  const out = conform(value, ride, defaultRide, "animation.ride");
  for (const key of ["i", "j"] as const)
    if (!Number.isInteger(out[key]))
      throw new LinkError(
        `animation.ride.${key}`,
        `animation.ride.${key} must be a whole number.`,
      );
  for (const key of ["follow", "turn"] as const)
    if (!(out[key] > rideRange[0]))
      throw new LinkError(
        `animation.ride.${key}`,
        `animation.ride.${key} must be more than ${rideRange[0]}.`,
      );
  return out;
}

const sight: SchemaOf<Sight> = {
  fields: {
    sheets: { options: { opaque: true, through: true } },
    opacity: { range: opacityRange },
    hidden: { options: { hide: true, faint: true, dashed: true } },
    weight: lineWeightSchema,
  },
};

const motion = probeMotionSchema;

const projection: SchemaOf<Projection> = {
  options: Object.fromEntries(
    Object.keys(projections).map((p) => [p, true]),
  ) as Record<Projection, true>,
};

// The chosen lens's angle, in the whole degrees its slider moves by.
function wholeAngle(value: unknown) {
  const out = conform(
    value,
    { range: [lensAngles.min, lensAngles.max] },
    lensAngles.initial,
    "lensAngle",
  );
  if (!Number.isInteger(out))
    throw new LinkError("lensAngle", "lensAngle must be a whole number.");
  return out;
}

export function spatialStudy(value: unknown): SpatialStudy {
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
        "layers",
        "view",
        "animation",
        "probe",
        "cut",
        "sight",
        "projection",
        "lensAngle",
      ].includes(key)
    )
      throw new LinkError(key, `${key} is not a known field.`);
  const study = {
    config: conform(raw.config, config, spatialPresets[0].config, "config"),
    layers: conform(raw.layers, flags(defaultLayers), defaultLayers, "layers"),
    view: conform(raw.view, view, initialView, "view"),
  };
  // The path, and the camera that flies it, are the 3D notebook's own part
  // of the animation setup.
  const grouped =
    typeof raw.animation === "object" &&
    raw.animation !== null &&
    !Array.isArray(raw.animation);
  const {
    path: flight,
    ride: rode,
    repeat,
    pace,
    probeMotion,
    ...shared
  } = grouped ? (raw.animation as Record<string, unknown>) : {};
  const flying = shared.camera === "path",
    rides = shared.camera === "ride";
  if (flying || rides) delete shared.camera;
  const settings = animationSettings(
    grouped ? shared : raw.animation,
    {
      reveal: true,
      parameters: true,
      orbit: true,
      trace: true,
      probe: true,
      cut: true,
      path: true,
    },
    availableTargets(study.config),
    { ...defaultAnimation, camera: "hold" },
  );
  const animation: SpatialAnimation = {
    ...settings,
    ...(flying && { camera: "path" }),
    ...(rides && { camera: "ride" }),
    path: cameraPath(flight),
    ride: riding(rode),
    ...animationTiming({ repeat, pace }, "animation"),
    probeMotion: conform(
      probeMotion,
      motion,
      defaultAnimation.probeMotion,
      "animation.probeMotion",
    ),
  };
  if (animation.repeat === "loop" && !loops(animation.mode))
    throw new LinkError(
      "animation.repeat",
      "animation.repeat loops only an orbit, parameter tracks, the probe or a camera path, which can return to their start.",
    );
  if (rides && animation.mode !== "trace")
    throw new LinkError(
      "animation.camera",
      "animation.camera rides a ray only while light is traced.",
    );
  if (flying && animation.mode === "orbit")
    throw new LinkError(
      "animation.camera",
      "animation.camera flies key views only while the geometry moves, not while the orbit turns the camera.",
    );
  if (animation.mode === "trace" && study.config.format !== "rays")
    throw new LinkError(
      "animation.mode",
      "animation.mode traces light only in a mirror or interface study.",
    );
  const probed = conform(raw.probe, probe, defaultProbe, "probe");
  // A surface patch offered no probe before the probe had a target, so a
  // link from then opens without it, as it drew.
  if (
    study.config.format === "surface" &&
    typeof raw.probe === "object" &&
    raw.probe !== null &&
    !("target" in raw.probe)
  )
    probed.enabled = false;
  // A mirror or interface had no probe before it could describe the light
  // or the mirror, so a link from then, whose probe describes something
  // else, opens without it, as it drew.
  if (
    study.config.format === "rays" &&
    probed.target !== "light" &&
    probed.target !== "mirror"
  )
    probed.enabled = false;
  if (
    animation.mode === "probe" &&
    !(probed.enabled && probeSupport(study.config).available)
  )
    throw new LinkError(
      "animation.mode",
      "animation.mode moves the probe only while it is on in a study that offers it.",
    );
  // A grid has rows, not a length: its probe stays, as the panel's does.
  if (
    animation.probeMotion === "length" &&
    gridded(probeTarget(study.config, probed))
  )
    animation.probeMotion = "stays";
  const cutting = conform(raw.cut, cut, defaultCut, "cut");
  if (cutting.enabled && "message" in cutPlane(cutting))
    throw new LinkError("cut.normal", "cut.normal must not be zero.");
  if (animation.mode === "cut" && !cutting.enabled)
    throw new LinkError(
      "animation.mode",
      "animation.mode peels with the cut only while the cut is on.",
    );
  return {
    ...study,
    animation,
    probe: probed,
    cut: cutting,
    sight: conform(
      raw.sight,
      sight,
      { ...defaultSight, weight: legacyWeight },
      "sight",
    ),
    projection: conform(
      raw.projection,
      projection,
      "orthographic",
      "projection",
    ),
    lensAngle: wholeAngle(raw.lensAngle),
  };
}
