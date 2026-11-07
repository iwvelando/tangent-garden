import { test, expect } from "@playwright/test";
import { presetStudy } from "../../web/spatial/link";
import { spatialPresets } from "../../web/spatial/presets";

const source = () =>
  presetStudy(spatialPresets.findIndex((p) => p.name === "Two drops meeting"));

test("contract: preview quality changes only cloned implicit quality", async () => {
  const { previewConfig } = await import("./model");
  const study = source();
  study.config.implicit.refine = 3;
  const original = structuredClone(study.config);
  for (const size of [3, 5] as const) {
    const preview = previewConfig(study.config, size);
    const expected = structuredClone(original);
    expected.implicit.cells = size === 3 ? 24 : 16;
    expected.implicit.refine = 0;
    expect(preview).toEqual(expected);
  }
  expect(study.config).toEqual(original);
  study.config.implicit.cells = 8;
  expect(previewConfig(study.config, 5).implicit.cells).toBe(8);
});

test("contract: reserve anisotropic grids and sections plus original inspection", async () => {
  const { budget } = await import("./model");
  const study = source();
  study.config.implicit.box = {
    xMin: -2,
    xMax: 2,
    yMin: -1,
    yMax: 1,
    zMin: -0.5,
    zMax: 0.5,
  };
  study.config.implicit.cells = 64;
  study.config.implicit.sections.count = 7;
  // Exact dimensions: 24×12×6 or 16×8×4, plus 64×32×16.
  expect(budget(study.config, 3)).toMatchObject({
    gridCells: 9 * 24 * 12 * 6 + 64 * 32 * 16,
    sectionCells: 9 * 7 * 96 ** 2 + 7 * 256 ** 2,
  });
  expect(budget(study.config, 5).gridCells).toBe(
    25 * 16 * 8 * 4 + 64 * 32 * 16,
  );
  study.config.implicit.cells = 128;
  study.config.implicit.box.zMax = 1;
  study.config.implicit.box.zMin = -1;
  expect(budget(study.config, 5).error).toContain("grid");
});

test("contract: queue keeps original inspection and pair-only candidates; late replies are dropped", async () => {
  const { ImplicitAtlas } = await import("./model");
  const study = source();
  const frozen = structuredClone(study);
  const calls: { config: any; resolve: (f: any) => void }[] = [];
  const worker = {
    computeSpatial: (config: any) =>
      new Promise<any>((resolve) => calls.push({ config, resolve })),
  };
  const queue = new ImplicitAtlas(worker, () => {});
  queue.generate(study, { level: [0.6, 1.4], a: [0.8, 1.2] }, 3);
  expect(calls).toHaveLength(1);
  expect(calls[0].config.implicit).toMatchObject({
    cells: 24,
    refine: 0,
    level: 0.6,
    a: 0.8,
  });
  calls[0].resolve({
    config: calls[0].config,
    result: { implicit: { positions: new Float64Array(3) } },
  });
  await expect
    .poll(() => queue.state.cells.filter((c) => c.frame).length)
    .toBe(1);
  queue.inspect(0);
  // One grid request is already in flight; inspection goes next.
  calls[1].resolve({ config: calls[1].config, result: {} });
  await expect.poll(() => calls.length).toBe(3);
  expect(calls[2].config).toEqual({
    ...study.config,
    implicit: { ...study.config.implicit, level: 0.6, a: 0.8 },
  });
  calls[2].resolve({ config: calls[2].config, result: {} });
  await expect.poll(() => !!queue.candidate()).toBe(true);
  expect(queue.candidate()).toEqual({ ...frozen, config: calls[2].config });
  const stale = calls.at(-1)!;
  queue.cancel();
  stale.resolve({
    config: stale.config,
    result: { implicit: { positions: new Float64Array(100) } },
  });
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(queue.state.cells).toEqual([]);
  expect(queue.candidate()).toBeNull();
  expect(study).toEqual(frozen);
});

