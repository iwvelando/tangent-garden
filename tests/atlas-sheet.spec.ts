import { test, expect } from "@playwright/test";
import { readFile, writeFile } from "node:fs/promises";
import { choosePreset, chooseColorScheme } from "./helpers";
import { decodePng } from "./png";
import { execFileSync } from "node:child_process";
import { observeAtlasWorkers } from "./gallery-helpers";

test("parameter captions draw bare text without a box in either theme", async () => {
  const { paintSheetNote, prepareSheetNotes } =
    await import("../web/atlas-sheet-notes");
  const { sheetLayout } = await import("../web/atlas-sheet");
  const note = { parameters: ["xw = -0.5", "yw = -0.25"] };
  const prepared = prepareSheetNotes(
    sheetLayout(3),
    Array.from({ length: 9 }, () => note),
    { title: "Atlas", definition: ["Definition"] },
    (s) => s.length * 10,
  );
  for (const dark of [false, true]) {
    const boxes: string[] = [],
      text: string[] = [];
    const context = {
      fillRect: () => boxes.push("fill"),
      strokeRect: () => boxes.push("stroke"),
      fillText: (s: string) => text.push(s),
    } as any;
    paintSheetNote(
      context,
      note,
      prepared.lines[0],
      prepared.layout.tiles[0],
      prepared.layout,
      dark,
      "plum",
    );
    expect(text).toEqual(["xw = -0.5", "yw = -0.25"]);
    expect(boxes).toEqual([]);
  }
});

test("atlas export and limits disclosures have the normal control clearance", async ({
  page,
}) => {
  for (const [notebook, name, title] of [
    ["2d", "Hypotrochoid & its evolute", "A field of possible flowers"],
    ["3d", "Trefoil · (2, 3)", "A field of possible forms"],
    ["4d", "A cube beyond a cube", "A field of possible worlds"],
  ] as const) {
    await page.goto(notebook === "2d" ? "/" : `/?study=${notebook}`);
    await choosePreset(page, { label: name });
    await page
      .getByRole("button", { name: "Explore parameter atlas", exact: true })
      .click();
    const atlas = page.getByRole("dialog", { name: title, exact: true });
    const gap = await atlas.locator(".atlas-sheet-export").evaluate((sheet) => {
      const first = sheet.querySelector("summary")!.getBoundingClientRect();
      const next = sheet
        .nextElementSibling!.querySelector("summary")!
        .getBoundingClientRect();
      return {
        actual: next.top - first.bottom,
        reference: parseFloat(
          getComputedStyle(
            sheet.closest(".atlas-controls")!.querySelector(".atlas-ranges")!,
          ).rowGap,
        ),
      };
    });
    expect(gap.actual).toBeCloseTo(gap.reference, 1);
  }
});

test("teaching captions preserve full text, grid positions, and bounded geometry panels", async () => {
  const { wrapSheetText, prepareSheetNotes, sheetValueForAxes } =
    await import("../web/atlas-sheet-notes");
  const { sheetLayout } = await import("../web/atlas-sheet");
  const measure = (s: string) => Array.from(s).length * 10;
  expect(wrapSheetText("alpha beta gamma", 100, measure)).toEqual([
    "alpha beta",
    "gamma",
  ]);
  expect(wrapSheetText("cos(1234567890*t)", 60, measure).join("")).toBe(
    "cos(1234567890*t)",
  );
  const notes = Array.from({ length: 25 }, (_, i) => ({
    parameters: ["p = 2", "q = 3"],
    ...(i === 6 && { reason: "Windings must be coprime." }),
  }));
  const plain = sheetLayout(5, true);
  const header = {
    title: "Parameter atlas · Preview geometry",
    definition: ["r(t) = (cos(t), sin(t))"],
  };
  const labeled = prepareSheetNotes(plain, notes, header, measure);
  expect(labeled.layout.width).toBe(2400);
  expect(labeled.layout.height).toBeLessThanOrEqual(6144);
  expect(labeled.layout.cell).toEqual(plain.cell);
  expect(labeled.layout.tiles).toHaveLength(25);
  expect(labeled.headerLines.join(" ")).toBe(header.definition[0]);
  expect(labeled.lines[0]).toEqual(["p = 2", "q = 3"]);
  expect(labeled.layout.captionHeight).toBeLessThan(200);
  expect(labeled.lines[6].join(" ")).toContain("Unavailable");
  expect(labeled.lines[6].join(" ")).toContain("Windings must be coprime.");
  for (const [i, point] of labeled.layout.tiles.entries()) {
    expect(point.x).toBe(plain.tiles[i].x);
    expect(point.y - labeled.layout.captionHeight).toBeGreaterThanOrEqual(24);
    expect(
      labeled.lines[i].every((s) => measure(s) <= plain.cell.width - 24),
    ).toBe(true);
  }
  expect(() =>
    prepareSheetNotes(
      plain,
      notes,
      { ...header, definition: ["x".repeat(100000)] },
      measure,
    ),
  ).toThrow(/too tall|6144|fit/);
  const axes = [{ path: ["angles", 3] }, { path: ["nested", "a"] }] as any;
  const value = sheetValueForAxes(axes);
  expect(value(["angles", 3], 0)).toBe("column value");
  expect(value(["nested", "a"], 7)).toBe("row value");
  expect(value(["unrelated"], 1.23456789123456)).toBe("1.23456789123456");
});

