import { test } from "node:test";
import assert from "node:assert/strict";
import { occurrence, parseJobLog } from "./ci-failure.mjs";

// A failed job's log as GitHub serves it: a timestamp before every line.
const stamp = (text) =>
  text
    .split("\n")
    .map((line) => `2026-11-13T22:41:44.3449000Z ${line}`)
    .join("\n");

const log = stamp(`##[group]Runner Image Provisioner
Version: 20261028.624
##[endgroup]
##[group]Operating System
macOS
26.7.2
##[endgroup]
##[group]Runner Image
Image: macos-26-arm64
Version: 20261102.0473.1
##[endgroup]
  1) [webkit] › tests/webkit.spec.ts:1002:3 › curved 4D A sphere in passing renders and exports through WebKit 

    Test timeout of 60000ms exceeded.

    Error: page.evaluate: Test timeout of 60000ms exceeded.

       at video.ts:84

  2) [webkit] › tests/webkit.spec.ts:2858:3 › overlay journey focus › stable navigation at 390x844 

    Error: expect(locator).toBeEnabled() failed

    Call log:
      - waiting for getByRole('button')
      - Target page, context or browser has been closed

  2 failed
    [webkit] › tests/webkit.spec.ts:1002:3 › curved 4D A sphere in passing renders and exports through WebKit 
  124 passed (10.6m)
##[error]Process completed with exit code 2.`);

test("a job log gives the runner image and each failed test once", () => {
  assert.deepEqual(parseJobLog(log), {
    image: "macos-26-arm64 20261102.0473.1",
    failures: [
      {
        project: "webkit",
        file: "tests/webkit.spec.ts",
        title:
          "curved 4D A sphere in passing renders and exports through WebKit",
        error: "Test timeout of 60000ms exceeded.",
        pageLost: false,
      },
      {
        project: "webkit",
        file: "tests/webkit.spec.ts",
        title: "overlay journey focus › stable navigation at 390x844",
        error: "Error: expect(locator).toBeEnabled() failed",
        pageLost: true,
      },
    ],
  });
});

test("a retried test gives its first attempt's error", () => {
  const retried = stamp(`  1) [chromium] › tests/a.spec.ts:3:1 › draws 

    Error: first

    Retry #1 ───────────────────────────────────────────────────────────────

    Error: second
`);
  assert.deepEqual(
    parseJobLog(retried).failures.map((f) => f.error),
    ["Error: first"],
  );
});

test("a log with no test failure has none, and no image is not an error", () => {
  assert.deepEqual(parseJobLog(stamp("npm error code E503")), {
    image: "",
    failures: [],
  });
});

test("an occurrence is one line an issue comment can hold", () => {
  const [, lost] = parseJobLog(log).failures;
  assert.equal(
    occurrence({
      date: "2026-11-13",
      url: "https://github.com/o/r/actions/runs/7/attempts/1",
      run: 7,
      attempt: 1,
      job: "webkit",
      image: "macos-26-arm64 20261102.0473.1",
      failure: lost,
    }),
    "- 2026-11-13, [run 7, attempt 1](https://github.com/o/r/actions/runs/7/attempts/1), job `webkit` on macos-26-arm64 20261102.0473.1: `tests/webkit.spec.ts` › overlay journey focus › stable navigation at 390x844. Error: expect(locator).toBeEnabled() failed (the page closed or crashed under the test)",
  );
});
