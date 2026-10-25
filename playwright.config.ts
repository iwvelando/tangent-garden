import { defineConfig } from "@playwright/test";
import { shardFiles } from "./tests/shards";

// BASE_URL points the tests at a deployed site instead of a local preview build.
const remote = process.env.BASE_URL;
// WEBKIT=1 adds Safari's engine and shared mobile-input checks (`make test-webkit`).
// It is opt-in so ordinary runs need only Chromium installed.
const webkit = /webkit\.spec\.ts$/;
// CI's shared runners draw WebGL in software, two tests at a time, and are
// slower still when GitHub is under load: heavy 3D studies there can take
// several times as long as locally to settle, render or play. A full local
// run is as loaded, with many workers sharing one machine and its other
// work, and lazily loading a notebook alone can then pass 5 s. So every
// run gives each wait 15 s instead of Playwright's 5 and each test 60 s
// instead of 30; a test that sets its own limit keeps it. A passing wait
// returns as soon as it holds, so only failures take longer. Each CI shard's
// per-test durations are uploaded (chromium-test-timings), so a test that
// slows down still shows.
// TEST_SHARD="2/6" runs one of CI's Chromium shards, packed by each spec
// file's recorded duration (tests/shards.ts) rather than by test count as
// --shard is. Each file is matched by its exact name: Playwright reads file
// arguments as patterns, so `export.spec.ts` would also run
// `mp4-export.spec.ts`.
const shard = process.env.TEST_SHARD;
const exact = (file: string) =>
  new RegExp(`/${file.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`);

export default defineConfig({
  testDir: "./tests",
  fullyParallel: false,
  timeout: 60_000,
  expect: { timeout: 15_000 },
  use: {
    baseURL: remote ?? "http://127.0.0.1:4173",
    viewport: { width: 1440, height: 1000 },
  },
  projects: [
    {
      name: "chromium",
      use: { browserName: "chromium" },
      testIgnore: webkit,
      ...(shard && { testMatch: shardFiles(shard, webkit).map(exact) }),
    },
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