test("contract: retained geometry overflow is unavailable, never truncated", async () => {
  const { ImplicitAtlas } = await import("./model");
  const queue = new ImplicitAtlas(
    {
      computeSpatial: async (config: any) =>
        ({
          config,
          result: { implicit: { positions: new Float64Array(4_000_001) } },
        }) as any,
    },
    () => {},
  );
  queue.generate(source(), { level: [0.6, 1.4], a: [0.8, 1.2] }, 3);
  await expect
    .poll(() => queue.state.cells.filter((c) => c.error).length)
    .toBe(9);
  expect(
    queue.state.cells.every(
      (c) => !c.frame && c.error?.includes("geometry limit"),
    ),
  ).toBe(true);
});

test("contract: sections reserve their actual four-times-finer sampling and refuse excess", async () => {
  const { budget } = await import("./model");
  const study = source();
  study.config.implicit.sections.count = 24;
  expect(budget(study.config, 3).error).toContain("section");
  expect(budget(study.config, 5).sectionCells).toBe(
    25 * 24 * 64 ** 2 + 24 * 256 ** 2,
  );
});

const researchPath = "/scripts/implicit-atlas-research/index.html";
for (const size of [3, 5] as const)
  test(
    "browser: real grid and original inspection equal direct workers and the sphere definition " +
      size,
    async ({ page }) => {
      await page.goto(researchPath);
      await page
        .getByLabel("Experiment", { exact: true })
        .selectOption("sphere");
      await page
        .getByLabel("Grid size", { exact: true })
        .selectOption(String(size));
      await page
        .getByRole("button", { name: "Generate atlas", exact: true })
        .click();
      await expect(page.getByRole("status")).toHaveText(
        size ** 2 + " of " + size ** 2 + " variants ready.",
      );
      const evidence = await page.evaluate(async () => {
        const r = (window as any).research;
        let maxError = 0,
          vertices = 0,
          empty = 0;
        for (const cell of r.queue.state.cells) {
          const f = cell.frame;
          if (!f) throw new Error(cell.error ?? "Missing frame");
          const direct = await r.direct(f.config);
          // Compare all typed geometry and diagnostics in-page, not large JSON
          // number lists transported back to the test runner.
          const equal = (a: any, b: any): boolean => {
            if (a === b) return true;
            if (!a || !b || typeof a !== "object" || typeof b !== "object")
              return false;
            const ak = Object.keys(a),
              bk = Object.keys(b);
            return (
              ak.length === bk.length && ak.every((k) => equal(a[k], b[k]))
            );
          };
          if (!equal(f, direct)) throw new Error("Direct worker mismatch");
          const p = f.result.implicit.positions;
          if (!p.length) empty++;
          for (let i = 0; i < p.length; i += 3) {
            vertices++;
            maxError = Math.max(
              maxError,
              Math.abs(
                p[i] ** 2 +
                  p[i + 1] ** 2 +
                  p[i + 2] ** 2 -
                  cell.values[0] -
                  cell.values[1],
              ),
            );
          }
        }
        return { maxError, vertices, empty };
      });
      expect(evidence.vertices).toBeGreaterThan(100);
      expect(evidence.empty).toBeGreaterThan(0);
      expect(evidence.maxError).toBeLessThan(1e-8);
      await page
        .getByRole("button", { name: "Inspect row 2, column 2", exact: true })
        .click();
      await expect(
        page.getByRole("link", { name: "Open selected study" }),
      ).toBeVisible();
      expect(
        await page.evaluate(() => {
          const r = (window as any).research;
          return (
            r.queue.state.selection.frame.config.implicit.cells ===
            r.source.config.implicit.cells
          );
        }),
      ).toBe(true);
      await expect(page.locator(".inspection img")).toBeVisible();
    },
  );

