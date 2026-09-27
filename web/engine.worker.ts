/// <reference lib="webworker" />
import { usesPole, type Bounds, type Config, type Result } from "./types";
declare const Go: new () => {
  importObject: WebAssembly.Imports;
  run(instance: WebAssembly.Instance): Promise<void>;
};
declare const tangentGardenCompute: (json: string) => string;
declare const tangentGardenSpatial: (json: string) => string;
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
  action: "compute" | "scalars" | "spatial";
  spatial?: import("./spatial/types").SpatialConfig;
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
    if (data.action === "spatial") {
      if (
        !data.spatial ||
        ![
          data.spatial.length,
          data.spatial.samples,
          data.spatial.lines,
          ...(data.spatial.format === "parametric"
            ? [
                data.spatial.curve.min,
                data.spatial.curve.max,
                data.spatial.curve.a,
              ]
            : [
                data.spatial.radius,
                data.spatial.tube,
                data.spatial.p,
                data.spatial.q,
              ]),
        ].every(Number.isFinite)
      )
        throw new Error("Fill in each spatial parameter with a finite number.");
      if (
        !Number.isInteger(data.spatial.samples) ||
        !Number.isInteger(data.spatial.lines)
      )
        throw new Error("Samples and tangent lines must be whole numbers.");
      const result = JSON.parse(
        tangentGardenSpatial(JSON.stringify(data.spatial)),
      );
      self.postMessage({
        id: data.id,
        ...("error" in result ? result : { result }),
      });
      return;
    }
    const config = structuredClone(data.config);
    if (data.bounds) {
      const [min, max] = scalar([data.bounds.min, data.bounds.max]);
      config.curve.min = min;
      config.curve.max = max;
    }
    const stacked = config.kind === "offset" && config.stack.enabled;
    const numbers = [
      config.curve.min,
      config.curve.max,
      config.curve.a,
      config.offset,
      config.distance,
      config.source.position.x,
      config.source.position.y,
      config.source.angle,
      config.nIncident,
      config.nTransmitted,
      config.samples,
      config.lines,
      ...(usesPole(config.kind) ||
      (config.kind === "inversion" && usesPole(config.inversion.of))
        ? [config.pole.x, config.pole.y]
        : []),
      ...(config.kind === "inversion"
        ? [
            config.inversion.center.x,
            config.inversion.center.y,
            config.inversion.radius,
          ]
        : []),
      ...(stacked
        ? [config.stack.from, config.stack.to, config.stack.count]
        : []),
      ...(config.kind === "rolling"
        ? config.rolling.shape === "curve"
          ? [
              config.rolling.curve.min,
              config.rolling.curve.max,
              config.rolling.curve.start,
              config.rolling.point.x,
              config.rolling.point.y,
            ]
          : [config.rolling.radius, config.rolling.arm, config.rolling.phase]
        : []),
      ...(config.curve.format === "roulette"
        ? [
            config.curve.roulette.radius,
            config.curve.roulette.arm,
            config.curve.roulette.phase,
            ...(config.curve.roulette.roll === "line"
              ? []
              : [config.curve.roulette.fixedRadius]),
          ]
        : []),
      ...(config.curve.format === "lissajous"
        ? Object.values(config.curve.lissajous)
        : []),
      ...(config.curve.format === "fourier"
        ? config.curve.terms.flatMap((term) => [
            term.frequency,
            term.radius,
            term.phase,
          ])
        : []),
      ...(config.curve.format === "pursuit"
        ? [
            config.curve.pursuit.capture,
            ...config.curve.pursuit.pursuers.flatMap((p) => [
              p.x,
              p.y,
              p.speed,
            ]),
          ]
        : []),
      ...(config.source.kind === "point" &&
      config.source.coordinates === "polar"
        ? [config.source.radius, config.source.theta]
        : []),
    ];
    if (!numbers.every(Number.isFinite))
      throw new Error("Fill in each numeric field with a finite number.");
    if (!Number.isInteger(config.samples) || !Number.isInteger(config.lines))
      throw new Error("Samples and construction lines must be whole numbers.");
    if (stacked && !Number.isInteger(config.stack.count))
      throw new Error("The number of offsets must be a whole number.");
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
