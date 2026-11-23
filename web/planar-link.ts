import {
  maps,
  memberCount,
  memberInterval,
  supportedSource,
  loomPaths,
  type LoomStudy,
} from "./loom/model";
import { defaultFamilyAnimation, type FamilyAnimation } from "./family-motion";
import {
  planarEngravingError,
  type PlanarEngravingPhrase,
} from "./planar-engraving";
import { laceLimits, type LaceStudy } from "./lace/model";
import { offeredTilings, sidesOf, type LaceTilingId } from "./lace/tilings";
import { planarStoryIds, type PlanarStoryId } from "./planar-story";
import { shortenLimits, type ShortenStudy } from "./shorten/model";
import {
  gardenLimits,
  gardenSeed,
  gardenView,
  type GardenCircle,
  type GardenStudy,
} from "./garden/model";
import {
  admittedSplit,
  gardenSeeds,
  seedOf,
  splitOf,
  type GardenSeedId,
} from "./garden/seeds";
import {
  familyDefaults,
  familyTargets,
  type FamilySettings,
} from "./planar-family";
// The 2D notebook's study in a portable link (see study-link.ts).
import {
  animationSettings,
  animationTiming,
  conform,
  defaultTiming,
  flags,
  LinkError,
  withPhaseViews,
  type AnimationSettings,
  type SchemaOf,
  type Timing,
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
  usesPole,
} from "./types";
import { presets } from "./presets";
import { boundText } from "./engine-client";
import {
  availableTargets,
  canTrace,
  loops,
  type AnimationMode,
  type Target,
} from "./animation";
import type { Layers } from "./Plot";
import { completeLayers, defaultLayers } from "./planar-layers";
export { defaultLayers } from "./planar-layers";
import { lineWeightSchema, type LineWeight } from "./line-weight";
import { probeMotionSchema, type ProbeMotion } from "./probe";
import { defaultProbe, probeSupported, type PlanarProbe } from "./planar-probe";
import { viewZoom } from "./refinement";
import { legRange, maxKeyName, maxKeys } from "./key-views";
import type { PlanarPath } from "./planar-path";
import {
  maxPhases,
  maxPhraseTracks,
  phraseError,
  phraseTargets,
  type Phrase,
  type PhrasePhase,
  type PhraseView,
} from "./phrase";

// The manual camera, offset from the fitted framing, which the drawing
// derives deterministically from the study: pixels of pan and a zoom factor.
export type PlotCamera = { x: number; y: number; zoom: number };
// The drawing allows the deeper zoom only when it is refined to its view.
export const zoomRange: [number, number] = [0.1, viewZoom];
// Repeat and pace are the timing every notebook shares (timing.ts), and the
// probe's motion while parameters vary is the 3D notebook's (probe.ts).
// A camera path's key views, absent in links and presets without one.
export type PlanarAnimation = AnimationSettings<AnimationMode, Target> &
  Timing & {
    probeMotion: ProbeMotion;
    path?: PlanarPath;
    phrase?: Phrase;
    phraseLabelInDrawing?: boolean;
  };
