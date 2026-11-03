import { test, expect, type Page } from "@playwright/test";

// Research preview for #322: the curve-shortening lab's presentation rules,
// worked by hand, and its production path (worker, retained film, SVG
// drawing, seek, playback and still export) in the browser. Not a product
// study; see the issue for the solver evidence.

test("contour families end where the film ends and space by time or radius", async () => {
  const { familyTimes } = await import("../web/shorten/model");
  const end = 0.49;
  const even = familyTimes(end, 4, "time");
  expect(even).toEqual(
    [0, 0.1225, 0.245, 0.3675].map((t) => expect.closeTo(t, 15)),
  );
  // Equal radius: t_j = end·(1 − (1 − j/K)²), so a circle ending at its
  // extinction time has radii stepping evenly.
  const radius = familyTimes(0.5, 4, "radius");
  expect(radius.map((t) => Math.sqrt(1 - 2 * t))).toEqual(
    [1, 0.75, 0.5, 0.25].map((r) => expect.closeTo(r, 12)),
  );
  for (const times of [even, radius])
    for (let i = 1; i < times.length; i++)
      expect(times[i]).toBeGreaterThan(times[i - 1]);
});

test("pacing maps progress to physical time within the film, ends exact", async () => {
  const { timeAt } = await import("../web/shorten/model");
  for (const pacing of ["time", "radius"] as const) {
    expect(timeAt(0, 0.49, pacing)).toBe(0);
    expect(timeAt(1, 0.49, pacing)).toBe(0.49);
    // Progress outside [0, 1] never leaves the film.
    expect(timeAt(-0.1, 0.49, pacing)).toBe(0);
    expect(timeAt(1.1, 0.49, pacing)).toBe(0.49);
  }
  expect(timeAt(0.5, 0.5, "time")).toBe(0.25);
  expect(timeAt(0.5, 0.5, "radius")).toBeCloseTo(0.375, 15);
});

test("normalization rescales a measured loop about its centroid to the starting area", async () => {
  const { normalized } = await import("../web/shorten/model");
  const square = {
    x: [1, 3, 3, 1],
    y: [1, 1, 3, 3],
    area: 4,
    centerX: 2,
    centerY: 2,
  };
  const n = normalized(square, 16);
  // Scale √(16/4) = 2 about (2, 2), placed at the origin.
  expect(n.x).toEqual([-2, 2, 2, -2]);
  expect(n.y).toEqual([-2, -2, 2, 2]);
  expect(n.scale).toBe(2);
  expect(square.x).toEqual([1, 3, 3, 1]);
});

async function openLab(page: Page) {
  await page.goto("./?lab=curve-shortening");
  const lab = page.getByRole("dialog", { name: /flower remembering a circle/ });
  await expect(lab).toBeVisible();
  await expect(
    lab.locator(".shorten-view svg path[data-role=family]"),
  ).toHaveCount(12);
  return lab;
}

test("the lab draws a finite physical nest and seeks without history", async ({
  page,
}) => {
  const lab = await openLab(page);
  const view = lab.locator(".shorten-view svg");
  // Geometry only: no text in the drawing.
  await expect(view.locator("text")).toHaveCount(0);
  const current = view.locator("path[data-role=current]");
  const slider = lab.getByRole("slider", { name: "Animation progress" });
  const seek = async (p: number) => {
    await slider.fill(String(p));
    await expect(lab.locator(".shorten-view")).toHaveAttribute(
      "data-progress",
      String(p),
    );
    await expect(lab.locator(".shorten-view")).not.toHaveAttribute(
      "data-busy",
      "",
    );
    return current.getAttribute("d");
  };
  const first = await seek(0.5);
  await seek(0.9);
  await seek(0.1);
  expect(await seek(0.5)).toBe(first);
  // The readout states physical time and the area law beside the drawing.
  await expect(lab.locator(".shorten-readout")).toContainText("t =");
  await expect(lab.locator(".shorten-readout")).toContainText("A₀ − 2πt");
});

test("playback pauses and stops, and an edit ends it", async ({ page }) => {
  const lab = await openLab(page);
  const play = lab.getByRole("button", { name: /Play motion|Resume motion/ });
  await play.click();
  const pause = lab.getByRole("button", { name: "Pause motion" });
  await expect(pause).toBeVisible();
  await page.waitForTimeout(400);
  await pause.click();
  const view = lab.locator(".shorten-view");
  const held = await view.getAttribute("data-progress");
  expect(Number(held)).toBeGreaterThan(0);
  await page.waitForTimeout(300);
  expect(await view.getAttribute("data-progress")).toBe(held);
  await lab.getByRole("button", { name: "Resume motion" }).click();
  await lab.getByLabel("Nodes").selectOption("128");
  await expect(lab.getByRole("button", { name: "Play motion" })).toBeVisible();
  await expect(view).toHaveAttribute("data-progress", "0");
  await expect(
    lab.locator(".shorten-view svg path[data-role=family]"),
  ).toHaveCount(12);
});

test("the normalized view is declared and the still exports geometry only", async ({
  page,
}) => {
  const lab = await openLab(page);
  await lab.getByLabel("View").selectOption("normalized");
  await expect(lab.locator(".shorten-key")).toContainText("Normalized");
  const download = page.waitForEvent("download");
  await lab.getByRole("button", { name: /Export image/ }).click();
  await page.getByRole("menuitem", { name: /SVG/ }).click();
  const file = await download;
  const text = await (await file.createReadStream()).toArray();
  const svg = Buffer.concat(text).toString("utf8");
  expect(svg).toContain("<path");
  expect(svg).not.toMatch(/<text/);
  expect(svg).toContain("curve-shortening");
});