test("sheet definitions describe the active curve and descriptor-owned 4D object", async () => {
  const { planarSheetDefinition } =
    await import("../web/planar-sheet-definition");
  const { spatialSheetDefinition } =
    await import("../web/spatial/atlas-definition");
  const { tesseractSheetDefinition } =
    await import("../web/tesseract/atlas-definition");
  const { presets } = await import("../web/presets");
  const { spatialPresets } = await import("../web/spatial/presets");
  const { tesseractPresets } = await import("../web/tesseract/presets");
  const { objects } = await import("../web/tesseract/objects");
  const c = structuredClone(presets[0].config);
  c.curve.x = "(a+2)*cos(t)";
  c.curve.y = "sin(3*t)";
  c.curve.a = 1.23456789123456;
  const planar = planarSheetDefinition(c).join(" ");
  expect(planar).toContain("(a+2)*cos(t)");
  expect(planar).toContain("sin(3*t)");
  expect(planar).toContain("1.23456789123456");
  const knot = spatialPresets.find(
    (p) => p.name === "Trefoil · (2, 3)",
  )!.config;
  const definition = spatialSheetDefinition(knot).join(" ");
  expect(definition).toContain("cos(qt)");
  expect(definition).toContain("cos(pt)");
  expect(definition).toContain(String(knot.radius));
  for (const p of tesseractPresets.filter(
    (p) => objects[p.config.object].atlas,
  )) {
    const d = objects[p.config.object];
    if (!d.atlas!.pairs.some((pair) => pair.supports(p.config))) continue;
    const lines = tesseractSheetDefinition(p.config);
    expect(lines.join(" ")).toContain(d.name);
    expect(lines.join(" ")).toContain(d.explanation(p.config)[2]);
    expect(lines.join(" ")).toContain(String(p.config.angles[3]));
  }
  const root = structuredClone(
    tesseractPresets.find((p) => p.config.object === "root")!.config,
  );
  root.root!.sheet = "minus";
  const rootText = tesseractSheetDefinition(root).join(" ");
  expect(rootText).toContain("w(0) = −√r");
  expect(rootText).not.toContain("Trace start");
});

for (const [notebook, preset, title] of [
  ["2d", "Cassini ovals & the lemniscate", "A field of possible flowers"],
  ["4d", "A flower below, a bouquet above", "A field of possible worlds"],
] as const) {
  test(`${notebook} teaching sheet uses the active definition and exact edited parameters`, async ({
    page,
  }, info) => {
    await page.emulateMedia({ colorScheme: "dark" });
    await page.goto(notebook === "2d" ? "/" : "/?study=4d");
    await choosePreset(page, { label: preset });
    await page
      .getByRole("button", { name: "Explore parameter atlas", exact: true })
      .click();
    const atlas = page.getByRole("dialog", { name: title, exact: true });
    if (notebook === "4d") {
      await atlas
        .getByRole("textbox", { name: "Flower amplitude A from", exact: true })
        .fill("-0.1");
      await atlas
        .getByRole("textbox", { name: "Flower amplitude A to", exact: true })
        .fill("0.3");
      await atlas
        .getByRole("button", { name: "Generate atlas", exact: true })
        .click();
    }
    await expect(atlas.locator(".atlas-cell")).toHaveCount(9);
    await expect(atlas.locator(".atlas-cell[data-state=pending]")).toHaveCount(
      0,
    );
    await atlas.getByText("Export atlas sheet", { exact: true }).click();
    await atlas
      .getByRole("checkbox", {
        name: "Include definitions and parameters",
        exact: true,
      })
      .check();
    const download = page.waitForEvent("download");
    await atlas
      .getByRole("button", { name: "Export preview sheet", exact: true })
      .click();
    await expect(atlas.locator(".atlas-sheet-export")).toContainText(
      /saved as|could not be exported/,
    );
    await expect(atlas.locator(".atlas-sheet-export .field-error")).toHaveCount(
      0,
    );
    const saved = await download;
    expect(saved.suggestedFilename()).toBe(`atlas-${notebook}-preview.png`);
    const bytes = await readFile((await saved.path())!);
    await writeFile(info.outputPath("teaching-sheet.png"), bytes);
    const key = "Tangent Garden\0\0\0\0\0",
      text = bytes.toString("utf8");
    const record = JSON.parse(
      text.slice(text.indexOf(key) + key.length, text.lastIndexOf("}") + 1),
    );
    const png = decodePng(bytes);
    expect(png.width).toBe(2400);
    expect(png.height).toBeLessThanOrEqual(6144);
    expect(png.height).toBeGreaterThan(notebook === "4d" ? 3612 : 1842);
    expect(record.notes).toHaveLength(9);
    expect(record.quality).toBe("preview");
    for (const [i, note] of record.notes.entries()) {
      expect(note.parameters).toEqual(
        record.axes.map(
          (a: any, k: number) => `${a.label} = ${record.cells[i].values[k]}`,
        ),
      );
      if (notebook === "2d") {
        expect(record.header.definition.join(" ")).toContain(
          record.source.config.curve.implicit.f,
        );
        expect(record.header.definition.join(" ")).toContain(
          "c = column value",
        );
        expect(record.header.definition.join(" ")).toContain("a = row value");
      } else {
        expect(record.header.definition.join(" ")).toContain("α(t)");
        expect(record.header.definition.join(" ")).toContain(
          "Flower amplitude A = row value",
        );
        expect(record.header.definition.join(" ")).toContain(
          `Petals = ${record.source.config.weave.petals}`,
        );
      }
      if (!record.cells[i].available)
        expect(note.reason).toBe(record.cells[i].error);
    }
    if (notebook === "4d")
      expect(record.cells.filter((c: any) => !c.available)).toHaveLength(3);
  });
}

