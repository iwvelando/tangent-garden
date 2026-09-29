import {
  fingerprint,
  slug,
  type Example,
  type ThumbnailSource,
} from "../ExampleGallery";
import { presets } from "../presets";
import { spatialPresets } from "../spatial/presets";
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
  keywords: `${p.config.kind} ${p.config.curve.format} ${p.config.input}`,
  fingerprint: fingerprint(p.config),
}));

export const spatialExamples: Example[] = spatialPresets.map((p) => ({
  title: p.name,
  caption: p.detail,
  family:
    p.config.format === "surface"
      ? "Surface normals and focal sheets"
      : p.config.format === "rays"
        ? "Mirrors and caustics"
        : p.config.format === "pursuit"
          ? "Spatial pursuit"
          : p.config.format === "field"
            ? "Vector-field trajectories"
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
  keywords: `${p.config.format} ${p.config.construction}`,
  fingerprint: fingerprint(p.config),
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
