import { useEffect, useRef, useState } from "react";
import {
  CheckSetting,
  Field,
  FieldErrorContext,
  type FieldErrorTarget,
} from "../Field";
import { ScalarInput } from "../ScalarInput";
import { tiered } from "../help";
import { distinctReadouts } from "../number-format";
import { EngineClient } from "../engine-client";
import {
  SpatialFamily,
  emptySpatialFamily,
  spatialFamilyBudget,
  spatialFamilyDefaults,
  spatialFamilyTargets,
  type SpatialFamilySettings,
  type SpatialFamilyState,
} from "./family";
import type { RefinementView, SpatialConfig } from "./types";

export function useSpatialFamily(
  config: SpatialConfig,
  f: SpatialFamilySettings | undefined,
  active: boolean,
  blocked: boolean,
  view: RefinementView | null,
) {
  const enabled = !!f?.enabled && active;
  const key = JSON.stringify([
    config,
    f?.target,
    f?.from,
    f?.to,
    f?.count,
    enabled,
    blocked,
    view,
  ]);
  const [delivered, setDelivered] = useState({
    key: "",
    state: emptySpatialFamily(),
  });
  const scheduler = useRef<SpatialFamily | null>(null);
  useEffect(() => {
    if (!enabled) return;
    const engine = new EngineClient();
    scheduler.current = new SpatialFamily(engine, () => {});
    return () => {
      scheduler.current?.cancel();
      engine.dispose();
      scheduler.current = null;
    };
  }, [enabled]);
  useEffect(() => {
    const job = scheduler.current;
    if (!job || !f) return;
    job.setChanged((state) => setDelivered({ key, state }));
    if (blocked) job.cancel();
    else job.generate(config, f, view ?? undefined);
    return () => job.cancel();
  }, [key]);
  return !enabled
    ? emptySpatialFamily()
    : delivered.key === key
      ? delivered.state
      : { ...emptySpatialFamily(), pending: true };
}
export function SpatialFamilyPanel({
  config,
  value,
  state,
  pending,
  fieldError,
  onChange,
}: {
  config: SpatialConfig;
  value?: SpatialFamilySettings;
  state: SpatialFamilyState;
  pending: boolean;
  fieldError: FieldErrorTarget;
  onChange: (
    change: (previous?: SpatialFamilySettings) => SpatialFamilySettings,
  ) => void;
}) {
  const f = value ?? spatialFamilyDefaults(config),
    targets = spatialFamilyTargets(config);
  const change = (patch: Partial<SpatialFamilySettings>) =>
    onChange((previous) => ({
      ...(previous ?? spatialFamilyDefaults(config)),
      ...patch,
    }));
  const budget = spatialFamilyBudget(config, f);
  const labels = distinctReadouts(state.members.map((m) => m.value));
  const target =
    fieldError.message || !budget.field
      ? fieldError
      : {
          ...fieldError,
          id: undefined,
          label: budget.field,
          message: budget.error!,
        };
  return (
    <FieldErrorContext.Provider value={target}>
      <section
        className="family-panel"
        aria-label="Spatial finite engraving settings"
      >
        <div className="section-label">FINITE ENGRAVING</div>
        <CheckSetting
          topic="finite engraving"
          label="Finite engraving"
          checked={f.enabled}
          onChange={(enabled) => change({ enabled })}
          help={tiered(
            "Overlay full-quality space curves from one changing shape parameter.",
            "Supports torus radius and tube radius, or a consumed expression a, with no construction, tangent-foot, orthotomic or base-curve inversion, without a shadow. Complete families show curves and the selected member's guides. Disable to restore the source study. Reveal members or move a band in Animation.",
          )}
        />
        {f.enabled && (
          <>
            <Field
              label="Family parameter"
              help="Only shape parameters used by an admitted curve are offered."
            >
              <select
                value={f.target}
                disabled={pending}
                onChange={(e) =>
                  onChange(() => ({
                    ...spatialFamilyDefaults(
                      config,
                      e.target.value as SpatialFamilySettings["target"],
                    ),
                    enabled: true,
                  }))
                }
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
                help="Both endpoints are members; descending and equal endpoints are allowed."
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
              help="2–32 whole members within work limits; refinement reserves additional geometry."
            >
              <input
                type="number"
                min="2"
                max="32"
                step="1"
                value={Number.isNaN(f.count) ? "" : f.count}
                onChange={(e) => {
                  const count = e.target.valueAsNumber;
                  onChange((previous) => {
                    const old = previous ?? f;
                    return {
                      ...old,
                      count,
                      ...(Number.isFinite(count) && count >= 2
                        ? {
                            selected: Math.min(old.selected, count - 1),
                            width: Math.min(old.width, count),
                          }
                        : {}),
                    };
                  });
                }}
              />
            </Field>
            <Field
              label="Family presentation"
              help="Inspect one member or show every curve with the selected member's guides."
            >
              <select
                value={f.presentation}
                onChange={(e) =>
                  change({
                    presentation: e.target
                      .value as SpatialFamilySettings["presentation"],
                  })
                }
              >
                <option value="family">Complete family</option>
                <option value="selected">Selected member · construction</option>
              </select>
            </Field>
            <Field label="Selected member">
              <select
                value={f.selected}
                onChange={(e) => change({ selected: Number(e.target.value) })}
              >
                {state.members.map((m, i) => (
                  <option key={m.id} value={m.id}>
                    {m.id + 1} · {labels[i]}
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
            {((budget.error && !budget.field) || state.error) && (
              <p className="field-error" role="alert">
                {budget.error ?? state.error}
              </p>
            )}
            <details>
              <summary>Members and limits</summary>
              <p className="note">
                A finite overlay, not a surface between curves. The selected
                member alone supplies enabled construction guides, while visible
                during motion. At most 500,000 reserved path points, four
                million retained numbers and 80 million weighted work units,
                including hidden geometry. One calculation runs at a time. The
                probe and source-study excursions wait until engraving is
                disabled.
              </p>
              <ol>
                {state.members.map((m, i) => (
                  <li key={m.id}>
                    {labels[i]}:{" "}
                    {m.error ?? (m.frame ? "Available" : "Pending")}
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
