import { test, expect } from "@playwright/test";

// Post-deploy smoke test. CI also runs it against the preview build; the deploy
// runs it against the live site with BASE_URL=https://tangent-garden.isaacvelando.com.
test("@smoke the engine loads and draws with no browser errors", async ({
  page,
}) => {
  const problems: string[] = [];
  page.on("console", (m) => {
    if (m.type() === "error") problems.push(m.text());
  });
  page.on("pageerror", (e) => problems.push(e.message));
  page.on("requestfailed", (r) => problems.push(`${r.url()} failed`));
  page.on("response", (r) => {
    if (r.status() >= 400) problems.push(`${r.url()} returned ${r.status()}`);
  });
  const wasm = page.waitForResponse((r) => r.url().endsWith("/engine.wasm"));
  await page.goto("/");
  expect((await wasm).headers()["content-type"]).toBe("application/wasm");
  await expect(page.locator("#artwork")).toBeVisible();
  expect(await page.locator("#artwork line").count()).toBeGreaterThan(20);
  await expect(page.getByRole("button", { name: /Export SVG/ })).toBeEnabled();
  expect(problems).toEqual([]);
});
