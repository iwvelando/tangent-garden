import { test, expect, type Page, type Locator } from "@playwright/test";
import { chooseNotebook } from "./helpers";

test.use({ hasTouch: true, viewport: { width: 390, height: 844 } });

type Point = [number, number];
// Real multi-touch through the DevTools protocol: every finger lands, moves
// in `steps` even steps from its start to its end, and lifts.
async function fingers(page: Page, from: Point[], to: Point[], steps = 8) {
  const cdp = await page.context().newCDPSession(page);
  const points = (t: number) =>
    from.map(([x, y], i) => ({
      x: x + (to[i][0] - x) * t,
      y: y + (to[i][1] - y) * t,
      id: i,
    }));
  await cdp.send("Input.dispatchTouchEvent", {
    type: "touchStart",
    touchPoints: points(0),
  });
  for (let k = 1; k <= steps; k++)
    await cdp.send("Input.dispatchTouchEvent", {
      type: "touchMove",
      touchPoints: points(k / steps),
    });
  await cdp.send("Input.dispatchTouchEvent", {
    type: "touchEnd",
    touchPoints: [],
  });
  await cdp.detach();
}
async function center(target: Locator): Promise<Point> {
  const box = (await target.boundingBox())!;
  return [box.x + box.width / 2, box.y + box.height / 2];
}
const plus = ([x, y]: Point, dx: number, dy = 0): Point => [x + dx, y + dy];

// The world point shown at a screen point of the 2D drawing.
async function world(page: Page, [sx, sy]: Point) {
  return page.locator("#artwork").evaluate(
    (svg, [sx, sy]) => {
      const r = svg.getBoundingClientRect();
      const ratio = Math.max(1000 / r.width, 760 / r.height);
      const scale = Number(svg.getAttribute("data-camera-scale"));
      const [cx, cy] = svg
        .getAttribute("data-camera-center")!
        .split(",")
        .map(Number);
      return {
        x: cx + ((sx - (r.left + r.width / 2)) * ratio) / scale,
        y: cy - ((sy - (r.top + r.height / 2)) * ratio) / scale,
        scale,
      };
    },
    [sx, sy],
  );
}

test("2D: pinch zooms about the fingers, two fingers pan, one finger pans", async ({
  page,
}) => {
  await page.goto("/");
  const art = page.locator("#artwork");
  await expect(art).toBeVisible();
  await page.getByRole("button", { name: "Adjust view", exact: true }).click();
  await art.scrollIntoViewIfNeeded();
  const c = await center(art);
  // An off-center pinch keeps the point between the fingers in place.
  const mid = plus(c, 60, 30);
  const before = await world(page, mid);
  await fingers(
    page,
    [plus(mid, -30), plus(mid, 30)],
    [plus(mid, -90), plus(mid, 90)],
  );
  const after = await world(page, mid);
  expect(after.scale / before.scale).toBeCloseTo(3, 1);
  expect(Math.abs(after.x - before.x) * after.scale).toBeLessThan(1.5);
  expect(Math.abs(after.y - before.y) * after.scale).toBeLessThan(1.5);
  // Moving both fingers together pans at the same scale.
  const centered = await art.getAttribute("data-camera-center");
  await fingers(
    page,
    [plus(c, -40), plus(c, 40)],
    [plus(c, 20, 50), plus(c, 100, 50)],
  );
  await expect(art).not.toHaveAttribute("data-camera-center", centered!);
  expect(Number(await art.getAttribute("data-camera-scale"))).toBeCloseTo(
    after.scale,
    6,
  );
  const panned = await art.getAttribute("data-camera-center");
  await fingers(page, [c], [plus(c, -50, -20)]);
  await expect(art).not.toHaveAttribute("data-camera-center", panned!);
});