test("PNG teaching sheet labels every knot cell and explains unavailable combinations without changing geometry", async ({
  page,
}, info) => {
  await page.addInitScript(() => {
    (window as any).sheetText = [];
    const fill = CanvasRenderingContext2D.prototype.fillText;
    CanvasRenderingContext2D.prototype.fillText = function (
      text,
      x,
      y,
      ...args
    ) {
      if (this.canvas.width === 2400)
        (window as any).sheetText.push({
          text,
          x,
          y,
          width: this.measureText(text).width,
          font: this.font,
        });
      fill.call(this, text, x, y, ...args);
    };
  });
  await page.goto("/?study=3d");
  await choosePreset(page, { label: "Trefoil · (2, 3)" });
  await page
    .getByRole("button", { name: "Explore parameter atlas", exact: true })
    .click();
  const atlas = page.getByRole("dialog", {
    name: "A field of possible forms",
    exact: true,
  });
  await atlas.getByLabel("Grid size", { exact: true }).selectOption("5");
  await atlas
    .getByRole("button", { name: "Generate atlas", exact: true })
    .click();
  await expect(atlas.locator(".atlas-cell")).toHaveCount(25);
  await expect(atlas.locator(".atlas-cell[data-state=pending]")).toHaveCount(0);
  await atlas.getByText("Export atlas sheet", { exact: true }).click();
  await expect(atlas.getByLabel("Sheet format", { exact: true })).toHaveValue(
    "png",
  );
  const labels = atlas.getByRole("checkbox", {
    name: "Include definitions and parameters",
    exact: true,
  });
  await expect(labels).not.toBeChecked();
  const save = async () => {
    const download = page.waitForEvent("download");
    await atlas
      .getByRole("button", { name: "Export preview sheet", exact: true })
      .click();
    const bytes = await readFile((await (await download).path())!);
    const text = bytes.toString("utf8"),
      key = "Tangent Garden\0\0\0\0\0";
    const metadata = JSON.parse(
      text.slice(text.indexOf(key) + key.length, text.lastIndexOf("}") + 1),
    );
    return { bytes, image: decodePng(bytes), metadata };
  };
  const plain = await save();
  await labels.check();
  const teaching = await save();
  await writeFile(info.outputPath("teaching-sheet.png"), teaching.bytes);
  expect(teaching.metadata.notes).toHaveLength(25);
  expect(teaching.metadata.notes[6].reason).toMatch(/coprime/);
  expect(teaching.metadata.notes[1].parameters).toEqual([
    "Windings around p = 2",
    "Windings through q = 1",
  ]);
  expect(teaching.image.width).toBe(2400);
  expect(teaching.image.height).toBeLessThanOrEqual(6144);
  expect(teaching.metadata.layout.cell).toEqual(plain.metadata.layout.cell);
  expect(teaching.metadata.header.definition.join(" ")).toContain("r(t)");
  expect(teaching.metadata.header.definition.join(" ")).toContain(
    "p = column value",
  );
  expect(teaching.metadata.header.definition.join(" ")).toContain(
    "q = row value",
  );
  for (const [i, cell] of teaching.metadata.cells.entries()) {
    expect(cell).toEqual(plain.metadata.cells[i]);
    expect(Object.keys(teaching.metadata.notes[i]).sort()).toEqual(
      cell.available ? ["parameters"] : ["parameters", "reason"],
    );
    const caption = teaching.metadata.layout.tiles[i];
    const corner =
      4 *
      ((caption.y - teaching.metadata.layout.captionHeight + 3) * 2400 +
        caption.x +
        3);
    expect(teaching.image.rgba.slice(corner, corner + 4)).toEqual(
      teaching.image.rgba.slice(0, 4),
    );
    if (!cell.available) {
      expect(teaching.metadata.notes[i].reason).toBe(cell.error);
      continue;
    }
    const a = plain.metadata.layout.tiles[i],
      b = teaching.metadata.layout.tiles[i];
    const { width, height } = plain.metadata.layout.cell;
    for (let row = 0; row < height; row++) {
      const oldAt = 4 * ((a.y + row) * 2400 + a.x),
        newAt = 4 * ((b.y + row) * 2400 + b.x);
      expect(teaching.image.rgba.slice(newAt, newAt + width * 4)).toEqual(
        plain.image.rgba.slice(oldAt, oldAt + width * 4),
      );
    }
  }
  const text = await page.evaluate(() => (window as any).sheetText);
  expect(text.map((t: any) => t.text).join(" ")).toContain("coprime");
  expect(text.map((t: any) => t.text).join(" ")).toContain("Unavailable");
  expect(text.filter((line: any) => line.text.includes("r(t)")).length).toBe(1);
  for (const line of text) {
    if (line.y < 24 + teaching.metadata.layout.headerHeight) {
      expect(line.x).toBe(24);
      expect(line.width).toBeLessThanOrEqual(2352);
      continue;
    }
    expect(line.width).toBeLessThanOrEqual(
      teaching.metadata.layout.cell.width - 24,
    );
    expect(line.font).toContain("22px");
    expect(
      teaching.metadata.layout.tiles.some(
        (tile: any) =>
          line.x === tile.x + 12 &&
          line.y >= tile.y - teaching.metadata.layout.captionHeight &&
          line.y + 22 <= tile.y,
      ),
    ).toBe(true);
  }
  await page.screenshot({ path: info.outputPath("teaching-controls.png") });
});

