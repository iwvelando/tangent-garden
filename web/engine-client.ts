import type { SpatialConfig, SpatialResult } from "./spatial/types";
import type { Bounds, Config, Frame } from "./types";

// What a spatial study asks Go for beside the study itself.
export type SpatialOptions = {
  diagnostics?: boolean;
  surfaceDiagnostics?: boolean;
  lightDiagnostics?: boolean;
};

// One worker per app, plus temporary ones during parameter-animation export
// and 3D parameter playback.
// Callers own cancellation; stale responses settle their
// promises but never replace a newer study or animation session.
export class EngineClient {
  private worker = new Worker(new URL("./engine.worker.ts", import.meta.url));
  private next = 0;
  private closed = false;
  private pending = new Map<
    number,
    {
      resolve: (value: any) => void;
      reject: (reason: Error) => void;
      timer: ReturnType<typeof setTimeout>;
    }
  >();
  constructor() {
    this.worker.onmessage = ({ data }) => {
      const task = this.pending.get(data.id);
      if (!task) return;
      clearTimeout(task.timer);
      this.pending.delete(data.id);
      if (data.error) task.reject(new EngineError(data.error, data.field));
      else task.resolve(data);
    };
    this.worker.onerror = () =>
      this.dispose(
        new Error(
          "The numerical engine could not start. Try reloading the page.",
        ),
      );
  }
  private request(message: object): Promise<any> {
    if (this.closed)
      return Promise.reject(new Error("Numerical engine is closed."));
    return new Promise((resolve, reject) => {
      const id = ++this.next;
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(
          new Error(
            "Calculation timed out. Reduce the resolution or simplify the expression.",
          ),
        );
      }, 30000);
      this.pending.set(id, { resolve, reject, timer });
      this.worker.postMessage({
        id,
        ...message,
        base: new URL(import.meta.env.BASE_URL, location.href).href,
      });
    });
  }
  async compute(config: Config, bounds?: Bounds): Promise<Frame> {
    const { result, config: resolved } = await this.request({
      action: "compute",
      config,
      bounds,
    });
    return { result, config: resolved };
  }
  // With diagnostics, the result also describes the base curve at every
  // sample: its curvature, torsion, and Frenet frame. With surface
  // diagnostics, it describes a surface patch or canal on the surface
  // probe's grid: its principal curvatures, directions, and focal points.
  async computeSpatial(
    config: SpatialConfig,
    options: SpatialOptions = {},
  ): Promise<import("./spatial/types").Frame> {
    return { config, result: await this.spatial(config, options) };
  }
  async spatial(
    config: SpatialConfig,
    options: SpatialOptions = {},
  ): Promise<SpatialResult> {
    return (
      await this.request({
        action: "spatial",
        spatial: config,
        ...(options.diagnostics ? { diagnostics: true } : {}),
        ...(options.surfaceDiagnostics ? { surfaceDiagnostics: true } : {}),
        ...(options.lightDiagnostics ? { lightDiagnostics: true } : {}),
      })
    ).result;
  }
  async tesseract(
    config: import("./tesseract/types").Config,
  ): Promise<import("./tesseract/types").Result> {
    return (await this.request({ action: "tesseract", tesseract: config }))
      .result;
  }
  async scalars(expressions: string[]): Promise<number[]> {
    return (await this.request({ action: "scalars", expressions })).values;
  }
  dispose(error = new Error("Numerical engine closed.")) {
    if (this.closed) return;
    this.closed = true;
    this.worker.terminate();
    for (const p of this.pending.values()) {
      clearTimeout(p.timer);
      p.reject(error);
    }
    this.pending.clear();
  }
}

// Engines used for a parameter-animation export: the app's own plus up to
// three temporary ones, leaving a core free for drawing and encoding. Each can
// hold ~100 MB at expert scale, so phones and tablets (a touch primary pointer)
// get at most one.
export function exportEngineCount(
  cores = navigator.hardwareConcurrency || 1,
  touch = matchMedia("(pointer: coarse)").matches,
) {
  return 1 + Math.max(0, Math.min(touch ? 1 : 3, cores - 2));
}

// Engines used for live playback of calculated frames in every notebook: the
// app's own plus one helper that calculates the next frame while the current
// one is drawn, wherever an export could add one.
export function playbackEngineCount(
  cores = navigator.hardwareConcurrency || 1,
  touch = matchMedia("(pointer: coarse)").matches,
) {
  return Math.min(2, exportEngineCount(cores, touch));
}

export function boundText(value: number) {
  if (value === Math.PI) return "pi";
  if (value === -Math.PI) return "-pi";
  // Whole multiples of pi, such as a roulette's closing period 4*pi.
  const turns = Math.round(value / Math.PI);
  if (turns !== 0 && Math.abs(turns) <= 400 && value === turns * Math.PI)
    return `${turns}*pi`;
  // Simple fractions of pi, such as a phase of pi/2, when the text evaluates
  // back to exactly this value.
  for (let q = 2; q <= 12; q++) {
    const p = Math.round((value * q) / Math.PI);
    if (p !== 0 && Math.abs(p) <= 400 * q && value === (p * Math.PI) / q)
      return `${p === 1 ? "" : p === -1 ? "-" : `${p}*`}pi/${q}`;
  }
  return String(value);
}

// An engine error, with the configuration path of the field it names when
// it is about one field.
export class EngineError extends Error {
  constructor(
    message: string,
    readonly field?: string,
  ) {
    super(message);
  }
}
