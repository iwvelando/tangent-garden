import { test, expect, type Page } from "@playwright/test";
import { openAnimation, exportImage } from "./helpers";
import { applyTracks, reveal } from "../web/animation";
import { presets } from "../web/presets";
import type { Result } from "../web/types";

async function ready(page: Page, preset = "1") {
  await page.goto("/");
  await expect(page.locator("#artwork")).toBeVisible();
  await openAnimation(page);
  await page
    .getByRole("combobox", { name: "Start with a notebook example" })
    .selectOption(preset);
  await expect(page.locator(".plot-wrap")).toHaveAttribute(
    "aria-busy",
    "false",
  );
}
async function progress(page: Page) {
  return Number(
    await page.locator("#artwork").getAttribute("data-animation-progress"),
  );
}
async function definition(page: Page) {
  return JSON.parse((await page.locator("#artwork desc").textContent())!);
}

test("tracks interpolate independently and reveal preserves gaps and sample identity", () => {
  const base = structuredClone(presets[2].config);
  const { config, length } = applyTracks(
    base,
    [
      { target: "sourceX", from: 1, to: 0.75 },
      { target: "sourceY", from: 0, to: 2 },
      { target: "a", from: 1, to: 3 },
      { target: "lines", from: 11, to: 14 },
      { target: "samples", from: 100, to: 201 },
      { target: "rayLength", from: 0.5, to: 1.5 },
    ],
    0.5,
    0.8,
  );
  expect(config.source.position).toEqual({ x: 0.875, y: 1 });
  expect(config.curve.a).toBe(2);
  expect(config.lines).toBe(13);
  expect(config.samples).toBe(151);
  expect(length).toBe(1);
  expect(base.source.position.x).toBe(1);
  const result: Result = {
    base: [{ x: 0, y: 0 }, null, { x: 2, y: 2 }],
    derived: [null, null, { x: 1, y: 1 }],
    virtual: [false, false, true],
    rays: [
      {
        sampleIndex: 2,
        origin: { x: 2, y: 2 },
        direction: { x: 1, y: 0 },
        incident: { x: 1, y: 0 },
        target: null,
        virtual: false,
        tir: false,
      },
    ],
    warnings: [],
    invalid: 2,
  };
  expect(reveal(result, 0.5).base).toEqual([{ x: 0, y: 0 }, null]);
  expect(reveal(result, 0.5).rays).toHaveLength(0);
  expect(reveal(result, 1)).toEqual(result);
});

test("unwinding holds final framing, pauses, scrubs, exports, and restores the manual view", async ({
  page,
}) => {
  await ready(page);
  const original = await page
    .locator("#artwork path")
    .first()
    .getAttribute("d");
  await page.locator("#artwork").hover();
  await page.mouse.wheel(0, -300);
  await expect(page.locator("#artwork path").first()).not.toHaveAttribute(
    "d",
    original!,
  );
  const manual = await page.locator("#artwork path").first().getAttribute("d");
  await page.getByRole("spinbutton", { name: "Duration (seconds)" }).fill("3");
  await page.getByRole("button", { name: "Play animation" }).click();
  await expect.poll(() => progress(page)).toBeGreaterThan(0.1);
  await page.getByRole("button", { name: "Pause", exact: true }).click();
  const p = await progress(page);
  expect(p).toBeLessThan(1);
  expect(
    (await page.locator("#artwork path").first().getAttribute("d"))!.length,
  ).toBeLessThan(original!.length);
  const scale = await page
    .locator("#artwork")
    .getAttribute("data-camera-scale");
  await expect(
    page.getByRole("button", { name: "Resume", exact: true }),
  ).toBeVisible();
  const download = page.waitForEvent("download");
  await exportImage(page, "SVG");
  expect((await download).suggestedFilename()).toBe(
    "tangent-garden-involute.svg",
  );
  await page
    .getByRole("slider", { name: "Animation progress", exact: true })
    .press("Home");
  await expect.poll(() => progress(page)).toBe(0);
  await page
    .getByRole("slider", { name: "Animation progress", exact: true })
    .press("End");
  await expect.poll(() => progress(page)).toBe(1);
  await expect(page.locator("#artwork")).toHaveAttribute(
    "data-camera-scale",
    scale!,
  );
  await expect(page.locator("#artwork path").first()).toHaveAttribute(
    "d",
    original!,
  );
  await page
    .getByRole("button", { name: /^(Stop|Reset view)$/, exact: true })
    .click();
  await expect(page.locator("#artwork path").first()).toHaveAttribute(
    "d",
    manual!,
  );
  await expect(page.locator("#artwork")).not.toHaveAttribute(
    "data-animation-progress",
  );
});

