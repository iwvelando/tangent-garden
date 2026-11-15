import { defineConfig } from "@playwright/test";

// The small suite tests/crash-retry.spec.ts runs in a Playwright of its
// own, with the WebKit project's one retry. Chromium, because only it has a
// page that crashes on request.
export default defineConfig({
  testDir: ".",
  testMatch: "cases.ts",
  retries: 1,
  workers: 1,
  outputDir: process.env.CRASH_RETRY_OUTPUT,
  projects: [{ name: "chromium", use: { browserName: "chromium" } }],
});
