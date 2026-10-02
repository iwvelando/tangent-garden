import { Field, HelpText, HelpToggle, useHelp } from "../Field";
import { ScalarInput } from "../ScalarInput";
import {
  cutFields,
  cutHelp,
  cutScopes,
  type Cut,
  type CutError,
  type CutScope,
} from "./cut";

// The cutaway plane's controls. Everything it shows comes from cut.ts.
// `peeling` is set while an animation moves the plane, which then holds
// the entered plane until it stops.
export function CutPanel({
  cut,
  onCut,
  error,
  onFace,
  onCenter,
  onFlip,
  peeling,
}: {
  cut: Cut;
  onCut: (change: (c: Cut) => Cut) => void;
  error?: CutError;
  onFace: () => void;
  onCenter: () => void;
  onFlip: () => void;
  peeling: boolean;
}) {
  const help = useHelp(),
    edgeHelp = useHelp();
  return (
    <fieldset className="spatial-cut">
      <legend>Cut away</legend>
      {/* Content that comes and goes stays inside this wrapper, as in the
          probe's panel. */}
      <div>
        <div className="probe-switch">
          <label>
            <input
              type="checkbox"
              checked={cut.enabled}
              onChange={(e) => {
                const enabled = e.target.checked;
                onCut((c) => ({ ...c, enabled }));
              }}
            />
            Cut with a plane
          </label>
          <HelpToggle topic="the cut" help={help} />
        </div>
        <HelpText help={help}>{cutHelp.enabled}</HelpText>
        {cut.enabled && (
          <fieldset className="cut-fields" disabled={peeling}>
            <div className="pair trio">
              {(["x", "y", "z"] as const).map((axis) => (
                <Field
                  key={axis}
                  label={`Normal ${axis}`}
                  help={axis === "x" ? cutHelp.normal : undefined}
                  topic="the cut's normal"
                >
                  <ScalarInput
                    name={cutFields[axis]}
                    value={cut.normal[axis]}
                    onChange={(value) =>
                      onCut((c) => ({
                        ...c,
                        normal: { ...c.normal, [axis]: value },
                      }))
                    }
                  />
                </Field>
              ))}
            </div>
            <div className="pair">
              <Field label="Offset d" help={cutHelp.offset}>
                <ScalarInput
                  name={cutFields.offset}
                  value={cut.offset}
                  onChange={(offset) => onCut((c) => ({ ...c, offset }))}
                />
              </Field>
              <Field label="What it cuts" help={cutHelp.cuts}>
                <select
                  value={cut.cuts}
                  onChange={(e) => {
                    const cuts = e.target.value as CutScope;
                    onCut((c) => ({ ...c, cuts }));
                  }}
                >
                  {cutScopes.map((s) => (
                    <option key={s.value} value={s.value}>
                      {s.label}
                    </option>
                  ))}
                </select>
              </Field>
            </div>
            <div className="cut-actions">
              <button type="button" onClick={onFace}>
                Face the view
              </button>
              <button type="button" onClick={onCenter}>
                Through the center
              </button>
              <button type="button" onClick={onFlip}>
                Flip
              </button>
            </div>
            <div className="probe-switch">
              <label>
                <input
                  type="checkbox"
                  checked={cut.edge}
                  onChange={(e) => {
                    const edge = e.target.checked;
                    onCut((c) => ({ ...c, edge }));
                  }}
                />
                Draw the cut edge
              </label>
              <HelpToggle topic="the cut edge" help={edgeHelp} />
            </div>
            <HelpText help={edgeHelp}>{cutHelp.edge}</HelpText>
            {error && (
              <p className="animation-error cut-error" role="alert">
                {error.field}: {error.message}
              </p>
            )}
            {peeling && (
              <p className="spatial-caption">
                The animation moves the plane; your plane returns when it stops.
              </p>
            )}
          </fieldset>
        )}
      </div>
    </fieldset>
  );
}
