import { expect, type Page } from "@playwright/test";
import { wireStudy } from "./study-link-wire";

// Shared by gallery.spec.ts (the gallery and its atlas) and journeys.spec.ts,
// split so that no one file holds a CI shard near its time limit
// (docs/contributing.md, CI shards).

export const gallery = (page: Page) =>
  page.getByRole("dialog", { name: "Notebook examples" });

export const heading = (page: Page) =>
  page.locator(".app:visible .plot-heading");

export const journeyTitles = [
  "Light finding a cusp",
  "Threads becoming surfaces",
  "Order inside apparent chaos",
  "A glimpse of four dimensions",
  "What a shadow leaves out",
  "A thread learns the surface",
  "Rules that grow a garden",
  "Every point owns a circle",
  "When a crystal meets its dual",
];

export async function settled(page: Page) {
  await expect(
    page.locator(
      ".app:visible .plot-wrap[aria-busy], .app:visible .spatial-stage",
    ),
  ).toHaveAttribute("aria-busy", "false");
}

// Copy link is disabled while a study computes, and settled() can return on
// the previous state just before an action's computation starts. Under load
// a click checked against the enabled button then landed on it disabled, so
// no click reached it; click again until one does.
export async function copiedStudy(page: Page) {
  const button = page.getByRole("button", { name: "Copy link", exact: true });
  await expect(async () => {
    const reached = button.evaluate(
      (b) =>
        new Promise<boolean>((resolve) => {
          b.addEventListener("click", () => resolve(true), { once: true });
          setTimeout(() => resolve(false), 1000);
        }),
    );
    await button.click();
    expect(await reached).toBe(true);
  }).toPass({ timeout: 15_000 });
  await expect(page.getByText("Link copied", { exact: true })).toBeVisible();
  const url = await page.evaluate(() => navigator.clipboard.readText());
  await page.mouse.click(1, 1);
  return { url, study: wireStudy(url.split("#s=")[1]) };
}

// Records every worker's compute requests and replies in window.atlasWorkers;
// replies from workers after the notebook's own arrive delay ms late.
export async function observeAtlasWorkers(page: Page, delay = 0) {
  await page.addInitScript(
    ({ delay }) => {
      const Native = window.Worker;
      const logs: any[] = [];
      Object.assign(window, { atlasWorkers: logs, atlasDelay: delay });
      window.Worker = class extends Native {
        log: any;
        constructor(url: string | URL, options?: WorkerOptions) {
          super(url, options);
          this.log = {
            url: String(url),
            requests: [],
            replies: [],
            active: 0,
            maximum: 0,
            terminated: false,
          };
          logs.push(this.log);
        }
        postMessage(data: any, options?: any) {
          if (data.action === "compute" && !data.probeOnly) {
            this.log.active++;
            this.log.maximum = Math.max(this.log.maximum, this.log.active);
            this.log.requests.push({
              data: structuredClone(data),
              started: performance.now(),
            });
          }
          super.postMessage(data, options);
        }
        set onmessage(handler: any) {
          super.onmessage = (event: MessageEvent) => {
            const deliver = () => {
              const request = this.log.requests.find(
                (r: any) => r.data.id === event.data.id,
              );
              if (request) {
                this.log.active--;
                this.log.replies.push({
                  data: structuredClone(event.data),
                  took: performance.now() - request.started,
                });
              }
              handler?.call(this, event);
            };
            if (logs.indexOf(this.log) > 0)
              setTimeout(deliver, (window as any).atlasDelay);
            else deliver();
          };
        }
        terminate() {
          this.log.terminated = true;
          super.terminate();
        }
      };
    },
    { delay },
  );
}

// The atlas button is disabled while a study computes, and, as for Copy
// link above, settled() can return just before an action's computation
// starts (after Adopt variant, say). Under load a click checked against the
// enabled button then landed on it disabled and the atlas never opened, so
// click again until the dialog appears. A repeated click only asks again.
export async function openAtlas(page: Page) {
  const button = page.getByRole("button", {
    name: "Explore parameter atlas",
    exact: true,
  });
  const dialog = page.getByRole("dialog", {
    name: "A field of possible flowers",
    exact: true,
  });
  await expect(async () => {
    if (!(await dialog.isVisible()))
      await button.click({ timeout: 2_000 }).catch(() => {});
    await expect(dialog).toBeVisible({ timeout: 5_000 });
  }).toPass({ timeout: 30_000 });
  return dialog;
}
