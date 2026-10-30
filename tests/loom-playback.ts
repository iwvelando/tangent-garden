import { expect, type Page } from "@playwright/test";

export async function checkLoomLiveScrub(page: Page, title: string) {
  await page.addInitScript(() => {
    const send = Worker.prototype.postMessage;
    Worker.prototype.postMessage = function (q: any, ...rest: any[]) {
      if (q.action === "loom" && (window as any).delayLoomScrub)
        setTimeout(() => send.call(this, q, ...rest), 200);
      else send.call(this, q, ...rest);
    };
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await expect(page.locator(".plot-wrap")).toHaveAttribute(
    "aria-busy",
    "false",
  );
  await page.getByRole("button", { name: "Browse notebook examples" }).click();
  await page
    .locator(`[data-loom-example][data-example-title="${title}"]`)
    .click();
  const d = page.getByRole("dialog", { name: "The complex loom" });
  await expect(d.locator(".loom-panes")).toHaveAttribute("aria-busy", "false");
  const map = title === "Circles through infinity";
  const slider = d.getByLabel(map ? "Motion progress" : "Source parameter", {
    exact: true,
  });
  const drawing = d.locator(
    map ? '[data-pane="image"] [data-member="0"]' : ".loom-correspondence",
  );
  const attribute = map ? "d" : "data-parameter";
  const before = await drawing.getAttribute(attribute);
  await slider.scrollIntoViewIfNeeded();
  const box = (await slider.boundingBox())!;
  await page.evaluate(() => {
    (window as any).delayLoomScrub = true;
  });
  await page.mouse.move(box.x + box.width * 0.05, box.y + box.height / 2);
  await page.mouse.down();
  let updatedDuringDrag = false;
  try {
    // These deliberate input intervals are shorter than the artificial
    // response delay. Work must finish and appear without a quiet period.
    for (let i = 0; i < 24; i++) {
      await page.mouse.move(
        box.x + box.width * (0.1 + i * 0.03),
        box.y + box.height / 2,
      );
      await page.waitForTimeout(30);
      updatedDuringDrag ||= (await drawing.getAttribute(attribute)) !== before;
    }
    expect(
      updatedDuringDrag,
      "the rendered geometry/marker must update before pointer release",
    ).toBe(true);
  } finally {
    await page.mouse.up();
  }
  await expect(d.locator(".loom-panes")).toHaveAttribute("aria-busy", "false");
  expect(Number(await slider.inputValue())).toBeGreaterThan(0.75);
}

// Reproduce a modal's fixed child reaching below iOS's shorter visual
// viewport. This controlled geometry does not establish actual-device QA.
export async function checkLoomPortraitPlayer(page: Page, title: string) {
  await page.addInitScript(() => {
    const viewport = Object.assign(new EventTarget(), {
      width: 390,
      height: 640,
      offsetTop: 24,
      offsetLeft: 0,
      scale: 1,
    });
    Object.defineProperty(window, "visualViewport", {
      configurable: true,
      value: viewport,
    });
    (window as any).loomViewport = viewport;
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await expect(page.locator(".plot-wrap")).toHaveAttribute(
    "aria-busy",
    "false",
  );
  await page.getByRole("button", { name: "Browse notebook examples" }).click();
  await page
    .locator(`[data-loom-example][data-example-title="${title}"]`)
    .click();
  const d = page.getByRole("dialog", { name: "The complex loom" });
  await expect(d.locator(".loom-panes")).toHaveAttribute("aria-busy", "false");
  const map = title === "Circles through infinity";
  const suffix = map ? "map motion" : "traversal";
  await d.getByLabel("Traversal duration", { exact: true }).fill("30");
  await d.getByRole("button", { name: `Play ${suffix}`, exact: true }).click();
  const bar = d.getByRole("group", { name: "Playback", exact: true });
  const slider = bar.getByRole("slider");
  await expect(slider).toHaveCount(1);
  await expect(bar.locator(".animation-values")).toContainText("t =");
  if (map) await expect(bar.locator(".animation-values")).toContainText("b =");
  const contained = async (top: number, bottom: number) => {
    const player = (await bar.boundingBox())!;
    expect(player.y).toBeGreaterThanOrEqual(top);
    expect(player.y + player.height).toBeLessThanOrEqual(bottom + 1);
    for (const control of [
      slider,
      bar.locator(".animation-values"),
      ...(await bar.getByRole("button").all()),
    ]) {
      if (!(await control.isVisible())) continue;
      const box = (await control.boundingBox())!;
      expect(box.y).toBeGreaterThanOrEqual(player.y);
      expect(box.y + box.height).toBeLessThanOrEqual(
        player.y + player.height + 1,
      );
    }
  };
  await contained(24, 664);
  await bar
    .getByRole("button", { name: `Pause ${suffix}`, exact: true })
    .click();
  await expect(
    bar.getByRole("button", { name: `Resume ${suffix}`, exact: true }),
  ).toBeVisible();
  await contained(24, 664);
  await slider.fill("0.5");
  await expect
    .poll(async () => Number(await slider.inputValue()))
    .toBeCloseTo(0.5, 6);
  await expect(d.locator(".loom-panes")).toHaveAttribute("aria-busy", "false");
  expect(Number(await slider.inputValue())).toBeCloseTo(0.5, 6);
  for (const end of [0, 1]) {
    await d.evaluate((el, end) => {
      el.scrollTop = end ? el.scrollHeight : 0;
    }, end);
    await contained(24, 664);
    if (end) expect(await d.evaluate((el) => el.scrollTop)).toBeGreaterThan(0);
  }
  await page.evaluate(() => {
    const viewport = (window as any).loomViewport;
    viewport.height = 720;
    viewport.offsetTop = 0;
    viewport.dispatchEvent(new Event("resize"));
  });
  await contained(0, 720);
  await bar
    .getByRole("button", { name: `Resume ${suffix}`, exact: true })
    .click();
  await expect(
    bar.getByRole("button", { name: `Pause ${suffix}`, exact: true }),
  ).toBeVisible();
  await bar
    .getByRole("button", { name: `Stop ${suffix}`, exact: true })
    .click();
  await expect(bar).not.toHaveClass(/active/);
  await expect(
    bar.getByRole("button", { name: `Play ${suffix}`, exact: true }),
  ).toBeVisible();
}