export type PlanarStudy = {
  config: Config;
  // Domain bounds as entered, so constant expressions such as 2*pi survive.
  bounds: Bounds;
  // Ray length in optical studies, as a multiple of the drawing's span.
  length: number;
  // Whether optical rays stop at their caustic points; off in links made
  // before it.
  stop: boolean;
  // The pole construction remembered while another tab is chosen.
  poleKind: PoleKind;
  layers: Layers;
  camera: PlotCamera;
  // How wide lines are drawn; regular in links made before line weights.
  weight: LineWeight;
  // The probe, off in links made before it.
  probe: PlanarProbe;
  animation: PlanarAnimation;
  family?: FamilySettings;
  loom?: LoomStudy;
  // An Apollonian garden open over this study; absent in older links.
  garden?: GardenStudy;
  // Hyperbolic lace open over this study; absent in older links.
  lace?: LaceStudy;
  // Curves that smooth themselves open over this study; absent in older
  // links.
  shorten?: ShortenStudy;
  // The planar event the study opened as (planar-story.ts), absent from
  // other studies and from links made before planar events.
  story?: PlanarStoryId;
};
export const defaultAnimation: PlanarAnimation = {
  mode: "reveal",
  camera: "hold",
  duration: 10,
  tracks: [],
  ...defaultTiming,
  probeMotion: "stays",
};
export const defaultLength = 0.8;
export const defaultCamera: PlotCamera = { x: 0, y: 0, zoom: 1 };
// The study an example opens: its own fields, and the notebook's defaults
// for every other, so that nothing of the study before it remains.
export function presetStudy(index: number): PlanarStudy {
  const preset = presets[index];
  const { kind, curve } = preset.config;
  return {
    config: structuredClone(preset.config),
    bounds: { min: boundText(curve.min), max: boundText(curve.max) },
    length: defaultLength,
    stop: !!preset.stop,
    poleKind: usesPole(kind) ? kind : "pedal",
    layers: completeLayers(preset.layers ?? {}),
    camera: { ...defaultCamera },
    weight: "regular",
    probe: structuredClone(preset.probe ?? defaultProbe),
    animation: structuredClone(preset.animation ?? defaultAnimation),
    ...(preset.family && { family: structuredClone(preset.family) }),
    ...(preset.story && { story: preset.story }),
  };
}

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
            stableNormals: { optional: "boolean" },
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
    adaptive: { optional: "boolean" },
    adaptiveView: { optional: "boolean" },
    adaptiveFrame: { optional: "boolean" },
  },
};

// Key views within the drawing's deepest zoom; a study not refined to its
// view refuses a deeper one when it plays (planar-path.ts).
const planarPath: SchemaOf<PlanarPath> = {
  fields: {
    style: { options: { steady: true, smooth: true } },
    ease: { optional: "boolean" },
    easingFactor: { optional: { range: [0, 1] } },
    keys: {
      list: {
        fields: {
          name: "text",
          x: "number",
          y: "number",
          zoom: { range: zoomRange },
          leg: { optional: { range: legRange } },
        },
      },
      max: maxKeys,
    },
  },
};
function cameraPath(value: unknown): PlanarPath {
  const out = conform<PlanarPath>(
    value,
    planarPath,
    { style: "steady", keys: [] },
    "animation.path",
  );
  out.keys.forEach((key, k) => {
    const field = `animation.path.keys[${k}]`;
    if (key.name.length > maxKeyName)
      throw new LinkError(
        `${field}.name`,
        `${field}.name is too long (at most ${maxKeyName} characters).`,
      );
    if (k === 0 && key.leg !== undefined && key.leg !== 1)
      throw new LinkError(
        `${field}.leg`,
        `${field}.leg must be 1: the first view has no leg before it.`,
      );
  });
  return out;
}

const partialLayers: SchemaOf<Partial<Layers>> = {
  fields: {
    base: { optional: "boolean" },
    derived: { optional: "boolean" },
    lines: { optional: "boolean" },
    definitionGuides: { optional: "boolean" },
    rollingGuides: { optional: "boolean" },
    incident: { optional: "boolean" },
    virtual: { optional: "boolean" },
    axes: { optional: "boolean" },
  },
};
// A planar phrase's key view: a center and a zoom about the fitted framing.
const phraseView = (view: unknown, field: string) =>
  conform<PhraseView>(
    view,
    { fields: { x: "number", y: "number", zoom: { range: zoomRange } } },
    undefined,
    field,
  );

// An engraving phrase over a family of count members: spans, layer events
// and views, with no parameter tracks (planar-engraving.ts).
function engravingPhrase(
  value: unknown,
  count: number,
  path: string,
): PlanarEngravingPhrase {
  type Phases = Omit<PlanarEngravingPhrase, "phases"> & {
    phases: Omit<PlanarEngravingPhrase["phases"][number], "view">[];
  };
  const span = { fields: { first: "number", last: "number" } } as const;
  const schema: SchemaOf<Phases> = {
    fields: {
      opening: span,
      phases: {
        list: {
          fields: {
            name: "text",
            duration: { range: [0.1, 3600] },
            pace: { options: { steady: true, ease: true } },
            members: { optional: span },
            layers: { optional: partialLayers },
          },
        },
        max: maxPhases,
      },
    },
  };
  const phrase = withPhaseViews<PlanarEngravingPhrase>(
    value,
    path,
    (rest) => conform<Phases>(rest, schema, undefined, path),
    phraseView,
  );
  const error = planarEngravingError(phrase, count);
  if (error) throw new LinkError(path, error);
  return phrase;
}

