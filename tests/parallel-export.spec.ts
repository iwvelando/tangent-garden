import { test, expect, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { openExportSettings } from "./helpers";
import { probe } from "./video";
import { exportEngineCount } from "../web/engine-client";

// Counts engine workers and lets a test corrupt one compute request, using the
// real browser inputs: navigator.hardwareConcurrency and the Worker API.
async function instrument(page: Page, cores: number) {
  await page.addInitScript((cores) => {
    Object.defineProperty(navigator, "hardwareConcurrency", {
      get: () => cores,
    });
    const w = ((window as any).workers = {
      created: 0,
      terminated: 0,
      computes: 0,
      breakAt: 0,
    });
    const Base = window.Worker;
    window.Worker = class extends Base {
      constructor(...args: ConstructorParameters<typeof Worker>) {
        super(...args);
        w.created++;
      }
      terminate() {
        w.terminated++;
        super.terminate();
      }
      postMessage(message: any, ...rest: any[]) {
        if (message?.action === "compute" && ++w.computes === w.breakAt)
          message = { ...message, config: { ...message.config, samples: NaN } };
        (super.postMessage as any)(message, ...rest);
      }
    };
  }, cores);
}
const workers = (page: Page) =>
  page.evaluate(() => ({ ...(window as any).workers }));

async function parameterStudy(page: Page, format: "webp" | "mp4") {
  await page.goto("/");
  await expect(page.locator("#artwork")).toBeVisible();
  await openExportSettings(page);
  await page
    .getByRole("combobox", { name: "Start with a notebook example" })
    .selectOption("2");
  await page
    .getByRole("combobox", { name: "Animate", exact: true })
    .selectOption("parameters");
  await page.getByRole("textbox", { name: "Track 1 to" }).fill(".75");
  await page
    .getByRole("combobox", { name: "Export frame rate" })
    .selectOption("15");
  await page
    .getByRole("combobox", { name: "Export format" })
    .selectOption(format);
}
const exportButton = (page: Page) =>
  page.getByRole("button", { name: /^Export (animated WebP|MP4 video)/ });

async function save(page: Page, seconds: string) {
  await page
    .getByRole("spinbutton", { name: "Duration (seconds)" })
    .fill(seconds);
  await expect(exportButton(page)).toBeEnabled();
  const download = page.waitForEvent("download");
  await exportButton(page).click();
  return (await download).path();
}

test("parallel parameter frames are identical to sequential ones", async ({
  browser,
}) => {
  const files: Buffer[] = [];
  for (const cores of [1, 8]) {
    const page = await browser.newPage();
    await instrument(page, cores);
    await parameterStudy(page, "webp");
    files.push(await readFile((await save(page, ".4"))!));
    const counts = await workers(page);
    // One app engine; three temporary engines on an 8-core machine.
    expect(counts.created).toBe(cores === 8 ? 4 : 1);
    expect(counts.terminated).toBe(cores === 8 ? 3 : 0);
    await page.close();
  }
  // The WebP encoder is deterministic, so equal files mean equal frames.
  expect(files[0].equals(files[1])).toBe(true);
});

test("a parallel MP4 export keeps exact timing and the app engine keeps working", async ({
  page,
}) => {
  await instrument(page, 8);
  await parameterStudy(page, "mp4");
  const path = (await save(page, ".4"))!;
  const probed = probe(path);
  if (probed) {
    expect(probed.frames).toBe(6);
    expect(probed.durations.reduce((a, b) => a + b, 0)).toBe(400);
  }
  expect(await workers(page)).toMatchObject({ created: 4, terminated: 3 });
  const title = await page.locator("#artwork title").textContent();
  await page
    .getByRole("combobox", { name: "Start with a notebook example" })
    .selectOption("0");
  await expect(page.locator("#artwork title")).not.toHaveText(title!);
  await expect(page.locator(".plot-wrap")).toHaveAttribute(
    "aria-busy",
    "false",
  );
});

test("reveal exports need no extra engines", async ({ page }) => {
  await instrument(page, 8);
  await page.goto("/");
  await expect(page.locator("#artwork")).toBeVisible();
  await openExportSettings(page);
  await save(page, ".2");
  expect(await workers(page)).toMatchObject({ created: 1, terminated: 0 });
});

test("canceling or editing during a parallel export discards it and stops the extra engines", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  const downloads: string[] = [];
  page.on("download", (d) => downloads.push(d.suggestedFilename()));
  await instrument(page, 8);
  await parameterStudy(page, "mp4");
  await page.getByRole("spinbutton", { name: "Duration (seconds)" }).fill("30");
  await exportButton(page).click();
  await expect.poll(async () => (await workers(page)).created).toBe(4);
  await page.getByRole("button", { name: "Cancel export" }).click();
  await expect.poll(async () => (await workers(page)).terminated).toBe(3);
  await expect(exportButton(page)).toBeEnabled();
  await exportButton(page).click();
  await expect.poll(async () => (await workers(page)).created).toBe(7);
  await page
    .getByRole("combobox", { name: "Start with a notebook example" })
    .selectOption("0");
  await expect.poll(async () => (await workers(page)).terminated).toBe(6);
  await page.waitForTimeout(300);
  expect(downloads).toEqual([]);
  expect(errors).toEqual([]);
});

test("a failed frame calculation stops a parallel export with a plain error", async ({
  page,
}) => {
  await instrument(page, 8);
  await parameterStudy(page, "mp4");
  await page.getByRole("spinbutton", { name: "Duration (seconds)" }).fill("2");
  await page.evaluate(() => {
    const w = (window as any).workers;
    w.breakAt = w.computes + 6;
  });
  await exportButton(page).click();
  await expect(page.getByRole("alert")).toHaveText(
    "Export stopped: Fill in each numeric field with a finite number.",
  );
  await expect.poll(async () => (await workers(page)).terminated).toBe(3);
  await expect(exportButton(page)).toBeEnabled();
  await expect(
    page.getByRole("button", { name: "Play animation" }),
  ).toBeEnabled();
});

test("export engine count leaves a core free and caps touch devices at one extra", () => {
  const counts = (touch: boolean) =>
    [1, 2, 3, 4, 8, 18].map((cores) => exportEngineCount(cores, touch));
  expect(counts(false)).toEqual([1, 1, 2, 3, 4, 4]);
  expect(counts(true)).toEqual([1, 1, 2, 2, 2, 2]);
});

test("phones and tablets use one extra engine with identical output", async ({
  browser,
}) => {
  const files: Buffer[] = [];
  for (const touch of [false, true]) {
    const context = await browser.newContext(
      touch ? { hasTouch: true, isMobile: true } : {},
    );
    const page = await context.newPage();
    await instrument(page, touch ? 8 : 1);
    await parameterStudy(page, "webp");
    expect(
      await page.evaluate(() => matchMedia("(pointer: coarse)").matches),
    ).toBe(touch);
    files.push(await readFile((await save(page, ".4"))!));
    expect(await workers(page)).toMatchObject(
      touch ? { created: 2, terminated: 1 } : { created: 1, terminated: 0 },
    );
    await context.close();
  }
  expect(files[0].equals(files[1])).toBe(true);
});