test("browser: cancellation clears retained meshes and images; unavailable requests stay visible", async ({
  page,
}) => {
  await page.goto(researchPath);
  await page
    .getByRole("button", { name: "Generate atlas", exact: true })
    .click();
  await expect(page.locator(".research-cell img").first()).toBeVisible();
  await page.getByRole("button", { name: "Cancel atlas", exact: true }).click();
  await expect(page.locator(".research-cell")).toHaveCount(0);
  expect(
    await page.evaluate(
      () => (window as any).research.queue.state.cells.length,
    ),
  ).toBe(0);
  await page
    .getByLabel("Experiment", { exact: true })
    .selectOption("unavailable");
  await page
    .getByRole("button", { name: "Generate atlas", exact: true })
    .click();
  await expect(page.getByRole("status")).toHaveText("9 of 9 variants ready.");
  await expect(
    page.locator(".research-cell[data-state=unavailable]"),
  ).toHaveCount(9);
  await expect(page.locator(".research-cell").first()).toContainText("normal");
});

test("contract: research snapshots use the ordinary link and animation schema", async () => {
  const { cases, experiment } = await import("./model");
  const { spatialStudy } = await import("../../web/spatial/link");
  for (const c of cases) {
    const { study } = experiment(c.id);
    expect(spatialStudy(study)).toEqual(study);
  }
});

test("browser: cancel during numerical work is a clean return, without a fatal-engine alert", async ({
  page,
}) => {
  await page.addInitScript(() => {
    const post = Worker.prototype.postMessage;
    Worker.prototype.postMessage = function (message: any, ...args: any[]) {
      setTimeout(() => post.call(this, message, ...(args as any)), 1500);
    };
  });
  await page.goto(researchPath);
  await page
    .getByRole("button", { name: "Generate atlas", exact: true })
    .click();
  await expect(page.getByRole("status")).toHaveText("0 of 9 variants ready.");
  await page.getByRole("button", { name: "Cancel atlas", exact: true }).click();
  await expect(page.locator(".research-cell")).toHaveCount(0);
  await expect(page.getByRole("alert")).toHaveCount(0);
});

test("browser: shared grid keyboard movement and phone layouts keep every action reachable", async ({
  page,
}) => {
  await page.goto(researchPath);
  await page
    .getByRole("button", { name: "Generate atlas", exact: true })
    .click();
  await expect(page.getByRole("status")).toHaveText("9 of 9 variants ready.");
  const first = page.getByRole("button", {
    name: "Inspect row 1, column 1",
    exact: true,
  });
  await first.focus();
  await first.press("ArrowRight");
  await expect(
    page.getByRole("button", { name: "Inspect row 1, column 2", exact: true }),
  ).toBeFocused();
  for (const viewport of [
    { width: 390, height: 844 },
    { width: 844, height: 390 },
  ]) {
    await page.setViewportSize(viewport);
    const generate = page.getByRole("button", {
      name: "Generate atlas",
      exact: true,
    });
    await generate.scrollIntoViewIfNeeded();
    const box = await generate.boundingBox();
    expect(box!.x).toBeGreaterThanOrEqual(0);
    expect(box!.x + box!.width).toBeLessThanOrEqual(viewport.width);
    await page
      .getByRole("button", { name: "Inspect row 3, column 3", exact: true })
      .click();
    await expect(
      page.getByRole("link", { name: "Open selected study" }),
    ).toBeVisible();
    await page
      .getByRole("link", { name: "Open selected study" })
      .scrollIntoViewIfNeeded();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
  }
});