for (const action of [
  "framing",
  "range",
  "dismiss",
  "theme",
  "labels",
] as const) {
  test(`pending sheet is discarded on ${action}`, async ({ page }) => {
    await page.addInitScript(() => {
      const encode = HTMLCanvasElement.prototype.toBlob;
      HTMLCanvasElement.prototype.toBlob = function (callback, ...args) {
        if (this.width === 2400) {
          (window as any).sheetEncoding = true;
          encode.call(
            this,
            (blob) =>
              setTimeout(() => {
                callback(blob);
                (window as any).sheetDrained = true;
              }, 600),
            ...args,
          );
        } else encode.call(this, callback, ...args);
      };
    });
    await page.emulateMedia({ colorScheme: "light" });
    await page.goto("/");
    await choosePreset(page, { label: "Hypotrochoid & its evolute" });
    await page
      .getByRole("button", { name: "Explore parameter atlas", exact: true })
      .click();
    const atlas = page.getByRole("dialog", {
      name: "A field of possible flowers",
      exact: true,
    });
    await expect(atlas.locator(".atlas-cell")).toHaveCount(9);
    await expect(atlas.locator(".atlas-cell[data-state=pending]")).toHaveCount(
      0,
    );
    await atlas.getByText("Export atlas sheet", { exact: true }).click();
    const downloads: string[] = [];
    page.on("download", (d) => downloads.push(d.suggestedFilename()));
    await atlas
      .getByRole("button", { name: "Export preview sheet", exact: true })
      .click();
    await page.waitForFunction(() => (window as any).sheetEncoding);
    if (action === "framing")
      await atlas.getByLabel("Framing", { exact: true }).selectOption("shared");
    if (action === "range")
      await atlas
        .getByRole("textbox", { name: "Rolling radius from", exact: true })
        .fill("1.6");
    if (action === "dismiss")
      await atlas
        .getByRole("button", { name: "Cancel atlas", exact: true })
        .click();
    if (action === "theme") await page.emulateMedia({ colorScheme: "dark" });
    if (action === "labels")
      await atlas
        .getByRole("checkbox", {
          name: "Include definitions and parameters",
          exact: true,
        })
        .check();
    await page.waitForFunction(() => (window as any).sheetDrained);
    expect(downloads).toEqual([]);
    if (action !== "dismiss")
      await expect(atlas.locator(".atlas-sheet-export")).toContainText(
        "Sheet canceled.",
      );
  });
}

