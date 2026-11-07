// Reproducible observations, not performance assertions or device FPS.
// RESEARCH_URL=https://<host>:4180 node scripts/implicit-atlas-research/measure.mjs chromium /tmp/report.json
import { chromium, webkit } from "@playwright/test";
import { writeFile, mkdir, readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
const kind = process.argv[2] ?? "chromium";
const output = process.argv[3] ?? "/tmp/implicit-atlas-" + kind + ".json";
const origin = process.env.RESEARCH_URL ?? "https://localhost:4180";
const browser = await { chromium, webkit }[kind].launch();
const context = await browser.newContext({
  ignoreHTTPSErrors: true,
  viewport: { width: 1280, height: 700 },
});
await context.addInitScript(() => {
  const workers = [];
  const NativeWorker = window.Worker;
  window.Worker = class extends NativeWorker {
    constructor(...args) {
      super(...args);
      this.record = { requests: [], replies: [], terminated: false };
      workers.push(this.record);
      this.addEventListener("message", ({ data }) =>
        this.record.replies.push(data.id),
      );
    }
    postMessage(message, ...args) {
      this.record.requests.push({
        id: message.id,
        action: message.action,
        at: performance.now(),
      });
      return super.postMessage(message, ...args);
    }
    terminate() {
      this.record.terminated = true;
      return super.terminate();
    }
  };
  window.researchWorkers = workers;
  const blobs = new Map();
  const create = URL.createObjectURL.bind(URL),
    revoke = URL.revokeObjectURL.bind(URL);
  URL.createObjectURL = (blob) => {
    const url = create(blob);
    blobs.set(url, blob.size);
    return url;
  };
  URL.revokeObjectURL = (url) => {
    blobs.delete(url);
    revoke(url);
  };
  window.liveResearchImages = () => ({
    count: blobs.size,
    bytes: [...blobs.values()].reduce((a, b) => a + b, 0),
  });
});
const hash = createHash("sha256");
for (const name of ["model.ts", "main.tsx", "research.css", "build.mjs"])
  hash.update(await readFile(new URL(name, import.meta.url)));
const report = {
  baseline: execFileSync("git", ["rev-parse", "HEAD"], {
    encoding: "utf8",
  }).trim(),
  prototypeHash: hash.digest("hex"),
  platform: process.platform + "/" + process.arch,
  browser: kind,
  version: browser.version(),
  viewport: { width: 1280, height: 700 },
  method:
    "Each Generate starts a fresh meshing worker; first request includes startup. Two runs per case/size. Timings include worker/transport and final PNG render; headless, not achieved device FPS. Forced-GC main-page heap snapshots exclude worker/WASM and GPU memory.",
  runs: [],
};
await mkdir("/tmp/tg-368-artifacts", { recursive: true });
try {
  for (const id of [
    "drops",
    "sphere",
    "gyroid",
    "gaps",
    "pole",
    "expensive",
    "unavailable",
  ]) {
    for (const size of [3, 5]) {
      for (let repeat = 0; repeat < 2; repeat++) {
        const page = await context.newPage();
        await page.goto(origin + "/scripts/implicit-atlas-research/index.html");
        await page.getByLabel("Experiment", { exact: true }).selectOption(id);
        await page
          .getByLabel("Grid size", { exact: true })
          .selectOption(String(size));
        const cdp =
          kind === "chromium" ? await context.newCDPSession(page) : null;
        const heap = async () => {
          if (!cdp) return null;
          await cdp.send("HeapProfiler.collectGarbage");
          return await cdp.send("Runtime.getHeapUsage");
        };
        const beforeHeap = await heap();
        await page
          .getByRole("button", { name: "Generate atlas", exact: true })
          .click();
        await page.waitForFunction(
          () =>
            window.research?.stats.drawnMs !== undefined ||
            window.research?.queue?.state.failed,
          null,
          { timeout: 120000 },
        );
        const grid = await page.evaluate(() => ({
          ...window.research.stats,
          images: window.liveResearchImages(),
          errors: window.research.queue.state.cells
            .filter((c) => c.error)
            .map((c) => c.error),
          cells: window.research.queue.state.cells.map((c) => ({
            values: c.values,
            vertices: c.frame?.result.implicit.positions.length / 3,
            triangles: c.frame?.result.implicit.triangles.length / 3,
            components: c.frame?.result.implicit.components,
            nonfinite: c.frame?.result.implicit.nonfinite,
            discontinuities: c.frame?.result.implicit.discontinuities,
            singular: c.frame?.result.implicit.singular,
          })),
        }));
        const gridHeap = await heap();
        const center = Math.floor(size ** 2 / 2);
        let inspection = null;
        if (
          await page
            .getByRole("button", {
              name:
                "Inspect row " +
                (Math.floor(center / size) + 1) +
                ", column " +
                ((center % size) + 1),
              exact: true,
            })
            .isEnabled()
        ) {
          const start = await page.evaluate(() => performance.now());
          await page
            .getByRole("button", {
              name:
                "Inspect row " +
                (Math.floor(center / size) + 1) +
                ", column " +
                ((center % size) + 1),
              exact: true,
            })
            .click();
          await page.waitForFunction(
            () => {
              const r = window.research;
              return r.queue.state.selection?.error || r.images.inspection;
            },
            null,
            { timeout: 120000 },
          );
          inspection = await page.evaluate(
            (start) => ({
              elapsedMs: performance.now() - start,
              error: window.research.queue.state.selection.error,
              numbers: window.research.stats.retainedNumbers,
              typedBytes: window.research.stats.typedBytes,
              images: window.liveResearchImages(),
              result: (() => {
                const q =
                  window.research.queue.state.selection.frame?.result.implicit;
                return (
                  q && {
                    vertices: q.positions.length / 3,
                    triangles: q.triangles.length / 3,
                    components: q.components,
                    nonfinite: q.nonfinite,
                    discontinuities: q.discontinuities,
                    singular: q.singular,
                    refinement: q.refinement,
                  }
                );
              })(),
            }),
            start,
          );
        }
        const inspectedHeap = await heap();
        if (repeat === 0 && id === "drops" && size === 3) {
          const oldLight = await page.evaluate(() =>
            Object.values(window.research.images).map((p) => p.url),
          );
          await page.getByRole("button", { name: "Use dark theme" }).click();
          await page.waitForFunction(
            (old) =>
              Object.values(window.research.images).every(
                (p) => p.status === "ready" && !old.includes(p.url),
              ),
            oldLight,
          );
          await page.screenshot({
            path: "/tmp/tg-368-artifacts/" + kind + "-drops-dark.png",
            fullPage: true,
          });
          const oldDark = await page.evaluate(() =>
            Object.values(window.research.images).map((p) => p.url),
          );
          await page.getByRole("button", { name: "Use light theme" }).click();
          await page.waitForFunction(
            (old) =>
              Object.values(window.research.images).every(
                (p) => p.status === "ready" && !old.includes(p.url),
              ),
            oldDark,
          );
          await page.screenshot({
            path: "/tmp/tg-368-artifacts/" + kind + "-drops-light.png",
            fullPage: true,
          });
        }
        const cancelStart = await page.evaluate(() => performance.now());
        await page
          .getByRole("button", { name: "Cancel atlas", exact: true })
          .click();
        await page.waitForFunction(
          () => window.research.queue.state.cells.length === 0,
        );
        const canceled = await page.evaluate(
          (start) => ({
            elapsedMs: performance.now() - start,
            cells: window.research.queue.state.cells.length,
            images: window.liveResearchImages(),
            numbers: window.research.stats.retainedNumbers,
          }),
          cancelStart,
        );
        const canceledHeap = await heap();
        report.runs.push({
          id,
          size,
          repeat,
          grid,
          inspection,
          canceled,
          heap: { beforeHeap, gridHeap, inspectedHeap, canceledHeap },
        });
        await writeFile(output, JSON.stringify(report, null, 2));
        console.log(
          JSON.stringify({
            id,
            size,
            repeat,
            gridMs: grid.gridMs,
            drawnMs: grid.drawnMs,
            numbers: inspection?.numbers ?? grid.retainedNumbers,
            inspectMs: inspection?.elapsedMs,
            errors: grid.errors.length,
            cancelMs: canceled.elapsedMs,
          }),
        );
        await page.close();
      }
    }
  }
  // Measure cancellation during real synchronous meshing, separately from cleanup.
  const page = await context.newPage();
  await page.goto(origin + "/scripts/implicit-atlas-research/index.html");
  await page
    .getByLabel("Experiment", { exact: true })
    .selectOption("expensive");
  await page
    .getByRole("button", { name: "Generate atlas", exact: true })
    .click();
  await page.waitForFunction(
    () => window.research?.stats.drawnMs !== undefined,
  );
  await page
    .getByRole("button", { name: "Inspect row 2, column 2", exact: true })
    .click();
  await page.waitForTimeout(100);
  const outstanding = await page.evaluate(() =>
    window.researchWorkers
      .filter((w) => !w.terminated)
      .map((w) => ({
        pending: w.requests.filter(
          (q) => q.action === "spatial" && !w.replies.includes(q.id),
        ).length,
      })),
  );
  if (!outstanding.some((w) => w.pending === 1))
    throw new Error("No calculation was in flight");
  const start = await page.evaluate(() => performance.now());
  await page.getByRole("button", { name: "Cancel atlas", exact: true }).click();
  await page.waitForFunction(
    () => window.research.queue.state.cells.length === 0,
  );
  const elapsedMs = await page.evaluate(
    (start) => performance.now() - start,
    start,
  );
  await page.waitForTimeout(500);
  report.inFlightCancellation = await page.evaluate(
    ({ outstanding, elapsedMs }) => ({
      outstanding,
      elapsedMs,
      workers: window.researchWorkers.map((w) => ({
        terminated: w.terminated,
        sent: w.requests.length,
        replied: w.replies.length,
      })),
      cells: window.research.queue.state.cells.length,
      numbers: window.research.stats.retainedNumbers,
      images: window.liveResearchImages(),
    }),
    { outstanding, elapsedMs },
  );
  await writeFile(output, JSON.stringify(report, null, 2));
  console.log(
    JSON.stringify({ inFlightCancellation: report.inFlightCancellation }),
  );
  await page.close();
} finally {
  await browser.close();
}