for (const camera of ["follow", "fit"])
  test(`${camera} camera handles the zero-length start and completes exactly`, async ({
    page,
  }) => {
    await ready(page);
    await page
      .getByRole("combobox", { name: "Animation camera" })
      .selectOption(camera);
    await page
      .getByRole("spinbutton", { name: "Duration (seconds)" })
      .fill(".2");
    await page.getByRole("button", { name: "Play animation" }).click();
    await expect(
      page.getByRole("button", { name: "Replay", exact: true }),
    ).toBeVisible();
    const fullScale = Number(
      await page.locator("#artwork").getAttribute("data-camera-scale"),
    );
    const fullCenter = await page
      .locator("#artwork")
      .getAttribute("data-camera-center");
    await page
      .getByRole("slider", { name: "Animation progress", exact: true })
      .press("Home");
    await expect.poll(() => progress(page)).toBe(0);
    const startScale = Number(
      await page.locator("#artwork").getAttribute("data-camera-scale"),
    );
    expect(Number.isFinite(startScale)).toBe(true);
    if (camera === "follow") expect(startScale).toBe(fullScale);
    else expect(startScale).toBeGreaterThan(fullScale);
    expect(
      await page.locator("#artwork").getAttribute("data-camera-center"),
    ).not.toBe(fullCenter);
    await page.getByRole("button", { name: "Resume", exact: true }).click();
    await expect(
      page.getByRole("button", { name: "Replay", exact: true }),
    ).toBeVisible();
    expect(await progress(page)).toBe(1);
  });

test("multiple moving-light tracks reach exact endpoints and stop restores the study", async ({
  page,
}) => {
  await ready(page, "2");
  const original = await page.locator("#artwork path").nth(1).getAttribute("d");
  await page
    .getByRole("combobox", { name: "Animate", exact: true })
    .selectOption("parameters");
  await expect(
    page.getByRole("combobox", { name: "Parameter 1", exact: true }),
  ).toHaveValue("sourceX");
  await page.getByRole("textbox", { name: "Track 1 to" }).fill(".75");
  await page.getByRole("button", { name: "+ Add parameter" }).click();
  await page
    .getByRole("combobox", { name: "Parameter 2", exact: true })
    .selectOption("sourceY");
  await page.getByRole("textbox", { name: "Track 2 to" }).fill(".2");
  await page
    .getByRole("spinbutton", { name: "Duration (seconds)" })
    .fill(".25");
  await page.getByRole("button", { name: "Play animation" }).click();
  await expect(
    page.getByRole("button", { name: "Replay", exact: true }),
  ).toBeVisible();
  const q = await definition(page);
  expect(q.source.position).toEqual({ x: 0.75, y: 0.2 });
  expect(q.animation.progress).toBe(1);
  expect(await page.locator("#artwork path").nth(1).getAttribute("d")).not.toBe(
    original,
  );
  await page
    .getByRole("button", { name: /^(Stop|Reset view)$/, exact: true })
    .click();
  await expect(page.locator("#artwork path").nth(1)).toHaveAttribute(
    "d",
    original!,
  );
  expect((await definition(page)).source.position).toEqual({ x: 1, y: 0 });
});