test("PNG fallback is named honestly and an encode failure saves no file", async ({
  page,
}) => {
  await page.addInitScript(() => {
    const url = HTMLCanvasElement.prototype.toDataURL;
    HTMLCanvasElement.prototype.toDataURL = function (type, ...args) {
      return url.call(
        this,
        type === "image/webp" ? "image/png" : type,
        ...args,
      );
    };
    const encode = HTMLCanvasElement.prototype.toBlob;
    HTMLCanvasElement.prototype.toBlob = function (callback, ...args) {
      if (this.width === 2400 && (window as any).failSheet) callback(null);
      else encode.call(this, callback, ...args);
    };
  });
  await page.goto("/");
  await choosePreset(page, { label: "Hypotrochoid & its evolute" });
  await page
    .getByRole("button", { name: "Explore parameter atlas", exact: true })
    .click();
  const atlas = page.getByRole("dialog", {
    name: "A field of possible flowers",
    exact: true,
  });
  await expect(atlas.locator(".atlas-cell")).toHaveCount(9);
  await expect(atlas.locator(".atlas-cell[data-state=pending]")).toHaveCount(0);
  await atlas.getByText("Export atlas sheet", { exact: true }).click();
  await expect(atlas.getByLabel("Sheet format", { exact: true })).toHaveValue(
    "png",
  );
  await expect(atlas.locator(".atlas-sheet-export")).toContainText(
    "WebP encoding is unavailable",
  );
  const download = page.waitForEvent("download");
  const button = atlas.getByRole("button", {
    name: "Export preview sheet",
    exact: true,
  });
  await button.click();
  expect((await download).suggestedFilename()).toBe("atlas-2d-preview.png");
  await page.evaluate(() => {
    (window as any).failSheet = true;
  });
  const unexpected: string[] = [];
  page.on("download", (d) => unexpected.push(d.suggestedFilename()));
  await button.click();
  await expect(atlas.getByRole("alert")).toContainText("could not be encoded");
  expect(unexpected).toEqual([]);
  await expect(button).toBeEnabled();
});

test("WebP sheet is independently decodable, carries XMP and requests no new geometry", async ({
  page,
}, info) => {
  await observeAtlasWorkers(page);
  await page.goto("/");
  await choosePreset(page, { label: "Hypotrochoid & its evolute" });
  await page
    .getByRole("button", { name: "Explore parameter atlas", exact: true })
    .click();
  const atlas = page.getByRole("dialog", {
    name: "A field of possible flowers",
    exact: true,
  });
  await expect(atlas.locator(".atlas-cell")).toHaveCount(9);
  await expect(atlas.locator(".atlas-cell[data-state=pending]")).toHaveCount(0);
  const requests = () =>
    page.evaluate(() =>
      (window as any).atlasWorkers.map((w: any) => w.requests.length),
    );
  const before = await requests();
  await atlas.getByText("Export atlas sheet", { exact: true }).click();
  await expect(atlas.getByLabel("Sheet format", { exact: true })).toHaveValue(
    "png",
  );
  await atlas.getByLabel("Sheet format", { exact: true }).selectOption("webp");
  const download = page.waitForEvent("download");
  const started = Date.now();
  await atlas
    .getByRole("button", { name: "Export preview sheet", exact: true })
    .click();
  const saved = await download;
  expect(saved.suggestedFilename()).toBe("atlas-2d-preview.webp");
  const path = (await saved.path())!;
  const bytes = await readFile(path);
  const png = execFileSync(
    "ffmpeg",
    [
      "-v",
      "error",
      "-i",
      path,
      "-frames:v",
      "1",
      "-f",
      "image2pipe",
      "-vcodec",
      "png",
      "pipe:1",
    ],
    { maxBuffer: 64 * 1024 * 1024 },
  );
  const decoded = decodePng(png);
  expect([decoded.width, decoded.height]).toEqual([2400, 1842]);
  expect(decoded.rgba.some((n) => n !== decoded.rgba[0])).toBe(true);
  expect(bytes.toString("ascii", 0, 4)).toBe("RIFF");
  expect(bytes.readUInt32LE(4)).toBe(bytes.length - 8);
  expect(bytes.toString("ascii", 12, 16)).toBe("VP8X");
  expect(bytes[20] & 4).toBe(4);
  const xmp = bytes.toString("utf8").match(/<tg:study>(.*?)<\/tg:study>/s)![1];
  const metadata = JSON.parse(
    xmp
      .replaceAll("&lt;", "<")
      .replaceAll("&gt;", ">")
      .replaceAll("&amp;", "&"),
  );
  expect(metadata).toMatchObject({
    quality: "preview",
    format: "webp",
    compression: { quality: 95, lossless: false },
    notebook: "2d",
  });
  expect(await requests()).toEqual(before);
  await atlas.getByLabel("Sheet format", { exact: true }).selectOption("png");
  const lossless = page.waitForEvent("download");
  await atlas
    .getByRole("button", { name: "Export preview sheet", exact: true })
    .click();
  const pngBytes = await readFile((await (await lossless).path())!);
  expect(decodePng(pngBytes).width).toBe(2400);
  expect(await requests()).toEqual(before);
  await info.attach("webp-sheet", { body: bytes, contentType: "image/webp" });
  console.log(
    `sheet observation: same independent roulette grid: WebP ${bytes.length} bytes, PNG ${pngBytes.length} bytes; ${Date.now() - started} ms for both downloads and WebP decode`,
  );
});

