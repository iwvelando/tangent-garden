// The 4D notebook's study in a portable link (see ../study-link.ts).
import {
  animationTiming,
  conform,
  durationRange,
  LinkError,
  type SchemaOf,
  type Timing,
} from "../study-link";
import { objects, defaultConfig } from "./objects";
import {
  initialView,
  motions,
  type Bypass,
  type Config,
  type Layers,
  type Lift,
  type Motion,
  type Object4,
  type Vec3,
  type View,
  type Weave,
} from "./types";

export type TesseractStudy = {
  config: Config;
  layers: Layers;
  // The shadow's camera, and the coordinate diagram's beside it.
  view: View;
  diagramView: View;
  motion: Motion;
  duration: number;
} & Timing;

const vec3 = { tuple: "number", length: 3 } satisfies SchemaOf<Vec3>;
const lift = {
  fields: {
    center: vec3,
    support: "number",
    height: "number",
    angle: "number",
    from: vec3,
    to: vec3,
    radiusFrom: "number",
    radiusTo: "number",
  },
} satisfies SchemaOf<Lift>;
const bypass = {
  fields: {
    inner: "number",
    outer: "number",
    extent: "number",
    outside: vec3,
    height: "number",
    position: "number",
    obstacle: { options: { embedded: true, radial: true } },
    w1: "number",
    w2: "number",
  },
} satisfies SchemaOf<Bypass>;
const weave = {
  fields: {
    family: { options: { tori: true, fibers: true } },
    alpha: "number",
    spread: "number",
    alphaFrom: "number",
    alphaTo: "number",
  },
} satisfies SchemaOf<Weave>;
const config: SchemaOf<Config> = {
  fields: {
    object: {
      options: Object.fromEntries(
        Object.keys(objects).map((k) => [k, true]),
      ) as Record<Object4, true>,
    },
    radius: "number",
    tube: "number",
    curves: "number",
    mode: {
      options: {
        perspective: true,
        orthographic: true,
        stereo: true,
        section: true,
        reference: true,
        lifted: true,
        shadow: true,
        diagram: true,
        paired: true,
      },
    },
    lift: { optional: lift },
    bypass: { optional: bypass },
    weave: { optional: weave },
    angles: { tuple: "number", length: 6 },
    distance: "number",
    slice: "number",
    spread: "number",
    count: "number",
    grid: "number",
    samples: "number",
    clip: "number",
  },
};
const view: SchemaOf<View> = {
  fields: {
    yaw: "number",
    pitch: { range: [-1.5, 1.5] },
    zoom: { range: [0.2, 8] },
    panX: "number",
    panY: "number",
  },
};
const layers: SchemaOf<Layers> = {
  fields: {
    edges: "boolean",
    guides: "boolean",
    faces: "boolean",
    selectedSection: { optional: "number" },
    missingGuide: { optional: "boolean" },
    connectors: { optional: "boolean" },
    comparison: { optional: "boolean" },
  },
};
const defaultLayers: Layers = {
  edges: true,
  guides: true,
  faces: true,
  selectedSection: 0,
};

export function tesseractStudy(value: unknown): TesseractStudy {
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
        "diagramView",
        "motion",
        "duration",
        "repeat",
        "pace",
      ].includes(key)
    )
      throw new LinkError(key, `${key} is not a known field.`);
  // The object decides its defaults, including its own parameters.
  const object = conform<Object4>(
    (raw.config as Record<string, unknown> | undefined)?.object,
    config.fields.object,
    "tesseract",
    "config.object",
  );
  const descriptor = objects[object];
  const defaults = descriptor.defaults(defaultConfig);
  const read = conform(raw.config, config, defaults, "config");
  const key = descriptor.parameterKey;
  if (key && !read[key])
    Object.assign(read, { [key]: structuredClone(defaults[key]) });
  if (!descriptor.modes.includes(read.mode))
    throw new LinkError(
      "config.mode",
      `config.mode must be one of ${descriptor.modes.join(", ")} for this object.`,
    );
  const motion = conform<string>(
    raw.motion,
    "text",
    descriptor.motion,
    "motion",
  );
  const choices = motions(read),
    offered = choices.map((m) => m.value as string);
  if (!offered.includes(motion))
    throw new LinkError(
      "motion",
      `motion must be one of ${offered.join(", ")} for this study.`,
    );
  const timing = animationTiming(raw, "");
  if (
    timing.repeat === "loop" &&
    !choices.find((m) => m.value === motion)!.loops
  )
    throw new LinkError(
      "repeat",
      "repeat loops only a whole turn or a slice passage, which can return to their start.",
    );
  return {
    config: read,
    layers: conform(raw.layers, layers, defaultLayers, "layers"),
    view: conform(raw.view, view, initialView, "view"),
    diagramView: conform(raw.diagramView, view, initialView, "diagramView"),
    motion: motion as Motion,
    duration: conform<number>(
      raw.duration,
      { range: durationRange },
      12,
      "duration",
    ),
    ...timing,
  };
}
