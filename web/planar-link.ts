import {
  maps,
  memberCount,
  memberInterval,
  supportedSource,
  type LoomStudy,
} from "./loom/model";
import { defaultFamilyAnimation } from "./family-motion";
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

function animationPhrase(value: unknown, config: Config): Phrase {
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
  // A phase's view is a key view or "entry", which the schema cannot state
  // as one field: it is checked on its own below.
  const schema: SchemaOf<
    Omit<Phrase, "phases"> & { phases: Omit<PhrasePhase, "view">[] }
  > = {
    fields: {
      target: {
        options: Object.fromEntries(
          phraseTargets(config).map((t) => [t, true]),
        ) as Record<Target, true>,
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
  const record =
    typeof value === "object" && value !== null && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : undefined;
  const rawPhases = Array.isArray(record?.phases) ? record.phases : undefined;
  const views = rawPhases?.map((p) =>
    typeof p === "object" && p !== null && !Array.isArray(p)
      ? (p as Record<string, unknown>).view
      : undefined,
  );
  const phrase: Phrase = conform<
    Omit<Phrase, "phases"> & { phases: Omit<PhrasePhase, "view">[] }
  >(
    rawPhases
      ? {
          ...record,
          phases: rawPhases.map((p) => {
            if (typeof p !== "object" || p === null || Array.isArray(p))
              return p;
            const { view: _, ...rest } = p as Record<string, unknown>;
            return rest;
          }),
        }
      : value,
    schema,
    undefined,
    "animation.phrase",
  );
  views?.forEach((view, i) => {
    if (view === undefined || view === "entry") {
      if (view) phrase.phases[i].view = view;
      return;
    }
    phrase.phases[i].view = conform<PhraseView>(
      view,
      { fields: { x: "number", y: "number", zoom: { range: zoomRange } } },
      undefined,
      `animation.phrase.phases[${i}].view`,
    );
  });
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
  const family =
    raw.family === undefined
      ? undefined
      : conform<FamilySettings>(
          raw.family,
          {
            fields: {
              enabled: "boolean",
              target: {
                options: {
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
                    mode: { options: { reveal: true, window: true } },
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
        );
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
  return {
    ...study,
    animation,
    ...(family && { family }),
    ...(loom && { loom }),
  };
}

// A probe snapped to samples carries no between flag, as the notebook keeps
// it, so a link's false and its absence open the same study.
function betweenOnlyWhenSet({ between, ...probe }: PlanarProbe): PlanarProbe {
  return between ? { ...probe, between } : probe;
}

// Reuse the ordinary curve schema; numerical validation stays in its Go compiler.
function loomStudy(value: unknown): LoomStudy {
  const camera: SchemaOf<PlotCamera> = {
    fields: { x: "number", y: "number", zoom: { range: [0.1, 100] } },
  };
  const out = conform<LoomStudy>(
    value,
    {
      fields: {
        map: { options: { square: true, mobius: true, joukowski: true } },
        mapParameter: { optional: "number" },
        exclusionRadius: { optional: { range: [0.000001, 1000000] } },
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
  if (maps[out.map].parameterized) {
    const [lo, hi] = maps[out.map].range;
    if (
      out.mapParameter === undefined ||
      out.mapParameter < lo ||
      out.mapParameter > hi
    )
      throw new LinkError(
        "loom.mapParameter",
        "Enter a supported map parameter.",
      );
    if (out.exclusionRadius === undefined)
      throw new LinkError(
        "loom.exclusionRadius",
        "Enter a positive exclusion radius.",
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
      "This selected source is unsupported; choose a direct ordinary curve.",
    );
  return out;
}
