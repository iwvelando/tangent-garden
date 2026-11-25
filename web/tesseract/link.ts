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
import { tesseractPresets } from "./presets";
import { lineWeightSchema } from "../line-weight";
import { maxPhases, maxPhraseTracks } from "../phrase-timeline";
import { maxPolygonVertices } from "../sphere-polygon";
import {
  maxTurns,
  pitchLimit,
  tesseractPhraseError,
  tesseractPhraseTargets,
  zoomLimits,
  type TesseractPhrase,
  type TesseractPhrasePhase,
  type TesseractPhraseView,
} from "./phrase";
import {
  initialView,
  motions,
  type Bypass,
  type DualPair,
  type Config,
  type Layers,
  type Lift,
  type Motion,
  type Object4,
  type Vec3,
  type View,
  type Weave,
  type Root,
  type TesseractTarget,
} from "./types";

export type TesseractStudy = {
  config: Config;
  layers: Layers;
  // The shadow's camera, and the coordinate diagram's beside it.
  view: View;
  diagramView: View;
  motion: Motion;
  duration: number;
  // The phrase Play a phrase plays (./phrase.ts); links and examples made
  // before phrases have none.
  phrase?: TesseractPhrase;
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
    // Base sphere and fibers: the selected sample, absent (0) in older
    // links and in every other weave.
    selected: { optional: { range: [0, 31] } },
    // Only playback moves the traced point, so a link never carries an
    // offset: 0 is the only value it accepts.
    trace: { optional: { range: [0, 0] } },
    path: {
      optional: {
        options: {
          latitude: true,
          flower: true,
          "great-circle": true,
          lissajous: true,
          polygon: true,
        },
      },
    },
    amplitude: { optional: "number" },
    petals: { optional: "number" },
    tilt: { optional: "number" },
    azimuthal: { optional: "number" },
    polar: { optional: "number" },
    // A geodesic polygon's vertices, absent in older links. Like the other
    // paths' fields, they stay in a study while another path is chosen.
    vertices: {
      optional: {
        list: { fields: { u: "number", v: "number" } },
        max: maxPolygonVertices,
      },
    },
    // Fiber sampling, absent (the whole path) in older links. The
    // neighborhood's fields stay in a study under the whole path.
    sampling: { optional: { options: { path: true, neighborhood: true } } },
    width: { optional: "number" },
    nearby: { optional: "number" },
    // A carried marked point, absent (off) in older links, and its
    // starting phase, kept while the point is not carried.
    transport: { optional: "boolean" },
    phase: { optional: "number" },
  },
} satisfies SchemaOf<Weave>;
// The root journey. Only playback moves the point, so a link
// carries no progress: 0 is the only value it accepts.
const root = {
  fields: {
    radius: "number",
    // The circle's center; absent in links made before translated
    // circles, which open the origin circle they drew.
    offset: { optional: "number" },
    direction: { optional: "number" },
    // The degree and the initial sheet's turn, absent in links made before
    // higher roots, which open the square root they drew. The worker
    // refuses a fractional degree or turn, or a turn of n or more, by name.
    degree: { optional: { range: [2, 6] } },
    branch: { optional: { range: [0, 5] } },
    sheet: { options: { plus: true, minus: true } },
    from: "number",
    to: "number",
    trace: { optional: { range: [0, 0] } },
  },
} satisfies SchemaOf<Root>;
// The 24-cell: its selected cell, counted from 0, and how much it draws.
// The worker refuses a fractional cell by name.
const cell24 = {
  fields: {
    selected: { range: [0, 23] },
    view: { options: { cell: true, crystal: true } },
    emphasis: { optional: { range: [0, 0] } },
  },
} satisfies SchemaOf<DualPair>;
// The tesseract and its 16-cell: one of the tesseract's eight cubes.
const cell16 = {
  fields: {
    selected: { range: [0, 7] },
    view: { options: { cell: true, crystal: true } },
    emphasis: { optional: { range: [0, 0] } },
  },
} satisfies SchemaOf<DualPair>;
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
        // Only a pane of the weave's paired views; no object offers it.
        base: true,
      },
    },
    lift: { optional: lift },
    bypass: { optional: bypass },
    weave: { optional: weave },
    cell24: { optional: cell24 },
    cell16: { optional: cell16 },
    root: { optional: root },
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
    weight: { optional: lineWeightSchema },
  },
};
export const defaultLayers: Layers = {
  edges: true,
  guides: true,
  faces: true,
  selectedSection: 0,
};

