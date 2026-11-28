import { expect, test, type Page } from "@playwright/test";

// #552 research: the three-body preview through the real worker, only with
// ?research=552. These are the research's targeted checks, not T2's suite.

const dialog = (page: Page) =>
  page.getByRole("dialog", { name: "Three bodies" });
const status = (page: Page) => dialog(page).getByRole("status");

async function open(page: Page) {
  await page.goto("/?research=552");
  await expect(dialog(page)).toBeVisible();
  await expect(status(page)).toContainText("reached the end", {
    timeout: 20000,
  });
}

// The worker's sampled history as the drawing shows it: each body's trail
// vertex count and its head position.
async function picture(page: Page) {
  return page.locator(".threebody-drawing").evaluate((svg) => ({
    trails: [...svg.querySelectorAll("path:not(.threebody-ghost)")].map(
      (p) => (p.getAttribute("d") ?? "").split(/[ML]/).length - 1,
    ),
    heads: [...svg.querySelectorAll("circle")].map(
      (c) => `${c.getAttribute("cx")},${c.getAttribute("cy")}`,
    ),
    triangle: svg.querySelectorAll("polygon").length,
    ghosts: svg.querySelectorAll("path.threebody-ghost").length,
    text: svg.querySelectorAll("text").length,
  }));
}

test("the preview appears only behind the research gate", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator(".plot, svg").first()).toBeVisible();
  await expect(dialog(page)).toHaveCount(0);
});

test("the figure-eight opens from the corpus through the worker", async ({
  page,
}) => {
  await open(page);
  const options = dialog(page).getByLabel("Configuration").locator("option");
  await expect(options).toHaveCount(7);
  const p = await picture(page);
  expect(p.heads).toHaveLength(3);
  expect(p.triangle).toBe(0);
  expect(p.text).toBe(0);
  // At t = 0 each trail is its first sample alone; the whole path is
  // drawn faintly behind it, and can be turned off.
  expect(p.trails).toEqual([1, 1, 1]);
  expect(p.ghosts).toBe(3);
  await dialog(page).getByLabel("The whole path, faintly").uncheck();
  expect((await picture(page)).ghosts).toBe(0);
  await expect(dialog(page)).toContainText("Periodicity.");
  await expect(dialog(page)).toContainText("Published lengths are divided");
});

test("seeking selects samples by physical time and never moves a button", async ({
  page,
}) => {
  await open(page);
  const play = dialog(page).locator(".threebody-playback button");
  const changes = await page.evaluate(() => {
    const log: string[] = [];
    (window as unknown as { log: string[] }).log = log;
    new MutationObserver((m) =>
      m.forEach((r) => log.push((r.target as Element).textContent ?? "")),
    ).observe(document.querySelector(".threebody-playback button")!, {
      attributes: true,
      attributeFilter: ["disabled"],
    });
    return log.length;
  });
  const slider = dialog(page).getByRole("slider");
  const box = (await slider.boundingBox())!;
  await page.mouse.move(box.x + 2, box.y + box.height / 2);
  await page.mouse.down();
  for (let i = 1; i <= 20; i++)
    await page.mouse.move(box.x + (box.width * i) / 20, box.y + box.height / 2);
  await page.mouse.up();
  expect(
    await page.evaluate(() => (window as unknown as { log: string[] }).log),
  ).toHaveLength(changes);
  await expect(play).toBeEnabled();
  await slider.fill(String(await slider.getAttribute("max")));
  // At the end, the trails hold every sample: duration × 200 + 1.
  const end = await picture(page);
  expect(end.trails[0]).toBeGreaterThan(6000);
  // A window keeps only the last time units.
  await dialog(page).getByLabel("Trail length in time units").selectOption("1");
  const windowed = await picture(page);
  expect(windowed.trails[0]).toBeLessThan(220);
  expect(windowed.trails[0]).toBeGreaterThan(190);
  await dialog(page).getByLabel("Connecting triangle").check();
  expect((await picture(page)).triangle).toBe(1);
});

test("playback advances the physical clock and stops at the end", async ({
  page,
}) => {
  await open(page);
  await dialog(page)
    .getByLabel("Speed (time units per second)")
    .selectOption("4");
  const before = await picture(page);
  await dialog(page).getByRole("button", { name: "Play" }).click();
  await expect(
    dialog(page).getByRole("button", { name: "Pause" }),
  ).toBeVisible();
  await page.waitForTimeout(500);
  const during = await picture(page);
  expect(during.heads).not.toEqual(before.heads);
  await expect(dialog(page).getByRole("button", { name: "Play" })).toBeVisible({
    timeout: 15000,
  });
  await expect(dialog(page).locator(".threebody-clock")).toContainText(
    /t = 32\.87\d* of 32\.87/,
  );
});

test("an encounter stops the history and draws nothing past it", async ({
  page,
}) => {
  await open(page);
  await dialog(page).getByLabel("Configuration").selectOption("head-on");
  await expect(status(page)).toContainText("stopped at a close encounter", {
    timeout: 20000,
  });
  await expect(status(page)).toContainText("bodies 1 and 2 came within 0.0001");
  const slider = dialog(page).getByRole("slider");
  await slider.fill(String(await slider.getAttribute("max")));
  const p = await picture(page);
  // The available samples, then the terminal state itself.
  expect(p.trails[0]).toBeLessThan(401);
});

test("a newer configuration replaces one still integrating", async ({
  page,
}) => {
  await open(page);
  const pick = dialog(page).getByLabel("Configuration");
  // Burrau's problem takes longest; the figure-eight, chosen after it, wins.
  await pick.selectOption("pythagorean");
  await pick.selectOption("lagrange-equal");
  await pick.selectOption("figure-eight");
  await expect(status(page)).toContainText("reached the end at t = 32.87", {
    timeout: 20000,
  });
  await page.waitForTimeout(1500);
  await expect(status(page)).toContainText("t = 32.87");
});

test("measure preparation in the worker", async ({ page }) => {
  await open(page);
  const pick = dialog(page).getByLabel("Configuration");
  const rows: string[] = [];
  for (const name of [
    "figure-eight",
    "lagrange-equal",
    "lagrange-routh",
    "hierarchical",
    "pythagorean",
    "broken-triangle",
    "head-on",
  ])
    for (const span of ["case", "100"]) {
      await pick.selectOption(name);
      await dialog(page)
        .getByLabel("Duration (time units, at most 100)")
        .selectOption(span);
      await expect(
        dialog(page).locator(".threebody-drawing"),
      ).not.toHaveAttribute("aria-busy", "true", { timeout: 30000 });
      const facts = await dialog(page).locator(".threebody-facts").innerText();
      rows.push(`${name} ${span}: ${facts.replace(/\n/g, " | ")}`);
    }
  console.log(rows.join("\n"));
});
