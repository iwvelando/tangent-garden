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
  // The engine is precompressed to about a fifth of its size, and the host
  // picks Brotli or gzip per browser, as vite preview does. If the upload or
  // the hosting's rewrite changed, it would silently ship uncompressed.
  expect(["br", "gzip"]).toContain(engine["content-encoding"]);
  await expect(page.locator("#artwork")).toBeVisible();
  expect(await page.locator("#artwork line").count()).toBeGreaterThan(20);
  await expect(imageButton(page)).toBeEnabled();
  expect(problems).toEqual([]);
});

// Too large for CloudFront to compress itself, the engine is uploaded as
// Brotli and gzip copies beside the plain file, and the host chooses one by
// Accept-Encoding, as CloudFront's own compression did (#604).
test("@smoke the engine is served compressed by Accept-Encoding", async ({
  request,
}) => {
  const fetch = async (encoding: string) => {
    const r = await request.get("/engine.wasm", {
      headers: { "Accept-Encoding": encoding },
    });
    expect(r.status()).toBe(200);
    const headers = r.headers();
    expect(headers["content-type"]).toBe("application/wasm");
    expect(headers["vary"]).toMatch(/accept-encoding/i);
    return { encoding: headers["content-encoding"], body: await r.body() };
  };
  const plain = await fetch("identity");
  expect(plain.encoding).toBeUndefined();
  expect(plain.body.subarray(0, 4)).toEqual(Buffer.from("\0asm"));
  for (const [accepted, sent] of [
    ["gzip, deflate, br, zstd", "br"],
    ["br;q=1.0, gzip;q=0.8", "br"],
    ["gzip, deflate", "gzip"],
    ["br;q=0, gzip", "gzip"],
    ["deflate", undefined],
  ] as const) {
    const served = await fetch(accepted);
    expect(served.encoding, accepted).toBe(sent);
    // The request context decodes the body, which must be the plain engine.
    expect(served.body.equals(plain.body), accepted).toBe(true);
  }
});
