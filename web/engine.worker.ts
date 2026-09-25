/// <reference lib="webworker" />
import type { Bounds, Config, Result } from "./types";
declare const Go: new () => {
  importObject: WebAssembly.Imports;
  run(instance: WebAssembly.Instance): Promise<void>;
};
declare const tangentGardenCompute: (json: string) => string;
declare const tangentGardenScalars: (json: string) => string;
let ready: Promise<void> | undefined;
async function init(base: string) {
  // Classic worker keeps Go's runtime unmodified and works on ordinary static hosts.
  importScripts(`${base}wasm_exec.js`);
  const go = new Go();
  const response = await fetch(`${base}engine.wasm`);
  if (!response.ok)
    throw new Error(`Engine download failed (${response.status})`);
  const { instance } = await WebAssembly.instantiate(
    await response.arrayBuffer(),
    go.importObject,
  );
  void go.run(instance);
}
self.onmessage = async ({
  data,
}: MessageEvent<{
  id: number;
  config: Config;
  bounds?: Bounds;
  expressions?: string[];
  action: "compute" | "scalars";
  base: string;
}>) => {
  try {
    await (ready ??= init(data.base).catch((error) => {
      ready = undefined;
      throw error;
    }));
    const scalar = (expressions: string[]): number[] => {
      const parsed = JSON.parse(
        tangentGardenScalars(JSON.stringify(expressions)),
      );
      if (parsed.error) throw new Error(parsed.error);
      return parsed.values;
    };
    if (data.action === "scalars") {
      self.postMessage({ id: data.id, values: scalar(data.expressions ?? []) });
      return;
    }
    const config = structuredClone(data.config);
    if (data.bounds) {
      const [min, max] = scalar([data.bounds.min, data.bounds.max]);
      config.curve.min = min;
      config.curve.max = max;
    }
    const numbers = [
      config.curve.min,
      config.curve.max,
      config.curve.a,
      config.offset,
      config.source.position.x,
      config.source.position.y,
      config.source.angle,
      config.nIncident,
      config.nTransmitted,
      config.samples,
      config.lines,
      ...(config.source.kind === "point" &&
      config.source.coordinates === "polar"
        ? [config.source.radius, config.source.theta]
        : []),
    ];
    if (!numbers.every(Number.isFinite))
      throw new Error("Fill in each numeric field with a finite number.");
    if (!Number.isInteger(config.samples) || !Number.isInteger(config.lines))
      throw new Error("Samples and construction lines must be whole numbers.");
    const result: Result | { error: string } = JSON.parse(
      tangentGardenCompute(JSON.stringify(config)),
    );
    if (!("error" in result) && result.sourcePosition)
      config.source.position = result.sourcePosition;
    self.postMessage({
      id: data.id,
      ...("error" in result ? result : { result, config }),
    });
  } catch (error) {
    self.postMessage({
      id: data.id,
      error: error instanceof Error ? error.message : String(error),
    });
  }
};
