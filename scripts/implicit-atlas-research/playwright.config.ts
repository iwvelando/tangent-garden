import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: ".",
  testMatch: "research.test.ts",
  timeout: 120_000,
  expect: { timeout: 15_000 },
  workers: 1,
  use: {
    baseURL: process.env.RESEARCH_URL ?? "http://127.0.0.1:4181",
    ignoreHTTPSErrors: true,
    viewport: { width: 1280, height: 700 },
  },
  projects: [
    { name: "chromium", use: { browserName: "chromium" } },
    ...(process.env.WEBKIT
      ? [{ name: "webkit", use: { browserName: "webkit" as const } }]
      : []),
  ],
  webServer: process.env.RESEARCH_URL
    ? undefined
    : {
        command:
          "npm run preview -- --outDir .codex/implicit-atlas-dist --port 4181 --strictPort",
        url: "http://127.0.0.1:4181",
        reuseExistingServer: !process.env.CI,
      },
});
