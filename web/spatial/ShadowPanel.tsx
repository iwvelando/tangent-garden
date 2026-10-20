import { Field } from "../Field";
import { ScalarInput } from "../ScalarInput";
import type { Layers } from "./scene";
import { shadowHelp, shadowLayers, shadowPlanes } from "./shadow";
import type { ShadowPlane, SpatialConfig } from "./types";

// A curve study's shadow on a plane: the plane, where it stands, its
// layers, and how the reduction fares. Everything it names comes from
// shadow.ts. `note` describes the drawn study's shadow (shadowNote), once
// there is one.
export function ShadowPanel({
  config,
  onPlane,
  onAt,
  layers,
  onLayer,
  note,
}: {
  config: SpatialConfig;
  onPlane: (plane: ShadowPlane | "none") => void;
  onAt: (at: number) => void;
  layers: Layers;
  onLayer: (layer: "shadow" | "planar" | "cast", on: boolean) => void;
  note?: string;
}) {
  const shadow = config.shadow;
  return (
    <fieldset className="spatial-shadow">
      <legend>Shadow on a plane</legend>
      {/* Content that comes and goes stays inside this wrapper, as in the
          probe's panel. */}
      <div>
        <div className="pair">
          <Field label="Shadow on" help={shadowHelp.plane}>
            <select
              value={shadow?.plane ?? "none"}
              onChange={(e) => onPlane(e.target.value as ShadowPlane | "none")}
            >
              <option value="none">No plane</option>
              {shadowPlanes.map((p) => (
                <option key={p.value} value={p.value}>
                  {p.label}
                </option>
              ))}
            </select>
          </Field>
          {shadow && (
            <Field label="Plane at c" help={shadowHelp.at}>
              <ScalarInput
                name="Plane at c"
                value={shadow.at}
                onChange={onAt}
              />
            </Field>
          )}
        </div>
        {shadow && (
          <>
            <div className="spatial-layers shadow-layers">
              {shadowLayers(config).map(([key, label]) => (
                <label key={key}>
                  <input
                    type="checkbox"
                    checked={layers[key]}
                    onChange={(e) => onLayer(key, e.target.checked)}
                  />
                  {label}
                </label>
              ))}
            </div>
            <p className="note" data-testid="shadow-note">
              {note ?? "Casting the shadow…"}
            </p>
          </>
        )}
      </div>
    </fieldset>
  );
}
