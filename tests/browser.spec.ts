import { test, expect } from "@playwright/test";

test("a failed WASM download can recover on the next input change", async ({
  page,
  context,
}) => {
  let attempts = 0;
  await context.route("**/engine.wasm", (route) => {
    attempts++;
    return attempts === 1
      ? route.fulfill({ status: 503, body: "Temporarily unavailable" })
      : route.continue();
  });
  await page.goto("/");
  await expect(page.getByRole("alert")).toContainText(
    "Engine download failed (503)",
  );
  await page.getByRole("spinbutton", { name: "Shape parameter a" }).fill("2");
  await expect(page.locator("#artwork")).toBeVisible();
  expect(attempts).toBe(2);
  await expect(page.getByRole("alert")).toHaveCount(0);
});
import { readFile } from "node:fs/promises";

test("WASM loads, all notebook studies compute, and SVG exports geometry", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/");
  await expect(page.locator("#artwork")).toBeVisible();
  await expect(page.getByRole("button", { name: /Export SVG/ })).toBeEnabled();
  expect(await page.locator("#artwork line").count()).toBeGreaterThan(20);
  for (const preset of ["1", "2", "3", "4", "5", "6", "7", "0"]) {
    await page.getByLabel("Start with a notebook example").selectOption(preset);
    await expect(page.locator(".plot-wrap")).toHaveAttribute(
      "aria-busy",
      "false",
    );
    await expect(page.getByRole("alert")).toHaveCount(0);
    await expect(page.locator("#artwork path").first()).toHaveAttribute(
      "d",
      /^M/,
    );
  }
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: /Export SVG/ }).click();
  const file = await download;
  const svg = await readFile((await file.path())!, "utf8");
  expect(svg).toContain("<svg");
  expect(svg).toContain("<path");
  expect(svg).toContain("2*cos(t)");
  expect(svg).not.toMatch(/NaN|Infinity/);
  expect(errors).toEqual([]);
});

test("curve formats, invalid input recovery, layers, optics and dark mode", async ({
  page,
}) => {
  await page.goto("/");
  await expect(page.locator("#artwork")).toBeVisible();
  await page.getByLabel("x(t)", { exact: true }).fill("sin(");
  await expect(page.getByRole("alert")).toBeVisible();
  await expect(page.getByRole("button", { name: /Export SVG/ })).toBeDisabled();
  await page.getByLabel("x(t)", { exact: true }).fill("2*cos(t)");
  await expect(page.locator("#artwork")).toBeVisible();
  await page
    .getByRole("combobox", { name: "Definition", exact: true })
    .selectOption("polar");
  await expect(page.getByLabel("r(t)", { exact: true })).toBeVisible();
  await page.getByLabel("r(t)", { exact: true }).fill("2");
  await expect(page.locator(".plot-wrap")).toHaveAttribute(
    "aria-busy",
    "false",
  );
  await expect(page.getByTestId("focus-point")).toBeVisible();
  await page
    .getByRole("combobox", { name: "Definition", exact: true })
    .selectOption("cartesian");
  await page.getByLabel("f(x)", { exact: true }).fill("x^2/4");
  await page.getByLabel("x from", { exact: true }).fill("-3");
  await page.getByLabel("to", { exact: true }).fill("3");
  await page.getByRole("button", { name: "diacaustic", exact: true }).click();
  await page
    .getByRole("combobox", { name: "Source", exact: true })
    .selectOption("parallel");
  await page.getByLabel("Travel direction (degrees)").fill("-90");
  await expect(page.locator(".plot-wrap")).toHaveAttribute(
    "aria-busy",
    "false",
  );
  await expect(page.getByRole("alert")).toHaveCount(0);
  await page
    .getByRole("checkbox", { name: "Construction lines", exact: true })
    .uncheck();
  await page
    .getByRole("checkbox", { name: "Incident rays", exact: true })
    .uncheck();
  await expect(page.locator("#artwork line")).toHaveCount(0);
  await page.getByRole("button", { name: "Use dark background" }).click();
  await expect(page.locator(".app")).toHaveClass("app dark");
  await expect(page.locator("#artwork > rect")).toHaveAttribute(
    "fill",
    "#141e22",
  );
  await page.getByLabel("to", { exact: true }).fill("");
  await expect(page.getByRole("alert")).toBeVisible();
});

test("narrow view has no horizontal overflow and retains controls", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await expect(page.locator("#artwork")).toBeVisible();
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth),
  ).toBeLessThanOrEqual(390);
  await page.getByLabel("Start with a notebook example").selectOption("1");
  await expect(page.locator(".plot-wrap")).toHaveAttribute(
    "aria-busy",
    "false",
  );
  await expect(
    page.getByRole("heading", { name: "A curve, unwound" }),
  ).toBeVisible();
});
