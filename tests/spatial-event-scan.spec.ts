import { test, expect, type Page } from "@playwright/test";
import { choosePreset, examplesButton } from "./helpers";
import { engines, watchEngines } from "./engines";

// Issue #406's research preview (web/spatial/ScanPanel.tsx): the scan of
// an implicit study for changes in its mesh's pieces, behind ?research=406.
// The tanglecube's critical levels come from its analysis
// (docs/mathematics.md, Curated events), written here: g(t) = t⁴ − 5t² has
// critical values 0 and −25/4, so F = Σ g(xᵢ) has −75/4, −25/2, −25/4, 0.

const panel = (page: Page) =>
  page.locator("details.scan-panel", { hasText: "Scan for changes" });
const status = (page: Page) =>
  panel(page).locator(".scan-report [role=status]");

async function open(page: Page, example: string, research = true) {
  await page.goto(`/?study=3d${research ? "&research=406" : ""}`);
  await choosePreset(page, { label: example });
  await expect(page.getByTestId("implicit-note")).not.toHaveText(
    "Meshing the level set…",
  );
}

test("without the research flag nothing of the scan appears", async ({
  page,
}) => {
  await open(page, "The tanglecube's three events", false);
  await expect(page.getByText("Scan for changes (research)")).toHaveCount(0);
  await examplesButton(page).click();
  const gallery = page.getByRole("dialog", { name: "Notebook examples" });
  await expect(
    gallery.locator('[data-example-title^="Research:"]'),
  ).toHaveCount(0);
});

test("a scan of the tanglecube finds its four events, each with its critical value", async ({
  page,
}) => {
  test.setTimeout(120_000);
  await open(page, "The tanglecube's three events");
  const p = panel(page);
  await expect(p.getByLabel("Scan from", { exact: true })).toHaveValue("-20");
  await expect(p.getByLabel("Scan to", { exact: true })).toHaveValue("4");
  await p.getByRole("button", { name: "Scan", exact: true }).click();
  await expect(status(page)).toContainText("Scan complete", {
    timeout: 90_000,
  });
  const items = p.locator(".scan-candidate");
  await expect(items).toHaveCount(4);
  const exact = [
    [-75 / 4, 0],
    [-12.5, 1],
    [-6.25, 2],
    [0, 3],
  ];
  for (const [k, [value, index]] of exact.entries()) {
    const item = items.nth(k);
    await expect(item.locator(".scan-title")).toContainText("Change near c =");
    await expect(item.locator(".scan-title")).toContainText(
      "Found on all three grids",
    );
    await expect(item).toContainText(
      `at c = ${String(value).replace("-", "−")}, index ${index}`,
    );
  }
  await expect(items.nth(0)).toContainText(
    "no surface → 8 closed pieces of χ 2",
  );
  await expect(items.nth(1)).toContainText(
    "8 closed pieces of χ 2 → 1 closed piece of χ −8",
  );
  // Previews: two per candidate, drawn once the scan is done.
  await expect(p.locator(".scan-sides img")).toHaveCount(8, {
    timeout: 60_000,
  });
  // After draws that side at full quality, as typing its level would.
  const after = items.nth(1).getByRole("button", { name: /^After: c = / });
  const label = (await after.textContent())!;
  const shown = Number(label.replace(/^After: c = /, "").replace("−", "-"));
  await after.click();
  await expect(after).toHaveAttribute("aria-pressed", "true");
  // The field holds the exact value meshed; the button shows it to six
  // significant digits.
  const field = page.getByLabel("Level c", { exact: true });
  await expect
    .poll(async () => Math.abs(Number(await field.inputValue()) - shown))
    .toBeLessThan(1e-4);
  await expect(page.getByTestId("implicit-note")).toContainText(
    "one piece, closed, of genus 5",
  );
  // The scan belongs to the study; changing the level alone keeps it.
  await expect(items).toHaveCount(4);
});

test("cancel closes the scan's worker at once and keeps what it found", async ({
  page,
}) => {
  await watchEngines(page, 4);
  await open(page, "The tanglecube's three events");
  const p = panel(page);
  await p.getByLabel("Samples", { exact: true }).fill("65");
  await p.getByRole("button", { name: "Scan", exact: true }).click();
  await expect
    .poll(() => p.locator(".scan-track line.scan-tick").count(), {
      timeout: 30_000,
    })
    .toBeGreaterThan(0);
  // The notebook's own engine keeps drawing while the scan runs in its
  // own worker: a typed level is drawn before the scan ends.
  const level = page.getByLabel("Level c", { exact: true });
  await level.fill("-10");
  await level.blur();
  await expect(page.getByTestId("implicit-note")).toContainText(
    "one piece, closed, of genus 5",
  );
  await expect(p.getByRole("button", { name: "Cancel scan" })).toBeVisible();
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
  await expect(
    p.getByRole("button", { name: "Scan", exact: true }),
  ).toBeEnabled();
});

test("a change to the study forgets its scan; an error names its field", async ({
  page,
}) => {
  test.setTimeout(90_000);
  await open(page, "Research: a sphere grows through its box");
  const p = panel(page);
  await p.getByRole("button", { name: "Scan", exact: true }).click();
  await expect(status(page)).toContainText("Scan complete", {
    timeout: 60_000,
  });
  const items = p.locator(".scan-candidate");
  await expect(items).toHaveCount(3);
  for (let k = 0; k < 3; k++)
    await expect(items.nth(k).locator(".scan-title")).toContainText(
      "Box cut near c =",
    );
  await page.getByLabel("F(x, y, z)", { exact: true }).fill("x^2+y^2+z^2+0");
  await expect(items).toHaveCount(0);
  // The range must rise: the error is under its second end.
  await p.getByLabel("Scan to", { exact: true }).fill("0.5");
  await p.getByLabel("Scan to", { exact: true }).blur();
  await p.getByRole("button", { name: "Scan", exact: true }).click();
  const to = p.locator(".field", { hasText: "Scan to" });
  await expect(to.locator(".field-error")).toHaveText(
    "the scan must end above where it starts",
  );
});

test("the shape parameter is scanned only where F reads it", async ({
  page,
}) => {
  test.setTimeout(90_000);
  await open(page, "Research: two drops parted by a");
  const p = panel(page);
  await expect(p.getByLabel("Scan along", { exact: true })).toHaveValue("a");
  await p.getByRole("button", { name: "Scan", exact: true }).click();
  await expect(status(page)).toContainText("Scan complete", {
    timeout: 60_000,
  });
  const items = p.locator(".scan-candidate");
  await expect(items).toHaveCount(1);
  await expect(items.first()).toContainText(
    "1 closed piece of χ 2 → 2 closed pieces of χ 2",
  );
  await expect(items.first()).toContainText("at a = 1, index 1");
  await open(page, "Research: a sphere grows through its box");
  await expect(
    panel(page).getByRole("option", { name: /Shape parameter a/ }),
  ).toBeDisabled();
});

test("a pole leaves every sample unresolved and claims no change", async ({
  page,
}) => {
  await open(page, "Research: a pole");
  const p = panel(page);
  await p.getByRole("button", { name: "Scan", exact: true }).click();
  await expect(status(page)).toContainText("Scan complete", {
    timeout: 60_000,
  });
  await expect(p.locator(".scan-candidate")).toHaveCount(0);
  await expect(p).toContainText("17 samples left out");
});
