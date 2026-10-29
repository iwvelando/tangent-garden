import type { Config } from "./types";

export type Layers = {
  base: boolean;
  derived: boolean;
  lines: boolean;
  definitionGuides: boolean;
  rollingGuides: boolean;
  incident: boolean;
  virtual: boolean;
  axes: boolean;
};

export const defaultLayers: Layers = {
  base: true,
  derived: true,
  lines: true,
  definitionGuides: true,
  rollingGuides: true,
  incident: true,
  virtual: true,
  axes: false,
};

// Older links, presets and phrase events used lines for all three subsets.
// Expand only omitted flags; explicit choices always remain independent.
export function constructionLayerChange(layers: Partial<Layers>) {
  return layers.lines === undefined
    ? layers
    : {
        ...layers,
        definitionGuides: layers.definitionGuides ?? layers.lines,
        rollingGuides: layers.rollingGuides ?? layers.lines,
      };
}

export function completeLayers(layers: Partial<Layers>): Layers {
  return { ...defaultLayers, ...constructionLayerChange(layers) };
}

type Choice = { key: keyof Layers; label: string };

export function PlanarLayers({
  config,
  layers,
  onChange,
}: {
  config: Config;
  layers: Layers;
  onChange: (key: keyof Layers, visible: boolean) => void;
}) {
  const format = config.curve.format;
  const implicit = format === "implicit";
  const attractor = format === "attractor";
  const parameterized = !implicit && !attractor;
  const optical =
    parameterized && ["catacaustic", "diacaustic"].includes(config.kind);
  const chords =
    parameterized &&
    config.kind === "envelope" &&
    config.envelope.mode === "chord";
  const rolling = parameterized && config.kind === "rolling";
  const definition = {
    fourier: "Fourier circles & vectors",
    lissajous: "Guide circles & projections",
    roulette: "Roulette circles & arm",
  }[format as "fourier" | "lissajous" | "roulette"];
  const curves: Choice[] = [
    {
      key: "base",
      label: implicit
        ? "Curve F = c"
        : attractor
          ? "Visit density"
          : "Base curve",
    },
    ...(!attractor
      ? [
          {
            key: "derived" as const,
            label: implicit ? "Other levels" : "Derived curve",
          },
        ]
      : []),
  ];
  const construction: Choice[] = [
    ...(definition
      ? [{ key: "definitionGuides" as const, label: definition }]
      : []),
    ...(rolling
      ? [
          {
            key: "rollingGuides" as const,
            label:
              config.rolling.shape === "curve"
                ? "Rolling curve & tracing arm"
                : "Rolling circle & arm",
          },
        ]
      : []),
    { key: "lines", label: rolling ? "Contact normals" : "Construction lines" },
    ...(optical ? [{ key: "incident" as const, label: "Incident rays" }] : []),
    ...(optical || chords
      ? [{ key: "virtual" as const, label: "Virtual extensions" }]
      : []),
  ];
  const choices = (items: Choice[]) =>
    items.map(({ key, label }) => (
      <label className="check" key={key}>
        <input
          type="checkbox"
          checked={layers[key]}
          onChange={(e) => onChange(key, e.target.checked)}
        />
        <span>{label}</span>
      </label>
    ));
  return (
    <div className="drawing-layers" role="group" aria-label="Visible layers">
      <fieldset aria-label="Curve layers">
        <legend>Curves</legend>
        <div className="curve-layer-options">{choices(curves)}</div>
      </fieldset>
      <fieldset aria-label="Construction layers">
        <legend>Construction</legend>
        <div className="construction-layer-options">
          {choices(construction)}
        </div>
      </fieldset>
      <fieldset aria-label="Reference layers">
        <legend>Reference</legend>
        {choices([{ key: "axes", label: "Grid & axes" }])}
      </fieldset>
    </div>
  );
}
