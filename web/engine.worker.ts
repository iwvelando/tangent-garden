/// <reference lib="webworker" />
// No import or export statements: the dev server serves this classic worker
// unbundled, and either would stop it from starting. Reference types inline
// (scripts/test-dev-worker.mjs checks this).

// Mirrors usesPole in types.ts; the Record type fails to compile if they drift.
const poleKinds: Record<import("./types").PoleKind, true> = {
  pedal: true,
  contrapedal: true,
  orthotomic: true,
};
const usesPole = (kind: string) => Object.hasOwn(poleKinds, kind);
declare const Go: new () => {
  importObject: WebAssembly.Imports;
  run(instance: WebAssembly.Instance): Promise<void>;
};
declare const tangentGardenCompute: (json: string) => string;
declare const tangentGardenTesseract: (json: string) => string;
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
  config: import("./types").Config;
  bounds?: import("./types").Bounds;
  expressions?: string[];
  action: "compute" | "scalars" | "spatial" | "tesseract";
  tesseract?: import("./tesseract/types").Config;
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
    if (data.action === "tesseract") {
      const q = data.tesseract;
      if (!q) throw new Error("Enter a 4D study definition.");
      if (
        q.object !== "lift" &&
        q.object !== "bypass" &&
        (!Array.isArray(q.angles) || q.angles.length !== 6)
      )
        throw new Error("Enter six tesseract rotation angles.");
      const curved = q.object === "ball" || q.object === "tube";
      const lift = q.object === "lift" ? q.lift : undefined;
      const route = q.object === "bypass" ? q.bypass : undefined;
      if (q.object === "bypass" && !route)
        throw new Error("Enter shell bypass parameters.");
      if (route) {
        if (!Array.isArray(route.outside) || route.outside.length !== 3)
          throw new Error("Outside point requires three coordinates.");
        const fields: [string, number][] = [
          ...route.outside.map(
            (value, i) =>
              [`Outside point ${["x", "y", "z"][i]}`, value] as [
                string,
                number,
              ],
          ),
          ["Inner radius a", route.inner],
          ["Outer radius b", route.outer],
          ["Route height H", route.height],
          ["Route position s", route.position],
          ["First comparison w", route.w1],
          ["Second comparison w", route.w2],
          ...(route.obstacle === "embedded"
            ? [["Fourth-coordinate extent ε", route.extent] as [string, number]]
            : []),
        ];
        for (const [label, value] of fields)
          if (!Number.isFinite(value))
            throw new Error(`${label} must be a finite constant.`);
        if (!Number.isFinite(q.samples))
          throw new Error("Shell samples must be a finite whole number.");
        if (!Number.isInteger(q.samples))
          throw new Error("Shell samples must be a whole number.");
      }
      if (q.object === "lift" && !lift)
        throw new Error("Enter localized lift parameters.");
      if (lift) {
        for (const [key, label] of [
          ["center", "Lift center"],
          ["from", "Drift start"],
          ["to", "Drift end"],
        ] as const) {
          if (!Array.isArray(lift[key]) || lift[key].length !== 3)
            throw new Error(`${label} requires three coordinates.`);
          for (const [i, value] of lift[key].entries())
            if (!Number.isFinite(value))
              throw new Error(
                `${label} ${["x", "y", "z"][i]} must be a finite constant.`,
              );
        }
        const fields: [string, number][] = [
          ["Lift support radius L", lift.support],
          ["Lift height A", lift.height],
          ["Support start", lift.radiusFrom],
          ["Support end", lift.radiusTo],
          ...(q.mode === "lifted"
            ? [["Presentation xw angle", lift.angle] as [string, number]]
            : []),
        ];
        for (const [label, value] of fields)
          if (!Number.isFinite(value))
            throw new Error(`${label} must be a finite constant.`);
        if (!Number.isFinite(q.samples))
          throw new Error("Thread samples must be a finite whole number.");
        if (!Number.isInteger(q.samples))
          throw new Error("Thread samples must be a whole number.");
      }
      const counts =
        lift || route
          ? [q.samples]
          : curved
            ? [q.count, q.curves, q.samples]
            : q.mode === "section"
              ? [q.count]
              : q.mode === "stereo"
                ? [q.grid, q.samples]
                : [q.grid];
      const values = curved
        ? [
            q.radius,
            ...(q.object === "tube" ? [q.tube] : []),
            q.slice,
            q.spread,
          ]
        : q.mode === "perspective"
          ? [q.distance]
          : q.mode === "section"
            ? [q.slice, q.spread]
            : q.mode === "stereo"
              ? [q.clip]
              : [];
      if (
        !lift &&
        !route &&
        ![...q.angles, ...values, ...counts].every(Number.isFinite)
      )
        throw new Error(
          "Fill in every active tesseract parameter with a finite constant.",
        );
      if (!counts.every(Number.isInteger))
        throw new Error(
          "Section, face-line and sample counts must be whole numbers.",
        );
      // Inactive unfinished integer fields must not fail Go JSON decoding.
      const request = {
        object: q.object,
        ...(route
          ? {
              bypass: {
                ...route,
                extent: route.obstacle === "embedded" ? route.extent : 0,
              },
              samples: q.samples,
            }
          : {}),
        ...(lift
          ? {
              lift: { ...lift, angle: q.mode === "lifted" ? lift.angle : 0 },
              samples: q.samples,
            }
          : {}),
        ...(curved
          ? {
              radius: q.radius,
              tube: q.tube,
              curves: q.curves,
              samples: q.samples,
            }
          : {}),
        mode: q.mode,
        angles: lift || route ? [0, 0, 0, 0, 0, 0] : q.angles,
        ...(lift || route
          ? {}
          : q.mode === "section"
            ? { count: q.count, slice: q.slice, spread: q.spread }
            : {
                grid: q.grid,
                ...(q.mode === "perspective"
                  ? { distance: q.distance }
                  : q.mode === "stereo"
                    ? { samples: q.samples, clip: q.clip }
                    : {}),
              }),
      };
      const result = JSON.parse(
        tangentGardenTesseract(JSON.stringify(request)),
      );
      self.postMessage({
        id: data.id,
        ...("error" in result ? result : { result }),
      });
      return;
    }
    if (data.action === "spatial") {
      // JSON turns NaN into null, which Go would read as zero: refuse it here.
      const inversion = data.spatial?.construction === "inversion";
      const projection =
        data.spatial?.construction === "tangent-foot" ||
        data.spatial?.construction === "orthotomic" ||
        (inversion && data.spatial?.inversion.input !== "base");
      const involute = data.spatial?.construction === "involute",
        family = data.spatial?.involute.family,
        framed = data.spatial?.construction === "framed",
        frame = data.spatial?.frame,
        ruled = data.spatial?.construction === "ruled",
        canal = data.spatial?.construction === "canal";
      // A surface or ray study reads only its own fields; Go ignores the
      // curve's, and a ray study the surface's offset and normal reach.
      const mirror = data.spatial?.format === "rays",
        rays = data.spatial?.rays;
      const surface =
        data.spatial?.format === "surface" || mirror
          ? data.spatial!.surface
          : undefined;
      // An implicit surface reads only its own fields, and its section
      // normal and offsets only when it has sections.
      const level =
        data.spatial?.format === "implicit" ? data.spatial.implicit : undefined;
      if (level) {
        const { box, sections } = level;
        if (
          ![
            level.a,
            level.level,
            box.xMin,
            box.xMax,
            box.yMin,
            box.yMax,
            box.zMin,
            box.zMax,
            level.cells,
            sections.count,
            ...(sections.count > 0
              ? [
                  sections.normal.x,
                  sections.normal.y,
                  sections.normal.z,
                  sections.from,
                  sections.to,
                ]
              : []),
          ].every(Number.isFinite)
        )
          throw new Error(
            "Fill in each spatial parameter with a finite number.",
          );
        if (![level.cells, sections.count].every(Number.isInteger))
          throw new Error("Cell and plane counts must be whole numbers.");
      } else if (surface) {
        const { uSamples, vSamples, curves } = surface;
        if (
          ![
            surface.a,
            surface.b,
            surface.c,
            surface.uMin,
            surface.uMax,
            surface.vMin,
            surface.vMax,
            ...(mirror
              ? [
                  rays!.length,
                  ...(rays!.light === "point"
                    ? [rays!.source.x, rays!.source.y, rays!.source.z]
                    : [rays!.azimuth, rays!.elevation]),
                  ...(rays!.interaction === "refract"
                    ? [rays!.n1, rays!.n2]
                    : []),
                  ...(rays!.receiver.plane !== "none"
                    ? [
                        rays!.receiver.at,
                        rays!.receiver.c1,
                        rays!.receiver.c2,
                        rays!.receiver.size,
                        rays!.receiver.bins,
                      ]
                    : []),
                ]
              : [surface.offset, surface.reach]),
            uSamples,
            vSamples,
            curves,
          ].every(Number.isFinite)
        )
          throw new Error(
            "Fill in each spatial parameter with a finite number.",
          );
        if (
          ![
            uSamples,
            vSamples,
            curves,
            ...(mirror && rays!.receiver.plane !== "none"
              ? [rays!.receiver.bins]
              : []),
          ].every(Number.isInteger)
        )
          throw new Error(
            "Sample, curve and bin counts must be whole numbers.",
          );
      } else if (
        !data.spatial ||
        ![
          ...(involute
            ? [
                data.spatial.involute.anchor,
                ...(family!.enabled
                  ? [family!.from, family!.to, family!.count]
                  : [data.spatial.involute.offset]),
              ]
            : ruled
              ? [data.spatial.ruled.rate, data.spatial.ruled.shift]
              : canal
                ? [
                    data.spatial.canal.radius,
                    data.spatial.canal.meridians,
                    frame!.angle,
                    frame!.twist,
                    frame!.reference.x,
                    frame!.reference.y,
                    frame!.reference.z,
                  ]
                : framed
                  ? [
                      frame!.angle,
                      frame!.twist,
                      frame!.offset,
                      frame!.width,
                      frame!.strands,
                      // A Frenet frame never reads N₀.
                      ...(frame!.kind === "rotation-minimizing"
                        ? [
                            frame!.reference.x,
                            frame!.reference.y,
                            frame!.reference.z,
                          ]
                        : []),
                    ]
                  : projection || inversion
                    ? [
                        ...(inversion
                          ? [
                              data.spatial.inversion.center.x,
                              data.spatial.inversion.center.y,
                              data.spatial.inversion.center.z,
                              data.spatial.inversion.radius,
                            ]
                          : []),
                        ...(projection
                          ? [
                              data.spatial.pole.x,
                              data.spatial.pole.y,
                              data.spatial.pole.z,
                            ]
                          : []),
                      ]
                    : data.spatial.construction === "none"
                      ? []
                      : [data.spatial.length]),
          data.spatial.samples,
          data.spatial.lines,
          ...(data.spatial.format === "parametric"
            ? [
                data.spatial.curve.min,
                data.spatial.curve.max,
                data.spatial.curve.a,
              ]
            : data.spatial.format === "field"
              ? [
                  data.spatial.field.min,
                  data.spatial.field.max,
                  data.spatial.field.a,
                  data.spatial.field.escape,
                  ...data.spatial.field.seeds.flatMap((v) => [v.x, v.y, v.z]),
                ]
              : data.spatial.format === "pursuit"
                ? [
                    data.spatial.pursuit.min,
                    data.spatial.pursuit.max,
                    data.spatial.pursuit.capture,
                    ...data.spatial.pursuit.pursuers.flatMap((p) => [
                      p.x,
                      p.y,
                      p.z,
                      p.speed,
                    ]),
                  ]
                : data.spatial.format === "harmonic"
                  ? [
                      data.spatial.harmonic.min,
                      data.spatial.harmonic.max,
                      ...[
                        data.spatial.harmonic.center,
                        ...data.spatial.harmonic.terms.flatMap((t) => [
                          t.cosine,
                          t.sine,
                        ]),
                      ].flatMap((v) => [v.x, v.y, v.z]),
                      ...data.spatial.harmonic.terms.map((t) => t.frequency),
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
      else if (
        !Number.isInteger(data.spatial.samples) ||
        !Number.isInteger(data.spatial.lines)
      )
        throw new Error("Sample and line counts must be whole numbers.");
      else if (involute && family!.enabled && !Number.isInteger(family!.count))
        throw new Error("The number of involutes must be a whole number.");
      else if (framed && !Number.isInteger(frame!.strands))
        throw new Error("The number of offset strands must be a whole number.");
      else if (canal && !Number.isInteger(data.spatial.canal.meridians))
        throw new Error("The number of meridians must be a whole number.");
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
    const implicit =
      config.curve.format === "implicit" ? config.curve.implicit : null;
    const attractor =
      config.curve.format === "attractor" ? config.curve.attractor : null;
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
      ...(usesPole(config.kind) || usesPole(config.input)
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
      ...(config.curve.format === "field"
        ? [
            config.curve.field.escape,
            ...config.curve.field.seeds.flatMap((p) => [p.x, p.y]),
          ]
        : []),
      ...(implicit
        ? [
            implicit.level,
            implicit.cells,
            ...Object.values(implicit.window),
            ...(implicit.family.enabled
              ? [
                  implicit.family.from,
                  implicit.family.to,
                  implicit.family.count,
                ]
              : []),
          ]
        : []),
      ...(attractor
        ? [
            attractor.a,
            attractor.b,
            attractor.c,
            attractor.d,
            attractor.start.x,
            attractor.start.y,
            attractor.discard,
            attractor.iterates,
            attractor.cells,
            ...Object.values(attractor.window),
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
    if (
      implicit &&
      (!Number.isInteger(implicit.cells) ||
        (implicit.family.enabled && !Number.isInteger(implicit.family.count)))
    )
      throw new Error("Grid cells and the level count must be whole numbers.");
    if (
      attractor &&
      ![attractor.cells, attractor.discard, attractor.iterates].every(
        Number.isInteger,
      )
    )
      throw new Error("Grid cells and iterate counts must be whole numbers.");
    if (stacked && !Number.isInteger(config.stack.count))
      throw new Error("The number of offsets must be a whole number.");
    const result: import("./types").Result | { error: string } = JSON.parse(
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
