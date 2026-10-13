import { Field } from "../Field";
import { ScalarInput } from "../ScalarInput";
import { LineWeightField } from "../LineWeightField";
import {
  dashMeasures,
  hiddenLines,
  layerFades,
  sheetSights,
  strokeDepths,
  sightFields,
  sightHelp,
  type DashMeasure,
  type HiddenLines,
  type LayerFade,
  type Sight,
  type SheetSight,
  type SightError,
  type StrokeDepth,
} from "./sight";

// The lines' weight and seeing through the drawing. Everything they show
// comes from sight.ts. `unavailable` is set when the device cannot draw
// see-through sheets, `unstroked` when it cannot draw strokes, and
// `lensed` when the drawing is seen through a perspective lens.
export function SightPanel({
  sight,
  onSight,
  error,
  unavailable,
  unstroked = false,
  lensed = false,
}: {
  sight: Sight;
  onSight: (change: (s: Sight) => Sight) => void;
  error?: SightError;
  unavailable: boolean;
  unstroked?: boolean;
  lensed?: boolean;
}) {
  const through = sight.sheets === "through",
    dashed = sight.hidden === "dashed";
  return (
    <>
      <fieldset className="spatial-sight">
        <legend>Lines</legend>
        <div>
          <div className="pair">
            <LineWeightField
              label="Weight"
              help={sightHelp.weight}
              value={sight.weight}
              onChange={(weight) => onSight((s) => ({ ...s, weight }))}
            />
            <Field label="Depth" help={sightHelp.depth}>
              <select
                value={sight.depth ?? "even"}
                onChange={(e) => {
                  const depth = e.target.value as StrokeDepth;
                  onSight((s) => ({ ...s, depth }));
                }}
              >
                {strokeDepths.map((d) => (
                  <option key={d.value} value={d.value}>
                    {d.label}
                  </option>
                ))}
              </select>
            </Field>
          </div>
          {unstroked && sight.weight !== "hairline" && (
            <p className="spatial-caption">{sightHelp.unstroked}</p>
          )}
          {sight.depth === "taper" && !lensed && (
            <p className="spatial-caption">{sightHelp.flat}</p>
          )}
        </div>
      </fieldset>
      <fieldset className="spatial-sight">
        <legend>See through</legend>
        {/* Content that comes and goes stays inside this wrapper, as in the
          cut's panel. */}
        <div>
          <div className="pair">
            <Field label="Sheets" help={sightHelp.sheets}>
              <select
                value={sight.sheets}
                onChange={(e) => {
                  const sheets = e.target.value as SheetSight;
                  onSight((s) => ({ ...s, sheets }));
                }}
              >
                {sheetSights.map((s) => (
                  <option key={s.value} value={s.value}>
                    {s.label}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Lines behind sheets" help={sightHelp.hidden}>
              <select
                value={sight.hidden}
                onChange={(e) => {
                  const hidden = e.target.value as HiddenLines;
                  onSight((s) => ({ ...s, hidden }));
                }}
              >
                {hiddenLines.map((h) => (
                  <option key={h.value} value={h.value}>
                    {h.label}
                  </option>
                ))}
              </select>
            </Field>
          </div>
          {(through || dashed) && (
            <div className="pair">
              {through && (
                <Field label="Opacity α" help={sightHelp.opacity}>
                  <ScalarInput
                    name={sightFields.opacity}
                    value={sight.opacity}
                    onChange={(opacity) => onSight((s) => ({ ...s, opacity }))}
                  />
                </Field>
              )}
              {dashed && (
                <Field label="Dashes" help={sightHelp.dashes}>
                  <select
                    value={sight.dashes ?? "space"}
                    onChange={(e) => {
                      const dashes = e.target.value as DashMeasure;
                      onSight((s) => ({ ...s, dashes }));
                    }}
                  >
                    {dashMeasures.map((d) => (
                      <option key={d.value} value={d.value}>
                        {d.label}
                      </option>
                    ))}
                  </select>
                </Field>
              )}
            </div>
          )}
          {sight.hidden !== "hide" && (
            <Field label="Fade behind layers" help={sightHelp.fade}>
              <select
                value={sight.fade ?? "nearest"}
                onChange={(e) => {
                  const fade = e.target.value as LayerFade;
                  onSight((s) => ({ ...s, fade }));
                }}
              >
                {layerFades.map((f) => (
                  <option key={f.value} value={f.value}>
                    {f.label}
                  </option>
                ))}
              </select>
            </Field>
          )}
          {through && error && (
            <p className="animation-error cut-error" role="alert">
              {error.field}: {error.message}
            </p>
          )}
          {through && unavailable && (
            <p className="spatial-caption">{sightHelp.unavailable}</p>
          )}
        </div>
      </fieldset>
    </>
  );
}
