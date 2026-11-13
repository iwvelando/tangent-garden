import { test, expect, type Page } from "@playwright/test";
import { deflateRawSync } from "node:zlib";
import { objects, defaultConfig } from "../web/tesseract/objects";
import { presetStudy, type TesseractStudy } from "../web/tesseract/link";
import { tesseractPresets } from "../web/tesseract/presets";
import { initialView, type Config } from "../web/tesseract/types";
import { choosePreset, exportImage } from "./helpers";

const flower = "A flower below, a bouquet above";
const latitude = "A circle over every point";
const study = (name = flower) => {
  const i = tesseractPresets.findIndex((p) => p.name === name);
  expect(i).toBeGreaterThanOrEqual(0);
  return presetStudy(i);
};
const ids = async (c: Config) => {
  const { tesseractAtlasPairs } = await import("../web/tesseract/atlas");
  return tesseractAtlasPairs(c).map((p) => p.id);
};

test("4D atlas catalog belongs to active object descriptors", async () => {
  expect(await ids(study().config)).toEqual(["flower", "rotation", "window"]);
  expect(await ids(study(latitude).config)).toEqual([
    "latitude",
    "rotation",
    "window",
  ]);
  const weave = objects.weave.defaults(defaultConfig);
  expect(await ids(weave)).toEqual(["rotation", "window"]);
  for (const mode of [
    "perspective",
    "orthographic",
    "stereo",
    "section",
  ] as const) {
    expect(await ids({ ...defaultConfig, mode })).toEqual(
      mode === "section"
        ? []
        : mode === "stereo"
          ? ["rotation", "window"]
          : mode === "perspective"
            ? ["rotation", "eye"]
            : ["rotation"],
    );
  }
  expect(await ids(objects.cell24.defaults(defaultConfig))).toEqual([
    "rotation",
  ]);
  // The 24-cell's perspective adds its eye distance; its sections none.
  for (const [mode, pairs] of [
    ["perspective", ["rotation", "eye"]],
    ["section", []],
  ] as const)
    expect(
      await ids({ ...objects.cell24.defaults(defaultConfig), mode }),
    ).toEqual(pairs);
  expect(await ids(objects.root.defaults(defaultConfig))).toEqual(["rotation"]);
  for (const object of ["ball", "tube", "lift", "bypass"] as const) {
    // Dormant weave, projection and rotation fields never enable a pair.
    expect(
      await ids({
        ...objects[object].defaults(defaultConfig),
        weave: study().config.weave,
      }),
    ).toEqual([]);
  }
});

test("4D atlas literal preview caps retain correspondence and every nonquality field", async () => {
  const {
    tesseractPreviewConfig,
    tesseractAtlasDefaults,
    tesseractAtlasBudget,
  } = await import("../web/tesseract/atlas");
  const c = study().config;
  c.samples = 256;
  c.curves = 32;
  c.weave!.selected = 31;
  for (const [size, cap] of [
    [3, 64],
    [5, 32],
  ] as const) {
    const preview = tesseractPreviewConfig(c, size);
    expect(preview).toEqual({ ...c, samples: cap });
    expect(tesseractPreviewConfig({ ...c, samples: 8 }, size).samples).toBe(8);
    const root = objects.root.defaults(defaultConfig);
    root.samples = 4096;
    expect(tesseractPreviewConfig(root, size)).toEqual({
      ...root,
      samples: size === 3 ? 256 : 128,
    });
    const cube = { ...defaultConfig, samples: 256, grid: 12 };
    expect(tesseractPreviewConfig(cube, size)).toEqual({
      ...cube,
      samples: cap,
      grid: size === 3 ? 4 : 2,
    });
  }
  expect(c.samples).toBe(256);
  expect(
    tesseractAtlasDefaults({ ...c, angles: [0, 0, 0, 0, 0, 0] }, "rotation"),
  ).toEqual({ xw: [-0.5, 0.5], yw: [-0.5, 0.5] });
  expect(tesseractAtlasBudget(c, 5).error).toBeUndefined();
  // A dense stereographic cube exceeds the explicit aggregate point cap.
  expect(
    tesseractAtlasBudget({ ...defaultConfig, mode: "stereo", grid: 10000 }, 5)
      .error,
  ).toContain("work limit");
  expect(
    tesseractAtlasBudget(objects.ball.defaults(defaultConfig)).error,
  ).toContain("no curated");
});

