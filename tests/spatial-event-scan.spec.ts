import { test, expect, type Page } from "@playwright/test";
import { choosePreset } from "./helpers";
import { engines, watchEngines } from "./engines";
import { wireStudy } from "./study-link-wire";

// Scan for changes (web/spatial/ScanPanel.tsx): an implicit study scanned
// along its level or shape parameter for changes in its mesh's pieces
// (engine3/scan.go). Expectations come from each field's analysis, written
// here: the tanglecube's g(t) = t⁴ − 5t² has critical values 0 and −25/4,
// so F = Σ g(xᵢ) has −75/4 (eight minima), −25/2 (twelve saddles of index
// 1), −25/4 (six of index 2) and 0 (its maximum).

const panel = (page: Page) => page.locator("details.scan-panel");
const status = (page: Page) =>
  panel(page).locator(".scan-report [role=status]");
const scanButton = (page: Page) =>
  panel(page).getByRole("button", { name: "Scan", exact: true });

async function open(page: Page, example: string) {
  await page.goto("/?study=3d");
  await choosePreset(page, { label: example });
  await expect(page.getByTestId("implicit-note")).not.toHaveText(
    "Meshing the level set…",
  );
  await panel(page).locator("summary").click();
}
async function scanned(page: Page, timeout = 90_000) {
  await scanButton(page).click();
  await expect(status(page)).toContainText("Scan complete", { timeout });
}
// The study as its link carries it.
async function linked(page: Page) {
  await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.getByRole("button", { name: "Copy link", exact: true }).click();
  await expect(page.getByText("Link copied", { exact: true })).toBeVisible();
  const href = await page.evaluate(() => navigator.clipboard.readText());
  await page.mouse.click(1, 1);
  return wireStudy(/#s=(.*)$/.exec(href)![1]);
}
const minus = (v: number) => String(v).replace("-", "−");

test("every implicit study offers a closed scan; other studies have none", async ({
  page,
}) => {
  await page.goto("/?study=3d");
  await expect(page.locator("#spatial-artwork")).toBeVisible();
  await expect(panel(page)).toHaveCount(0);
  await choosePreset(page, { label: "A sphere and its latitudes" });
  await expect(panel(page)).toHaveCount(1);
  await expect(panel(page)).not.toHaveAttribute("open");
  await expect(panel(page).locator("summary")).toHaveText("Scan for changes");
  // An example without a suggestion scans about its own level, c = 1,
  // by a quarter either side; F does not read a.
  await panel(page).locator("summary").click();
  await expect(
    panel(page).getByLabel("Scan from", { exact: true }),
  ).toHaveValue("0.75");
  await expect(panel(page).getByLabel("Scan to", { exact: true })).toHaveValue(
    "1.25",
  );
  await expect(
    panel(page).getByRole("option", { name: /Shape parameter a/ }),
  ).toBeDisabled();
});

test("a scan of the tanglecube leads each change with its exact critical value; a side drawn is the value meshed", async ({
  page,
}) => {
  test.setTimeout(150_000);
  await open(page, "The tanglecube's three events");
  const p = panel(page);
  await expect(p.getByLabel("Scan from", { exact: true })).toHaveValue("-20");
  await expect(p.getByLabel("Scan to", { exact: true })).toHaveValue("4");
  await scanned(page, 120_000);
  const items = p.locator(".scan-candidate");
  await expect(items).toHaveCount(4);
  const exact: [number, string, number][] = [
    [-75 / 4, "Index 0, a minimum", 8],
    [-12.5, "Index 1, a saddle", 12],
    [-6.25, "Index 2, a saddle", 6],
    [0, "Index 3, a maximum", 1],
  ];
  for (const [k, [value, index, points]] of exact.entries()) {
    const item = items.nth(k);
    await expect(item.locator(".scan-title b")).toHaveText(
      `Critical point at c = ${minus(value)}`,
    );
    await expect(item.locator(".scan-stability")).toHaveText(
      "On all three grids",
    );
    await expect(item.locator(".scan-lead")).toHaveText(
      `${index} · ${points} ${points > 1 ? "points" : "point"} · found numerically`,
    );
  }
  await expect(items.nth(0)).toContainText(
    "no surface → 8 closed pieces of χ 2",
  );
  await expect(items.nth(1)).toContainText(
    "8 closed pieces of χ 2 → 1 closed piece of χ −8",
  );
  // The note's second tier: how the grids saw it.
  const more = items.nth(1).getByRole("button", { name: "Show more" });
  await more.click();
  await expect(items.nth(1).locator(".scan-note")).toContainText(
    "Rechecked on 33 cells, the same change; 48 cells, the same change.",
  );
  // Close-up previews, two a candidate, once the scan is done.
  await expect(p.locator(".scan-image img")).toHaveCount(8, {
    timeout: 60_000,
  });
  await expect(p.locator(".scan-closeup")).toHaveCount(4);
  // A side is a button, its image included; choosing it draws the study
  // there, as typing the value would. The field holds the value meshed,
  // a short decimal with no floating-point tail.
  const after = items.nth(1).locator(".scan-side[data-side=after]");
  await after.locator("img").click();
  await expect(after).toHaveAttribute("aria-pressed", "true");
  const field = page.getByLabel("Level c", { exact: true });
  await expect(field).toHaveValue(/^-12\.\d{1,12}$/);
  const shown = Number(
    (await after.locator(".scan-side-label").textContent())!
      .replace(/^After · c\s=\s/, "")
      .replace("−", "-"),
  );
  expect(Math.abs(Number(await field.inputValue()) - shown)).toBeLessThan(1e-4);
  await expect(page.getByTestId("implicit-note")).toContainText(
    "one piece, closed, of genus 5",
  );
  // Changing the scanned value alone keeps the scan; nothing of it is in
  // the link, which carries the level chosen.
  await expect(items).toHaveCount(4);
  const study = await linked(page);
  expect(study.config.implicit.level).toBe(Number(await field.inputValue()));
  expect(JSON.stringify(study)).not.toMatch(/scan|candidate/i);
});

test("cancel closes the scan's worker at once and keeps what it found; the settings wait meanwhile", async ({
  page,
}) => {
  await watchEngines(page, 4);
  await open(page, "The tanglecube's three events");
  const p = panel(page);
  await p.getByLabel("Samples", { exact: true }).fill("65");
  await scanButton(page).click();
  await expect
    .poll(() => p.locator(".scan-track line.scan-tick").count(), {
      timeout: 30_000,
    })
    .toBeGreaterThan(0);
  // Every setting is disabled while the scan runs.
  for (const label of [
    "Scan along",
    "Scan from",
    "Scan to",
    "Samples",
    "Bisections",
    "Recheck on two other grids",
    "Look for critical points",
  ])
    await expect(p.getByLabel(label, { exact: true })).toBeDisabled();
  // The notebook's own engine keeps drawing while the scan runs in its
  // own worker: a typed level is drawn before the scan ends.
  const level = page.getByLabel("Level c", { exact: true });
  await level.fill("-10");
  await level.blur();
  await expect(page.getByTestId("implicit-note")).toContainText(
    "one piece, closed, of genus 5",
  );
  await expect(p.getByRole("button", { name: "Cancel scan" })).toBeVisible();
  // Past the drops' birth at −75/4, between the fourth and fifth samples:
  // the coarse pass has bracketed a change, which Cancel must keep.
  await expect
    .poll(() => p.locator(".scan-track line.scan-tick").count(), {
      timeout: 30_000,
    })
    .toBeGreaterThan(8);
  const before = (await engines(page)).length;
  const asked = Date.now();
  await p.getByRole("button", { name: "Cancel scan" }).click();
  await expect(status(page)).toContainText("Canceled");
  // Measured, not a timing claim: the worker closes synchronously.
  test.info().annotations.push({
    type: "cancel latency",
    description: `${Date.now() - asked} ms from click to Canceled`,
  });
  const log = await engines(page);
  const scan = log.findIndex((e) => e.sent["implicit-scan"]);
  expect(scan).toBeGreaterThanOrEqual(0);
  expect(log[scan].terminated).toBe(true);
  expect(log.length).toBe(before);
  await expect(scanButton(page)).toBeEnabled();
  await expect(p.getByLabel("Scan from", { exact: true })).toBeEnabled();
  // Zero-width ticks count as hidden: what the scan found is counted.
  expect(await p.locator(".scan-track line.scan-tick").count()).toBeGreaterThan(
    8,
  );
  // The changes bracketed so far are kept, unchecked; the scan does not
  // claim that every sample read alike.
  const kept = p.locator(".scan-candidate");
  await expect(kept.first().locator(".scan-title b")).toHaveText(
    /^Change near c\s=\s−1[89]/,
  );
  await expect(kept.first()).toContainText(
    "no surface → 8 closed pieces of χ 2",
  );
  await expect(kept.first().locator(".scan-stability")).toHaveText(
    "Not rechecked",
  );
  await expect(p).not.toContainText("No sample reads differently");
});

// F = r² in [−1.3, 1.3]³ has no critical point there: the box cuts the
// sphere at c = 1.69, 3.38 and 5.07, by its faces, edges and corners.
test("box events; a change to the study forgets its scan; errors name their fields and never hold the study", async ({
  page,
}) => {
  test.setTimeout(120_000);
  await open(page, "A sphere and its latitudes");
  const p = panel(page);
  const from = p.getByLabel("Scan from", { exact: true });
  const to = p.getByLabel("Scan to", { exact: true });
  await from.fill("0.5");
  await to.fill("5.5");
  await scanned(page);
  const items = p.locator(".scan-candidate");
  await expect(items).toHaveCount(3);
  for (const [k, at] of [1.69, 3.38, 5.07].entries()) {
    await expect(items.nth(k).locator(".scan-title b")).toContainText(
      "Box cut near c =",
    );
    const near = Number(
      (await items.nth(k).locator(".scan-title b").textContent())!
        .replace(/^Box cut near c\s=\s/, "")
        .replace("−", "-"),
    );
    expect(Math.abs(near - at)).toBeLessThan(0.1);
    await items.nth(k).getByRole("button", { name: "Show more" }).click();
    await expect(items.nth(k)).toContainText(
      "No critical point was found near it.",
    );
  }
  // Whole-surface previews: no critical point, no close-up.
  await expect(p.locator(".scan-image img")).toHaveCount(6, {
    timeout: 60_000,
  });
  await expect(p.locator(".scan-closeup")).toHaveCount(0);
  await page.getByLabel("F(x, y, z)", { exact: true }).fill("x^2+y^2+z^2+0");
  await expect(items).toHaveCount(0);
  await expect(p.locator(".scan-report")).toHaveCount(0);
  // A range that does not parse is the scan's error alone: the study
  // goes on drawing, and the error stays under its field.
  await from.fill("1+");
  const fromField = p.locator(".field", { hasText: "Scan from" });
  await expect(fromField.locator(".field-error")).toBeVisible();
  const levelField = page.getByLabel("Level c", { exact: true });
  await levelField.fill("1.2");
  await expect(page.getByTestId("implicit-note")).toContainText(
    "one piece, closed, of genus 0",
  );
  await expect(page.locator(".study-error")).toHaveCount(0);
  // The range must rise: the engine's error is under its second end.
  await from.fill("1");
  await expect(fromField.locator(".field-error")).toHaveCount(0);
  await to.fill("0.5");
  await scanButton(page).click();
  const toField = p.locator(".field", { hasText: "Scan to" });
  await expect(toField.locator(".field-error")).toHaveText(
    "the scan must end above where it starts",
  );
  // An empty count is named before any meshing.
  await to.fill("2");
  await p.getByLabel("Bisections", { exact: true }).fill("");
  await scanButton(page).click();
  await expect(
    p.locator(".field", { hasText: "Bisections" }).locator(".field-error"),
  ).toHaveText("Bisections must be a whole number.");
  // A study the engine refuses is the study's error, beside Scan, not a
  // range field's.
  await p.getByLabel("Bisections", { exact: true }).fill("3");
  await page.getByLabel("F(x, y, z)", { exact: true }).fill("x^2+");
  await scanButton(page).click();
  await expect(p.locator(".scan-actions .field-error")).toContainText(
    "F(x, y, z)",
  );
  await expect(p.locator(".field .field-error")).toHaveCount(0);
});

// Two drops meeting: F = (r² + a²)² − 4a²x² at c = 0.9, whose origin has
// F = a⁴. One sphere while a⁴ < 0.9, two drops once a⁴ > 0.9: the event is
// at a = 0.9^¼ = 0.974004 (six digits).
test("the shape parameter is scanned where F reads it", async ({ page }) => {
  test.setTimeout(120_000);
  await open(page, "Two drops meeting");
  const p = panel(page);
  await expect(p.getByLabel("Scan along", { exact: true })).toHaveValue("a");
  await scanned(page);
  const items = p.locator(".scan-candidate");
  await expect(items).toHaveCount(1);
  await expect(items.first().locator(".scan-title b")).toHaveText(
    "Critical point at a = 0.974004",
  );
  await expect(items.first()).toContainText(
    "1 closed piece of χ 2 → 2 closed pieces of χ 2",
  );
  await expect(items.first().locator(".scan-stability")).toHaveText(
    "On all three grids",
  );
});

test("a pole leaves every sample unresolved and claims no change", async ({
  page,
}) => {
  test.setTimeout(90_000);
  await open(page, "A sphere and its latitudes");
  await page
    .getByLabel("F(x, y, z)", { exact: true })
    .fill("1/(x^2+y^2+z^2-1)");
  await expect(page.getByTestId("implicit-note")).not.toHaveText(
    "Meshing the level set…",
  );
  await scanned(page);
  await expect(panel(page).locator(".scan-candidate")).toHaveCount(0);
  await expect(panel(page)).toContainText("17 samples left out");
});

// In A double torus's thin box the face cut near c = 0.0225 reads as a
// cascade of unstable box changes, which merge; the holes closing at
// c = 1/16 keep their own critical point.
test("unstable box changes without a critical point merge into one interval", async ({
  page,
}) => {
  test.setTimeout(150_000);
  await open(page, "A double torus");
  await scanned(page, 120_000);
  const items = panel(page).locator(".scan-candidate");
  await expect(items.first().locator(".scan-title b")).toHaveText(
    /^\d+ box cuts near c\s=\s0\.023\d*$/,
  );
  await expect(items.first().locator(".scan-stability")).toHaveText(
    "Not the same on every grid",
  );
  await expect(items.first()).toContainText(
    "1 closed piece of χ −2 → 3 cut pieces of χ 0",
  );
  await expect(
    items.filter({ hasText: "Critical point at c = 0.0625" }),
  ).toHaveCount(1);
});

test("on a phone, choosing a side shows the drawing, and Controls returns to the scan", async ({
  page,
}) => {
  test.setTimeout(90_000);
  await page.setViewportSize({ width: 390, height: 844 });
  await open(page, "Two drops become one");
  await scanned(page);
  const before = panel(page).locator(".scan-side[data-side=before]");
  await expect(before.locator("img")).toBeVisible({ timeout: 30_000 });
  await before.scrollIntoViewIfNeeded();
  await before.click();
  await expect(before).toHaveAttribute("aria-pressed", "true");
  // The drawing is in view, under the notebook's navigation.
  await expect
    .poll(async () => (await page.locator("article").boundingBox())!.y)
    .toBeLessThan(80);
  await page
    .getByRole("navigation", { name: "Notebook sections" })
    .getByRole("button", { name: "Controls" })
    .click();
  await expect(before).toBeInViewport();
});
