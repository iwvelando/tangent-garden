import { test, expect, type Page } from "@playwright/test";
import { openExportSettings, exportImage } from "./helpers";
import { readFileSync } from "node:fs";

// The production Content-Security-Policy. CloudFront sends it (iwvelando/cloud-accounts,
// sites/tangent-garden.isaacvelando.com), vite preview sends it here, and the deploy
// workflow checks the live header still matches this file.
const policy = readFileSync(
  "deploy/content-security-policy.txt",
  "utf8",
).trim();

function violations(page: Page) {
  const found: string[] = [];
  page.on("console", (m) => {
    if (m.text().includes("Content Security Policy")) found.push(m.text());
  });
  page.on("pageerror", (e) => found.push(e.message));
  return found;
}

test("preview serves the production Content-Security-Policy", async ({
  request,
}) => {
  const response = await request.get("/");
  expect(response.headers()["content-security-policy"]).toBe(policy);
});

test("the engine, SVG and PNG export, and WebP and MP4 exports run under the policy", async ({
  page,
}) => {
  const found = violations(page);
  await page.goto("/");
  await expect(page.locator("#artwork")).toBeVisible();
  const svg = page.waitForEvent("download");
  await exportImage(page, "SVG");
  await svg;
  const png = page.waitForEvent("download");
  await exportImage(page, "PNG");
  expect((await png).suggestedFilename()).toMatch(/\.png$/);
  await openExportSettings(page);
  await page.getByRole("spinbutton", { name: "Duration (seconds)" }).fill(".2");
  await page
    .getByRole("combobox", { name: "Export frame rate" })
    .selectOption("15");
  const mp4 = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export MP4 video" }).click();
  expect((await mp4).suggestedFilename()).toMatch(/\.mp4$/);
  await page
    .getByRole("combobox", { name: "Export format" })
    .selectOption("webp");
  const webp = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export animated WebP" }).click();
  expect((await webp).suggestedFilename()).toMatch(/\.webp$/);
  expect(found).toEqual([]);
});

test("the not-found page renders under the policy", async ({ page }) => {
  const found = violations(page);
  await page.goto("/404.html");
  await expect(
    page.getByRole("heading", { name: "Page not found" }),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: /Tangent Garden/ }),
  ).toHaveAttribute("href", "/");
  expect(found).toEqual([]);
});
