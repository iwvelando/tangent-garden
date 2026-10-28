import { useEffect, useRef, useState } from "react";
import {
  Field,
  CheckSetting,
  FieldErrorContext,
  type FieldErrorTarget,
} from "./Field";
import { ScalarInput } from "./ScalarInput";
import { tiered } from "./help";
import { familyMotionHelp } from "./family-motion";
import { EngineClient } from "./engine-client";
import {
  familyDefaults,
  familyTargets,
  familyBudget,
  PlanarFamily,
  emptyFamily,
  type FamilyMember,
  type FamilySettings,
  type FamilyState,
} from "./planar-family";
import type { PlanarStudy } from "./planar-link";
import type { ViewRect } from "./types";

export function usePlanarFamily(
  study: PlanarStudy,
  active: boolean,
  blocked: boolean,
  view: ViewRect | null,
) {
  const [delivered, setDelivered] = useState<{
    key: string;
    state: FamilyState;
  }>({ key: "", state: emptyFamily() });
  const scheduler = useRef<PlanarFamily | null>(null);
  const f = study.family;
  const enabled = !!f?.enabled && active;
  const key = JSON.stringify([
    study.config,
    study.bounds,
    study.probe,
    f?.target,
    f?.from,
    f?.to,
    f?.count,
    view,
    enabled,
    blocked,
  ]);
  useEffect(() => {
    if (!enabled) return;
    const client = new EngineClient();
    const family = new PlanarFamily(client, () => {});
    scheduler.current = family;
    return () => {
      family.cancel();
      client.dispose();
      scheduler.current = null;
    };
  }, [enabled]);
  useEffect(() => {
    const family = scheduler.current;
    if (!family || !f) return;
    // Each callback belongs to the specification that started it. A render
    // with changed inputs is already unavailable before this effect runs.
    family.setChanged((state) => setDelivered({ key, state }));
    if (blocked) family.cancel();
    else family.generate(study, f, view ?? undefined);
    return () => family.cancel();
  }, [key]);
  // The last settled members, drawn while a newer specification computes, as
  // the ordinary notebook keeps its previous frame. A zoom refined to the
  // view recomputes every member and must not take the drawing away.
  const held = useRef<FamilyMember[] | undefined>(undefined);
  if (!enabled) held.current = undefined;
  else if (
    delivered.key === key &&
    !delivered.state.pending &&
    delivered.state.members.some((m) => m.frame)
  )
    held.current = delivered.state.members;
  const state = !enabled
    ? emptyFamily()
    : delivered.key === key
      ? delivered.state
      : { ...emptyFamily(), pending: true };
  return {
    ...state,
    revision: key,
    held: state.pending ? held.current : undefined,
  };
}
export function FamilyPanel({
  study,
  value,
  state,
  pending,
  fieldError,
  onChange,
}: {
  study: PlanarStudy;
  value?: FamilySettings;
  state: FamilyState;
  pending: boolean;
  // The notebook's error target: a constant that failed to parse is shown
  // under its own control, here as elsewhere.
  fieldError: FieldErrorTarget;
  onChange: (update: (previous?: FamilySettings) => FamilySettings) => void;
}) {
  const targets = familyTargets(study.config);
  const f = value ?? familyDefaults(study.config);
  const change = (patch: Partial<FamilySettings>) =>
    onChange((previous) => ({
      ...(previous ?? familyDefaults(study.config)),
      ...patch,
    }));
  const budget = familyBudget(study.config, f, study.probe.enabled);
  // A rejected constant explains its own field; otherwise a setting's
  // refusal goes under the setting it names.
  const target: FieldErrorTarget =
    fieldError.message || !budget.field
      ? fieldError
      : {
          ...fieldError,
          id: undefined,
          label: budget.field,
          message: budget.error!,
        };
  // The scheduler repeats a budget refusal; show it once.
  const general = fieldError.message
    ? undefined
    : budget.error
      ? budget.field
        ? undefined
        : budget.error
      : state.error;
  return (
    <FieldErrorContext.Provider value={target}>
      <section className="family-panel" aria-label="Finite engraving settings">
        <div className="section-label">FINITE ENGRAVING</div>
        <CheckSetting
          topic="finite engraving"
          label="Finite engraving"
          checked={f.enabled}
          onChange={(enabled) => change({ enabled })}
          help={tiered(
            "Overlay full-quality constructions from one changing parameter.",
            "Only active point-source coordinates, pedal-family poles and consumed shape a are supported. Implicit curves, densities, integrated paths and nested stacks are excluded. Disabling restores the source study. Reveal members or move a band in Animation; ordinary study animation is unavailable here.",
          )}
        />
        {f.enabled && (
          <>
            <Field
              label="Family parameter"
              help="Only parameters used by this study are offered."
            >
              <select
                value={f.target}
                disabled={pending}
                onChange={(e) => {
                  const next = familyDefaults(
                    study.config,
                    e.target.value as FamilySettings["target"],
                  );
                  onChange(() => ({ ...next, enabled: true }));
                }}
              >
                {!targets.some((t) => t.target === f.target) && (
                  <option value={f.target}>Unsupported parameter</option>
                )}
                {targets.map((t) => (
                  <option key={t.target} value={t.target}>
                    {t.label}
                  </option>
                ))}
              </select>
            </Field>
            <div className="pair" key={f.target}>
              <Field
                label="Family from"
                help={tiered(
                  "Finite constants; descending and equal endpoints are allowed.",
                  "Both endpoints are members. A theta family opens one step short of a whole turn, so no lamp position repeats. Changing the member count keeps both endpoints.",
                )}
              >
                <ScalarInput
                  name="Family from"
                  value={f.from}
                  onChange={(from) => change({ from })}
                />
              </Field>
              <Field label="Family to">
                <ScalarInput
                  name="Family to"
                  value={f.to}
                  onChange={(to) => change({ to })}
                />
              </Field>
            </div>
            <Field
              label="Family members"
              help="2–32 whole members, including both endpoints; default 16."
            >
              <input
                type="number"
                min="2"
                max="32"
                step="1"
                value={Number.isNaN(f.count) ? "" : f.count}
                onChange={(e) => {
                  const count = e.target.valueAsNumber;
                  // An emptied field is NaN while the next count is typed;
                  // the selection waits for a count it can be clamped to.
                  onChange((previous) => {
                    const { selected } = previous ?? f;
                    return {
                      ...(previous ?? f),
                      count,
                      ...(previous?.animation &&
                        Number.isFinite(count) && {
                          animation: {
                            ...previous.animation,
                            width: Math.max(
                              1,
                              Math.min(previous.animation.width, count),
                            ),
                          },
                        }),
                      selected: Number.isFinite(count)
                        ? Math.max(0, Math.min(selected, count - 1))
                        : selected,
                    };
                  });
                }}
              />
            </Field>
            <Field
              label="Family presentation"
              help="Choose the complete family or inspect one member alone."
            >
              <select
                value={f.presentation}
                onChange={(e) =>
                  change({
                    presentation: e.target
                      .value as FamilySettings["presentation"],
                  })
                }
              >
                <option value="family">Complete family</option>
                <option value="selected">Selected member · construction</option>
              </select>
            </Field>
            <CheckSetting
              topic="construction for all members"
              label="Construction lines for all members"
              checked={!!f.allConstruction}
              onChange={(allConstruction) =>
                change({ allConstruction: allConstruction || undefined })
              }
              help={familyMotionHelp.construction}
            />
            <Field label="Selected member">
              <select
                value={f.selected}
                onChange={(e) => change({ selected: Number(e.target.value) })}
              >
                {state.members.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.id + 1} · {m.value}
                    {m.error ? " · unavailable" : !m.frame ? " · pending" : ""}
                  </option>
                ))}
              </select>
            </Field>
            <p className="note" role="status">
              {state.pending
                ? "Calculating family…"
                : `${state.members.filter((m) => m.frame).length} of ${state.members.length} members available.`}
            </p>
            {general && (
              <p className="field-error" role="alert">
                {general}
              </p>
            )}
            <details>
              <summary>Members and limits</summary>
              <p className="note">
                A finite overlay, not an envelope. Complete families show member
                curves. Construction layers show the selected member, or every
                visible member with Construction lines for all members enabled.
                Selection does not follow the moving band. Select one to inspect
                it alone. At most 500,000 reserved path points, four million
                retained numbers and 80 million weighted work units. One
                calculation runs at a time. Hidden geometry counts too.
              </p>
              <ol>
                {state.members.map((m) => (
                  <li key={m.id}>
                    {m.value}: {m.error ?? (m.frame ? "Available" : "Pending")}
                  </li>
                ))}
              </ol>
            </details>
          </>
        )}
      </section>
    </FieldErrorContext.Provider>
  );
}