function animationPhrase(value: unknown, config: Config): Phrase {
  const offered = phraseTargets(config);
  const targetOptions = {
    options: Object.fromEntries(offered.map((t) => [t, true])) as Record<
      Target,
      true
    >,
  };
  const schema: SchemaOf<
    Omit<Phrase, "phases"> & { phases: Omit<PhrasePhase, "view">[] }
  > = {
    fields: {
      target: targetOptions,
      // Further parameters; phraseError refuses repeats and the first's own.
      also: {
        optional: { list: targetOptions, max: maxPhraseTracks - 1 },
      },
      opening: {
        fields: {
          base: { range: [0, 1] },
          construction: { range: [0, 1] },
          derived: { range: [0, 1] },
        },
      },
      phases: {
        list: {
          fields: {
            name: "text",
            duration: { range: [0.1, 3600] },
            pace: { options: { steady: true, ease: true } },
            key: { optional: "text" },
            // A further parameter's key, by its target.
            keys: {
              optional: {
                fields: Object.fromEntries(
                  offered.map((t) => [t, { optional: "text" }]),
                ) as Record<Target, { optional: "text" }>,
              },
            },
            layers: { optional: partialLayers },
            reveal: {
              optional: {
                fields: {
                  base: { optional: { range: [0, 1] } },
                  construction: { optional: { range: [0, 1] } },
                  derived: { optional: { range: [0, 1] } },
                },
              },
            },
          },
        },
        max: maxPhases,
      },
    },
  };
  const phrase = withPhaseViews<Phrase>(
    value,
    "animation.phrase",
    (rest) =>
      conform<Omit<Phrase, "phases"> & { phases: Omit<PhrasePhase, "view">[] }>(
        rest,
        schema,
        undefined,
        "animation.phrase",
      ),
    phraseView,
  );
  const error = phraseError(config, phrase);
  if (error) throw new LinkError("animation.phrase", error);
  return phrase;
}

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
        "stop",
        "poleKind",
        "layers",
        "camera",
        "weight",
        "probe",
        "animation",
        "family",
        "loom",
        "garden",
        "lace",
        "shorten",
        "story",
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
    length: conform<number>(
      raw.length,
      { range: [0.1, 3] },
      defaultLength,
      "length",
    ),
    stop: conform<boolean>(raw.stop, "boolean", false, "stop"),
    poleKind: conform<PoleKind>(
      raw.poleKind,
      { options: poleKinds },
      "pedal",
      "poleKind",
    ),
    layers: completeLayers(
      conform<
        Omit<Layers, "definitionGuides" | "rollingGuides"> &
          Partial<Pick<Layers, "definitionGuides" | "rollingGuides">>
      >(
        raw.layers,
        {
          fields: {
            ...flags(defaultLayers).fields,
            definitionGuides: { optional: "boolean" },
            rollingGuides: { optional: "boolean" },
          },
        },
        defaultLayers,
        "layers",
      ),
    ),
    camera: conform<PlotCamera>(
      raw.camera,
      { fields: { x: "number", y: "number", zoom: { range: zoomRange } } },
      defaultCamera,
      "camera",
    ),
    weight: conform<LineWeight>(
      raw.weight,
      lineWeightSchema,
      "regular",
      "weight",
    ),
    probe: betweenOnlyWhenSet(
      conform<PlanarProbe>(
        raw.probe,
        {
          fields: {
            enabled: "boolean",
            position: { range: [0, 1] },
            // Absent in links made before the probe stood between samples,
            // which snap it to the nearest sample.
            between: { optional: "boolean" },
          },
        },
        defaultProbe,
        "probe",
      ),
    ),
  };
  const grouped =
    typeof raw.animation === "object" &&
    raw.animation !== null &&
    !Array.isArray(raw.animation);
  const {
    repeat,
    pace,
    probeMotion,
    path,
    phrase,
    phraseLabelInDrawing,
    ...shared
  } = grouped ? (raw.animation as Record<string, unknown>) : {};
  const animation: PlanarAnimation = {
    ...animationSettings(
      grouped ? shared : raw.animation,
      {
        reveal: true,
        parameters: true,
        trace: true,
        probe: true,
        path: true,
        phrase: true,
      },
      availableTargets(study.config),
      defaultAnimation,
    ),
    ...animationTiming({ repeat, pace }, "animation"),
    probeMotion: conform(
      probeMotion,
      probeMotionSchema,
      defaultAnimation.probeMotion,
      "animation.probeMotion",
    ),
    // Links made before 2D camera paths have none.
    ...(path !== undefined && { path: cameraPath(path) }),
    ...(phrase !== undefined && {
      phrase: animationPhrase(phrase, study.config),
    }),
    ...(phraseLabelInDrawing !== undefined && {
      phraseLabelInDrawing: conform<boolean>(
        phraseLabelInDrawing,
        "boolean",
        false,
        "animation.phraseLabelInDrawing",
      ),
    }),
  };
  if (animation.mode === "phrase" && !animation.phrase)
    throw new LinkError(
      "animation.phrase",
      "A phrase animation needs phase settings.",
    );
  if (
    animation.mode === "phrase" &&
    animation.camera !== "hold" &&
    animation.camera !== "current"
  )
    throw new LinkError(
      "animation.camera",
      "A phrase camera must hold the entry or current view.",
    );
  if (
    animation.mode === "probe" &&
    !(study.probe.enabled && probeSupported(study.config))
  )
    throw new LinkError(
      "animation.mode",
      "animation.mode moves the probe only while it is on, along a curve with a parameter.",
    );
  if (animation.repeat === "loop" && !loops(animation.mode))
    throw new LinkError(
      "animation.repeat",
      "animation.repeat loops only parameter tracks or a camera path, which can return to their start.",
    );
  if (animation.mode === "trace" && !canTrace(study.config))
    throw new LinkError(
      "animation.mode",
      "animation.mode traces light only in a catacaustic or diacaustic.",
    );
  // A family's phrase is conformed against its member count, after the
  // rest of the family.
  const rawFamily = raw.family as
    { animation?: { phrase?: unknown } } | undefined;
  const rawPhrase =
    typeof rawFamily?.animation === "object" && rawFamily.animation !== null
      ? rawFamily.animation.phrase
      : undefined;
  const family =
    raw.family === undefined
      ? undefined
      : (conform<
          Omit<FamilySettings, "animation"> & {
            animation?: Omit<FamilyAnimation, "phrase">;
          }
        >(
          rawPhrase === undefined
            ? raw.family
            : {
                ...rawFamily,
                animation: (({ phrase: _, ...rest }) => rest)(
                  rawFamily!.animation!,
                ),
              },
          {
            fields: {
              enabled: "boolean",
              target: {
                options: {
                  rollArm: true,
                  rollPhase: true,
                  rollRadius: true,
                  rollFixed: true,
                  lissajousA: true,
                  lissajousB: true,
                  lissajousPhase: true,
                  contourLevel: true,
                  sourceTheta: true,
                  sourceRadius: true,
                  sourceX: true,
                  sourceY: true,
                  poleX: true,
                  poleY: true,
                  a: true,
                },
              },
              from: "number",
              to: "number",
              count: { range: [2, 32] },
              selected: { range: [0, 31] },
              presentation: { options: { family: true, selected: true } },
              allConstruction: { optional: "boolean" },
              animation: {
                optional: {
                  fields: {
                    mode: {
                      options: { reveal: true, window: true, phrase: true },
                    },
                    width: { range: [1, 32] },
                    duration: { range: [0.1, 3600] },
                    repeat: { options: { once: true, "back-and-forth": true } },
                    pace: { options: { steady: true, ease: true } },
                    camera: { options: { hold: true, current: true } },
                  },
                },
              },
              camera: {
                optional: {
                  fields: {
                    x: "number",
                    y: "number",
                    zoom: { range: zoomRange },
                  },
                },
              },
            },
          },
          {
            ...familyDefaults(study.config),
            animation: defaultFamilyAnimation,
          },
          "family",
        ) as FamilySettings);
  if (family) {
    if (
      family.animation &&
      (!Number.isInteger(family.animation.width) ||
        family.animation.width > family.count)
    )
      throw new LinkError(
        "family.animation.width",
        "family.animation.width must be a whole number within the family.",
      );
    if (!Number.isInteger(family.count))
      throw new LinkError(
        "family.count",
        "family.count must be a whole number.",
      );
    if (!Number.isInteger(family.selected) || family.selected >= family.count)
      throw new LinkError(
        "family.selected",
        "family.selected must name a member of this family.",
      );
    if (family.animation && rawPhrase !== undefined)
      family.animation.phrase = engravingPhrase(
        rawPhrase,
        family.count,
        "family.animation.phrase",
      );
    if (family.animation?.mode === "phrase" && !family.animation.phrase)
      throw new LinkError(
        "family.animation.phrase",
        "family.animation.phrase is needed to play a phrase.",
      );
    if (
      family.enabled &&
      !familyTargets(study.config).some((t) => t.target === family.target)
    )
      throw new LinkError(
        "family.target",
        "family.target is not supported by this study.",
      );
  }
  const loom = raw.loom === undefined ? undefined : loomStudy(raw.loom);
  const garden = raw.garden === undefined ? undefined : gardenStudy(raw.garden);
  const lace = raw.lace === undefined ? undefined : laceStudy(raw.lace);
  const shorten =
    raw.shorten === undefined ? undefined : shortenStudy(raw.shorten);
  // A story is kept however the study has changed since; it applies only
  // while the study is its recipe (planar-story.ts's planarStoryContext).
  const story =
    raw.story === undefined
      ? undefined
      : conform<PlanarStoryId>(
          raw.story,
          {
            options: Object.fromEntries(
              planarStoryIds.map((id) => [id, true]),
            ) as Record<PlanarStoryId, true>,
          },
          planarStoryIds[0],
          "story",
        );
  return {
    ...study,
    animation,
    ...(family && { family }),
    ...(loom && { loom }),
    ...(garden && { garden }),
    ...(lace && { lace }),
    ...(shorten && { shorten }),
    ...(story && { story }),
  };
}

