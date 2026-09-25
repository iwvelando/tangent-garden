import { test, expect } from "@playwright/test";

const closing = "An open notebook for mathematical beauty.";

test("phones show the drawing, then the controls, then the explanation", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await expect(page.locator("#artwork")).toBeVisible();
  const top = async (selector: string) =>
    (await page.locator(selector).first().boundingBox())!.y;
  const plot = await top(".plot-wrap");
  const controls = await top("aside");
  const behind = await top(".explanation");
  const note = await top(".bottom-note");
  const last = await top(".closing");
  expect(plot).toBeLessThan(controls);
  expect(controls).toBeLessThan(behind);
  expect(behind).toBeLessThan(note);
  expect(note).toBeLessThan(last);
  await expect(page.getByText(closing, { exact: true })).toBeVisible();
  // The closing line ends the page.
  const bottom = await page.evaluate(() => document.body.scrollHeight);
  const box = (await page.locator(".closing").boundingBox())!;
  expect(bottom - (box.y + box.height)).toBeLessThan(80);
  await expect(page.getByText(/Computed entirely in your browser/)).toHaveCount(
    0,
  );
});

test("wide screens keep the explanation and closing line under the drawing", async ({
  page,
}) => {
  await page.goto("/");
  await expect(page.locator("#artwork")).toBeVisible();
  const article = page.locator("article");
  await expect(article.getByText("BEHIND THE LINES")).toBeVisible();
  await expect(article.getByText(closing, { exact: true })).toBeAttached();
  await expect(page.getByRole("complementary").getByText(closing)).toHaveCount(
    0,
  );
  await expect(page.getByText(/Computed entirely in your browser/)).toHaveCount(
    0,
  );
});

test("the explanation follows the layout when the window is resized", async ({
  page,
}) => {
  await page.goto("/");
  await expect(page.locator("#artwork")).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.locator("article .explanation")).toHaveCount(0);
  await expect(page.locator(".explanation")).toHaveCount(1);
  await page.setViewportSize({ width: 1440, height: 1000 });
  await expect(page.locator("article .explanation")).toHaveCount(1);
});
