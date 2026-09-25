import { test, expect } from "@playwright/test";
import { imageButton } from "./helpers";

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
  const engine = (await wasm).headers();
  expect(engine["content-type"]).toBe("application/wasm");
  // CloudFront compresses engine.wasm to about a quarter of its size, choosing
  // Brotli or gzip per browser. If a distribution setting or the object's content
  // type changes, it would silently ship uncompressed; vite preview never
  // compresses, so this only applies to a deployed site.
  if (process.env.BASE_URL)
    expect(["br", "gzip"]).toContain(engine["content-encoding"]);
  await expect(page.locator("#artwork")).toBeVisible();
  expect(await page.locator("#artwork line").count()).toBeGreaterThan(20);
  await expect(imageButton(page)).toBeEnabled();
  expect(problems).toEqual([]);
});