// A probe snapped to samples carries no between flag, as the notebook keeps
// it, so a link's false and its absence open the same study.
function betweenOnlyWhenSet({ between, ...probe }: PlanarProbe): PlanarProbe {
  return between ? { ...probe, between } : probe;
}

// Generation settings, selection by integer identity, presentation, view
// and weight; never generated geometry. Go validates the same limits again.
function gardenStudy(value: unknown): GardenStudy {
  const identity: SchemaOf<GardenCircle> = {
    fields: {
      curvature: "number",
      x: "number",
      y: "number",
      root: { optional: { tuple: "number", length: 3 } },
    },
  };
  const seeds = Object.fromEntries(
    gardenSeeds.map((s) => [s.id, true]),
  ) as Record<GardenSeedId, true>;
  const out = conform<GardenStudy>(
    value,
    {
      fields: {
        seed: { options: seeds },
        depth: { range: [0, gardenLimits.depth] },
        minRadius: { range: [Number.MIN_VALUE, 1] },
        split: { optional: { range: [0, 1] } },
        maxCircles: { range: [4, gardenLimits.circles] },
        selected: { optional: identity },
        presentation: { options: { complete: true, selected: true } },
        view: {
          fields: { x: "number", y: "number", zoom: { range: [0.1, 100] } },
        },
        weight: lineWeightSchema,
        follow: { optional: "boolean" },
        viewBeforeFollow: {
          optional: {
            fields: { x: "number", y: "number", zoom: { range: [0.1, 100] } },
          },
        },
        detail: { optional: "boolean" },
        reveal: {
          optional: {
            fields: {
              duration: { range: [0.1, 3600] },
              repeat: {
                options: { once: true, loop: true, "back-and-forth": true },
              },
            },
          },
        },
        // Absent in older links, which open without a view.
        inversion: {
          optional: {
            fields: {
              x: { range: [-gardenView.pole, gardenView.pole] },
              y: { range: [-gardenView.pole, gardenView.pole] },
              radius: { range: gardenView.radius },
            },
          },
        },
        glide: {
          optional: {
            fields: {
              x: { range: [-gardenView.pole, gardenView.pole] },
              y: { range: [-gardenView.pole, gardenView.pole] },
            },
          },
        },
        motion: { optional: { options: { glide: true } } },
      },
    },
    undefined,
    "garden",
  );
  // A glide needs the view; without one the link opens with the reveal.
  if (!out.inversion) delete out.motion;
  for (const k of ["depth", "maxCircles"] as const)
    if (!Number.isInteger(out[k]))
      throw new LinkError(`garden.${k}`, `garden.${k} must be a whole number.`);
  // The split diameter's split, whose nearest fraction the engine admits;
  // the other seeds have none.
  const family = seedOf(out.seed).family;
  if (!family) delete out.split;
  else {
    const split = splitOf(out);
    if (!split || !admittedSplit(family, split))
      throw new LinkError(
        "garden.split",
        `garden.split must be ${family.range[0]}–${family.range[1]}.`,
      );
  }
  // Every seed circle is kept: 4, or 8 for six around one.
  const least = seedOf(out.seed).seeds;
  if (out.maxCircles < least)
    throw new LinkError(
      "garden.maxCircles",
      `garden.maxCircles must be at least ${least} for this seed.`,
    );
  if (out.selected) {
    for (const k of ["curvature", "x", "y"] as const)
      if (!Number.isSafeInteger(out.selected[k]))
        throw new LinkError(
          `garden.selected.${k}`,
          `garden.selected.${k} must be a whole number.`,
        );
    if (out.selected.root && !out.selected.root.every(Number.isSafeInteger))
      throw new LinkError(
        "garden.selected.root",
        "garden.selected.root must hold whole numbers.",
      );
  }
  return out;
}

