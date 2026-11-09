import type { EngineClient } from "../engine-client";
import { tiered } from "../help";
import { turnTo } from "../named-views";
import {
  defaultAnimation,
  presetStudy,
  type SpatialAnimation,
  type SpatialCamera,
  type SpatialStudy,
} from "./link";
import { defaultLayers, initialView, lensAngles, viewBasis } from "./scene";
import type { HarmonicCurve, SpatialConfig, Vec3 } from "./types";

export const harmonicFitEntryHelp = tiered(
  "Fit a closed torus knot, expression or harmonic curve with turning vectors, then compare.",
  "The study must build on the base curve, whose ends must meet. Sampling permits 4,096 points and 32,768 evaluations, coordinates and fitted vectors within ±100,000, and length at least 0.000001. Open ends, gaps, jumps and unresolved detail are refused. Back keeps your study; adoption replaces it.",
);
export const harmonicFitTermsHelp = tiered(
  "Choose 1–8 turning vectors, largest first; adding one never reorders the rest.",
  "The center is separate and free. Terms rank by |A|² + |B|², frequencies 1–256. A source with fewer terms offers only those. Sample error counts 1,024 positions; only even pace states a bound between them, and a small error never guarantees the same knot: a fit can pass through itself.",
);
export const harmonicFitParameterHelp = tiered(
  "Source parameter can recover a finite sum exactly; even pace ignores how the source was timed.",
  "Source parameter samples the source at equal steps of its own t, so a torus knot is recovered exactly. Even pace samples equal lengths along its polygon: it never recovers those exactly, but rewriting t leaves it unchanged and it needs fewer terms when t runs very unevenly. Both keep the start and direction.",
);

export type HarmonicParameter = "source" | "arc-length";

export type HarmonicFitRequest = {
  source?: SpatialConfig;
  parameter?: HarmonicParameter;
  count: number;
};
export type HarmonicEllipse = { major: number; minor: number; normal: Vec3 };
export type HarmonicFitResult = {
  curve: HarmonicCurve;
  bounds: { center: Vec3; radius: number };
  ellipses: HarmonicEllipse[];
  parameter: HarmonicParameter;
  available: number;
  rms: number;
  maxResidual: number;
  continuousBound?: number;
  length: number;
  extent: number;
  tolerance: number;
  evaluations: number;
  outline?: { points: Vec3[] };
};

export type HarmonicFitState = {
  count: number;
  parameter: HarmonicParameter;
  pending: boolean;
  fit?: HarmonicFitResult;
  outline?: Vec3[];
  error?: string;
};

// One disposable worker and at most one request at a time, as in
// FourierFitSession: a term change overwrites the one wanted count, and a new
// parameter disposes the worker, so an obsolete reply cannot arrive.
export class HarmonicFitSession {
  private client: EngineClient | null = null;
  private generation = 0;
  private running = false;
  private needsSource = true;
  private state: HarmonicFitState = {
    count: 8,
    parameter: "source",
    pending: true,
  };
  constructor(
    private readonly make: () => EngineClient,
    private readonly source: SpatialConfig,
    private readonly publish: (state: HarmonicFitState) => void,
  ) {
    this.fresh();
  }
  private set(change: Partial<HarmonicFitState>) {
    this.state = { ...this.state, ...change };
    this.publish(this.state);
  }
  private fresh() {
    this.client?.dispose();
    this.client = this.make();
    this.generation++;
    this.running = false;
    this.needsSource = true;
    this.set({ pending: true, error: undefined });
    void this.pump();
  }
  private async pump() {
    if (this.running) return;
    this.running = true;
    const generation = this.generation;
    const client = this.client!;
    while (generation === this.generation) {
      const { count, parameter, fit } = this.state;
      const asked = this.needsSource;
      if (
        !asked &&
        fit &&
        fit.curve.terms.length === Math.min(count, fit.available)
      ) {
        this.running = false;
        this.set({ pending: false });
        return;
      }
      try {
        const reply = await client.spatialFit(
          asked ? { source: this.source, parameter, count } : { count },
        );
        if (generation !== this.generation) return;
        this.needsSource = false;
        const { outline, ...selected } = reply;
        this.set({
          fit: selected,
          ...(outline && { outline: outline.points }),
          error: undefined,
        });
      } catch (e) {
        if (generation !== this.generation) return;
        this.running = false;
        this.set({
          pending: false,
          fit: undefined,
          outline: undefined,
          error: e instanceof Error ? e.message : String(e),
        });
        return;
      }
    }
  }
  choose(count: number) {
    this.set({ count, pending: true });
    void this.pump();
  }
  parameterize(parameter: HarmonicParameter) {
    if (parameter === this.state.parameter) return;
    this.state = { ...this.state, parameter };
    this.fresh();
  }
  cancel() {
    this.generation++;
    this.client?.dispose();
    this.client = null;
  }
}

