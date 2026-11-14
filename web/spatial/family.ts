import { roundedGenerated } from "../atlas";
import { refineBudget } from "../refinement";
import { conform, LinkError, type SchemaOf } from "../study-link";
import type { SpatialConfig } from "./types";
import { EngineError, type EngineClient } from "../engine-client";
import { familyValues } from "../planar-family";
import { sharedBounds } from "./atlas-paint";
import type { Frame, SpatialResult, RefinementView } from "./types";
import { familyProgressAt } from "../family-motion";
import type { Pace } from "../timing";
import type { AnimationView } from "./animation";
import type { View } from "./renderer";
export type SpatialFamilySettings = {
  enabled: boolean;
  target: "radius" | "tube" | "a";
  from: number;
  to: number;
  count: number;
  selected: number;
  presentation: "family" | "selected";
  motion: "reveal" | "window";
  width: number;
};
export function spatialFamilyTargets(c: SpatialConfig) {
  if (c.shadow) return [];
  if (
    !["none", "tangent-foot", "orthotomic", "inversion"].includes(
      c.construction,
    ) ||
    (c.construction === "inversion" && c.inversion.input !== "base")
  )
    return [];
  if (c.format === "torus")
    return [
      { target: "radius" as const, label: "Torus radius" },
      { target: "tube" as const, label: "Tube radius" },
    ];
  if (
    c.format === "parametric" &&
    [c.curve.x, c.curve.y, c.curve.z].some((e) => /\ba\b/.test(e))
  )
    return [{ target: "a" as const, label: "Shape a" }];
  return [];
}
export function spatialFamilyDefaults(
  c: SpatialConfig,
  target = spatialFamilyTargets(c)[0]?.target ?? "tube",
): SpatialFamilySettings {
  const value = target === "a" ? c.curve.a : c[target];
  const half =
    target === "a" ? Math.max(1, Math.abs(value) * 0.25) : value * 0.5;
  let from = roundedGenerated(value - half, Math.abs(value) + half);
  let to = roundedGenerated(value + half, Math.abs(value) + half);
  if (target === "radius") {
    from = Math.max(0.1, from);
    if (from <= c.tube) {
      const middle = roundedGenerated(c.tube / 2 + c.radius / 2, c.radius);
      from = middle > c.tube ? middle : c.radius;
    }
    to = Math.min(20, to);
  } else if (target === "tube") {
    from = Math.max(0.01, from);
    if (to >= c.radius) {
      const middle = roundedGenerated(c.tube / 2 + c.radius / 2, c.radius);
      to = middle < c.radius ? middle : c.tube;
    }
  }
  return {
    enabled: false,
    target,
    from,
    to,
    count: c.adaptive ? 8 : 16,
    selected: 0,
    presentation: "family",
    motion: "reveal",
    width: 3,
  };
}
export function spatialFamilyBudget(
  c: SpatialConfig,
  f: SpatialFamilySettings,
) {
  const paths = c.construction === "none" ? 1 : 2;
  const points =
    f.count * paths * (c.samples + 1 + (c.adaptive ? refineBudget : 0));
  const numbers = points * 8 + f.count * (c.lines * 40 + 64);
  const work = points * (c.adaptive ? 32 : 9) * (c.adaptiveFrame ? 2 : 1);
  const [field, error] =
    !Number.isInteger(f.count) || f.count < 2 || f.count > 32
      ? [
          "Family members",
          "Family members must be a whole number from 2 to 32.",
        ]
      : !Number.isFinite(f.from)
        ? ["Family from", "Family from must be a finite constant."]
        : !Number.isFinite(f.to)
          ? ["Family to", "Family to must be a finite constant."]
          : !Number.isInteger(f.selected) ||
              f.selected < 0 ||
              f.selected >= f.count
            ? ["Selected member", "Selected member must be within the family."]
            : !Number.isInteger(f.width) || f.width < 1 || f.width > f.count
              ? [
                  "Band width",
                  "Band width must be a whole number within the family.",
                ]
              : !spatialFamilyTargets(c).some((t) => t.target === f.target)
                ? [
                    "Family parameter",
                    "This study does not support the selected family parameter. Disable engraving to return to your source study.",
                  ]
                : !Number.isFinite(points + numbers + work) ||
                    points > 500000 ||
                    numbers > 4000000 ||
                    work > 80000000
                  ? [
                      undefined,
                      "This family exceeds the work or geometry limit. Reduce members, samples, lines or refinement.",
                    ]
                  : [undefined, undefined];
  return { points, numbers, work, field, error };
}
const schema: SchemaOf<SpatialFamilySettings> = {
  fields: {
    enabled: "boolean",
    target: { options: { radius: true, tube: true, a: true } },
    from: "number",
    to: "number",
    count: "number",
    selected: "number",
    presentation: { options: { family: true, selected: true } },
    motion: { options: { reveal: true, window: true } },
    width: "number",
  },
};
export function spatialFamilyLink(raw: unknown, c: SpatialConfig) {
  if (raw === undefined) return undefined;
  const f = conform(raw, schema, spatialFamilyDefaults(c), "family");
  // Disabled settings still need bounded indices and counts. Applicability and
  // work are evaluated when enabled, so a source edit can remain shareable.
  const check = spatialFamilyBudget(c, f);
  if (
    check.error &&
    (f.enabled ||
      (check.field !== undefined && check.field !== "Family parameter"))
  )
    throw new LinkError("family", check.error);
  return f;
}

