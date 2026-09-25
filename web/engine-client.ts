import type { Bounds, Config, Frame } from "./types";

// One worker per app. Callers own cancellation; stale responses settle their
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
      if (data.error) task.reject(new Error(data.error));
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
  async scalars(expressions: string[]): Promise<number[]> {
    return (await this.request({ action: "scalars", expressions })).values;
  }
  dispose(error = new Error("Numerical engine closed.")) {
    this.closed = true;
    this.worker.terminate();
    for (const p of this.pending.values()) {
      clearTimeout(p.timer);
      p.reject(error);
    }
    this.pending.clear();
  }
}

export function boundText(value: number) {
  if (value === 2 * Math.PI) return "2*pi";
  if (value === Math.PI) return "pi";
  if (value === -Math.PI) return "-pi";
  return String(value);
}