test("browser: drops expose disconnected and singular meshes at both preview sizes", async ({
  page,
}) => {
  for (const size of [3, 5]) {
    await page.goto(researchPath);
    await page
      .getByLabel("Grid size", { exact: true })
      .selectOption(String(size));
    await page
      .getByRole("button", { name: "Generate atlas", exact: true })
      .click();
    await expect(page.getByRole("status")).toHaveText(
      size ** 2 + " of " + size ** 2 + " variants ready.",
    );
    const evidence = await page.evaluate(() => {
      const r = (window as any).research;
      let error = 0,
        vertices = 0;
      for (const c of r.queue.state.cells) {
        const q = c.frame.result.implicit;
        for (let i = 0; i < q.positions.length; i += 3) {
          const [x, y, z] = q.positions.subarray(i, i + 3);
          const a = c.values[1];
          error = Math.max(
            error,
            Math.abs(
              ((x - a) ** 2 + y * y + z * z) * ((x + a) ** 2 + y * y + z * z) -
                c.values[0],
            ),
          );
          vertices++;
        }
      }
      const center =
        r.queue.state.cells[Math.floor(r.queue.state.cells.length / 2)].frame
          .result.implicit;
      const separated = r.queue.state.cells.find(
        (c: any) => c.values[0] === 0.6 && c.values[1] === 1,
      ).frame.result.implicit;
      return {
        error,
        vertices,
        singular: center.singular,
        centerChi: center.components.map((c: any) => c.euler),
        separated: separated.components.map((c: any) => [c.closed, c.euler]),
      };
    });
    expect(evidence.vertices).toBeGreaterThan(100);
    expect(evidence.error).toBeLessThan(1e-8);
    expect(evidence.singular).toBeGreaterThan(0);
    expect(evidence.centerChi).toEqual([3]);
    expect(evidence.separated).toEqual([
      [true, 2],
      [true, 2],
    ]);
  }
});

test("browser: an unresolved small hole changes between preview and refined inspection", async ({
  page,
}) => {
  await page.goto(researchPath);
  const classes = await page.evaluate(async () => {
    const r = (window as any).research;
    const config = structuredClone(r.source.config);
    Object.assign(config.implicit, {
      f: "(x^2+y^2-a)^2+z^2",
      a: 1,
      level: 0.999,
      cells: 24,
      box: {
        xMin: -1.9629,
        xMax: 2.0371,
        yMin: -1.9787,
        yMax: 2.0213,
        zMin: -2.0157,
        zMax: 1.9843,
      },
      sections: { normal: { x: 0, y: 0, z: 1 }, from: 0, to: 0, count: 0 },
    });
    const classes = [];
    for (const refine of [0, 2]) {
      config.implicit.refine = refine;
      const result = (await r.direct(config)).result.implicit;
      classes.push(result.components.map((c: any) => [c.closed, c.euler]));
    }
    return classes;
  });
  expect(classes).toEqual([[[true, 2]], [[true, 0]]]);
});

test("browser: images stay bounded across replacement and cancel revokes every URL", async ({
  page,
}) => {
  await page.addInitScript(() => {
    const live = new Set<string>();
    const create = URL.createObjectURL.bind(URL),
      revoke = URL.revokeObjectURL.bind(URL);
    URL.createObjectURL = (blob) => {
      const url = create(blob);
      live.add(url);
      return url;
    };
    URL.revokeObjectURL = (url) => {
      live.delete(url);
      revoke(url);
    };
    Object.assign(window, { liveImages: live });
  });
  await page.goto(researchPath);
  await page.getByLabel("Grid size", { exact: true }).selectOption("5");
  await page
    .getByRole("button", { name: "Generate atlas", exact: true })
    .click();
  await expect.poll(() => page.locator(".research-cell img").count()).toBe(25);
  expect(await page.evaluate(() => (window as any).liveImages.size)).toBe(25);
  for (const column of [1, 2, 3]) {
    await page
      .getByRole("button", {
        name: "Inspect row 1, column " + column,
        exact: true,
      })
      .click();
    await expect(page.locator(".inspection img")).toBeVisible();
    expect(await page.evaluate(() => (window as any).liveImages.size)).toBe(26);
  }
  await page.getByRole("button", { name: "Cancel atlas", exact: true }).click();
  await expect
    .poll(() => page.evaluate(() => (window as any).liveImages.size))
    .toBe(0);
  expect(
    await page.evaluate(() => (window as any).research.stats.retainedNumbers),
  ).toBe(0);
});