// Generation and motif settings, layers, selection by address,
// presentation, view and weight; never generated geometry. Go validates
// the same limits again.
function laceStudy(value: unknown): LaceStudy {
  // Issue #389's research tilings open only in its preview (?research=389).
  const tilings = Object.fromEntries(
    offeredTilings().map((t) => [t.id, true]),
  ) as Record<LaceTilingId, true>;
  const out = conform<LaceStudy>(
    value,
    {
      fields: {
        tiling: { options: tilings },
        depth: { range: [0, laceLimits.depth] },
        maxTiles: { range: [1, laceLimits.tiles] },
        starPoint: { range: [0, 1] },
        edges: "boolean",
        motif: "boolean",
        selected: {
          optional: { list: { range: [0, 6] }, max: laceLimits.depth },
        },
        presentation: { options: { complete: true, selected: true } },
        view: {
          fields: { x: "number", y: "number", zoom: { range: [0.1, 100] } },
        },
        weight: lineWeightSchema,
        follow: { optional: "boolean" },
        viewBeforeFollow: {
          optional: {
            fields: { x: "number", y: "number", zoom: { range: [0.1, 100] } },
          },
        },
        // Absent in older links, which open the lace in place and still.
        isometry: {
          optional: {
            fields: {
              offset: { range: [0, laceLimits.offset] },
              direction: { range: [-laceLimits.angle, laceLimits.angle] },
              rotation: { range: [-laceLimits.angle, laceLimits.angle] },
            },
          },
        },
        motion: {
          optional: {
            fields: {
              offset: { range: [0, laceLimits.offset] },
              orbits: { range: [-laceLimits.turns, laceLimits.turns] },
              turns: { range: [-laceLimits.turns, laceLimits.turns] },
              duration: { range: [0.1, 3600] },
              repeat: {
                options: { once: true, loop: true, "back-and-forth": true },
              },
            },
          },
        },
      },
    },
    undefined,
    "lace",
  );
  for (const k of ["depth", "maxTiles"] as const)
    if (!Number.isInteger(out[k]))
      throw new LinkError(`lace.${k}`, `lace.${k} must be a whole number.`);
  for (const k of ["orbits", "turns"] as const)
    if (out.motion && !Number.isInteger(out.motion[k]))
      throw new LinkError(
        `lace.motion.${k}`,
        `lace.motion.${k} must be a whole number.`,
      );
  out.selected?.forEach((side, i) => {
    if (!Number.isInteger(side))
      throw new LinkError(
        `lace.selected[${i}]`,
        `lace.selected[${i}] must be a whole number.`,
      );
    // A tile has p sides: 0 to p − 1 (all of 0–6 for {7,3}).
    if (side >= sidesOf(out))
      throw new LinkError(
        `lace.selected[${i}]`,
        `lace.selected[${i}] must be 0–${sidesOf(out) - 1}.`,
      );
  });
  return out;
}

