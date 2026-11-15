import { test as base } from "@playwright/test";
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";

// A test that lost its page to the browser may run once more; nothing else
// is retried.
//
// On CI's macOS runners WebKit's page process sometimes dies in its first
// seconds, in JavaScriptCore's own generated code, under whichever test is
// running (issue #423). The WebKit project therefore allows one retry
// (playwright.config.ts), and this fixture refuses it unless the first
// attempt lost its page: an assertion, a timeout or an engine error fails
// as it would with no retries. A retry runs in a new worker, so the record
// is a file. Every loss is added to the CI job's summary, so one that
// passed on its retry is still counted.
//
// A page is lost when it reports a crash, or when it closes during the test
// and the test fails on Playwright's error for a closed page. CI's crashes
// have all arrived the second way, with no crash event. A test that closes
// its own page and fails on that error fails again on its retry.
const records = "page-crashes";
const closedUnderTest = /Target page, context or browser has been closed/;

export const test = base.extend<{ crashRetry: void }>({
  crashRetry: [
    async ({ context }, use, testInfo) => {
      const dir = join(testInfo.project.outputDir, records);
      const record = join(dir, testInfo.testId);
      if (testInfo.retry === 0) rmSync(record, { force: true });
      else if (!existsSync(record))
        throw new Error(
          "Not run again: a test is retried only after its page crashed or closed under it, and the first attempt failed otherwise.",
        );
      let crashed = false;
      let closed = false;
      let over = false;
      context.on("page", (page) => {
        page.on("crash", () => (crashed = true));
        // The test's own pages close after it, with its context.
        page.on("close", () => (closed ||= !over));
      });
      await use();
      over = true;
      if (testInfo.status === testInfo.expectedStatus) return;
      const lost = crashed
        ? "crashed"
        : closed &&
            testInfo.errors.some((e) => closedUnderTest.test(e.message ?? ""))
          ? "closed under the test"
          : "";
      if (!lost) return;
      const title = testInfo.titlePath.join(" › ");
      mkdirSync(dir, { recursive: true });
      writeFileSync(record, `${title}\n`);
      const summary = process.env.GITHUB_STEP_SUMMARY;
      if (summary)
        appendFileSync(
          summary,
          `- Page ${lost} (${testInfo.project.name}, attempt ${testInfo.retry + 1}): ${title}\n`,
        );
    },
    { auto: true },
  ],
});
