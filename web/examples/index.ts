import { tesseractPresets } from "../tesseract/presets";
import {
  fingerprint,
  slug,
  type Example,
  type ThumbnailSource,
} from "../ExampleGallery";
import { presets } from "../presets";
import { spatialPresets } from "../spatial/presets";
import { defaultSight, isPlain } from "../spatial/sight";
import { composes } from "../spatial/types";
import type { Config } from "../types";
import manifest from "./thumbnails.json";

// Thumbnails are drawn from the built site by scripts/build-thumbnails.mjs
// (`make thumbnails`), which records each preset's fingerprint here. A preset
// edited since shows no picture rather than an outdated one, and
// tests/gallery.spec.ts fails until they are drawn again.
const recorded: Record<"2d" | "3d", Record<string, string>> = manifest;
const svgs = import.meta.glob<string>("./2d/*.svg", {
  query: "?raw",
  import: "default",
});
const images = import.meta.glob<string>("./3d/*.webp", {
  query: "?url",
  import: "default",
  eager: true,
});

const planarFamily = (config: Config) => {
  if (config.curve.format === "implicit") return "Implicit curves";
  if (config.curve.format === "attractor") return "Iterated maps";
  switch (config.kind) {
    case "evolute":
    case "involute":
      return "Evolutes & involutes";
    case "catacaustic":
    case "diacaustic":
      return "Caustics";
    case "pedal":
    case "contrapedal":
    case "orthotomic":
      return "Pedals";
    case "offset":
      return "Offsets";
    case "rolling":
      return "Rolling";
    case "envelope":
      return "Envelopes";
    case "inversion":
      return "Inversion";
  }
};

export const planarExamples: Example[] = presets.map((p) => ({
  title: p.title,
  caption: p.note,
  family: planarFamily(p.config),
  keywords: `${p.config.kind} ${p.config.curve.format} ${p.config.input}${p.animation?.repeat === "loop" ? " seamless loop" : p.animation?.repeat === "back-and-forth" ? " back and forth" : ""}${p.probe ? " probe curvature" : ""}`,
  // A preset's probe is part of its picture; presets without one keep the
  // fingerprints they had before the probe.
  fingerprint: fingerprint(
    p.probe ? { config: p.config, probe: p.probe } : p.config,
  ),
}));

export const spatialExamples: Example[] = spatialPresets.map((p) => ({
  title: p.name,
  caption: p.detail,
  family:
    p.config.format === "implicit"
      ? "Implicit surfaces and sections"
      : p.config.format === "surface"
        ? "Surface normals and focal sheets"
        : p.config.format === "rays"
          ? p.config.rays.interaction === "refract" ||
            p.config.rays.receiver.plane !== "none"
            ? "Refraction and receivers"
            : "Mirrors and caustics"
          : p.config.format === "pursuit"
            ? "Spatial pursuit"
            : p.config.format === "field"
              ? "Vector-field trajectories"
              : composes(p.config)
                ? "Built on a derived curve"
                : p.config.construction === "canal"
                  ? "Tubes and canal surfaces"
                  : p.config.construction === "ruled"
                    ? "Ruled surfaces"
                    : p.config.construction === "framed"
                      ? "Framed ribbons"
                      : p.config.format === "harmonic"
                        ? "Harmonic generators"
                        : p.config.construction === "involute"
                          ? "Involute filaments"
                          : p.config.construction === "tangent-foot" ||
                              p.config.construction === "orthotomic"
                            ? "Tangent projections"
                            : p.config.construction === "inversion"
                              ? "Sphere inversions"
                              : p.config.format === "torus"
                                ? "Torus knots"
                                : "Parametric curves",
  keywords: `${p.config.format} ${p.config.construction}${composes(p.config) ? ` ${p.config.input} composition` : ""}${p.cut ? " cut" : ""}${p.sight && !isPlain(p.sight) ? " see-through" : ""}${p.sight && p.sight.weight !== defaultSight.weight ? ` ${p.sight.weight} line weight strokes` : ""}${p.projection && p.projection !== "orthographic" ? " perspective" : ""}${p.flight ? `${p.flight.path.keys.length ? " flight" : ""}${p.flight.ride ? " ride perspective" : ""}${p.flight.repeat === "loop" ? " seamless loop" : p.flight.repeat === "back-and-forth" ? " back and forth" : ""}` : ""}${p.config.adaptive ? " refined adaptive aliasing" : ""}${p.probe?.enabled ? " probe curvature torsion" : ""}`,
  // A preset's cut, sight, projection, opening view and probe are part of
  // its picture; presets without them keep the fingerprints they had before
  // those existed.
  fingerprint: fingerprint(
    p.cut || p.sight || p.projection || p.view || p.probe
      ? {
          config: p.config,
          ...(p.cut && { cut: p.cut }),
          ...(p.sight && { sight: p.sight }),
          ...(p.projection && { projection: p.projection }),
          ...(p.view && { view: p.view }),
          ...(p.probe && { probe: p.probe }),
        }
      : p.config,
  ),
}));

export const planarThumbnail: ThumbnailSource = async (example) => {
  const name = slug(example.title);
  const load = svgs[`./2d/${name}.svg`];
  if (!load || recorded["2d"][name] !== example.fingerprint) return;
  return { kind: "svg", markup: await load() };
};

export const spatialThumbnail: ThumbnailSource = async (example) => {
  const name = slug(example.title);
  const [light, dark] = [
    images[`./3d/${name}-light.webp`],
    images[`./3d/${name}-dark.webp`],
  ];
  if (!light || !dark || recorded["3d"][name] !== example.fingerprint) return;
  return { kind: "image", light, dark };
};

export const tesseractExamples: Example[] = tesseractPresets.map((p) => ({
  title: p.name,
  caption: p.detail,
  family:
    p.config.object === "bypass"
      ? "Extra-coordinate routes"
      : p.config.mode === "reference" || p.config.mode === "lifted"
        ? "Lifted threads"
        : p.config.mode === "section"
          ? "Sections"
          : p.config.mode === "stereo"
            ? "Stereographic curves"
            : "Shadows",
  keywords: `${p.config.object} 4D ${p.config.mode}${p.repeat === "loop" ? " seamless loop" : p.repeat === "back-and-forth" ? " back and forth" : ""}`,
  fingerprint: fingerprint(p.config),
}));
const hyperImages = import.meta.glob<string>("./4d/*.webp", {
  query: "?url",
  import: "default",
  eager: true,
});
export const tesseractThumbnail: ThumbnailSource = async (example) => {
  const name = slug(example.title),
    light = hyperImages[`./4d/${name}-light.webp`],
    dark = hyperImages[`./4d/${name}-dark.webp`];
  const records = manifest as Record<string, Record<string, string>>;
  if (!light || !dark || records["4d"]?.[name] !== example.fingerprint) return;
  return { kind: "image", light, dark };
};