test("4D atlas queue freezes full studies, inspects at source quality and drops stale results", async () => {
  const { TesseractAtlas, tesseractAtlasDefaults } =
    await import("../web/tesseract/atlas");
  const source = study();
  source.config.samples = 256;
  source.config.weave!.selected = 3;
  source.view = { ...initialView, zoom: 1.7, panX: 20 };
  source.diagramView = { ...initialView, yaw: -0.8, panY: -19 };
  const frozen = structuredClone(source);
  const calls: Config[] = [];
  const pending: ((r: any) => void)[] = [];
  const engine = {
    tesseract: (c: Config) => {
      calls.push(structuredClone(c));
      return new Promise<any>((r) => pending.push(r));
    },
  };
  const atlas = new TesseractAtlas(engine, () => {});
  const result = (c: Config) => ({
    object: c.object,
    paths: [{ points: [[1, 2, 3]], source: "fiber/0" }],
    radius: 3,
    companion: {
      radius: 1.1,
      paths: [{ points: [[0, 0, 1]], source: "sample/0" }],
    },
  });
  const tick = async () => {
    await new Promise((r) => setTimeout(r, 0));
  };
  atlas.generate(source, tesseractAtlasDefaults(source.config, "flower"), {
    pair: "flower",
  });
  source.config.weave!.selected = 0;
  expect(calls).toHaveLength(1);
  pending.shift()!(result(calls[0]));
  await tick();
  atlas.inspect(0);
  // Inspection wins over the unsent grid cells after the current request.
  pending.shift()!(result(calls[1]));
  await tick();
  expect(calls[2].samples).toBe(256);
  pending.shift()!(result(calls[2]));
  await tick();
  const candidate = atlas.candidate()!;
  const values = atlas.state.cells[0].values;
  expect(candidate).toEqual({
    ...frozen,
    config: {
      ...frozen.config,
      weave: {
        ...frozen.config.weave!,
        alpha: values[0],
        amplitude: values[1],
      },
    },
  });
  expect(atlas.state.selection!.frame!.result.companion.paths).toHaveLength(1);
  candidate.diagramView.zoom = 8;
  candidate.config.weave!.selected = 0;
  expect(atlas.candidate()!.diagramView).toEqual(frozen.diagramView);
  expect(atlas.candidate()!.config.weave!.selected).toBe(3);
  atlas.cancel();
  pending.shift()!(result(calls.at(-1)!));
  await tick();
  expect(atlas.state.cells).toEqual([]);
  expect(atlas.candidate()).toBeNull();
});

const settle = (p: Page) =>
  expect(p.locator(".tesseract-stage")).toHaveAttribute("aria-busy", "false");