export type SpatialFamilyMember = {
  id: number;
  value: number;
  frame?: Frame;
  error?: string;
};
export type SpatialFamilyState = {
  members: SpatialFamilyMember[];
  pending: boolean;
  queued: number;
  retained: number;
  error?: string;
};
export const emptySpatialFamily = (): SpatialFamilyState => ({
  members: [],
  pending: false,
  queued: 0,
  retained: 0,
});
export type SpatialEngraving = {
  settings: SpatialFamilySettings;
  members: readonly SpatialFamilyMember[];
  visible: number[];
};
// Typed arrays are counted without expanding them into object properties.
export function spatialFamilyNumbers(value: unknown): number {
  if (typeof value === "number") return 1;
  if (ArrayBuffer.isView(value))
    return value.byteLength / (value instanceof Float64Array ? 8 : 4);
  if (!value || typeof value !== "object") return 0;
  let n = 0;
  for (const v of Object.values(value)) n += spatialFamilyNumbers(v);
  return n;
}
export class SpatialFamily {
  state = emptySpatialFamily();
  private epoch = 0;
  private working = false;
  private config: SpatialConfig | null = null;
  private remaining: number[] = [];
  private view?: RefinementView;
  private target: SpatialFamilySettings["target"] = "tube";
  private failed?: string;
  constructor(
    private engine: Pick<EngineClient, "computeSpatial"> &
      Partial<Pick<EngineClient, "dispose">>,
    private changed: (s: SpatialFamilyState) => void,
  ) {}
  setChanged(changed: (s: SpatialFamilyState) => void) {
    this.changed = changed;
  }
  private emit() {
    this.state = { ...this.state, queued: this.remaining.length };
    this.changed(this.state);
  }
  cancel() {
    this.epoch++;
    this.config = null;
    this.remaining = [];
    this.state = emptySpatialFamily();
    this.emit();
  }
  generate(
    config: SpatialConfig,
    f: SpatialFamilySettings,
    view?: RefinementView,
  ) {
    this.cancel();
    const error = this.failed ?? spatialFamilyBudget(config, f).error;
    if (error) {
      this.state = { ...this.state, error };
      this.emit();
      return;
    }
    this.config = structuredClone(config);
    this.view = view && structuredClone(view);
    this.target = f.target;
    const current = f.target === "a" ? config.curve.a : config[f.target];
    this.state = {
      ...emptySpatialFamily(),
      pending: true,
      members: familyValues(f, current).map((value, id) => ({ id, value })),
    };
    this.remaining = this.state.members.map((m) => m.id);
    this.emit();
    this.pump();
  }
  private pump() {
    if (this.working || !this.config) return;
    const id = this.remaining.shift();
    if (id === undefined) {
      this.state = { ...this.state, pending: false };
      this.emit();
      return;
    }
    const member = this.state.members[id];
    // Equal settings identify exactly the same ordinary request, never merely
    // nearby curves. Slots remain separate for selection and timeline identity.
    const duplicate = this.state.members
      .slice(0, id)
      .find((m) => m.value === member.value && (m.frame || m.error));
    if (duplicate) {
      this.state = {
        ...this.state,
        members: this.state.members.map((m) =>
          m.id === id
            ? { ...m, frame: duplicate.frame, error: duplicate.error }
            : m,
        ),
      };
      this.emit();
      this.pump();
      return;
    }
    const config = structuredClone(this.config);
    if (this.target === "a") config.curve.a = member.value;
    else config[this.target] = member.value;
    const token = this.epoch;
    this.working = true;
    this.emit();
    const refuse = (error: string) => {
      this.state = {
        ...this.state,
        members: this.state.members.map((m) =>
          m.id === id ? { ...m, error } : m,
        ),
      };
    };
    void this.engine
      .computeSpatial(config, this.view ? { view: this.view } : {})
      .then(
        (frame) => {
          if (token !== this.epoch) return;
          const path =
            config.construction === "none"
              ? frame.result.base
              : config.construction === "inversion"
                ? frame.result.inversion?.points
                : frame.result.projection?.points;
          if (
            !path?.some(
              (p, i) =>
                p &&
                i > 0 &&
                path[i - 1] &&
                !(frame.result.inversion?.breaks ??
                  frame.result.projection?.breaks ??
                  frame.result.breaks)[i],
            )
          ) {
            refuse("No finite curve for this member.");
            return;
          }
          const entries = spatialFamilyNumbers(frame.result);
          if (this.state.retained + entries > 4000000) {
            refuse("Family retained geometry limit reached.");
            return;
          }
          this.state = {
            ...this.state,
            retained: this.state.retained + entries,
            members: this.state.members.map((m) =>
              m.id === id ? { ...m, frame } : m,
            ),
          };
        },
        (error: Error) => {
          if (error instanceof EngineError) {
            if (token === this.epoch) refuse(error.message);
          } else {
            this.failed = `The family's numerical engine stopped: ${error.message} Disable and re-enable engraving to retry.`;
            this.remaining = [];
            this.config = null;
            this.state = { ...this.state, pending: false, error: this.failed };
            this.engine.dispose?.();
            this.emit();
          }
        },
      )
      .finally(() => {
        this.working = false;
        if (token === this.epoch) this.emit();
        this.pump();
      });
  }
}
export function spatialFamilyVisible(
  f: SpatialFamilySettings,
  n: number,
  progress?: number,
) {
  if (f.presentation === "selected") return [f.selected];
  if (progress === undefined) return Array.from({ length: n }, (_, i) => i);
  const p = Math.max(0, Math.min(1, progress));
  if (f.motion === "reveal")
    return Array.from(
      { length: Math.min(n, 1 + Math.floor(p * (n - 1))) },
      (_, i) => i,
    );
  const width = Math.max(1, Math.min(n, f.width));
  const start =
    p === 1 ? n - width : Math.min(n - width, Math.floor(p * (n - width + 1)));
  return Array.from({ length: width }, (_, i) => start + i);
}
export function composeSpatialFamily(
  config: SpatialConfig,
  settings: SpatialFamilySettings,
  members: readonly SpatialFamilyMember[],
  progress?: number,
): Frame {
  const bounds = sharedBounds(
    members.flatMap((m) => (m.frame ? [m.frame.result.bounds] : [])),
  ) ?? { center: { x: 0, y: 0, z: 0 }, radius: 1 };
  const visible = spatialFamilyVisible(settings, members.length, progress);
  const result: SpatialResult = {
    base: [],
    minus: [],
    plus: [],
    breaks: [],
    mesh: {
      vertices: new Float64Array(),
      triangles: new Int32Array(),
      sampleIndex: new Int32Array(),
    },
    rulings: [],
    bounds,
    radius: bounds.radius,
    omitted: 0,
    invalid: 0,
    engraving: { settings, members, visible },
    ...(!visible.some((id) => members[id]?.frame) && {
      unavailable:
        "No available member is visible. Select an available member or another timeline position.",
    }),
  };
  return { config, result };
}
export function spatialFamilyRecord(e: SpatialEngraving) {
  return {
    settings: e.settings,
    visible: e.visible,
    members: e.members.map((m) => ({
      id: m.id,
      value: m.value,
      ...(m.error ? { error: m.error } : { available: !!m.frame }),
    })),
    partial: e.members.some((m) => !m.frame),
  };
}

export function sampleSpatialFamily(
  config: SpatialConfig,
  settings: SpatialFamilySettings,
  members: readonly SpatialFamilyMember[],
  setup: { duration: number; repeat: "once" | "back-and-forth"; pace: Pace },
  view: View,
  time: number,
  length: number,
  camera: "hold" | "current",
): AnimationView {
  const progress = familyProgressAt(time, setup);
  return {
    frame: composeSpatialFamily(config, settings, members, progress),
    final: composeSpatialFamily(config, settings, members),
    camera,
    heldView: view,
    length,
    progress,
    time,
    mode: "reveal",
    complete: setup.repeat === "once" && time === 1,
  };
}