// The seed's and the nest's settings, presentation, view, weight and
// motion timing; never solved geometry. Go validates the seeds again,
// including the limits that depend on several fields.
function shortenStudy(value: unknown): ShortenStudy {
  const out = conform<ShortenStudy>(
    value,
    {
      fields: {
        family: { options: { flower: true, convex: true } },
        petals: { range: [0, shortenLimits.petals] },
        depth: { range: [-shortenLimits.depths, shortenLimits.depths] },
        ruffles: { range: [0, shortenLimits.ruffles[1]] },
        ruffle: { range: [-shortenLimits.depths, shortenLimits.depths] },
        phase: "number",
        lobes: { range: [3, 6] },
        ripple: { range: [-1 / 16, 1 / 16] },
        contours: { range: [1, shortenLimits.contours] },
        spacing: { options: { early: true, radius: true, time: true } },
        nest: { options: { whole: true, ghost: true, grows: true } },
        framing: { options: { physical: true, normalized: true } },
        view: {
          fields: { x: "number", y: "number", zoom: { range: [0.1, 100] } },
        },
        weight: lineWeightSchema,
        motion: {
          optional: {
            fields: {
              duration: { range: [0.1, 3600] },
              repeat: {
                options: { once: true, loop: true, "back-and-forth": true },
              },
              pacing: { options: { early: true, radius: true, time: true } },
            },
          },
        },
      },
    },
    undefined,
    "shorten",
  );
  for (const k of ["petals", "ruffles", "contours"] as const)
    if (!Number.isInteger(out[k]))
      throw new LinkError(
        `shorten.${k}`,
        `shorten.${k} must be a whole number.`,
      );
  if (out.lobes !== 3 && out.lobes !== 6)
    throw new LinkError("shorten.lobes", "shorten.lobes must be 3 or 6.");
  return out;
}

