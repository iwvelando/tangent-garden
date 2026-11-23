import { expect, type Page } from "@playwright/test";
import { wireStudy } from "./study-link-wire";
import { examplesButton } from "./helpers";

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
  }).toPass();
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

// A click on the atlas button while the study computes waits for it to
// settle before the atlas opens, which under load can outlast one wait, and
// the button is disabled until the study's first frame. So click again
// until the dialog appears. A repeated click only asks again.
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

// Delays the lazily loaded journey drawings (the 3D and 4D renderers), so a
// journey that opens on such a step shows its placeholder for a while
// before the drawing is presented.
export async function delayJourneyDrawings(page: Page, ms = 1500) {
  await page.route(/\/assets\/JourneyDrawing-[^/]*\.js$/, async (route) => {
    await new Promise((resolve) => setTimeout(resolve, ms));
    await route.continue();
  });
}

// Opens the journey titled title from the gallery and takes every step,
// recording on each frame, from the moment the journey's Next step button
// appears, that button's box and whether the shown step's drawing has been
// presented (its art holds a drawing and nothing in the journey is busy).
// Each step is taken once its drawing is presented.
export async function recordJourneyNavigation(page: Page, title: string) {
  await page.evaluate(() => {
    const w = window as unknown as {
      navigation: { box: number[]; drawn: boolean; step: string }[];
      watchNavigation: boolean;
    };
    w.navigation = [];
    w.watchNavigation = true;
    const observe = () => {
      const dialog = document
        .querySelector(".journey-step")
        ?.closest("dialog, [role=dialog]");
      const next = [...(dialog?.querySelectorAll("button") ?? [])].find(
        (b) => b.textContent?.trim() === "Next step",
      );
      if (dialog && next) {
        // In the scrolled content's coordinates: a click scrolls a button
        // below the fold into view, which is not a move.
        const r = next.getBoundingClientRect();
        let x = r.left + scrollX,
          y = r.top + scrollY;
        for (let e = next.parentElement; e; e = e.parentElement)
          ((x += e.scrollLeft), (y += e.scrollTop));
        w.navigation.push({
          box: [x, y, r.width, r.height],
          drawn:
            !dialog.querySelector('[aria-busy="true"]') &&
            (dialog.querySelector(".journey-art")?.childElementCount ?? 0) > 0,
          step: dialog.querySelector(".journey-step")?.textContent ?? "",
        });
      }
      if (w.watchNavigation) requestAnimationFrame(observe);
    };
    observe();
  });
  await examplesButton(page).click();
  const examples = page.getByRole("dialog", { name: "Notebook examples" });
  await examples.getByRole("button", { name: title, exact: true }).click();
  const journey = page.getByRole("dialog", { name: title, exact: true });
  await expect(journey).toBeVisible();
  const status = journey.locator(".journey-step");
  const total = Number((await status.textContent())!.match(/of (\d+)/)![1]);
  for (let i = 1; i <= total; i++) {
    await expect(status).toHaveText(new RegExp(`^Step ${i} of`));
    await expect(journey.locator('[aria-busy="true"]')).toHaveCount(0);
    await expect
      .poll(() =>
        journey
          .locator(".journey-art")
          .first()
          .evaluate((art) => art.childElementCount),
      )
      .toBeGreaterThan(0);
    if (i < total)
      await journey
        .getByRole("button", { name: "Next step", exact: true })
        .click();
  }
  return page.evaluate(() => {
    const w = window as unknown as {
      navigation: { box: number[]; drawn: boolean; step: string }[];
      watchNavigation: boolean;
    };
    w.watchNavigation = false;
    return w.navigation;
  });
}

// The Next step button never moved while a journey opened, presented its
// first drawing and changed steps: every box equals the first. A journey
// whose first drawing waits shows its placeholder for some of those frames
// (an overlay guide draws at once, so it shows none).
export function expectStillNavigation(
  frames: { box: number[]; drawn: boolean; step: string }[],
  { waits = true } = {},
) {
  expect(frames.length).toBeGreaterThan(10);
  if (waits) expect(frames.some((f) => !f.drawn)).toBe(true);
  expect(frames.some((f) => f.drawn)).toBe(true);
  const moved = frames.filter((f) =>
    f.box.some((v, k) => Math.abs(v - frames[0].box[k]) > 0.5),
  );
  expect(moved.slice(0, 3).map((f) => ({ ...f, from: frames[0].box }))).toEqual(
    [],
  );
}
