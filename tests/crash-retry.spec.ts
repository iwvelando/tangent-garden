import { test, expect } from "@playwright/test";
import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";

// The WebKit project retries a test once, and only when its page crashed or
// its engine trapped (tests/crash-retry.ts). This runs small tests under
// that rule, in a Playwright of their own, with a Chromium page that really
// crashes.

type Attempt = { status: string; error?: { message: string } };

test("only a lost page or a trapped engine earns a retry, and each is reported", async ({}, testInfo) => {
  const summary = testInfo.outputPath("summary.md");
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    CRASH_RETRY_OUTPUT: testInfo.outputPath("results"),
    GITHUB_STEP_SUMMARY: summary,
  };
  // The outer run's own settings: its shard, and where CI writes its report.
  for (const name of Object.keys(env))
    if (/^(TEST_|PLAYWRIGHT_|PW_|PWTEST_|WEBKIT$|BASE_URL$)/.test(name))
      delete env[name];
  const report = await new Promise<string>((resolve) =>
    execFile(
      "npx",
      [
        "playwright",
        "test",
        "--config",
        "tests/crash-retry/playwright.config.ts",
        "--reporter=json",
      ],
      { env, maxBuffer: 1 << 24 },
      // It exits nonzero, since two of its tests must fail.
      (_, stdout) => resolve(stdout),
    ),
  );
  const attempts = new Map<string, Attempt[]>();
  for (const suite of JSON.parse(report).suites)
    for (const spec of suite.specs)
      attempts.set(spec.title, spec.tests[0].results);
  const of = (title: string) =>
    (attempts.get(title) ?? []).map((a) => a.status);

  // A crash is retried, and the test passes.
  expect(of("crashes once")).toEqual(["failed", "passed"]);
  // So is a page that closed under the test, which is how CI's WebKit
  // crashes have arrived.
  expect(of("loses its page once")).toEqual(["failed", "passed"]);
  expect(of("fails after closing its page")).toEqual(["failed", "failed"]);
  expect(
    attempts.get("fails after closing its page")![1].error!.message,
  ).toContain("retried only after");
  // Any other failure is not run again: its retry fails before the test body.
  expect(of("fails with no crash")).toEqual(["failed", "failed"]);
  expect(attempts.get("fails with no crash")![0].error!.message).toContain(
    "never",
  );
  expect(attempts.get("fails with no crash")![1].error!.message).toContain(
    "retried only after",
  );
  // A crash that repeats still fails.
  expect(of("crashes every time")).toEqual(["failed", "failed"]);
  expect(attempts.get("crashes every time")![1].error!.message).toMatch(
    /crash/i,
  );

  // A WebAssembly trap or a Go runtime gone from the engine is retried too.
  expect(of("engine traps once")).toEqual(["failed", "passed"]);
  expect(of("engine exits once")).toEqual(["failed", "passed"]);
  expect(of("engine traps every time")).toEqual(["failed", "failed"]);
  expect(
    attempts.get("engine traps every time")![1].error!.message,
  ).not.toContain("retried only after");
  // No other engine error is.
  expect(of("engine overflows its stack once")).toEqual(["failed", "failed"]);
  expect(
    attempts.get("engine overflows its stack once")![1].error!.message,
  ).toContain("retried only after");

  // The job summary lists every crash, including the one that passed after.
  const lines = (await readFile(summary, "utf8")).trim().split("\n");
  expect(lines.filter((l) => l.includes("crashes once"))).toHaveLength(1);
  expect(lines.filter((l) => l.includes("crashes every time"))).toHaveLength(2);
  expect(lines.filter((l) => l.includes("loses its page once"))).toHaveLength(
    1,
  );
  expect(lines.filter((l) => l.includes("engine traps once"))).toHaveLength(1);
  expect(lines.filter((l) => l.includes("engine traps once"))[0]).toContain(
    "Out of bounds memory access",
  );
  expect(lines.filter((l) => l.includes("engine exits once"))).toHaveLength(1);
  expect(
    lines.filter((l) => l.includes("engine traps every time")),
  ).toHaveLength(2);
  expect(lines.some((l) => l.includes("fails"))).toBe(false);
  expect(lines.some((l) => l.includes("overflows"))).toBe(false);
});