const open = async (p: Page, s = study()) => {
  const token = deflateRawSync(
    JSON.stringify({ v: 1, notebook: "4d", study: s }),
  ).toString("base64url");
  await p.goto(`/?study=4d#s=${token}`);
  await expect(p).not.toHaveURL(/#s=/);
  await settle(p);
};
const dialog = (p: Page) =>
  p.getByRole("dialog", { name: "A field of possible worlds", exact: true });
const enter = async (p: Page) => {
  await p
    .getByRole("button", { name: "Explore parameter atlas", exact: true })
    .click();
  await expect(dialog(p)).toBeVisible();
  return dialog(p);
};
const metadata = (p: Page) =>
  p
    .locator("#tesseract-artwork > desc")
    .evaluate((e) => JSON.parse(e.textContent!));

test("4D atlas entry retains paired source, raw drafts and original quality on cancel and adoption", async ({
  page,
}) => {
  const s = study();
  s.view = { ...initialView, zoom: 1.4, panX: 17 };
  s.diagramView = { ...initialView, yaw: -0.6, panY: -13 };
  await open(page, s);
  const alpha = page.getByRole("textbox", {
    name: "Central latitude α",
    exact: true,
  });
  await alpha.fill("pi/4");
  await alpha.press("Tab");
  await settle(page);
  const before = await metadata(page);
  const atlas = await enter(page);
  await expect(atlas.locator('.atlas-cell[data-state="valid"]')).toHaveCount(9);
  await expect(atlas.locator(".atlas-art img")).toHaveCount(9);
  await atlas
    .getByRole("button", { name: "Cancel atlas", exact: true })
    .click();
  await settle(page);
  expect(await alpha.inputValue()).toBe("pi/4");
  expect(await metadata(page)).toEqual(before);
  await enter(page);
  await atlas
    .getByRole("button", { name: "Inspect row 2, column 3", exact: true })
    .click();
  await expect(
    atlas.getByRole("button", { name: "Adopt variant", exact: true }),
  ).toBeEnabled();
  await atlas
    .getByRole("button", { name: "Adopt variant", exact: true })
    .click();
  await settle(page);
  await expect
    .poll(async () => (await metadata(page)).config.weave.alpha)
    .toBeGreaterThan(before.config.weave.alpha);
  await settle(page);
  const after = await metadata(page);
  expect(after.config.samples).toBe(before.config.samples);
  expect(after.config.weave.selected).toBe(before.config.weave.selected);
  expect(after.view).toEqual(before.view);
  expect(after.views.map((v: any) => v.view)).toEqual(
    before.views.map((v: any) => v.view),
  );
});

test("4D shared framing uses separate panel radii without changing provenance", async () => {
  const { sharedAtlasRadii, frameAtlasResult } =
    await import("../web/tesseract/atlas-art");
  const a = {
    radius: 3,
    paths: [{ source: "fiber/7", branch: "arc/1", points: [[1, 0, 0]] }],
    companion: {
      radius: 1.1,
      paths: [{ source: "base/7", points: [[0, 1, 0]] }],
    },
  } as any;
  const b = { ...a, radius: 9, companion: { ...a.companion, radius: 1.2 } };
  const saved = structuredClone(a);
  expect(sharedAtlasRadii([a, b])).toEqual([9, 1.2]);
  const framed = frameAtlasResult(a, [9, 1.2]);
  expect(framed).toEqual({
    ...a,
    radius: 9,
    companion: { ...a.companion, radius: 1.2 },
  });
  expect(a).toEqual(saved);
  expect(frameAtlasResult(a)).toBe(a);
});

// Observe the actual production transport before restoration and the delivered
// geometry after it. A second ordinary worker provides direct evaluation.
async function observe(page: Page) {
  await page.addInitScript(() => {
    const blobs = new Map<string, Blob>();
    const create = URL.createObjectURL.bind(URL),
      revoke = URL.revokeObjectURL.bind(URL);
    URL.createObjectURL = (blob) => {
      const url = create(blob);
      if (blob instanceof Blob) blobs.set(url, blob);
      return url;
    };
    URL.revokeObjectURL = (url) => {
      blobs.delete(url);
      revoke(url);
    };
    Object.assign(window, { fourAtlasBlobs: blobs });
    const Native = Worker;
    const logs: any[] = [];
    Object.assign(window, { fourAtlasLogs: logs, fourAtlasDelay: 0 });
    window.Worker = class extends Native {
      log: any;
      constructor(url: string | URL, options?: WorkerOptions) {
        super(url, options);
        this.log = {
          url: String(url),
          requests: [],
          replies: [],
          frames: [],
          terminated: false,
        };
        logs.push(this.log);
      }
      postMessage(q: any, options?: any) {
        if (q.action === "tesseract")
          this.log.requests.push(structuredClone(q));
        super.postMessage(q, options);
      }
      set onmessage(handler: any) {
        super.onmessage = (e: MessageEvent) => {
          const deliver = () => {
            const raw = structuredClone(e.data);
            handler?.call(this, e);
            if (this.log.requests.some((q: any) => q.id === e.data.id)) {
              this.log.replies.push(raw);
              this.log.frames.push({
                id: e.data.id,
                result: structuredClone(e.data.result),
              });
            }
          };
          setTimeout(deliver, (window as any).fourAtlasDelay);
        };
      }
      terminate() {
        this.log.terminated = true;
        super.terminate();
      }
    };
  });
}
const generated = (a: ReturnType<typeof dialog>, n = 9) =>
  expect(
    a.locator(
      '.atlas-cell[data-state="valid"], .atlas-cell[data-state="invalid"]',
    ),
  ).toHaveCount(n);
const imageMetadata = (a: ReturnType<typeof dialog>, selector: string) =>
  a.locator(selector).evaluateAll(async (images) =>
    Promise.all(
      images.map(async (image) => {
        const svg = new DOMParser().parseFromString(
          await (window as any).fourAtlasBlobs
            .get((image as HTMLImageElement).src)
            .text(),
          "image/svg+xml",
        );
        return {
          meta: JSON.parse(svg.querySelector("svg > desc")!.textContent!),
          panels: svg.querySelectorAll("svg[data-representation]").length,
          text: svg.querySelectorAll("text, foreignObject").length,
          radii: JSON.parse(image.getAttribute("data-radii")!),
        };
      }),
    ),
  );

for (const kind of [
  "flower",
  "latitude",
  "loom",
  "eye",
  "cube",
  "crystal",
  "root",
] as const)
  test(`4D atlas returned geometry matches direct WASM with independent bounds: ${kind}`, async ({
    page,
  }) => {
    test.setTimeout(120000);
    await observe(page);
    const s =
      kind === "flower"
        ? study()
        : kind === "latitude"
          ? study(latitude)
          : study();
    if (!["flower", "latitude"].includes(kind)) {
      const object = {
        loom: "weave",
        cube: "tesseract",
        eye: "tesseract",
        crystal: "cell24",
        root: "root",
      }[kind] as keyof typeof objects;
      s.config = objects[object].defaults(defaultConfig);
      s.motion = objects[object].motion;
      s.repeat = "once";
    }
    if (kind === "cube") {
      s.config.mode = "stereo";
      s.config.grid = 3;
    }
    if (s.config.weave && s.config.mode === "paired")
      s.config.weave.selected = 3;
    await open(page, s);
    const a = await enter(page);
    const { tesseractAtlasPairs } = await import("../web/tesseract/atlas");
    const pairs = tesseractAtlasPairs(s.config);
    for (const pair of pairs) {
      if (pair !== pairs[0]) {
        await a
          .getByLabel("Parameter pair", { exact: true })
          .selectOption(pair.id);
        await a
          .getByRole("button", { name: "Generate atlas", exact: true })
          .click();
      }
      await generated(a);
      const checked = await page.evaluate(async () => {
        const logs = (window as any).fourAtlasLogs;
        const log = logs.at(-1);
        const direct = new Worker(log.url);
        logs.pop();
        const equal = (a: any, b: any): boolean =>
          Object.is(a, b) ||
          (!!a &&
            !!b &&
            typeof a === "object" &&
            typeof b === "object" &&
            [...new Set([...Object.keys(a), ...Object.keys(b)])]
              .filter((k) => k !== "id")
              .every((k) => equal(a[k], b[k])));
        let points = 0,
          clipped = 0,
          base = 0,
          maxResidual = 0;
        const requests = log.requests.slice(-9);
        for (const q of requests) {
          const answer: any = await new Promise((r) => {
            direct.onmessage = (e) => r(e.data);
            direct.postMessage({ ...q, id: q.id + 100000 });
          });
          const raw = log.replies.find((r: any) => r.id === q.id);
          if (!equal(raw, answer))
            throw new Error("Direct ordinary-worker mismatch");
          if (raw.error) continue;
          const r = log.frames.find((r: any) => r.id === q.id).result;
          points += r.emittedPoints;
          clipped += r.clipped;
          if (
            ["weave", "tesseract"].includes(q.tesseract.object) &&
            ["stereo", "paired"].includes(q.tesseract.mode)
          )
            for (const path of r.paths)
              for (const p of path.points)
                if (Math.hypot(...p) > q.tesseract.clip * (1 + 1e-10))
                  throw new Error("Projection outside safe window");
          const path = r.companion?.paths.find(
            (p: any) => p.role === "base-curve",
          );
          if (path) {
            const w = q.tesseract.weave;
            if (!r.paths.some((p: any) => p.role === "fiber"))
              throw new Error("No bouquet geometry");
            if (r.weave.correspondence.selected !== w.selected)
              throw new Error("Lost selected fiber");
            for (let i = 0; i < path.points.length; i++) {
              const t = path.parameters[i];
              const alpha =
                w.alpha +
                (w.path === "flower"
                  ? (w.amplitude ?? 0) * Math.cos((w.petals ?? 5) * t)
                  : 0);
              const expected = [
                Math.sin(2 * alpha) * Math.cos(t),
                Math.sin(2 * alpha) * Math.sin(t),
                Math.cos(2 * alpha),
              ];
              for (let k = 0; k < 3; k++)
                maxResidual = Math.max(
                  maxResidual,
                  Math.abs(path.points[i][k] - expected[k]),
                );
              base++;
            }
          }
          if (r.root && r.root.residual > 1e-12)
            throw new Error("Root relation w²=z failed");
        }
        direct.terminate();
        return { points, clipped, base, maxResidual };
      });
      expect(checked.points).toBeGreaterThan(0);
      expect(checked.maxResidual).toBeLessThan(1e-12);
      if (["flower", "latitude"].includes(kind))
        expect(checked.base).toBeGreaterThan(50);
      await expect(a.locator(".atlas-art img")).not.toHaveCount(0);
      const images = await imageMetadata(a, ".atlas-art img");
      expect(images.every((i) => i.text === 0)).toBe(true);
      expect(
        images.every((i) => i.panels === (s.config.mode === "paired" ? 2 : 0)),
      ).toBe(true);
      await a
        .getByRole("button", { name: "Inspect row 2, column 2", exact: true })
        .click();
      await expect(
        a.getByRole("button", { name: "Adopt variant", exact: true }),
      ).toBeEnabled();
      const inspection = await page.evaluate(
        () => (window as any).fourAtlasLogs.at(-1).requests.at(-1).tesseract,
      );
      // The center is the exact frozen source for symmetric default ranges.
      // One-sided endpoint ranges are independently interpolated instead.
      expect(inspection.samples).toBe(s.config.samples);
      expect(inspection.curves).toBe(s.config.curves);
      expect(inspection.angles.slice(0, 3)).toEqual(
        s.config.angles.slice(0, 3),
      );
      await a.getByRole("tab", { name: "Atlas grid", exact: true }).click();
    }
  });

async function range(
  a: ReturnType<typeof dialog>,
  label: string,
  from: string,
  to: string,
) {
  await a.getByLabel(`${label} to`, { exact: true }).fill("10000000");
  await a.getByLabel(`${label} from`, { exact: true }).fill(from);
  await a.getByLabel(`${label} to`, { exact: true }).fill(to);
  await a.getByText("Original quality:", { exact: false }).click();
}

test("4D atlas projection refusals, paired common scale and full inspection remain distinct", async ({
  page,
}) => {
  await observe(page);
  await open(page);
  const a = await enter(page);
  await generated(a);
  await a.getByLabel("Parameter pair", { exact: true }).selectOption("window");
  await range(a, "Projection window radius", "1", "3");
  await a.getByLabel("Framing", { exact: true }).selectOption("shared");
  await a.getByRole("button", { name: "Generate atlas", exact: true }).click();
  await generated(a);
  await expect(a.locator('.atlas-cell[data-state="invalid"]')).toHaveCount(3);
  await expect(a.locator('.atlas-cell[data-state="valid"]')).toHaveCount(6);
  await expect(a.locator(".atlas-art img")).toHaveCount(6);
  const images = await imageMetadata(a, ".atlas-art img");
  expect(images.every((i) => i.radii[0] === 3 && i.radii[1] === 1.3)).toBe(
    true,
  );
  await a
    .getByRole("button", { name: "Inspect row 2, column 2", exact: true })
    .click();
  await expect(a.locator(".atlas-inspected-art img")).toHaveCount(1);
  expect((await imageMetadata(a, ".atlas-inspected-art img"))[0].radii).toEqual(
    [2, 1.3],
  );
  await a.getByRole("button", { name: "Adopt variant", exact: true }).click();
  await expect.poll(async () => (await metadata(page)).config.clip).toBe(2);
  await settle(page);
});

test("4D atlas range edits terminate in-flight work and reject stale inspection", async ({
  page,
}) => {
  await observe(page);
  await open(page);
  await page.evaluate(() => {
    (window as any).fourAtlasDelay = 500;
  });
  const a = await enter(page);
  await expect
    .poll(() =>
      page.evaluate(() => (window as any).fourAtlasLogs.at(-1).requests.length),
    )
    .toBeGreaterThan(0);
  await range(a, "Central latitude α", "0.7", "0.9");
  expect(
    await page.evaluate(() => (window as any).fourAtlasLogs.at(-2).terminated),
  ).toBe(true);
  await a.getByRole("button", { name: "Generate atlas", exact: true }).click();
  await generated(a);
  await a
    .getByRole("button", { name: "Inspect row 2, column 2", exact: true })
    .click();
  await a.getByRole("tab", { name: "Atlas grid", exact: true }).click();
  await range(a, "Central latitude α", "0.6", "1");
  await expect(
    a.getByRole("tab", { name: "Selected variant", exact: true }),
  ).toBeDisabled();
  await expect(
    a.getByRole("button", { name: "Adopt variant", exact: true }),
  ).toHaveCount(0);
  await a.getByRole("button", { name: "Cancel atlas", exact: true }).click();
  await settle(page);
  expect((await metadata(page)).config).toEqual(study().config);
});

test("4D queue publishes unsupported admission and counts companion provenance in geometry cap", async () => {
  const { TesseractAtlas, tesseractAtlasDefaults } =
    await import("../web/tesseract/atlas");
  const { atlasNumbers } = await import("../web/atlas-queue");
  const { EngineError } = await import("../web/engine-client");
  const source = study();
  let published: any;
  let count = 0;
  const atlas = new TesseractAtlas(
    {
      tesseract: async () => {
        count++;
        if (count === 2)
          throw new EngineError("Unavailable amplitude", "weave.amplitude");
        // Ordinary primary paths are small; the retained source coordinates in
        // the companion alone must exhaust storage on the third accepted reply.
        return {
          radius: 3,
          companion: { fourPoints: new Float64Array(1900000) },
        } as any;
      },
    },
    (s) => {
      published = s;
    },
  );
  const unsupported = {
    ...source,
    config: objects.ball.defaults(defaultConfig),
  };
  atlas.generate(unsupported, {});
  expect(published.error).toContain("no curated");
  atlas.generate(source, tesseractAtlasDefaults(source.config));
  await expect
    .poll(() => published.cells.filter((c: any) => c.frame || c.error).length)
    .toBe(9);
  expect(published.cells[1].error).toContain("Unavailable amplitude");
  expect(published.cells.filter((c: any) => c.frame)).toHaveLength(2);
  expect(published.cells[3].error).toContain("geometry limit");
  expect(
    atlasNumbers(
      published.cells
        .filter((c: any) => c.frame)
        .map((c: any) => c.frame.result),
    ),
  ).toBeLessThanOrEqual(4000000);
});

test("adopted 4D study keeps raw unrelated fields, ordinary links, vector and decoded raster exports", async ({
  page,
}) => {
  const { readFile } = await import("node:fs/promises");
  const { chooseColorScheme } = await import("./helpers");
  await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);
  await open(page);
  await chooseColorScheme(page, "cobalt");
  const angle = page.getByRole("textbox", { name: "zw angle", exact: true });
  await angle.fill("pi/7");
  await angle.press("Tab");
  await settle(page);
  const original = await metadata(page);
  const a = await enter(page);
  await generated(a);
  await a
    .getByRole("button", { name: "Inspect row 2, column 3", exact: true })
    .click();
  await expect(
    a.getByRole("button", { name: "Adopt variant", exact: true }),
  ).toBeEnabled();
  await a.getByRole("button", { name: "Adopt variant", exact: true }).click();
  await expect
    .poll(async () => (await metadata(page)).config.weave.alpha)
    .toBeGreaterThan(original.config.weave.alpha);
  await settle(page);
  expect(await angle.inputValue()).toBe("pi/7");
  const adopted = await metadata(page);
  const svgd = page.waitForEvent("download");
  await exportImage(page, "SVG");
  const svg = await readFile((await (await svgd).path())!, "utf8");
  const parsed = await page.evaluate((svg) => {
    const root = new DOMParser().parseFromString(svg, "image/svg+xml");
    return {
      meta: JSON.parse(root.querySelector("svg > desc")!.textContent!),
      text: root.querySelectorAll("text, foreignObject").length,
      paths: [...root.querySelectorAll("path[d]")].map((p) =>
        p.getAttribute("d"),
      ),
    };
  }, svg);
  expect(parsed.meta.config).toEqual(adopted.config);
  expect(parsed.meta.views).toEqual(adopted.views);
  expect(parsed.text).toBe(0);
  expect(parsed.paths).toEqual(
    await page
      .locator("#tesseract-artwork path[d]")
      .evaluateAll((es) => es.map((e) => e.getAttribute("d"))),
  );
  const pngd = page.waitForEvent("download");
  await exportImage(page, "PNG");
  const png = await readFile((await (await pngd).path())!);
  const pixels = await page.evaluate(
    async ({ svg, png }) => {
      const decode = async (blob: Blob) => {
        const image = new Image(),
          url = URL.createObjectURL(blob);
        try {
          image.src = url;
          await image.decode();
          const canvas = document.createElement("canvas");
          canvas.width = image.naturalWidth;
          canvas.height = image.naturalHeight;
          const ctx = canvas.getContext("2d")!;
          ctx.drawImage(image, 0, 0);
          return {
            width: canvas.width,
            height: canvas.height,
            pixels: ctx.getImageData(0, 0, canvas.width, canvas.height).data,
          };
        } finally {
          URL.revokeObjectURL(url);
        }
      };
      const a = await decode(new Blob([svg], { type: "image/svg+xml" }));
      const b = await decode(
        new Blob([Uint8Array.from(atob(png), (c) => c.charCodeAt(0))], {
          type: "image/png",
        }),
      );
      let difference = 0;
      for (let i = 0; i < a.pixels.length; i++)
        difference = Math.max(difference, Math.abs(a.pixels[i] - b.pixels[i]));
      return { a: [a.width, a.height], b: [b.width, b.height], difference };
    },
    { svg, png: png.toString("base64") },
  );
  expect(pixels.a).toEqual(pixels.b);
  expect(pixels.difference).toBe(0);
  await page.getByRole("button", { name: "Copy link", exact: true }).click();
  await expect(page.getByText("Link copied", { exact: true })).toBeVisible();
  const href = await page.evaluate(() => navigator.clipboard.readText());
  await page.goto(href);
  await expect(page).not.toHaveURL(/#s=/);
  await settle(page);
  expect((await metadata(page)).config).toEqual(adopted.config);
  expect((await metadata(page)).views).toEqual(adopted.views);
});

for (const viewport of [
  { width: 1100, height: 650 },
  { width: 390, height: 844 },
  { width: 844, height: 390 },
])
  test(`4D atlas walkthrough at ${viewport.width}: controls, focus, errors, adoption and motion`, async ({
    page,
  }) => {
    await page.setViewportSize(viewport);
    await open(page);
    const source = await metadata(page);
    const entry = page.getByRole("button", {
      name: "Explore parameter atlas",
      exact: true,
    });
    await entry.focus();
    await page.keyboard.press("Enter");
    const a = dialog(page);
    await expect(a).toBeVisible();
    await expect(
      a.getByRole("button", { name: "Cancel atlas", exact: true }),
    ).toBeFocused();
    await generated(a);
    await a.getByLabel("Central latitude α from", { exact: true }).fill("t");
    await a.getByRole("heading", { level: 2 }).click();
    await expect(a.getByRole("alert")).toContainText("Central latitude α from");
    await expect(
      a.getByRole("button", { name: "Generate atlas", exact: true }),
    ).toBeDisabled();
    await range(a, "Central latitude α", "0.7", "0.9");
    await a.getByLabel("Grid size", { exact: true }).selectOption("5");
    await a
      .getByRole("button", { name: "Generate atlas", exact: true })
      .click();
    await generated(a, 25);
    const first = a.getByRole("button", {
      name: "Inspect row 1, column 1",
      exact: true,
    });
    await first.focus();
    await page.keyboard.press("ArrowRight");
    await expect(
      a.getByRole("button", { name: "Inspect row 1, column 2", exact: true }),
    ).toBeFocused();
    await page.keyboard.press("Enter");
    const adopt = a.getByRole("button", { name: "Adopt variant", exact: true });
    await expect(adopt).toBeEnabled();
    await adopt.scrollIntoViewIfNeeded();
    const box = await adopt.boundingBox();
    expect(box!.y).toBeGreaterThanOrEqual(0);
    expect(box!.y + box!.height).toBeLessThanOrEqual(viewport.height);
    await adopt.click();
    await expect
      .poll(async () => (await metadata(page)).config.weave.alpha)
      .not.toBe(source.config.weave.alpha);
    await settle(page);
    const { openShapeAnimation } = await import("./helpers");
    await openShapeAnimation(page);
    await page
      .getByRole("button", { name: "Play animation", exact: true })
      .click();
    await expect
      .poll(async () =>
        Number(
          await page.locator(".tesseract-stage").getAttribute("data-progress"),
        ),
      )
      .toBeGreaterThan(0);
    await page.getByRole("button", { name: "Pause", exact: true }).click();
    await settle(page);
    // Returning to ordinary controls keeps the paired gesture targets alive.
    await expect(
      page.locator("#tesseract-artwork svg[data-representation]"),
    ).toHaveCount(2);
  });

test("4D atlas entry waits for raw scalar settlement and rechecks an object switch", async ({
  page,
}) => {
  await observe(page);
  await open(page);
  const entry = page.getByRole("button", {
    name: "Explore parameter atlas",
    exact: true,
  });
  await page.evaluate(() => {
    (window as any).fourAtlasDelay = 350;
  });
  await page
    .getByRole("textbox", { name: "xw angle", exact: true })
    .fill("pi/7");
  await entry.click();
  const a = dialog(page);
  await expect(a).toBeVisible();
  await generated(a);
  const requested = await page.evaluate(
    () => (window as any).fourAtlasLogs.at(-1).requests[0].tesseract,
  );
  expect(requested.angles[3]).toBe(Math.PI / 7);
  await a.getByRole("button", { name: "Cancel atlas", exact: true }).click();
  await page
    .getByRole("textbox", { name: "xw angle", exact: true })
    .fill("pi/3");
  await entry.click();
  await page
    .getByRole("combobox", { name: "4D object", exact: true })
    .selectOption("ball");
  await settle(page);
  await expect(a).toHaveCount(0);
  await expect(entry).toBeDisabled();
  await expect(page.locator(".atlas-entry")).toContainText(
    "no curated parameter pair",
  );
  await page
    .getByRole("combobox", { name: "4D object", exact: true })
    .selectOption("weave");
  await settle(page);
  await expect(entry).toBeEnabled();
});

test("4D latitude atlas retains pole aliases and selected correspondence", async ({
  page,
}) => {
  await observe(page);
  const s = study(latitude);
  s.config.weave!.selected = 7;
  await open(page, s);
  const a = await enter(page);
  await generated(a);
  await range(a, "Central latitude α", "0", "pi/2");
  await a.getByRole("button", { name: "Generate atlas", exact: true }).click();
  await generated(a);
  const endpoints = await page.evaluate(() => {
    const log = (window as any).fourAtlasLogs.at(-1);
    return log.requests.slice(-9).map((q: any) => {
      const r = log.frames.find((r: any) => r.id === q.id).result;
      return {
        alpha: q.tesseract.weave.alpha,
        fibers: r.paths.filter(
          (p: any) => p.role === "fiber" || p.role === "collapsed",
        ).length,
        correspondence: r.weave.correspondence,
        points: r.companion.markers.filter((m: any) => m.role === "sample")
          .length,
      };
    });
  });
  expect(
    endpoints.filter((p: any) => p.alpha === 0 || p.alpha === Math.PI / 2),
  ).toHaveLength(6);
  for (const p of endpoints.filter(
    (p: any) => p.alpha === 0 || p.alpha === Math.PI / 2,
  )) {
    expect(p.correspondence.selected).toBe(7);
    expect(p.correspondence.coincident).toBe(true);
    expect(p.fibers).toBeGreaterThan(0);
    expect(p.fibers).toBeLessThanOrEqual(2); // one source circle may have two clipped arcs
    expect(p.points).toBe(1); // one marker represents the coincident samples
  }
});

test("an adopted Hopf bouquet uses the ordinary motion exporter with decoded timing and frames", async ({
  page,
}) => {
  test.setTimeout(120000);
  const { readFile } = await import("node:fs/promises");
  const { openShapeAnimation, openShapeExport } = await import("./helpers");
  const { probe, decodeVideo, frameDifference } = await import("./video");
  await open(page);
  const a = await enter(page);
  await generated(a);
  await a
    .getByRole("button", { name: "Inspect row 2, column 3", exact: true })
    .click();
  await expect(
    a.getByRole("button", { name: "Adopt variant", exact: true }),
  ).toBeEnabled();
  await a.getByRole("button", { name: "Adopt variant", exact: true }).click();
  await expect
    .poll(async () => (await metadata(page)).config.weave.alpha)
    .toBeGreaterThan(study().config.weave!.alpha);
  await settle(page);
  await openShapeAnimation(page);
  await page
    .getByRole("spinbutton", { name: "Duration (seconds)", exact: true })
    .fill("1");
  await page
    .getByRole("button", { name: "Play animation", exact: true })
    .click();
  await page.getByRole("button", { name: "Pause", exact: true }).click();
  const references: number[][] = [];
  for (const progress of [0, 0.4]) {
    await page
      .getByRole("slider", { name: "Animation progress", exact: true })
      .fill(String(progress));
    await settle(page);
    references.push(
      await page.evaluate(async () => {
        const svg = document
          .getElementById("tesseract-artwork")!
          .cloneNode(true) as SVGSVGElement;
        svg.setAttribute("width", "1000");
        svg.setAttribute("height", "380");
        const url = URL.createObjectURL(
          new Blob([new XMLSerializer().serializeToString(svg)], {
            type: "image/svg+xml",
          }),
        );
        try {
          const image = new Image();
          image.src = url;
          await image.decode();
          const canvas = document.createElement("canvas");
          canvas.width = 1000;
          canvas.height = 380;
          const ctx = canvas.getContext("2d")!;
          ctx.drawImage(image, 0, 0);
          return [...ctx.getImageData(0, 0, 1000, 380).data];
        } finally {
          URL.revokeObjectURL(url);
        }
      }),
    );
  }
  await openShapeExport(page);
  await page
    .getByRole("combobox", { name: "Export format", exact: true })
    .selectOption("mp4");
  await page
    .getByRole("slider", { name: "Export resolution", exact: true })
    .fill("0.5");
  await page
    .getByRole("combobox", { name: "Export frame rate", exact: true })
    .selectOption("15");
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: /^Export MP4 video/ }).click();
  const path = (await (await download).path())!;
  const result = probe(path);
  if (result) {
    expect([result.width, result.height, result.frames]).toEqual([
      1000, 380, 15,
    ]);
    expect(result.durations.reduce((a, b) => a + b, 0)).toBe(1000);
  }
  expect((await decodeVideo(page, await readFile(path))).duration).toBeCloseTo(
    1,
    3,
  );
  for (const [k, index] of [0, 6].entries()) {
    const difference = frameDifference(path, 1000, 380, index, references[k]);
    if (difference) {
      expect(difference.meanDifference).toBeLessThan(6);
      expect(difference.unmatchedInk).toBeLessThan(0.02);
    }
  }
});