test("browser: the selected original-quality snapshot uses the ordinary SVG export", async ({
  page,
  context,
}) => {
  const { readFile } = await import("node:fs/promises");
  await page.goto(researchPath);
  await page.getByLabel("Experiment", { exact: true }).selectOption("sphere");
  await page
    .getByRole("button", { name: "Generate atlas", exact: true })
    .click();
  await expect(page.getByRole("status")).toHaveText("9 of 9 variants ready.");
  await page
    .getByRole("button", { name: "Inspect row 2, column 2", exact: true })
    .click();
  const link = page.getByRole("link", {
    name: "Open selected study",
    exact: true,
  });
  await expect(link).toBeVisible();
  const selected = await page.evaluate(() =>
    (window as any).research.queue.candidate(),
  );
  const notebook = await context.newPage();
  await notebook.goto((await link.getAttribute("href"))!);
  await expect(notebook.locator(".spatial-stage")).toHaveAttribute(
    "aria-busy",
    "false",
  );
  await notebook
    .getByRole("button", { name: "Export image", exact: true })
    .click();
  const download = notebook.waitForEvent("download");
  await notebook
    .getByRole("menuitem", { name: "SVG · embedded 3D image", exact: true })
    .click();
  const svg = await readFile((await (await download).path())!, "utf8");
  const desc = JSON.parse(
    svg
      .match(/<desc>(.*?)<\/desc>/s)![1]
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&amp;/g, "&"),
  );
  expect(desc.config.implicit).toEqual(selected.config.implicit);
  expect(desc.config.implicit.cells).toBe(48);
  const png = svg.match(/data:image\/png;base64,([^"]+)/)![0];
  const decoded = await notebook.evaluate(async (url) => {
    const image = new Image();
    image.src = url;
    await image.decode();
    return [image.naturalWidth, image.naturalHeight];
  }, png);
  expect(decoded[0]).toBeGreaterThanOrEqual(1000);
  expect(decoded[1]).toBeGreaterThanOrEqual(760);
  await notebook.close();
});

test("browser: range constants settle and invalid ranges name the offending endpoint", async ({
  page,
}) => {
  await page.goto(researchPath);
  await page.getByLabel("Level c to", { exact: true }).fill("pi/2");
  await expect(
    page.getByRole("button", { name: "Generate atlas", exact: true }),
  ).toBeEnabled();
  await page
    .getByRole("button", { name: "Generate atlas", exact: true })
    .click();
  await expect(page.getByRole("status")).toHaveText("9 of 9 variants ready.");
  expect(
    await page.evaluate(
      () => (window as any).research.queue.state.cells[2].values[0],
    ),
  ).toBe(Math.PI / 2);
  await page.getByLabel("Level c to", { exact: true }).fill("0");
  await expect(page.getByRole("alert")).toContainText("Level c to");
  await expect(
    page.getByRole("button", { name: "Generate atlas", exact: true }),
  ).toBeDisabled();
  await expect(page.locator(".research-cell")).toHaveCount(0);
  await page.getByLabel("Experiment", { exact: true }).selectOption("sphere");
  await expect(page.getByLabel("Level c to", { exact: true })).toHaveValue(
    "1.5",
  );
  await expect(
    page.getByRole("button", { name: "Generate atlas", exact: true }),
  ).toBeEnabled();
});

test("browser: wheel scrolling reaches inspection on a short desktop", async ({
  page,
}) => {
  await page.goto(researchPath);
  await page
    .getByRole("button", { name: "Generate atlas", exact: true })
    .click();
  await expect(page.getByRole("status")).toHaveText("9 of 9 variants ready.");
  await page
    .getByRole("button", { name: "Inspect row 2, column 2", exact: true })
    .click();
  await expect(
    page.getByRole("link", { name: "Open selected study" }),
  ).toBeVisible();
  await page.mouse.move(1100, 500);
  await page.mouse.wheel(0, 600);
  await expect
    .poll(async () => {
      const box = await page
        .getByRole("link", { name: "Open selected study" })
        .boundingBox();
      return !!box && box.y >= 0 && box.y + box.height <= 700;
    })
    .toBe(true);
});
