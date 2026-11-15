import { expect, type Page } from "@playwright/test";
import { test } from "../crash-retry";

// Not part of the suite: tests/crash-retry.spec.ts runs these and reads
// what became of each.

// The navigation is refused as the page dies; the next use of the page is
// what fails, as it does when WebKit's page crashes under a test.
async function crash(page: Page) {
  const crashed = page.waitForEvent("crash");
  await page.goto("chrome://crash").catch(() => {});
  await crashed;
  await page.evaluate(() => 1);
}

test("crashes once", async ({ page }, testInfo) => {
  if (testInfo.retry === 0) await crash(page);
});

// On CI a WebKit crash has reached the test as its page closing under it,
// with no crash event.
test("loses its page once", async ({ page }, testInfo) => {
  if (testInfo.retry > 0) return;
  setTimeout(() => void page.close(), 200);
  await page.locator("#never").click();
});

// A test that closes its own page and then fails has not lost it.
test("fails after closing its page", async ({ page }) => {
  await page.close();
  expect(1).toBe(2);
});

test("fails with no crash", async ({ page }) => {
  await page.goto("about:blank");
  expect(await page.title()).toBe("never");
});

test("crashes every time", async ({ page }) => {
  await crash(page);
});