test("4D shared artwork waits for all outcomes while ready cells remain inspectable", async ({
  page,
}) => {
  await observe(page);
  await open(page);
  await page.evaluate(() => {
    (window as any).fourAtlasDelay = 250;
  });
  const a = await enter(page);
  await a.getByLabel("Framing", { exact: true }).selectOption("shared");
  const first = a.getByRole("button", {
    name: "Inspect row 1, column 1",
    exact: true,
  });
  await expect(first).toBeEnabled();
  await expect(a.locator('.atlas-cell[data-state="pending"]')).not.toHaveCount(
    0,
  );
  await expect(a.locator(".atlas-art img")).toHaveCount(0);
  await first.click();
  await expect(
    a.getByRole("button", { name: "Adopt variant", exact: true }),
  ).toBeEnabled();
  await expect(a.locator(".atlas-inspected-art img")).toHaveCount(1);
  await a.getByRole("tab", { name: "Atlas grid", exact: true }).click();
  await generated(a);
  await expect(a.locator(".atlas-art img")).toHaveCount(9);
});

test("4D drawing loss stays visible without losing numerical inspection or adoption", async ({
  page,
}) => {
  await open(page);
  await page.evaluate(() => {
    URL.createObjectURL = () => `blob:${location.origin}/missing-atlas-image`;
  });
  const a = await enter(page);
  await generated(a);
  await expect(
    a.getByText(
      "This variant could not be drawn. It can still be inspected or adopted.",
      { exact: true },
    ),
  ).toHaveCount(9);
  await a
    .getByRole("button", { name: "Inspect row 2, column 3", exact: true })
    .click();
  await expect(
    a.getByRole("button", { name: "Adopt variant", exact: true }),
  ).toBeEnabled();
  await expect(
    a.getByText(
      "This variant could not be drawn. It can still be inspected or adopted.",
      { exact: true },
    ),
  ).toHaveCount(10);
  await a.getByRole("button", { name: "Adopt variant", exact: true }).click();
  await expect
    .poll(async () => (await metadata(page)).config.weave.alpha)
    .toBeGreaterThan(study().config.weave!.alpha);
  await settle(page);
});

test("4D flower preview quality distinguishes arc samples from petal-dependent base sampling", async ({
  page,
}) => {
  await open(page);
  const a = await enter(page);
  await expect(a.locator(".atlas-quality")).toContainText("arc samples");
  await a.getByText("Atlas limits and projection", { exact: true }).click();
  await expect(
    a.getByText(/nonconstant flowers use at least 16 base segments per petal/),
  ).toBeVisible();
});