// Which studies the entry admits; the engine's own refusals cover the rest.
export function harmonicFitEligible(c: SpatialConfig) {
  return (
    (c.format === "torus" ||
      c.format === "parametric" ||
      c.format === "harmonic") &&
    (c.input === "base" || !c.input)
  );
}

// The principal spreads of points as a view projects them.
function projectedSpread(points: Vec3[], view: SpatialCamera) {
  const { right, up } = viewBasis({
    ...view,
    center: { x: 0, y: 0, z: 0 },
    radius: 1,
  });
  let mx = 0,
    my = 0,
    xx = 0,
    yy = 0,
    xy = 0;
  const along = (a: number[], p: Vec3) => a[0] * p.x + a[1] * p.y + a[2] * p.z;
  for (const p of points) {
    mx += along(right, p) / points.length;
    my += along(up, p) / points.length;
  }
  for (const p of points) {
    const x = along(right, p) - mx,
      y = along(up, p) - my;
    xx += (x * x) / points.length;
    yy += (y * y) / points.length;
    xy += (x * y) / points.length;
  }
  const root = Math.hypot((xx - yy) / 2, xy);
  return {
    major: Math.sqrt((xx + yy) / 2 + root),
    minor: Math.sqrt(Math.max(0, (xx + yy) / 2 - root)),
  };
}

// A share of the widest spread any candidate shows; below it a view counts as
// edge-on. Three of the candidates look along nearly perpendicular axes, so a
// circle in any plane shows at least 1/√3 of its width to one of them.
const openEnough = 0.3;

// The opening view of a fit: the notebook's default orbit, unless the outline
// is much thinner there than it can be, then the first named view that shows
// it adequately open, or failing all of them the one showing the most.
export function harmonicFitOpeningView(outline: Vec3[]): SpatialCamera {
  const views = [
    initialView,
    ...(["isometric", "front", "side", "top"] as const).map((name) =>
      turnTo(initialView, name),
    ),
  ];
  const seen = views.map((view) => ({
    view,
    ...projectedSpread(outline, view),
  }));
  const major = Math.max(...seen.map((s) => s.major)),
    widest = Math.max(...seen.map((s) => s.minor)),
    // A straight line's width is the root of a rounded variance, about 10⁻⁸ of
    // its length, which must decide nothing.
    minor = widest > 1e-6 * major ? widest : 0;
  const open = seen.find(
    (s) => s.major >= openEnough * major && s.minor >= openEnough * minor,
  );
  const best = seen.reduce((a, b) =>
    b.major * b.minor > a.major * a.minor ? b : a,
  );
  return { ...(open ?? best).view };
}

// A reveal under one whole turn of the camera, since a spatial chain's depth
// shows only as it moves: an ordinary path, starting and ending on the opening
// view, which the study's camera choice can change like any other.
function harmonicFitTurn(view: SpatialCamera): SpatialAnimation {
  const key = {
    yaw: view.yaw,
    pitch: view.pitch,
    zoom: view.zoom,
    panX: view.panX,
    panY: view.panY,
  };
  return {
    ...structuredClone(defaultAnimation),
    camera: "path",
    duration: 16,
    path: {
      style: "steady",
      keys: [
        { ...key, name: "Opening view", turns: 0 },
        { ...key, name: "One turn around", turns: 1 },
      ],
    },
  };
}

// An ordinary harmonic study of the fit, opening on a camera of its own:
// nothing of the source's construction, animation or framing carries over,
// since a source's camera can show the fit nothing at all.
export function harmonicFitStudy(
  curve: HarmonicCurve,
  view: SpatialCamera,
): SpatialStudy {
  const base = presetStudy(0);
  return {
    ...base,
    config: {
      ...base.config,
      format: "harmonic",
      construction: "none",
      input: "base",
      harmonic: curve,
      samples: 1200,
      lines: 48,
      adaptive: true,
    },
    layers: { ...defaultLayers },
    animation: harmonicFitTurn(view),
    view,
    projection: "orthographic",
    lensAngle: lensAngles.initial,
    story: undefined,
  };
}

const short = (x: number) => Number(x.toPrecision(3)).toString();
// What one term actually traces, in words. The tilt is against the first
// term's plane: a planar epicycle chain would read zero throughout.
export function harmonicEllipseWords(
  e: HarmonicEllipse,
  reference?: HarmonicEllipse,
) {
  const flat = e.minor <= 1e-9 * e.major;
  if (flat) return `segment of half-length ${short(e.major)}`;
  const round = e.major - e.minor <= 1e-3 * e.major;
  const shape = round
    ? `circle of radius ${short(e.major)}`
    : `ellipse ${short(e.major)} × ${short(e.minor)}`;
  const n = reference?.normal;
  if (!n || (n.x === 0 && n.y === 0 && n.z === 0)) return shape;
  const dot = Math.abs(n.x * e.normal.x + n.y * e.normal.y + n.z * e.normal.z);
  const tilt = Math.round((Math.acos(Math.min(1, dot)) * 180) / Math.PI);
  return tilt ? `${shape}, tilted ${tilt}°` : shape;
}
