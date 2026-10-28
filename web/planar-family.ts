import type { FamilyAnimation } from "./family-motion";
import {
  applyTracks,
  availableTargets,
  targetLabel,
  targetValue,
} from "./animation";
import { roundedGenerated } from "./atlas";
import { EngineError, type EngineClient } from "./engine-client";
import type { PlotCamera, PlanarStudy } from "./planar-link";
import { refineBudget } from "./refinement";
import { usesPole, type Config, type Frame, type ViewRect } from "./types";

export type FamilyTarget =
  | "sourceTheta"
  | "sourceRadius"
  | "sourceX"
  | "sourceY"
  | "poleX"
  | "poleY"
  | "a";
export type FamilySettings = {
  enabled: boolean;
  target: FamilyTarget;
  from: number;
  to: number;
  count: number;
  selected: number;
  presentation: "family" | "selected";
  allConstruction?: boolean;
  camera?: PlotCamera;
  animation?: FamilyAnimation;
};
const consumedA = (c: Config) => {
  const format = c.curve.format;
  const expressions =
    format === "parametric"
      ? [c.curve.x, c.curve.y]
      : format === "cartesian"
        ? [c.curve.y]
        : format === "polar"
          ? [c.curve.r]
          : [];
  if (c.kind === "envelope")
    expressions.push(
      ...(c.envelope.mode === "angle"
        ? [c.envelope.angle]
        : c.envelope.mode === "chord"
          ? [c.envelope.x, c.envelope.y]
          : [c.envelope.radius]),
    );
  if (c.kind === "rolling" && c.rolling.shape === "curve")
    expressions.push(c.rolling.curve.x, c.rolling.curve.y);
  return expressions.some((e) => /\ba\b/.test(e));
};
// One curated descriptor owns applicability and defaults; never change a
// study's definition to make a dormant source, pole or coefficient active.
const catalog: { target: FamilyTarget; supports: (c: Config) => boolean }[] = [
  ...(["sourceTheta", "sourceRadius", "sourceX", "sourceY"] as const).map(
    (target) => ({
      target,
      supports: (c: Config) => availableTargets(c).includes(target),
    }),
  ),
  ...(["poleX", "poleY"] as const).map((target) => ({
    target,
    supports: (c: Config) => usesPole(c.kind) || usesPole(c.input),
  })),
  { target: "a", supports: consumedA },
];
export function familyTargets(c: Config) {
  if (
    ["implicit", "attractor", "field", "pursuit"].includes(c.curve.format) ||
    (c.kind === "offset" && c.stack.enabled) ||
    (c.kind === "envelope" && c.envelope.mode === "circle")
  )
    return [];
  return catalog
    .filter((t) => t.supports(c))
    .map((t) => ({ ...t, label: targetLabel(t.target) }));
}
export function familyDefaults(
  c: Config,
  target = familyTargets(c)[0]?.target ?? "a",
): FamilySettings {
  const value = targetValue(c, target, 0.8);
  const half = Math.max(1, Math.abs(value) * 0.25);
  const count = 16;
  // Theta is periodic: a whole inclusive turn would end on the first lamp, so
  // the default stops one step short and every member is a distinct position.
  return {
    enabled: false,
    target,
    from:
      target === "sourceTheta"
        ? value
        : target === "sourceRadius"
          ? Math.max(0, roundedGenerated(value - half, half + Math.abs(value)))
          : roundedGenerated(value - half, half + Math.abs(value)),
    to:
      target === "sourceTheta"
        ? value + (2 * Math.PI * (count - 1)) / count
        : roundedGenerated(value + half, half + Math.abs(value)),
    count,
    selected: 0,
    presentation: "family",
  };
}
export function familyValues(f: FamilySettings, current: number) {
  if (f.from === f.to) return Array(f.count).fill(f.from) as number[];
  const reverse = f.from > f.to;
  const a = reverse ? f.to : f.from,
    b = reverse ? f.from : f.to;
  return Array.from({ length: f.count }, (_, index) => {
    const i = reverse ? f.count - 1 - index : index;
    if (i === 0) return a;
    if (i === f.count - 1) return b;
    const p = i / (f.count - 1);
    const value = (1 - p) * a + p * b;
    const scale = Math.max(Math.abs(f.from), Math.abs(f.to), Math.abs(current));
    return i * 2 === f.count - 1 &&
      Math.abs(value - current) <= Number.EPSILON * scale
      ? current
      : roundedGenerated(value, scale);
  });
}
export function familyBudget(
  c: Config,
  f: FamilySettings,
  diagnostics = false,
) {
  const refined = !!c.adaptive;
  const paths = 2 + (c.input === "curve" ? 0 : 1);
  const points = f.count * paths * (c.samples + (refined ? refineBudget : 0));
  const work =
    points *
    (c.input === "curve" ? 9 : 81) *
    (refined ? 8 : 1) *
    (["rolling", "involute"].includes(c.kind) ? 16 : 1) *
    (refined && c.adaptiveFrame ? 2 : 1);
  // Reserve sampled diagnostics, representative geometry (including Fourier
  // guides and rolling placements), refinement parameters/flags and reach.
  const numbers =
    points * (refined && c.adaptiveFrame ? 16 : 7) +
    f.count *
      ((diagnostics ? c.samples * 12 : 0) +
        c.lines * (40 + c.curve.terms.length * 8));
  // An error about one setting names the field shown under that control; the
  // aggregate limit belongs to no single field.
  const [field, error] = !familyTargets(c).some((t) => t.target === f.target)
    ? [
        "Family parameter",
        "This family target is not supported by the current study. Your source study is kept.",
      ]
    : !Number.isInteger(f.count) || f.count < 2 || f.count > 32
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
            : points > 500000 || numbers > 4000000 || work > 80000000
              ? [
                  undefined,
                  "This family exceeds the work or geometry limit. Reduce members, samples, lines or refinement. Your source study is kept.",
                ]
              : [undefined, undefined];
  return { points, work, numbers, error, field };
}
export type FamilyMember = {
  id: number;
  value: number;
  frame?: Frame;
  error?: string;
};
export type FamilyState = {
  members: FamilyMember[];
  queued: number;
  pending: boolean;
  retained: number;
  error?: string;
  failed?: string;
};
export const emptyFamily = (): FamilyState => ({
  members: [],
  queued: 0,
  pending: false,
  retained: 0,
});
export function numericEntries(value: unknown): number {
  if (typeof value === "number") return 1;
  if (!value || typeof value !== "object") return 0;
  return Object.values(value).reduce<number>(
    (n, v) => n + numericEntries(v),
    0,
  );
}
// Full-quality frames are retained exactly once. Selection never recomputes
// or duplicates geometry. One active computation and at most 31 unsent indices;
// replacement may wait for that single obsolete request, never queue behind it.
export class PlanarFamily {
  state = emptyFamily();
  private generation = 0;
  private working = false;
  private source: PlanarStudy | null = null;
  private settings: FamilySettings | null = null;
  private view?: ViewRect;
  private remaining: number[] = [];
  private failed?: string;
  constructor(
    private engine: Pick<EngineClient, "compute"> &
      Partial<Pick<EngineClient, "dispose">>,
    private changed: (state: FamilyState) => void,
  ) {}
  setChanged(changed: (state: FamilyState) => void) {
    this.changed = changed;
  }
  private emit() {
    this.state = { ...this.state, queued: this.remaining.length };
    this.changed(this.state);
  }
  cancel() {
    this.generation++;
    this.source = null;
    this.settings = null;
    this.remaining = [];
    this.state = {
      ...emptyFamily(),
      ...(this.failed && { error: this.failed, failed: this.failed }),
    };
    this.emit();
  }
  generate(study: PlanarStudy, settings: FamilySettings, view?: ViewRect) {
    this.cancel();
    const error =
      this.failed ??
      familyBudget(study.config, settings, study.probe.enabled).error;
    if (error) {
      this.state = { ...this.state, error };
      this.emit();
      return;
    }
    this.source = structuredClone(study);
    this.settings = structuredClone(settings);
    this.view = view && { ...view };
    this.state = {
      ...emptyFamily(),
      pending: true,
      members: familyValues(
        settings,
        targetValue(study.config, settings.target, study.length),
      ).map((value, id) => ({ id, value })),
    };
    this.remaining = this.state.members.map((m) => m.id);
    this.emit();
    this.pump();
  }
  private pump() {
    if (this.working || !this.source || !this.settings) return;
    const index = this.remaining.shift();
    if (index === undefined) {
      this.state = { ...this.state, pending: false };
      this.emit();
      return;
    }
    const generation = this.generation;
    const study = this.source;
    const member = this.state.members[index];
    const config = applyTracks(
      study.config,
      [{ target: this.settings.target, from: member.value, to: member.value }],
      0,
      study.length,
    ).config;
    this.working = true;
    this.emit();
    const current = () => generation === this.generation;
    const refuse = (error: string) => {
      this.state = {
        ...this.state,
        members: this.state.members.map((m, i) =>
          i === index ? { ...m, error } : m,
        ),
      };
    };
    void this.engine
      .compute(config, study.bounds, {
        diagnostics: study.probe.enabled,
        ...(this.view && { view: this.view }),
      })
      .then(
        (frame) => {
          if (!current()) return;
          const count = numericEntries(frame.result);
          if (this.state.retained + count > 4000000) {
            refuse("Family retained geometry limit reached.");
            return;
          }
          if (!frame.result.derived.some((p) => p)) {
            refuse("No finite derived curve for this member.");
            return;
          }
          this.state = {
            ...this.state,
            retained: this.state.retained + count,
            members: this.state.members.map((m, i) =>
              i === index ? { ...m, frame: structuredClone(frame) } : m,
            ),
          };
        },
        (error: Error) => {
          if (!(error instanceof EngineError)) {
            this.failed = `The family’s numerical engine stopped: ${error.message} Disable and re-enable the family to retry.`;
            this.remaining = [];
            this.source = null;
            this.state = {
              ...this.state,
              pending: false,
              error: this.failed,
              failed: this.failed,
            };
            this.engine.dispose?.();
            this.emit();
          } else if (current()) refuse(error.message);
        },
      )
      .finally(() => {
        this.working = false;
        if (current()) this.emit();
        this.pump();
      });
  }
}
