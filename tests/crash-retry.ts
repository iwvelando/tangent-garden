import { test as base, type Page } from "@playwright/test";
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";

// A test that lost its page or its engine to the browser may run once more;
// nothing else is retried.
//
// On CI's macOS runners (macOS 26.7.2 under virtualization) WebKit faults in
// JavaScriptCore's own generated code, under whichever test is running: the
// page process dies in its first seconds, or a worker's WebAssembly engine
// traps or its Go runtime exits. That is upstream of this repository and
// unseen in Safari on devices (closed issue #423). The WebKit project
// therefore allows one retry (playwright.config.ts), and this fixture
// refuses it unless the first attempt lost its page or its engine: an
// assertion, a timeout or any other engine error fails as it would with no
// retries. A retry runs in a new worker, so the record is a file. Every loss
// is added to the CI job's summary, so one that passed on its retry is still
// counted.
//
// A page is lost when it reports a crash, or when it closes during the test
// and the test fails on Playwright's error for a closed page. CI's crashes
// have all arrived the second way, with no crash event. A test that closes
// its own page and fails on that error fails again on its retry. An engine
// is lost when a page still open after the failure shows one of the two
// forms the fault has taken: JavaScriptCore's out-of-bounds trap, or Go's
// runtime already gone. A Go panic also ends the runtime, but a panic the
// input causes happens again on the retry and fails it. A stack overflow or
// any other engine error is the product's to explain.
const records = "page-crashes";
const closedUnderTest = /Target page, context or browser has been closed/;
const engineLost = /Out of bounds memory access|Go program has already exited/;

// The engine error a failed test's open pages show, if it is one of those.
async function lostEngine(pages: Page[]) {
  for (const page of pages) {
    if (page.isClosed()) continue;
    const text = await page
      .locator("body")
      .innerText({ timeout: 2_000 })
      .catch(() => "");
    const lost = engineLost.exec(text);
    if (lost) return lost[0];
  }
  return "";
}

export const test = base.extend<{ crashRetry: void }>({
  crashRetry: [
    async ({ context }, use, testInfo) => {
      const dir = join(testInfo.project.outputDir, records);
      const record = join(dir, testInfo.testId);
      if (testInfo.retry === 0) rmSync(record, { force: true });
      else if (!existsSync(record))
        throw new Error(
          "Not run again: a test is retried only after its page crashed or closed under it, or its engine was lost, and the first attempt failed otherwise.",
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
      let lost = crashed
        ? "Page crashed"
        : closed &&
            testInfo.errors.some((e) => closedUnderTest.test(e.message ?? ""))
          ? "Page closed under the test"
          : "";
      if (!lost) {
        const engine = await lostEngine(context.pages());
        if (engine) lost = `Engine lost ("${engine}")`;
      }
      if (!lost) return;
      const title = testInfo.titlePath.join(" › ");
      mkdirSync(dir, { recursive: true });
      writeFileSync(record, `${title}\n`);
      const summary = process.env.GITHUB_STEP_SUMMARY;
      if (summary)
        appendFileSync(
          summary,
          `- ${lost} (${testInfo.project.name}, attempt ${testInfo.retry + 1}): ${title}\n`,
        );
    },
    { auto: true },
  ],
});