test("parallel-light direction, scalar endpoints, and invalid track recovery", async ({
  page,
}) => {
  await ready(page, "7");
  await page
    .getByRole("combobox", { name: "Animate", exact: true })
    .selectOption("parameters");
  await expect(
    page.getByRole("combobox", { name: "Parameter 1", exact: true }),
  ).toHaveValue("angle");
  await page.getByRole("textbox", { name: "Track 1 to" }).fill("t");
  await page.getByRole("button", { name: "Play animation" }).click();
  await expect(page.getByRole("alert")).toContainText("not allowed");
  await page.getByRole("textbox", { name: "Track 1 to" }).fill("180/pi");
  await page.getByRole("spinbutton", { name: "Duration (seconds)" }).fill(".2");
  await page.getByRole("button", { name: "Play animation" }).click();
  await expect(
    page.getByRole("button", { name: "Replay", exact: true }),
  ).toBeVisible();
  expect((await definition(page)).source.angle).toBeCloseTo(180 / Math.PI, 12);
  await page
    .getByRole("button", { name: /^(Stop|Reset view)$/, exact: true })
    .click();
  await page.getByRole("spinbutton", { name: "Duration (seconds)" }).fill("30");
  await page.getByRole("button", { name: "Play animation" }).click();
  await page
    .getByRole("button", { name: /^(Stop|Reset view)$/, exact: true })
    .click();
  await page
    .getByRole("spinbutton", { name: "Travel direction (degrees)" })
    .fill("45");
  await expect(page.locator(".plot-wrap")).toHaveAttribute(
    "aria-busy",
    "false",
  );
  expect((await definition(page)).source.angle).toBe(45);
  await expect(page.locator("#artwork")).not.toHaveAttribute(
    "data-animation-progress",
  );
});

test("shape coefficient animation changes the numerical curve", async ({
  page,
}) => {
  await ready(page, "1");
  await page
    .getByRole("textbox", { name: "x(t)", exact: true })
    .fill("a*cos(t)");
  await page
    .getByRole("textbox", { name: "y(t)", exact: true })
    .fill("a*sin(t)");
  await expect(page.locator(".plot-wrap")).toHaveAttribute(
    "aria-busy",
    "false",
  );
  await page
    .getByRole("combobox", { name: "Animate", exact: true })
    .selectOption("parameters");
  await page.getByRole("textbox", { name: "Track 1 to" }).fill("phi");
  await page.getByRole("spinbutton", { name: "Duration (seconds)" }).fill(".2");
  await page.getByRole("button", { name: "Play animation" }).click();
  await expect(
    page.getByRole("button", { name: "Replay", exact: true }),
  ).toBeVisible();
  expect((await definition(page)).curve.a).toBeCloseTo(
    (1 + Math.sqrt(5)) / 2,
    12,
  );
  await page.getByRole("textbox", { name: "x(t)", exact: true }).fill("cos(t)");
  await expect(page.locator("#artwork")).not.toHaveAttribute(
    "data-animation-progress",
  );
});

for (const mode of ["reveal", "parameters"] as const) {
  test(`dragging the paused timeline scrubs continuously in ${mode} mode`, async ({
    page,
  }) => {
    await ready(page, "0");
    await page
      .getByRole("combobox", { name: "Animate", exact: true })
      .selectOption(mode);
    await page
      .getByRole("spinbutton", { name: "Duration (seconds)" })
      .fill("20");
    await page.getByRole("button", { name: "Play animation" }).click();
    await expect.poll(() => progress(page)).toBeGreaterThan(0);
    await page.getByRole("button", { name: "Pause", exact: true }).click();
    const slider = page.getByRole("slider", {
      name: "Animation progress",
      exact: true,
    });
    await slider.scrollIntoViewIfNeeded();
    const box = (await slider.boundingBox())!;
    const y = box.y + box.height / 2;
    const at = (f: number) => box.x + 8 + (box.width - 16) * f;
    const start = await progress(page);
    await page.mouse.move(at(start), y);
    await page.mouse.down();
    const seen = new Set<number>();
    for (let i = 1; i <= 12; i++) {
      await page.mouse.move(at(start + ((0.8 - start) * i) / 12), y, {
        steps: 2,
      });
      // The slider stays usable, and its value follows the pointer.
      await expect(slider).toBeEnabled();
      seen.add(await progress(page));
    }
    await page.mouse.up();
    await expect(slider).toHaveValue(/^0\.(79|8|80)\d*$/);
    await expect.poll(() => progress(page)).toBeCloseTo(0.8, 1);
    // Intermediate frames rendered during the drag, not only at release.
    expect(seen.size).toBeGreaterThan(2);
    await expect(
      page.getByRole("button", { name: "Resume", exact: true }),
    ).toBeVisible();
  });
}
