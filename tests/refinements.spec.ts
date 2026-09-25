import { test, expect, type Page } from "@playwright/test";
import { openAnimation } from "./helpers";

async function ready(page: Page, preset = "0") {
  await page.goto("/");
  await expect(page.locator("#artwork")).toBeVisible();
  await openAnimation(page);
  await page
    .getByRole("combobox", { name: "Start with a notebook example" })
    .selectOption(preset);
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

test("expert counts reach 32,768 samples and 2,048 lines without truncation and persist in simple mode", async ({
  page,
}) => {
  await ready(page);
  await page.getByRole("radio", { name: "Expert mode" }).check();
  await page
    .getByRole("spinbutton", { name: "Numerical samples", exact: true })
    .fill("32768");
  await page
    .getByRole("spinbutton", { name: "Construction lines", exact: true })
    .fill("2048");
  await expect(page.getByRole("button", { name: /Export SVG/ })).toBeEnabled({
    timeout: 15000,
  });
  expect((await definition(page)).samples).toBe(32768);
  expect((await definition(page)).lines).toBe(2048);
  expect(await page.locator("#artwork line").count()).toBe(2048);
  await page.getByRole("radio", { name: "Simple mode" }).check();
  await expect(
    page.getByRole("combobox", { name: "Numerical samples" }),
  ).toHaveValue("32768");
  await expect(
    page.getByRole("slider", { name: /Construction lines/ }),
  ).toHaveValue("2048");
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
  await page.getByRole("button", { name: /Export SVG/ }).click();
  expect((await download).suggestedFilename()).toMatch(/\.svg$/);
  await page
    .getByRole("button", { name: /^(Stop|Reset view)$/, exact: true })
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
  await page.getByRole("spinbutton", { name: "Source radius r" }).fill("1");
  await page
    .getByRole("spinbutton", { name: "Source theta θ (radians)" })
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
    .getByRole("button", { name: /^(Stop|Reset view)$/, exact: true })
    .click();
  await page
    .getByRole("spinbutton", { name: "Source theta θ (radians)" })
    .fill(String(Math.PI / 2));
  await page
    .getByRole("combobox", { name: "Source coordinates" })
    .selectOption("cartesian");
  await expect(
    page.getByRole("spinbutton", { name: "Source y", exact: true }),
  ).toHaveValue("1");
  await page
    .getByRole("combobox", { name: "Source coordinates" })
    .selectOption("polar");
  await page.getByRole("spinbutton", { name: "Source radius r" }).fill("-1");
  await expect(page.getByRole("alert")).toContainText("nonnegative");
});