export const defaultDuration = 12;
// The study an example opens: its own fields, and the notebook's defaults
// for every other, so that nothing of the study before it remains.
export function presetStudy(index: number): TesseractStudy {
  const preset = tesseractPresets[index];
  return {
    config: structuredClone(preset.config),
    layers: { ...defaultLayers },
    view: { ...(preset.view ?? initialView) },
    diagramView: { ...(preset.diagramView ?? initialView) },
    motion: preset.motion,
    duration: defaultDuration,
    repeat: preset.repeat ?? "once",
    pace: preset.pace ?? "steady",
    ...(preset.phrase && { phrase: structuredClone(preset.phrase) }),
  };
}

// A phrase over the linked study: its tracks among the values the study
// offers a phrase, every phase within the shared limits, each camera key
// within the drawing's orbit and zoom limits, or "entry", and each cut a
// selection the study shows.
function linkedPhrase(value: unknown, config: Config): TesseractPhrase {
  const offered = tesseractPhraseTargets(config);
  if (!offered.length)
    throw new LinkError("phrase", "This study does not offer a phrase.");
  const targetOptions = {
    options: Object.fromEntries(offered.map((t) => [t, true])) as Record<
      TesseractTarget,
      true
    >,
  };
  type Phases = Omit<TesseractPhrase, "phases"> & {
    phases: Omit<TesseractPhrasePhase, "view" | "companionView">[];
  };
  const schema: SchemaOf<Phases> = {
    fields: {
      target: targetOptions,
      // Further parameters; tesseractPhraseError refuses repeats.
      also: { optional: { list: targetOptions, max: maxPhraseTracks - 1 } },
      phases: {
        list: {
          fields: {
            name: "text",
            duration: { range: [0.1, 3600] },
            pace: { options: { steady: true, ease: true } },
            key: { optional: "text" },
            keys: {
              optional: {
                fields: Object.fromEntries(
                  offered.map((t) => [t, { optional: "text" }]),
                ) as Record<TesseractTarget, { optional: "text" }>,
              },
            },
            selected: { optional: { range: [0, 255] } },
          },
        },
        max: maxPhases,
      },
    },
  };
  // A camera key is a view or "entry", which the schema cannot state as
  // one field: each is checked on its own below.
  const record =
    typeof value === "object" && value !== null && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : undefined;
  const rawPhases = Array.isArray(record?.phases) ? record.phases : undefined;
  const panes = ["view", "companionView"] as const;
  const keyed = rawPhases?.map((p) =>
    typeof p === "object" && p !== null && !Array.isArray(p)
      ? panes.map((pane) => (p as Record<string, unknown>)[pane])
      : [undefined, undefined],
  );
  const phrase: TesseractPhrase = conform<Phases>(
    rawPhases
      ? {
          ...record,
          phases: rawPhases.map((p) => {
            if (typeof p !== "object" || p === null || Array.isArray(p))
              return p;
            const {
              view: _,
              companionView: __,
              ...rest
            } = p as Record<string, unknown>;
            return rest;
          }),
        }
      : value,
    schema,
    undefined,
    "phrase",
  );
  keyed?.forEach((views, i) =>
    views.forEach((key, k) => {
      const pane = panes[k];
      if (key === undefined) return;
      if (key === "entry") {
        phrase.phases[i][pane] = key;
        return;
      }
      const field = `phrase.phases[${i}].${pane}`;
      const read = conform<TesseractPhraseView>(
        key,
        {
          fields: {
            yaw: "number",
            pitch: { range: [-pitchLimit, pitchLimit] },
            zoom: { range: [zoomLimits[0], zoomLimits[1]] },
            panX: "number",
            panY: "number",
            turns: { range: [-maxTurns, maxTurns] },
          },
        },
        undefined,
        field,
      );
      if (!Number.isInteger(read.turns))
        throw new LinkError(
          `${field}.turns`,
          `${field}.turns must be a whole number.`,
        );
      phrase.phases[i][pane] = read;
    }),
  );
  const error = tesseractPhraseError(config, phrase);
  if (error) throw new LinkError("phrase", error);
  return phrase;
}

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
        "phrase",
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
  const phrase =
    raw.phrase === undefined ? undefined : linkedPhrase(raw.phrase, read);
  if (motion === "phrase" && !phrase)
    throw new LinkError("phrase", "A phrase animation needs phase settings.");
  if (
    timing.repeat === "loop" &&
    !choices.find((m) => m.value === motion)!.loops
  )
    throw new LinkError(
      "repeat",
      "repeat loops only a whole turn, a slice passage or a phrase, which can return to their start.",
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
      defaultDuration,
      "duration",
    ),
    ...timing,
    ...(phrase && { phrase }),
  };
}