test("4D: an off-center pinch keeps the point between the fingers in place", async ({
  page,
}) => {
  await page.goto("/");
  await expect(page.locator("#artwork")).toBeVisible();
  await chooseNotebook(page, "4d");
  const art = page.locator("#tesseract-artwork");
  await expect(art).toBeVisible();
  await page.getByRole("button", { name: "Adjust view", exact: true }).click();
  await art.scrollIntoViewIfNeeded();
  const view = async () =>
    JSON.parse((await art.locator("desc").textContent())!).view;
  await expect.poll(async () => !!(await view())).toBe(true);
  // The first vertex drawn, and a screen point, in page units of the
  // 1000 × 760 drawing.
  const vertex = async () => {
    const d = (await art
      .locator('path[data-guide="false"]')
      .first()
      .getAttribute("d"))!;
    const [x, y] = d.slice(1).split(/[L ]/)[0].split(",").map(Number);
    return { x, y };
  };
  const box = (await art.boundingBox())!,
    s = Math.min(box.width / 1000, box.height / 760);
  const c = await center(art);
  const mid = plus(c, 50, -40).map(Math.round) as Point;
  const at = {
    x: 500 + (mid[0] - c[0]) / s,
    y: 380 + (mid[1] - c[1]) / s,
  };
  const start = await view(),
    from = await vertex();
  await fingers(
    page,
    [plus(mid, -30), plus(mid, 30)],
    [plus(mid, -90), plus(mid, 90)],
  );
  await expect
    .poll(async () => (await view()).zoom)
    .toBeCloseTo(start.zoom * 3, 1);
  const k = (await view()).zoom / start.zoom,
    to = await vertex();
  expect(Math.abs(to.x - at.x - (from.x - at.x) * k)).toBeLessThan(1.5);
  expect(Math.abs(to.y - at.y - (from.y - at.y) * k)).toBeLessThan(1.5);
});

test("2D: gestures wait while an animation holds the camera", async ({
  page,
}) => {
  await page.goto("/");
  const art = page.locator("#artwork");
  await expect(art).toBeVisible();
  await page.getByRole("button", { name: "Adjust view", exact: true }).click();
  await page.getByRole("spinbutton", { name: "Duration (seconds)" }).fill("30");
  await page.getByRole("button", { name: "Play animation" }).click();
  await page.getByRole("button", { name: "Pause", exact: true }).click();
  await art.scrollIntoViewIfNeeded();
  const scale = await art.getAttribute("data-camera-scale");
  const c = await center(art);
  await fingers(page, [plus(c, -30), plus(c, 30)], [plus(c, -90), plus(c, 90)]);
  await expect(art).toHaveAttribute("data-camera-scale", scale!);
});

for (const dimension of ["3d", "4d"] as const)
  test(`${dimension.toUpperCase()}: pinch zooms, two fingers pan, one finger orbits`, async ({
    page,
  }) => {
    await page.goto("/");
    await expect(page.locator("#artwork")).toBeVisible();
    await chooseNotebook(page, dimension);
    const art = page.locator(
      dimension === "3d" ? "#spatial-artwork" : "#tesseract-artwork",
    );
    await expect(art).toBeVisible();
    const view = async () =>
      dimension === "3d"
        ? JSON.parse((await art.getAttribute("data-view"))!)
        : JSON.parse((await art.locator("desc").textContent())!).view;
    await expect.poll(async () => !!(await view())).toBe(true);
    await page
      .getByRole("button", { name: "Adjust view", exact: true })
      .click();
    await art.scrollIntoViewIfNeeded();
    const c = await center(art);
    const start = await view();
    await fingers(
      page,
      [plus(c, -30), plus(c, 30)],
      [plus(c, -60), plus(c, 60)],
    );
    await expect
      .poll(async () => (await view()).zoom)
      .toBeCloseTo(start.zoom * 2, 1);
    const zoomed = await view();
    await fingers(
      page,
      [plus(c, -40), plus(c, 40)],
      [plus(c, 0, 40), plus(c, 80, 40)],
    );
    await expect.poll(async () => (await view()).panX).not.toBe(zoomed.panX);
    const panned = await view();
    expect(panned.panY).not.toBe(zoomed.panY);
    expect(panned.yaw).toBe(zoomed.yaw);
    expect(panned.zoom).toBeCloseTo(zoomed.zoom, 9);
    await fingers(page, [c], [plus(c, 60)]);
    await expect.poll(async () => (await view()).yaw).not.toBe(panned.yaw);
    expect((await view()).zoom).toBeCloseTo(zoomed.zoom, 9);
  });