test("cancel during encoding discards output and waits for its surface to drain", async ({
  page,
}) => {
  await page.addInitScript(() => {
    const encode = HTMLCanvasElement.prototype.toBlob;
    HTMLCanvasElement.prototype.toBlob = function (callback, ...args) {
      if (this.width === 2400) {
        (window as any).sheetEncoding = true;
        encode.call(
          this,
          (blob) => setTimeout(() => callback(blob), 1500),
          ...args,
        );
      } else encode.call(this, callback, ...args);
    };
  });
  await page.goto("/");
  await choosePreset(page, { label: "Hypotrochoid & its evolute" });
  await page
    .getByRole("button", { name: "Explore parameter atlas", exact: true })
    .click();
  const atlas = page.getByRole("dialog", {
    name: "A field of possible flowers",
    exact: true,
  });
  await expect(atlas.locator(".atlas-cell")).toHaveCount(9);
  await expect(atlas.locator(".atlas-cell[data-state=pending]")).toHaveCount(0);
  await atlas.getByText("Export atlas sheet", { exact: true }).click();
  const downloads: string[] = [];
  page.on("download", (d) => downloads.push(d.suggestedFilename()));
  const button = atlas.getByRole("button", {
    name: "Export preview sheet",
    exact: true,
  });
  await button.click();
  await page.waitForFunction(() => (window as any).sheetEncoding);
  await atlas
    .getByRole("button", { name: "Cancel sheet", exact: true })
    .click();
  await expect(button).toBeDisabled();
  await expect(button).toBeEnabled();
  expect(downloads).toEqual([]);
  await expect(atlas.locator(".atlas-sheet-export")).toContainText(
    "Sheet canceled.",
  );
});

test("sheet cancellation drains one export and releases its surfaces before another starts", async () => {
  const { atlasSheet } = await import("../web/atlas-sheet");
  const canvases: any[] = [];
  const original = Object.getOwnPropertyDescriptor(globalThis, "document");
  Object.defineProperty(globalThis, "document", {
    configurable: true,
    value: {
      createElement: () => {
        const canvas = {
          width: 0,
          height: 0,
          getContext: () => ({
            fillRect() {},
            clearRect() {},
            getImageData: () => ({ data: [0, 0, 0, 255] }),
          }),
        };
        canvases.push(canvas);
        return canvas;
      },
    },
  });
  let finish!: (blob: Blob) => void;
  let disposed = 0,
    calls = 0;
  const abort = new AbortController();
  const options = {
    cells: Array.from({ length: 9 }, () => ({
      values: [1, 2] as [number, number],
      frame: {},
    })),
    size: 3 as const,
    dark: false,
    scheme: "default" as const,
    format: "png" as const,
    metadata: {},
    signal: abort.signal,
    painter: () => ({
      draw: async () => {
        calls++;
        return new Promise<Blob>((r) => {
          finish = r;
        });
      },
      dispose: () => {
        disposed++;
      },
    }),
    progress() {},
  };
  try {
    const pending = atlasSheet(options);
    expect(calls).toBe(1);
    abort.abort();
    await expect(
      atlasSheet({ ...options, signal: new AbortController().signal }),
    ).rejects.toThrow(/finishing|already/);
    expect(canvases).toHaveLength(1);
    finish(new Blob());
    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
    expect(calls).toBe(1);
    expect(disposed).toBe(1);
    expect(canvases[0]).toMatchObject({ width: 0, height: 0 });
    // Admission and metadata limits run before allocating or calling a painter.
    await expect(
      atlasSheet({
        ...options,
        signal: new AbortController().signal,
        metadata: { large: "a".repeat(65536) },
      }),
    ).rejects.toThrow(/64 KiB/);
    expect(canvases).toHaveLength(1);
  } finally {
    if (original) Object.defineProperty(globalThis, "document", original);
    else delete (globalThis as any).document;
  }
});

test("sheet layout bounds every admitted size and preserves refused slots", async () => {
  const { sheetLayout, sheetReady } = await import("../web/atlas-sheet");
  for (const size of [3, 5] as const) {
    for (const paired of [false, true]) {
      const layout = sheetLayout(size, paired);
      expect(layout.width).toBe(2400);
      expect(layout.height).toBeLessThanOrEqual(3648);
      expect(layout.tiles).toHaveLength(size * size);
      expect(Number.isInteger(layout.cell.width)).toBe(true);
      const margin = size === 3 ? 24 : 26;
      expect(layout.tiles[0]).toMatchObject({ x: margin, y: 24 });
      expect(layout.tiles[1].x).toBe(margin + layout.cell.width + 12);
      expect(layout.tiles[size].y).toBe(24 + layout.cell.height + 12);
      expect(layout.tiles.at(-1)!.x + layout.cell.width).toBe(2400 - margin);
      expect(layout.tiles.at(-1)!.y + layout.cell.height).toBe(
        layout.height - 24,
      );
      expect(layout.cell.height).toBe(
        Math.round(layout.cell.width * (paired ? 1.52 : 0.76)),
      );
    }
    const cells = Array.from({ length: size * size }, () => ({
      error: "refused",
    }));
    expect(sheetReady(cells, size)).toBe(false);
    Object.assign(cells[1], { frame: {} });
    expect(sheetReady(cells, size)).toBe(true);
    cells[2] = {} as any;
    expect(sheetReady(cells, size)).toBe(false);
    expect(sheetReady(cells.slice(1), size)).toBe(false);
  }
  expect(() => sheetLayout(99 as any)).toThrow();
});