// Reuse the ordinary curve schema; numerical validation stays in its Go compiler.
function loomStudy(value: unknown): LoomStudy {
  const camera: SchemaOf<PlotCamera> = {
    fields: { x: "number", y: "number", zoom: { range: [0.1, 100] } },
  };
  const complex: SchemaOf<Vec> = { fields: { x: "number", y: "number" } };
  const out = conform<LoomStudy>(
    value,
    {
      fields: {
        map: {
          options: {
            square: true,
            power: true,
            exp: true,
            "exp-power": true,
            mobius: true,
            joukowski: true,
            fractional: true,
          },
        },
        degree: { optional: { range: [2, 6] } },
        mapParameter: { optional: "number" },
        // The exponential's and the composite's own s; absent is s = 1, the
        // map itself.
        wrap: { optional: { range: [0, 1] } },
        // The power's own s; absent is s = 1, the power.
        fold: { optional: { range: [0, 1] } },
        exclusionRadius: { optional: { range: [0.000001, 1000000] } },
        // Go refuses components beyond ±1,000,000 and degenerate matrices,
        // under their own fields, as when they are typed.
        coefficients: {
          optional: {
            fields: { a: complex, b: complex, c: complex, d: complex },
          },
        },
        showExclusion: { optional: "boolean" },
        motion: {
          optional: {
            fields: {
              mode: { options: { map: true } },
              from: "number",
              to: "number",
            },
          },
        },
        source: {
          fields: {
            kind: {
              options: {
                grid: true,
                concentric: true,
                rosette: true,
                curve: true,
              },
            },
            count: { range: [1, 32] },
            xCount: { range: [1, 32] },
            yCount: { range: [1, 32] },
            xMin: "number",
            xMax: "number",
            yMin: "number",
            yMax: "number",
            radius: "number",
            input: config.fields.input,
            curve: config.fields.curve,
            // Required below only by a path that reads them.
            pole: { optional: complex },
            distance: { optional: { range: [-100000, 100000] } },
          },
        },
        samples: { range: [4, 1024] },
        tolerance: { range: [0.000001, 0.05] },
        selected: { range: [0, 63] },
        parameter: "number",
        views: { fields: { source: camera, image: camera } },
        framing: {
          optional: {
            fields: {
              source: {
                fields: {
                  cx: "number",
                  cy: "number",
                  scale: { range: [Number.MIN_VALUE, Number.MAX_VALUE] },
                },
              },
              image: {
                fields: {
                  cx: "number",
                  cy: "number",
                  scale: { range: [Number.MIN_VALUE, Number.MAX_VALUE] },
                },
              },
            },
          },
        },
        duration: { range: [0.1, 3600] },
      },
    },
    undefined,
    "loom",
  );
  // A retained degree may ride along with another map; the power map and
  // the composite exp(zⁿ) need one.
  if (
    out.degree !== undefined
      ? !Number.isInteger(out.degree)
      : maps[out.map].degree !== undefined
  )
    throw new LinkError(
      "loom.degree",
      "The power degree must be a whole number 2–6.",
    );
  if (maps[out.map].parameterized) {
    const [lo, hi] = maps[out.map].range;
    // A family's s (the power's, the exponential's or the composite's) has
    // its own field, optional; another map's retained mapParameter rides
    // along unread, as it did before s existed.
    if (
      maps[out.map].parameterKey === "mapParameter" &&
      (out.mapParameter === undefined ||
        out.mapParameter < lo ||
        out.mapParameter > hi)
    )
      throw new LinkError(
        "loom.mapParameter",
        "Enter a supported map parameter.",
      );
    if (maps[out.map].exclusion && out.exclusionRadius === undefined)
      throw new LinkError(
        "loom.exclusionRadius",
        "Enter a positive exclusion radius.",
      );
    if ("coefficients" in maps[out.map] && !out.coefficients)
      throw new LinkError(
        "loom.coefficients",
        "Enter the Möbius coefficients a, b, c and d.",
      );
    if (
      out.motion &&
      (out.motion.from < lo ||
        out.motion.from > hi ||
        out.motion.to < lo ||
        out.motion.to > hi)
    )
      throw new LinkError(
        "loom.motion",
        "Map motion endpoints must be in the supported range.",
      );
  } else if (out.motion)
    throw new LinkError(
      "loom.motion",
      `${maps[out.map].label} supports point traversal only.`,
    );
  for (const [path, v] of Object.entries({
    count: out.source.count,
    xCount: out.source.xCount,
    yCount: out.source.yCount,
  }))
    if (!Number.isInteger(v))
      throw new LinkError(
        `loom.source.${path}`,
        "Family counts must be whole numbers.",
      );
  if (!Number.isInteger(out.samples))
    throw new LinkError("loom.samples", "Samples must be a whole number.");
  if (
    !Number.isInteger(out.selected) ||
    out.selected >= memberCount(out.source)
  )
    throw new LinkError("loom.selected", "Select a member of this source.");
  const [lo, hi] = memberInterval(out.source, out.selected);
  if (out.parameter < lo || out.parameter > hi)
    throw new LinkError(
      "loom.parameter",
      "The parameter must be inside the selected source interval.",
    );
  if (out.source.kind === "curve" && !supportedSource(out.source))
    throw new LinkError(
      "loom.source.curve.format",
      "This selected source is unsupported; choose a parametric, Cartesian, polar, roulette, Lissajous or Fourier curve.",
    );
  const setting = loomPaths[out.source.input].setting;
  if (
    out.source.kind === "curve" &&
    setting &&
    out.source[setting] === undefined
  )
    throw new LinkError(
      `loom.source.${setting}`,
      `This path needs its ${setting === "pole" ? "pole" : "offset distance"}.`,
    );
  return out;
}
