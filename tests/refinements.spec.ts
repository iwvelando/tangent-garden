import { readFile } from "node:fs/promises";
import { test, expect, type Page } from "@playwright/test";
import {
  openAnimation,
  exportImage,
  imageButton,
  choosePreset,
} from "./helpers";

async function ready(page: Page, preset = "0") {
  await page.goto("/");
  await expect(page.locator("#artwork")).toBeVisible();
  await openAnimation(page);
  await choosePreset(page, preset);
  await expect(
    page.getByRole("button", { name: "Play animation" }),
  ).toBeEnabled();
}
async function definition(page: Page) {
  return JSON.parse((await page.locator("#artwork desc").textContent())!);
}

test("domain animation identifies the zero-width final interval", async ({
  page,
}) => {
  await ready(page);
  await page
    .getByRole("combobox", { name: "Animate", exact: true })
    .selectOption("parameters");
  await page
    .getByRole("combobox", { name: "Parameter 1", exact: true })
    .selectOption("min");
  await page.getByRole("textbox", { name: "Track 1 from" }).fill("0");
  await page.getByRole("textbox", { name: "Track 1 to" }).fill("2*pi");
  await page.getByRole("button", { name: "Play animation" }).click();
  await expect(page.getByRole("alert")).toContainText("At animation end");
  await expect(page.getByRole("alert")).toContainText(
    "start and end are equal",
  );
  await expect(page.getByRole("alert")).toContainText("zero width");
  await page.getByRole("textbox", { name: "Track 1 to" }).fill("pi");
  await page.getByRole("spinbutton", { name: "Duration (seconds)" }).fill(".1");
  await page.getByRole("button", { name: "Play animation" }).click();
  await expect(
    page.getByRole("button", { name: "Replay", exact: true }),
  ).toBeVisible();
  expect((await definition(page)).curve.min).toBe(Math.PI);
});

test("counts are exact whole numbers from the start, reaching 32,768 samples and 2,048 lines without truncation", async ({
  page,
}) => {
  await ready(page);
  // There is no control mode to switch: the counts are always exact fields.
  await expect(page.getByRole("group", { name: "Controls" })).toHaveCount(0);
  await expect(page.getByRole("radio", { name: /mode/ })).toHaveCount(0);
  await page
    .getByRole("spinbutton", { name: "Numerical samples", exact: true })
    .fill("32768");
  await page
    .getByRole("spinbutton", { name: "Construction lines", exact: true })
    .fill("2048");
  await expect(imageButton(page)).toBeEnabled({
    timeout: 15000,
  });
  expect((await definition(page)).samples).toBe(32768);
  expect((await definition(page)).lines).toBe(2048);
  expect(await page.locator("#artwork line").count()).toBe(2048);
});

