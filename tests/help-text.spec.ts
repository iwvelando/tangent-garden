import { test, expect, type Page } from "@playwright/test";
import { chooseNotebook, choosePreset, exampleTitles } from "./helpers";

// Help opens on its essentials: one short line. Whatever more a reader may
// want waits behind Show more, so a narrow sidebar column never opens onto
// a page of text (AGENTS.md, Help text).
const briefWords = 30;

const words = (text: string) => text.trim().split(/\s+/).filter(Boolean).length;

// Reads every help in the sidebar, open or not, folded sections included,
// and returns each one's topic, essentials and more.
async function helps(page: Page) {
  return page.locator(".app:visible aside").evaluate((aside) =>
    Array.from(aside.querySelectorAll(".help-toggle"), (toggle) => {
      const help = document.getElementById(
        toggle.getAttribute("aria-controls")!,
      )!;
      const brief = help.querySelector(".hint-brief");
      let essentials = help.textContent ?? "";
      if (brief) {
        const copy = brief.cloneNode(true) as HTMLElement;
        copy.querySelector(".help-more")?.remove();
        essentials = copy.textContent ?? "";
      }
      return {
        topic: toggle.getAttribute("aria-label")!,
        essentials: essentials.trim(),
        more: help.querySelector(".hint-more")?.textContent?.trim() ?? null,
      };
    }),
  );
}

test("a tiered help opens on its essentials, and Show more reveals the rest", async ({
  page,
}) => {
  await page.goto("/");
  await expect(page.locator("#artwork")).toBeVisible();
  const toggle = page.getByRole("button", {
    name: "About Line weight",
    exact: true,
  });
  await toggle.click();
  const help = page.locator(`#${await toggle.getAttribute("aria-controls")}`);
  const brief = help.locator(".hint-brief");
  await expect(brief).toContainText("How wide lines are drawn");
  const more = help.getByRole("button", { name: "Show more" });
  const detail = help.locator(".hint-more");
  await expect(detail).toBeHidden();
  await expect(more).toHaveAttribute(
    "aria-controls",
    (await detail.getAttribute("id"))!,
  );
  await more.click();
  await expect(detail).toBeVisible();
  // The detail keeps the limits the engine enforces.
  await expect(detail).toContainText("one pixel");
  await expect(help.getByRole("button", { name: "Show less" })).toHaveAttribute(
    "aria-expanded",
    "true",
  );
  // The field's control is described by the whole help while it is open.
  const select = page.getByRole("combobox", { name: "Line weight" });
  await expect(select).toHaveAttribute(
    "aria-describedby",
    (await help.getAttribute("id"))!,
  );
  // Closing the help folds the detail away again, so it reopens on its
  // essentials.
  await toggle.click();
  await expect(help).toBeHidden();
  await toggle.click();
  await expect(detail).toBeHidden();
  await expect(help.getByRole("button", { name: "Show more" })).toBeVisible();
});

const notebooks: Record<string, (page: Page) => Promise<string[]>> = {
  "2D": async (page) => {
    await page.goto("/");
    await expect(page.locator("#artwork")).toBeVisible();
    return exampleTitles(page);
  },
  "3D": async (page) => {
    await page.goto("/");
    await chooseNotebook(page, "3d");
    return exampleTitles(page);
  },
  "4D": async (page) => {
    await page.goto("/");
    await chooseNotebook(page, "4d");
    return exampleTitles(page);
  },
};

for (const [notebook, titles] of Object.entries(notebooks))
  test(`every help in every ${notebook} example opens on a short essentials line`, async ({
    page,
  }) => {
    const labels = await titles(page);
    test.setTimeout(60_000 + 3_000 * labels.length);
    let checked = 0;
    for (const label of labels) {
      await choosePreset(page, { label });
      for (const { topic, essentials, more } of await helps(page)) {
        expect
          .soft(
            words(essentials),
            `${label} · ${topic} opens with ${words(essentials)} words: ${essentials}`,
          )
          .toBeLessThanOrEqual(briefWords);
        // A second tier has something to show.
        if (more !== null)
          expect.soft(words(more), `${label} · ${topic}`).toBeGreaterThan(0);
        checked++;
      }
    }
    // Guard against a sweep that silently finds nothing.
    expect(checked).toBeGreaterThan(labels.length);
  });
