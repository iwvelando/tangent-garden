import { Field, HelpText, HelpToggle, useHelp } from "../Field";
import { ScalarInput } from "../ScalarInput";
import {
  cutBeyonds,
  cutFields,
  cutHelp,
  cutPlaneInputs,
  cutScopes,
  maxCutPlanes,
  otherCutFields,
  withCutPlanes,
  type Cut,
  type CutBeyond,
  type CutError,
  type CutPlaneInput,
  type CutScope,
} from "./cut";

// The cutaway plane's controls. Everything it shows comes from cut.ts.
// `peeling` is set while an animation moves the plane, which then holds
// the entered plane until it stops. The buttons' handlers take the plane
// they act on, counting the first as 0.
export function CutPanel({
  cut,
  onCut,
  error,
  onFace,
  onCenter,
  onFlip,
  onAdd,
  peeling,
}: {
  cut: Cut;
  onCut: (change: (c: Cut) => Cut) => void;
  error?: CutError;
  onFace: (plane: number) => void;
  onCenter: (plane: number) => void;
  onFlip: (plane: number) => void;
  onAdd: () => void;
  peeling: boolean;
}) {
  const help = useHelp(),
    edgeHelp = useHelp();
  const planes = cutPlaneInputs(cut),
    several = planes.length > 1;
  // Plane k's change, against the latest cut.
  const changePlane = (
    k: number,
    change: (p: CutPlaneInput) => CutPlaneInput | null,
  ) =>
    onCut((c) =>
      withCutPlanes(
        c,
        cutPlaneInputs(c).flatMap((p, i) => {
          if (i !== k) return [p];
          const changed = change(p);
          return changed ? [changed] : [];
        }),
      ),
    );
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
            {planes.map((plane, k) => {
              const names = k ? otherCutFields(k + 1) : cutFields;
              return (
                <fieldset className="cut-plane" key={k}>
                  {several && <legend>Plane {k + 1}</legend>}
                  <div className="pair trio">
                    {(["x", "y", "z"] as const).map((axis) => (
                      <Field
                        key={axis}
                        label={`Normal ${axis}`}
                        help={axis === "x" ? cutHelp.normal : undefined}
                        topic="the cut's normal"
                      >
                        <ScalarInput
                          name={names[axis]}
                          value={plane.normal[axis]}
                          onChange={(value) =>
                            changePlane(k, (p) => ({
                              ...p,
                              normal: { ...p.normal, [axis]: value },
                            }))
                          }
                        />
                      </Field>
                    ))}
                  </div>
                  <div className="pair">
                    <Field label="Offset d" help={cutHelp.offset}>
                      <ScalarInput
                        name={names.offset}
                        value={plane.offset}
                        onChange={(offset) =>
                          changePlane(k, (p) => ({ ...p, offset }))
                        }
                      />
                    </Field>
                    {k === 0 && (
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
                    )}
                  </div>
                  <div className="cut-actions">
                    <button type="button" onClick={() => onFace(k)}>
                      Face the view
                    </button>
                    <button type="button" onClick={() => onCenter(k)}>
                      Through the center
                    </button>
                    <button type="button" onClick={() => onFlip(k)}>
                      Flip
                    </button>
                    {several && (
                      <button
                        type="button"
                        onClick={() => changePlane(k, () => null)}
                      >
                        Remove
                      </button>
                    )}
                  </div>
                </fieldset>
              );
            })}
            {several && (
              <div className="pair">
                <Field label="Hidden" help={cutHelp.beyond}>
                  <select
                    value={cut.beyond ?? "every"}
                    onChange={(e) => {
                      const beyond = e.target.value as CutBeyond;
                      onCut((c) => ({ ...c, beyond }));
                    }}
                  >
                    {cutBeyonds.map((b) => (
                      <option key={b.value} value={b.value}>
                        {b.label}
                      </option>
                    ))}
                  </select>
                </Field>
              </div>
            )}
            <div className="cut-actions cut-add">
              <button
                type="button"
                onClick={onAdd}
                disabled={planes.length >= maxCutPlanes}
                title={cutHelp.add}
              >
                Add a plane
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