test("hold current view captures pan and zoom through playback, scrubbing and SVG export", async ({
  page,
}) => {
  await ready(page, "1");
  const svg = page.locator("#artwork");
  const initialScale = await svg.getAttribute("data-camera-scale");
  await svg.hover();
  await page.mouse.wheel(0, -300);
  await expect(svg).not.toHaveAttribute("data-camera-scale", initialScale!);
  const box = (await svg.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(
    box.x + box.width / 2 + 60,
    box.y + box.height / 2 + 40,
  );
  await page.mouse.up();
  const center = await svg.getAttribute("data-camera-center");
  const scale = await svg.getAttribute("data-camera-scale");
  const path = await svg.locator("path").first().getAttribute("d");
  await page
    .getByRole("combobox", { name: "Animation camera" })
    .selectOption("current");
  await page.getByRole("spinbutton", { name: "Duration (seconds)" }).fill(".1");
  await page.getByRole("button", { name: "Play animation" }).click();
  await expect(
    page.getByRole("button", { name: "Replay", exact: true }),
  ).toBeVisible();
  await expect(svg).toHaveAttribute("data-camera-center", center!);
  await expect(svg).toHaveAttribute("data-camera-scale", scale!);
  await expect(svg.locator("path").first()).toHaveAttribute("d", path!);
  await page
    .getByRole("slider", { name: "Animation progress", exact: true })
    .press("Home");
  await expect(svg).toHaveAttribute("data-animation-progress", "0");
  await expect(svg).toHaveAttribute("data-camera-center", center!);
  await expect(svg).toHaveAttribute("data-camera-scale", scale!);
  expect((await definition(page)).animation.heldView.scale).toBe(Number(scale));
  const download = page.waitForEvent("download");
  await exportImage(page, "SVG");
  expect((await download).suggestedFilename()).toMatch(/\.svg$/);
  await page
    .getByRole("button", { name: /^(Stop|Back to study)$/, exact: true })
    .click();
  await expect(svg.locator("path").first()).toHaveAttribute("d", path!);
});

test("polar light source follows a circular orbit, accepts scalar angle endpoints, and switches coordinates", async ({
  page,
}) => {
  await ready(page, "2");
  await page
    .getByRole("combobox", { name: "Definition", exact: true })
    .selectOption("polar");
  await page.getByRole("textbox", { name: "r(t)", exact: true }).fill("1");
  await page
    .getByRole("combobox", { name: "Source coordinates" })
    .selectOption("polar");
  await page.getByRole("textbox", { name: "Source radius r" }).fill("1");
  await page
    .getByRole("textbox", { name: "Source theta θ (radians)" })
    .fill("0");
  await page
    .getByRole("combobox", { name: "Animate", exact: true })
    .selectOption("parameters");
  await page
    .getByRole("combobox", { name: "Parameter 1", exact: true })
    .selectOption("sourceTheta");
  await page.getByRole("textbox", { name: "Track 1 from" }).fill("0");
  await page.getByRole("textbox", { name: "Track 1 to" }).fill("pi/2");
  await page.getByRole("spinbutton", { name: "Duration (seconds)" }).fill(".2");
  await page.getByRole("button", { name: "Play animation" }).click();
  await expect(
    page.getByRole("button", { name: "Replay", exact: true }),
  ).toBeVisible();
  let source = (await definition(page)).source;
  expect(source.theta).toBe(Math.PI / 2);
  expect(source.position.x).toBeCloseTo(0, 12);
  expect(source.position.y).toBeCloseTo(1, 12);
  const timeline = page.getByRole("slider", {
    name: "Animation progress",
    exact: true,
  });
  await timeline.press("Home");
  await expect(page.locator("#artwork")).toHaveAttribute(
    "data-animation-progress",
    "0",
  );
  await timeline.press("ArrowRight");
  await expect(page.locator("#artwork")).toHaveAttribute(
    "data-animation-progress",
    "0.001",
  );
  source = (await definition(page)).source;
  expect(source.position.x).toBeCloseTo(Math.cos(Math.PI / 2000), 12);
  expect(source.position.y).toBeCloseTo(Math.sin(Math.PI / 2000), 12);
  await page
    .getByRole("button", { name: /^(Stop|Back to study)$/, exact: true })
    .click();
  await page
    .getByRole("textbox", { name: "Source theta θ (radians)" })
    .fill(String(Math.PI / 2));
  await page
    .getByRole("combobox", { name: "Source coordinates" })
    .selectOption("cartesian");
  await expect(
    page.getByRole("textbox", { name: "Source y", exact: true }),
  ).toHaveValue("1");
  await page
    .getByRole("combobox", { name: "Source coordinates" })
    .selectOption("polar");
  await page.getByRole("textbox", { name: "Source radius r" }).fill("-1");
  await expect(page.getByRole("alert")).toContainText("nonnegative");
});

test("tiny involutes retain their string, refinement, and SVG through control edits", async ({
  page,
}) => {
  await ready(page, "1");
  const art = page.locator("#artwork");
  const derived = art.getByTestId("derived-curve");
  const settled = async () =>
    expect(page.locator(".plot-wrap")).toHaveAttribute("aria-busy", "false");
  // Each unwinding string is a line from the circle to the involute.
  const strings = () =>
    art
      .locator("line")
      .evaluateAll((lines) =>
        lines.map((l) =>
          ["x1", "y1", "x2", "y2"].map((a) => l.getAttribute(a)).join(" "),
        ),
      );
  const original = await derived.getAttribute("d");
  expect(original!.length).toBeGreaterThan(100);
  const unwound = await strings();
  expect(unwound.length).toBeGreaterThanOrEqual(32);
  const edit = async (x: string, y: string) => {
    await page.getByRole("textbox", { name: "x(t)", exact: true }).fill(x);
    await page.getByRole("textbox", { name: "y(t)", exact: true }).fill(y);
    await page.getByRole("textbox", { name: "y(t)", exact: true }).press("Tab");
    await expect.poll(async () => (await definition(page)).curve.y).toBe(y);
    await settled();
  };
  await edit("2^-35*cos(t)", "2^-35*sin(t)");
  await expect(derived).toHaveAttribute("d", original!);
  expect(await strings()).toEqual(unwound);
  await page
    .getByRole("checkbox", { name: "Refine between samples", exact: true })
    .check();
  await settled();
  const refined = await derived.getAttribute("d");
  expect(refined!.length).toBeGreaterThan(100);
  const download = page.waitForEvent("download");
  await exportImage(page, "SVG");
  const file = await download;
  const svg = await readFile((await file.path())!, "utf8");
  expect(svg).toContain(`d="${refined}"`);
  expect(svg).toContain("2^-35*cos(t)");
  await edit("cos(t)", "sin(t)");
  await expect(derived).toHaveAttribute("d", refined!);
  await page
    .getByRole("checkbox", { name: "Refine between samples", exact: true })
    .uncheck();
  await settled();
  await expect(derived).toHaveAttribute("d", original!);
});
