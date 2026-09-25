import { test, expect } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { fitFrame, framingPoints } from "../web/Plot";
import { presets } from "../web/presets";
import { reveal } from "../web/animation";
import type { Result } from "../web/types";

test("offset involute fits both curves throughout reveal, with fixed follow zoom", () => {
  const config = structuredClone(presets[1].config);
  config.offset = 5;
  const result: Result = {
    base: [],
    derived: [],
    virtual: [],
    rays: [],
    warnings: [],
    invalid: 0,
  };
  for (let i = 0; i <= 1000; i++) {
    const t = (i * 2 * Math.PI) / 1000;
    result.base.push({ x: Math.cos(t), y: Math.sin(t) });
    result.derived.push({
      x: Math.cos(t) + (t + 5) * Math.sin(t),
      y: Math.sin(t) - (t + 5) * Math.cos(t),
    });
    result.virtual.push(false);
  }
  const final = fitFrame(result, config);
  for (const progress of [0, 0.001, 0.01, 0.1, 0.33, 0.5, 0.85, 0.95, 1]) {
    const current = reveal(result, progress);
    const frame = fitFrame(current, config);
    for (const scale of [frame.scale, final.scale]) {
      for (const p of [...current.base, ...current.derived]) {
        expect(Math.abs(p!.x - frame.cx) * scale).toBeLessThan(500);
        expect(Math.abs(p!.y - frame.cy) * scale).toBeLessThan(380);
      }
    }
  }
});

test("robust framing rejects isolated asymptotic tails but keeps a distant coherent curve", () => {
  const base = Array.from({ length: 101 }, (_, i) => ({ x: i / 100, y: 0 }));
  const derived = base.map((p) => ({ x: p.x + 100, y: 50 + p.x }));
  derived.push({ x: 1e8, y: -1e8 });
  expect(framingPoints(derived)).toHaveLength(101);
  const frame = fitFrame(
    { base, derived, virtual: [], rays: [], warnings: [], invalid: 0 },
    presets[0].config,
  );
  expect(frame.cx).toBe(50.5);
  expect(frame.span).toBe(101);
});

test("help, branding, and completed animation settings are usable without stopping", async ({
  page,
}) => {
  await page.goto("/");
  await expect(page).toHaveTitle(/Tangent Garden/);
  await expect(page.locator(".brand-symbol")).toHaveAttribute(
    "src",
    /tangent-garden\.svg$/,
  );
  await expect(page.getByRole("group", { name: "Controls" })).toHaveAttribute(
    "title",
    /Expert mode unlocks/,
  );
  await expect(
    page.getByRole("spinbutton", { name: "Shape parameter a" }).locator(".."),
  ).toHaveAttribute("title", /Expressions without a are unaffected/);
  await page.getByText("Expression reference", { exact: true }).click();
  await expect(
    page.locator("details var").filter({ hasText: "a" }).first(),
  ).toBeVisible();
  await page.getByRole("spinbutton", { name: "Duration (seconds)" }).fill(".1");
  await page.getByRole("button", { name: "Play animation" }).click();
  await expect(
    page.getByRole("button", { name: "Reset view", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("combobox", { name: "Animation camera" }),
  ).toBeEnabled();
  await expect(
    page.getByRole("spinbutton", { name: "Duration (seconds)" }),
  ).toBeEnabled();
  await page.getByRole("spinbutton", { name: "Duration (seconds)" }).fill(".2");
  await expect(
    page.getByRole("button", { name: "Play animation" }),
  ).toBeEnabled();
  await page
    .getByRole("combobox", { name: "Animation camera" })
    .selectOption("fit");
  await page.getByRole("button", { name: "Play animation" }).click();
  await expect(
    page.getByRole("button", { name: "Replay", exact: true }),
  ).toBeVisible();
  expect(
    JSON.parse((await page.locator("#artwork desc").textContent())!).animation
      .camera,
  ).toBe("fit");
});

test("fine animation export decodes at double resolution", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator("#artwork")).toBeVisible();
  await page
    .getByRole("combobox", { name: "Export quality" })
    .selectOption("fine");
  await page.getByRole("spinbutton", { name: "Duration (seconds)" }).fill(".1");
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export animated WebP" }).click();
  const saved = await download;
  expect(saved.suggestedFilename()).toMatch(/^tangent-garden-/);
  const bytes = await readFile((await saved.path())!);
  const decoded = await page.evaluate(async (data) => {
    const decoder = new (window as any).ImageDecoder({
      data: new Uint8Array(data),
      type: "image/webp",
    });
    await decoder.tracks.ready;
    const count = decoder.tracks.selectedTrack.frameCount;
    const { image } = await decoder.decode({ frameIndex: count - 1 });
    const dimensions = [image.displayWidth, image.displayHeight];
    image.close();
    decoder.close();
    return { count, dimensions };
  }, Array.from(bytes));
  expect(decoded).toEqual({ count: 3, dimensions: [2000, 1520] });
});