// These are actual saved files, decoded independently of the export canvas.
// Black/white synthetic tiles aren't a substitute for the ordinary WASM path.
for (const [notebook, name, title, paired, size] of [
  ["2d", "Hypotrochoid & its evolute", "A field of possible flowers", false, 3],
  ["2d", "Clifford attractor", "A field of possible flowers", false, 5],
  ["3d", "Trefoil · (2, 3)", "A field of possible forms", false, 5],
  [
    "3d",
    "The focal sheets of an ellipsoid",
    "A field of possible forms",
    false,
    3,
  ],
  ["3d", "Two drops meeting", "A field of possible forms", false, 5],
  [
    "4d",
    "A flower below, a bouquet above",
    "A field of possible worlds",
    true,
    3,
  ],
  ["4d", "A cube beyond a cube", "A field of possible worlds", false, 5],
] as const) {
  test(`${notebook} ${name} sheet saves preview geometry with provenance and blank refused cells`, async ({
    page,
  }, info) => {
    // Read the app's SVG blobs without weakening connect-src to allow fetch
    // of blob URLs. Only the test retains these references.
    await page.addInitScript(() => {
      const create = URL.createObjectURL.bind(URL);
      const blobs = new Map<string, Blob>();
      (window as any).sheetTestBlobs = blobs;
      URL.createObjectURL = (blob) => {
        const url = create(blob);
        blobs.set(url, blob as Blob);
        return url;
      };
    });
    await page.emulateMedia({
      colorScheme: notebook === "4d" ? "dark" : "light",
    });
    await page.goto(notebook === "2d" ? "/" : `/?study=${notebook}`);
    await choosePreset(page, { label: name });
    if (notebook === "4d") await chooseColorScheme(page, "plum");
    await page
      .getByRole("button", { name: "Explore parameter atlas", exact: true })
      .click();
    const atlas = page.getByRole("dialog", { name: title, exact: true });
    if (size === 5) {
      await atlas.getByLabel("Grid size", { exact: true }).selectOption("5");
      await atlas
        .getByRole("button", { name: "Generate atlas", exact: true })
        .click();
    }
    await expect(atlas.locator(".atlas-cell")).toHaveCount(size * size);
    await expect(
      atlas.locator('.atlas-cell[data-state="pending"]'),
    ).toHaveCount(0);
    // The metadata and image must reflect the grid's shared framing.
    await atlas.getByLabel("Framing", { exact: true }).selectOption("shared");
    await atlas.getByText("Export atlas sheet", { exact: true }).click();
    await atlas.getByLabel("Sheet format", { exact: true }).selectOption("png");
    const download = page.waitForEvent("download");
    const exportStarted = Date.now();
    await atlas
      .getByRole("button", { name: "Export preview sheet", exact: true })
      .click();
    await expect(atlas.locator(".atlas-sheet-export")).toContainText(
      /saved as|could not be exported|canceled/,
    );
    await expect(atlas.locator(".atlas-sheet-export .field-error")).toHaveCount(
      0,
    );
    const saved = await download;
    expect(saved.suggestedFilename()).toBe(`atlas-${notebook}-preview.png`);
    const exportMs = Date.now() - exportStarted;
    const bytes = await readFile((await saved.path())!);
    await writeFile(info.outputPath("sheet.png"), bytes);
    console.log(
      `sheet observation: ${name} ${size} × ${size} PNG ${bytes.length} bytes, ${exportMs} ms click-to-file`,
    );
    await info.attach("contact-sheet", {
      body: bytes,
      contentType: "image/png",
    });
    const image = decodePng(bytes);
    expect(image.width).toBe(2400);
    expect(image.height).toBe(
      paired ? (size === 3 ? 3612 : 3591) : size === 3 ? 1842 : 1846,
    );
    const text = bytes.toString("utf8");
    const begin =
      text.indexOf("Tangent Garden\0\0\0\0\0") +
      "Tangent Garden\0\0\0\0\0".length;
    expect(begin).toBeGreaterThan(21);
    const metadata = JSON.parse(text.slice(begin, text.lastIndexOf("}") + 1));
    expect(metadata).toMatchObject({
      kind: "atlas-contact-sheet",
      notebook,
      quality: "preview",
      framing: "shared",
      format: "png",
      size,
    });
    expect(metadata.cells).toHaveLength(size * size);
    expect(metadata.axes).toHaveLength(2);
    expect(metadata.source.config).toBeTruthy();
    expect(metadata.preview).toBeTruthy();
    expect(metadata.dark).toBe(notebook === "4d");
    expect(metadata.scheme).toBe(notebook === "4d" ? "plum" : "default");
    if (name === "Trefoil · (2, 3)") {
      expect(metadata.axes.map((a: any) => a.path)).toEqual([["p"], ["q"]]);
      expect(metadata.cells.map((c: any) => c.values)).toEqual(
        [1, 2, 3, 4, 5].flatMap((q) => [1, 2, 3, 4, 5].map((p) => [p, q])),
      );
      expect(metadata.preview.samples).toBe(240);
      expect(metadata.source.config.samples).toBe(960);
    }
    // Rasterize the actual displayed vectors independently at the output
    // tile's resolution, then compare the decoded file's first tile. This
    // catches swapped frames, changed framing/palette, and screen upscaling.
    if ((notebook === "2d" && size === 3) || notebook === "4d") {
      const reference = await atlas
        .locator(".atlas-art")
        .first()
        .evaluate(async (art, pageSize) => {
          const live = art.querySelector("svg");
          const text = live
            ? new XMLSerializer().serializeToString(live)
            : await (window as any).sheetTestBlobs
                .get(art.querySelector("img")!.src)
                .text();
          const svg = new DOMParser().parseFromString(
            text,
            "image/svg+xml",
          ).documentElement;
          if (svg.querySelector("text, foreignObject"))
            throw new Error("visible text in artwork");
          svg.setAttribute("width", String(pageSize.width));
          svg.setAttribute("height", String(pageSize.height));
          const url = URL.createObjectURL(
            new Blob([new XMLSerializer().serializeToString(svg)], {
              type: "image/svg+xml",
            }),
          );
          const image = new Image();
          try {
            image.src = url;
            await image.decode();
            const canvas = document.createElement("canvas");
            canvas.width = pageSize.width;
            canvas.height = pageSize.height;
            const context = canvas.getContext("2d")!;
            context.drawImage(image, 0, 0);
            const data = canvas.toDataURL("image/png");
            canvas.width = canvas.height = 0;
            return data.split(",")[1];
          } finally {
            URL.revokeObjectURL(url);
          }
        }, metadata.layout.cell);
      const expected = decodePng(Buffer.from(reference, "base64"));
      const { x, y } = metadata.layout.tiles[0];
      let difference = 0;
      for (let row = 0; row < expected.height; row++) {
        for (let col = 0; col < expected.width; col++) {
          const target = 4 * ((y + row) * image.width + x + col);
          const at = 4 * (row * expected.width + col);
          for (let k = 0; k < 3; k++)
            difference += Math.abs(
              image.rgba[target + k] - expected.rgba[at + k],
            );
        }
      }
      expect(difference / (3 * expected.width * expected.height)).toBeLessThan(
        0.05,
      );
    }
    const valid = metadata.cells.filter((c: any) => c.available);
    expect(valid.length).toBeGreaterThan(0);
    if (name === "Trefoil · (2, 3)") expect(valid.length).toBe(19);
    const background = image.rgba.slice(0, 3);
    const ink = (x: number, y: number, width: number, height: number) => {
      let count = 0;
      for (let row = y; row < y + height; row++)
        for (let col = x; col < x + width; col++) {
          const at = 4 * (row * image.width + col);
          if (background.some((b, k) => Math.abs(b - image.rgba[at + k]) > 15))
            count++;
        }
      return count;
    };
    for (const [i, cell] of metadata.cells.entries()) {
      const { x, y } = metadata.layout.tiles[i];
      const { width, height } = metadata.layout.cell;
      if (cell.available) {
        expect(ink(x, y, width, height)).toBeGreaterThan(20);
        if (paired) {
          expect(ink(x, y, width, Math.floor(height / 2))).toBeGreaterThan(20);
          expect(
            ink(x, y + Math.ceil(height / 2), width, Math.floor(height / 2)),
          ).toBeGreaterThan(20);
        }
      } else {
        expect(ink(x, y, width, height), `refused cell ${i}`).toBe(0);
        expect(cell.error).toBeTruthy();
      }
    }
    await atlas
      .getByRole("button", { name: "Cancel atlas", exact: true })
      .click();
    await expect(atlas).not.toBeVisible();
    await expect(
      page.locator(
        notebook === "2d"
          ? ".plot-wrap"
          : notebook === "3d"
            ? ".spatial-stage"
            : ".tesseract-stage",
      ),
    ).toHaveAttribute("aria-busy", "false");
  });
}
