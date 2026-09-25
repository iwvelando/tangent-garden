import { test, expect } from "@playwright/test";
import { openAnimation } from "./helpers";

test("system theme follows live changes, and overrides persist until reset", async ({
  page,
}) => {
  await page.emulateMedia({ colorScheme: "dark" });
  await page.goto("/");
  await expect(page.locator(".app")).toHaveClass("app dark");
  await page.emulateMedia({ colorScheme: "light" });
  await expect(page.locator(".app")).toHaveClass("app");
  await page.getByRole("button", { name: "Use dark background" }).click();
  await page.reload();
  await expect(page.locator(".app")).toHaveClass("app dark");
  await expect(page.locator(".app")).toHaveAttribute(
    "data-theme-preference",
    "dark",
  );
  await page
    .getByRole("button", { name: "Follow system", exact: true })
    .click();
  await expect(page.locator(".app")).toHaveClass("app");
  await page.emulateMedia({ colorScheme: "dark" });
  await expect(page.locator(".app")).toHaveClass("app dark");
  await page.reload();
  await expect(page.locator(".app")).toHaveAttribute(
    "data-theme-preference",
    "system",
  );
});

test("theme works when local storage is unavailable", async ({ page }) => {
  await page.addInitScript(() => {
    Storage.prototype.getItem = () => {
      throw new Error("disabled");
    };
    Storage.prototype.setItem = () => {
      throw new Error("disabled");
    };
    Storage.prototype.removeItem = () => {
      throw new Error("disabled");
    };
  });
  await page.emulateMedia({ colorScheme: "dark" });
  await page.goto("/");
  await expect(page.locator(".app")).toHaveClass("app dark");
  await page.getByRole("button", { name: "Use light background" }).click();
  await expect(page.locator(".app")).toHaveClass("app");
  await expect(page.locator("#artwork")).toBeVisible();
});

test("bounds use the Go constant parser, and expert values are preserved", async ({
  page,
}) => {
  await page.goto("/");
  await expect(page.locator("#artwork")).toBeVisible();
  await page.getByRole("textbox", { name: "t from", exact: true }).fill("-phi");
  await page
    .getByRole("textbox", { name: "to", exact: true })
    .fill("2*pi+ln(e)");
  await expect(page.locator(".plot-wrap")).toHaveAttribute(
    "aria-busy",
    "false",
  );
  let q = JSON.parse((await page.locator("#artwork desc").textContent())!);
  expect(q.curve.min).toBeCloseTo(-(1 + Math.sqrt(5)) / 2, 12);
  expect(q.curve.max).toBeCloseTo(2 * Math.PI + 1, 12);
  await page.getByRole("textbox", { name: "to", exact: true }).fill("t+1");
  await expect(page.getByRole("alert")).toContainText("not allowed");
  await page.getByRole("textbox", { name: "to", exact: true }).fill("2*pi");
  await page.getByRole("radio", { name: "Expert mode" }).check();
  await page
    .getByRole("spinbutton", { name: "Numerical samples", exact: true })
    .fill("777");
  await page
    .getByRole("spinbutton", { name: "Construction lines", exact: true })
    .fill("240");
  await expect(page.locator(".plot-wrap")).toHaveAttribute(
    "aria-busy",
    "false",
  );
  await expect(page.getByRole("alert")).toHaveCount(0);
  q = JSON.parse((await page.locator("#artwork desc").textContent())!);
  expect(q.samples).toBe(777);
  expect(q.lines).toBe(240);
  await page.getByRole("radio", { name: "Simple mode" }).check();
  await expect(
    page.getByRole("combobox", { name: "Numerical samples" }),
  ).toHaveValue("777");
  await expect(
    page.getByRole("slider", { name: /Construction lines/ }),
  ).toHaveValue("240");
  await page.getByRole("radio", { name: "Expert mode" }).check();
  await page
    .getByRole("spinbutton", { name: "Construction lines", exact: true })
    .fill("12.5");
  await expect(page.getByRole("alert")).toContainText("whole numbers");
  await page
    .getByRole("spinbutton", { name: "Construction lines", exact: true })
    .fill("12");
  await page
    .getByRole("spinbutton", { name: "Numerical samples", exact: true })
    .fill("63");
  await expect(page.getByRole("alert")).toContainText("64");
  await page
    .getByRole("spinbutton", { name: "Numerical samples", exact: true })
    .fill("64");
  await expect(page.locator(".plot-wrap")).toHaveAttribute(
    "aria-busy",
    "false",
  );
  await expect(page.getByRole("alert")).toHaveCount(0);
});

test("sidebar scrolling leaves the drawing stationary and decimal indices are valid", async ({
  page,
}) => {
  await page.goto("/");
  await expect(page.locator("#artwork")).toBeVisible();
  await openAnimation(page);
  const before = await page.locator("#artwork").boundingBox();
  await page
    .getByRole("button", { name: "Play animation" })
    .scrollIntoViewIfNeeded();
  const after = await page.locator("#artwork").boundingBox();
  expect(after!.y).toBe(before!.y);
  expect(
    await page.getByRole("complementary").evaluate((el) => el.scrollTop),
  ).toBeGreaterThan(0);
  expect(await page.evaluate(() => window.scrollY)).toBe(0);
  await page.getByRole("button", { name: "diacaustic", exact: true }).click();
  const input = page.getByRole("spinbutton", { name: "Incident index n₁" });
  await input.fill("1.333");
  expect(
    await input.evaluate((el: HTMLInputElement) => el.validity.valid),
  ).toBe(true);
  await page
    .getByText("How the refractive indices work", { exact: true })
    .click();
  await expect(
    page.getByText("0.01 through 10", { exact: true }),
  ).toBeVisible();
  await input.fill("0");
  await expect(page.getByRole("alert")).toContainText("medium indices");
});
