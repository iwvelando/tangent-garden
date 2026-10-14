import { defineConfig } from "@playwright/test";

// BASE_URL points the tests at a deployed site instead of a local preview build.
const remote = process.env.BASE_URL;
// WEBKIT=1 adds Safari's engine and shared mobile-input checks (`make test-webkit`).
// It is opt-in so ordinary runs need only Chromium installed.
const webkit = /webkit\.spec\.ts$/;
// CI's shared runners draw WebGL in software, two tests at a time, and are
// slower still when GitHub is under load: heavy 3D studies there can take
// several times as long as locally to settle, render or play. On CI, each
// wait gets 15 s instead of 5 and each test 60 s instead of 30; a test that
// sets its own limit keeps it. Each shard's per-test durations are uploaded
// (chromium-test-timings), so a test that slows down still shows.
const ci = !!process.env.CI;

export default defineConfig({
  testDir: "./tests",
  fullyParallel: false,
  ...(ci && { timeout: 60_000, expect: { timeout: 15_000 } }),
  use: {
    baseURL: remote ?? "http://127.0.0.1:4173",
    viewport: { width: 1440, height: 1000 },
  },
  projects: [
    { name: "chromium", use: { browserName: "chromium" }, testIgnore: webkit },
    ...(process.env.WEBKIT
      ? [
          {
            name: "webkit",
            use: { browserName: "webkit" as const },
            testMatch: /(?:webkit|mobile-inputs)\.spec\.ts$/,
          },
        ]
      : []),
  ],
  webServer: remote
    ? undefined
    : {
        command: "npm run preview -- --port 4173 --strictPort",
        url: "http://127.0.0.1:4173",
        reuseExistingServer: !process.env.CI,
      },
});
