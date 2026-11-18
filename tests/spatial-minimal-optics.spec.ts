import { test, expect, type Page } from "@playwright/test";
import { choosePreset, exampleTitles } from "./helpers";
import type { SpatialConfig } from "../web/spatial/types";

// Issue #397's research preview through the real controls, worker and
// engine: the helicoid–catenoid family lit as a mirror only with
// ?research=397, its first-hit option, and links, which never carry the
// research flag. Without the parameter the app is unchanged.
const shadowStudy = {
  label: "Research: the staircase mirror in its own shadow",
};
const stage = (page: Page) => page.locator(".spatial-stage");
const settled = (page: Page) =>
  expect(stage(page)).toHaveAttribute("aria-busy", "false", {
    timeout: 60000,
  });
const config = async (page: Page): Promise<SpatialConfig> =>
  JSON.parse((await stage(page).getAttribute("data-config"))!);
const note = (page: Page) => page.getByTestId("rays-note");
const firstHit = (page: Page) =>
  page.getByRole("checkbox", {
    name: "Shadows and blocking (research)",
    exact: true,
  });

test("without the parameter the family is not offered as a mirror and no research study is listed", async ({
  page,
}) => {
  await page.goto("/?study=3d");
  await settled(page);
  expect(
    (await exampleTitles(page)).filter((t) => t.startsWith("Research:")),
  ).toEqual([]);
  await choosePreset(page, { label: "A paraboloid gathering light" });
  await settled(page);
  await expect(
    page.getByLabel("Surface", { exact: true }).locator("option"),
  ).not.toContainText(["Helicoid · catenoid family"]);
  await expect(firstHit(page)).toHaveCount(0);
});

test("the research study shades the stair, and the option turns it off and on", async ({
  page,
}) => {
  await page.goto("/?study=3d&research=397");
  await settled(page);
  expect(
    (await exampleTitles(page)).filter((t) => t.startsWith("Research:")),
  ).toHaveLength(7);
  await choosePreset(page, shadowStudy);
  await settled(page);
  await expect(firstHit(page)).toBeChecked();
  await expect(note(page)).toContainText(
    "1,450 samples are in shadow: the light meets another part of the mirror first.",
  );
  await firstHit(page).uncheck();
  await settled(page);
  await expect(note(page)).not.toContainText("in shadow");
  expect((await config(page)).rays).not.toHaveProperty("occlusion");
  await firstHit(page).check();
  await settled(page);
  expect((await config(page)).rays.occlusion).toBe(true);
  await expect(note(page)).toContainText("in shadow");
  // An edited angle is lit through the same path.
  const theta = page.getByRole("textbox", {
    name: "Associate angle θ",
    exact: true,
  });
  await theta.fill("pi/3");
  await theta.press("Enter");
  await settled(page);
  expect((await config(page)).surface.b).toBeCloseTo(Math.PI / 3, 12);
  await expect(note(page)).toContainText("in shadow");
});

test("a link keeps the option, and opens refused without the preview", async ({
  page,
  context,
}) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.goto("/?study=3d&research=397");
  await settled(page);
  await choosePreset(page, shadowStudy);
  await settled(page);
  await page.getByRole("button", { name: "Copy link", exact: true }).click();
  await expect(page.getByText("Link copied", { exact: true })).toBeVisible();
  const url = new URL(
    await page.evaluate(() => navigator.clipboard.readText()),
  );
  // The address keeps the preview's parameter, as it keeps the notebook;
  // the study itself holds only the option.
  expect(url.searchParams.get("research")).toBe("397");
  // Opened in the preview, it draws the same shadows.
  const open = async () => {
    await page.goto("about:blank");
    await page.goto(url.pathname + url.search + url.hash);
  };
  url.searchParams.set("research", "397");
  await open();
  await settled(page);
  expect((await config(page)).rays.occlusion).toBe(true);
  await expect(note(page)).toContainText("1,450 samples are in shadow");
  // Opened without it, the engine refuses the family as a mirror, as on
  // main.
  url.searchParams.delete("research");
  await open();
  await expect(page.locator(".app:visible")).toContainText(
    "the helicoid–catenoid family is not offered as a mirror or interface",
  );
});
