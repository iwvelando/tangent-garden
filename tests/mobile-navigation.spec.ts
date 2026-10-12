import { test, expect, type Page } from "@playwright/test";
import { choosePreset } from "./helpers";

test.use({ hasTouch: true });

for (const [path, fieldName, value, drawing, preset] of [
  ["/", "y(t)", "4*sin(t)", "#artwork", null],
  ["/?study=3d", "Tangent reach L", "3", "#spatial-artwork", null],
  ["/?study=4d", "xw angle", "0.7", "#tesseract-artwork", null],
  ["/?study=4d", "", "", "#tesseract-artwork", "The missing middle"],
] as const) {
  test(`mobile swipes scroll until Adjust view is enabled in ${path} ${preset ?? ""}`, async ({
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(path);
    if (preset) {
      await choosePreset(page, { label: preset });
      await page.getByRole("button", { name: "Drawing", exact: true }).click();
    }
    const art = page.locator(drawing);
    await expect(art).toBeVisible();
    await expect(
      page.locator(path === "/?study=3d" ? ".spatial-stage" : ".plot-wrap"),
    ).toHaveAttribute("aria-busy", "false");
    const geometry = () =>
      art.evaluate((e) =>
        e.tagName === "CANVAS" ? e.getAttribute("data-view") : e.innerHTML,
      );
    const initial = await geometry();
    const cdp = await page.context().newCDPSession(page);
    const swipe = async () => {
      const box = (await art.boundingBox())!;
      const x = box.x + box.width / 2;
      const y = Math.min(650, box.y + box.height / 2);
      await cdp.send("Input.dispatchTouchEvent", {
        type: "touchStart",
        touchPoints: [{ x, y }],
      });
      for (let dy = 10; dy <= 100; dy += 10)
        await cdp.send("Input.dispatchTouchEvent", {
          type: "touchMove",
          touchPoints: [{ x, y: y - dy }],
        });
      // Lift after a brief hold so inertial page scrolling from the first
      // swipe cannot spill into the next interaction.
      await page.waitForTimeout(120);
      await cdp.send("Input.dispatchTouchEvent", {
        type: "touchEnd",
        touchPoints: [],
      });
    };
    const scroll = await page.evaluate(() => scrollY);
    await swipe();
    await expect
      .poll(() => page.evaluate(() => scrollY))
      .toBeGreaterThan(scroll + 30);
    expect(await geometry()).toBe(initial);
    const nav = page.getByRole("navigation", { name: "Notebook sections" });
    await nav.getByRole("button", { name: "Drawing", exact: true }).click();
    await nav.getByRole("button", { name: "Adjust view", exact: true }).click();
    const adjustedScroll = await page.evaluate(() => scrollY);
    await swipe();
    await expect.poll(geometry).not.toBe(initial);
    expect(await page.evaluate(() => scrollY)).toBe(adjustedScroll);
    const adjusted = await geometry();
    await nav
      .getByRole("button", { name: "Done adjusting view", exact: true })
      .click();
    await swipe();
    expect(await geometry()).toBe(adjusted);
    await expect
      .poll(() => page.evaluate(() => scrollY))
      .toBeGreaterThan(adjustedScroll + 30);
    // Leaving the drawing also exits adjustment mode.
    await nav.getByRole("button", { name: "Adjust view", exact: true }).click();
    await nav.getByRole("button", { name: "Controls", exact: true }).click();
    await expect(
      nav.getByRole("button", { name: "Adjust view", exact: true }),
    ).toHaveAttribute("aria-pressed", "false");
  });

  if (preset) continue;
  test(`mobile editing returns to the drawing and the same control in ${path}`, async ({
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(path);
    const nav = page.getByRole("navigation", { name: "Notebook sections" });
    const controls = nav.getByRole("button", { name: "Controls", exact: true });
    const picture = nav.getByRole("button", { name: "Drawing", exact: true });
    await expect(nav).toBeInViewport();
    await controls.click();
    const field = page.getByRole("textbox", { name: fieldName, exact: true });
    await field.fill(value);
    await field.press("Tab");
    await field.evaluate((e) => e.scrollIntoView({ block: "center" }));
    expect((await page.locator("aside").boundingBox())!.y).toBeLessThan(0);
    const before = (await field.boundingBox())!.y;
    await expect(nav).toBeInViewport();
    await picture.click();
    await expect(page.locator(drawing)).toBeInViewport({ ratio: 1 });
    expect(
      (await page.locator(drawing).boundingBox())!.y,
    ).toBeGreaterThanOrEqual((await nav.boundingBox())!.height);
    await expect(picture).toHaveAttribute("aria-current", "location");
    await controls.click();
    await expect(field).toHaveValue(value);
    await expect(field).toBeInViewport();
    expect(Math.abs((await field.boundingBox())!.y - before)).toBeLessThan(2);
    await expect(controls).toHaveAttribute("aria-current", "location");
    // A second round trip must not replace the remembered position with the
    // top of the controls, or reset an edited study.
    await picture.click();
    await controls.click();
    expect(Math.abs((await field.boundingBox())!.y - before)).toBeLessThan(2);
    await expect(field).toHaveValue(value);

    // Playback's automatic jump must also leave the drawing below the
    // navigation, with its own controls still docked at the bottom.
    await page
      .getByRole("button", { name: "Play animation", exact: true })
      .click();
    await expect(
      page.getByRole("button", { name: "Pause", exact: true }),
    ).toBeVisible();
    expect(
      (await page.locator(drawing).boundingBox())!.y,
    ).toBeGreaterThanOrEqual((await nav.boundingBox())!.height);
    await page.getByRole("button", { name: "Pause", exact: true }).click();
  });
}

test("desktop keeps its independent sidebar without mobile navigation", async ({
  page,
}) => {
  await page.goto("/");
  await expect(
    page.getByRole("navigation", { name: "Notebook sections" }),
  ).toBeHidden();
  const drawing = page.locator(".plot-wrap");
  const before = await drawing.boundingBox();
  await page
    .getByRole("button", { name: "Play animation", exact: true })
    .scrollIntoViewIfNeeded();
  expect(await drawing.boundingBox()).toEqual(before);
});

test("the drawing shortcut fits a short phone screen in every notebook", async ({
  page,
}) => {
  await page.setViewportSize({ width: 320, height: 568 });
  for (const path of ["/", "/?study=3d", "/?study=4d"]) {
    await page.goto(path);
    await expect(
      page.locator(path === "/?study=3d" ? ".spatial-stage" : ".plot-wrap"),
    ).toHaveAttribute("aria-busy", "false");
    await page.getByRole("button", { name: "Drawing", exact: true }).click();
    await expect(page.locator(".plot-wrap")).toBeInViewport({ ratio: 1 });
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth),
    ).toBeLessThanOrEqual(320);
  }
});

// iOS opens its keyboard over the page without shrinking the layout viewport:
// it shortens the visual viewport and may pan it down inside the layout one,
// and sometimes leaves it panned after the keyboard closes. Desktop engines
// never do this, so stand in a scripted visual viewport the page reads.
async function scriptedKeyboard(page: Page) {
  await page.addInitScript(() => {
    const viewport = Object.assign(new EventTarget(), {
      offsetLeft: 0,
      offsetTop: 0,
      pageLeft: 0,
      pageTop: 0,
      scale: 1,
      width: innerWidth,
      height: innerHeight,
    });
    Object.defineProperty(window, "visualViewport", {
      configurable: true,
      get: () => viewport,
    });
    (window as unknown as { keyboard: unknown }).keyboard = (
      offsetTop: number,
      height: number,
    ) => {
      viewport.offsetTop = offsetTop;
      viewport.pageTop = scrollY + offsetTop;
      viewport.height = height;
      viewport.dispatchEvent(new Event("resize"));
      viewport.dispatchEvent(new Event("scroll"));
    };
  });
  return (offsetTop: number, height: number) =>
    page.evaluate(
      ([top, h]) =>
        (
          window as unknown as { keyboard: (a: number, b: number) => void }
        ).keyboard(top, h),
      [offsetTop, height],
    );
}

test("mobile navigation stays at the top of a visual viewport the keyboard panned", async ({
  page,
}) => {
  const keyboard = await scriptedKeyboard(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  const nav = page.getByRole("navigation", { name: "Notebook sections" });
  await nav.getByRole("button", { name: "Controls", exact: true }).click();
  const samples = page.getByRole("spinbutton", {
    name: "Numerical samples",
    exact: true,
  });
  await samples.scrollIntoViewIfNeeded();
  const top = async () => (await nav.boundingBox())!.y;
  expect(await top()).toBe(0);
  // Keyboard open: the screen now begins 260px down the layout viewport.
  await samples.focus();
  await keyboard(260, 420);
  await expect.poll(top).toBe(260);
  // Closed, but left panned, as iOS sometimes does until the next scroll.
  await samples.blur();
  await keyboard(110, 844);
  await expect.poll(top).toBe(110);
  // The reader still knows where they are.
  const controls = nav.getByRole("button", { name: "Controls", exact: true });
  await expect(controls).toHaveAttribute("aria-current", "location");
  // A round trip to the drawing returns to the same place on the screen.
  const before = (await samples.boundingBox())!.y;
  await nav.getByRole("button", { name: "Drawing", exact: true }).click();
  const bar = (await nav.boundingBox())!;
  const frame = (await page.locator(".plot-wrap").boundingBox())!;
  expect(frame.y).toBeGreaterThanOrEqual(bar.y + bar.height);
  expect(frame.y + frame.height).toBeLessThanOrEqual(110 + 844);
  await controls.click();
  expect((await samples.boundingBox())!.y).toBeCloseTo(before, 0);
  // Controls that begin under the panned navigation are the current section.
  await page
    .locator("aside")
    .evaluate((e) => scrollBy(0, e.getBoundingClientRect().top - 150));
  await expect(controls).toHaveAttribute("aria-current", "location");
  await keyboard(0, 844);
  await expect.poll(top).toBe(0);
  // With no field edited since, an offset is the page bouncing past its end,
  // which the navigation rides with the page as before.
  await keyboard(140, 844);
  await page.waitForTimeout(200);
  expect(await top()).toBe(0);
  await keyboard(0, 844);
  // Pinch zoom keeps the browser's own behavior, even while editing.
  await samples.focus();
  await page.evaluate(() => {
    const viewport = window.visualViewport as unknown as { scale: number };
    viewport.scale = 2;
  });
  await keyboard(200, 422);
  await expect.poll(top).toBe(0);
});

for (const [name, offsetTop, fieldTop] of [
  // The keyboard covers a field near the bottom of the screen.
  ["below the keyboard", 0, 700],
  // The visual viewport panned down past a field, under the navigation.
  ["above a panned screen", 300, 330],
] as const)
  test(`a field focused ${name} is brought into the space left for it`, async ({
    page,
  }) => {
    const keyboard = await scriptedKeyboard(page);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/");
    const nav = page.getByRole("navigation", { name: "Notebook sections" });
    const field = page.getByRole("textbox", { name: "x(t)", exact: true });
    await expect(field).toBeVisible();
    await field.evaluate((e, y) => {
      scrollBy(0, e.getBoundingClientRect().top - y);
    }, fieldTop);
    expect((await field.boundingBox())!.y).toBeCloseTo(fieldTop, 0);
    await field.focus();
    await keyboard(offsetTop, 420);
    const visible = async () => {
      const box = (await field.boundingBox())!;
      const bar = (await nav.boundingBox())!;
      return (
        box.y >= bar.y + bar.height && box.y + box.height <= offsetTop + 420
      );
    };
    await expect.poll(visible).toBe(true);
    // The label stays with the field it names.
    const label = (await page
      .locator("label", { hasText: /^x\(t\)$/ })
      .boundingBox())!;
    const bar = (await nav.boundingBox())!;
    expect(label.y).toBeGreaterThanOrEqual(bar.y + bar.height);
    // Later viewport changes, as the reader scrolls on, do not pull it back.
    await page.waitForTimeout(1200);
    await page.evaluate(() => scrollBy(0, 400));
    const moved = (await field.boundingBox())!.y;
    await keyboard(offsetTop, 430);
    await page.waitForTimeout(300);
    expect((await field.boundingBox())!.y).toBe(moved);
  });

test("the browser's own reveal of a focused field leaves room for the navigation", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  // A notebook hidden by switching away keeps its bar mounted but empty;
  // returning must still leave room for the visible one.
  await page.getByRole("radio", { name: "3D studies" }).click();
  await expect(page.locator(".spatial-stage")).toBeVisible();
  await page.getByRole("radio", { name: "2D studies" }).click();
  const nav = page.getByRole("navigation", { name: "Notebook sections" });
  await nav.getByRole("button", { name: "Controls", exact: true }).click();
  const field = page.getByRole("textbox", { name: "x(t)", exact: true });
  const bar = (await nav.boundingBox())!;
  // Tuck the field under the navigation, then focus it as a tap would. The
  // browser's scroll, before any correction of ours, must clear the bar and
  // show the label, so the field moves once rather than twice.
  const label = await field.evaluate((e, y) => {
    scrollBy(0, e.getBoundingClientRect().top - y);
    e.focus();
    return e.closest(".field")!.querySelector("label")!.getBoundingClientRect()
      .top;
  }, bar.height / 2);
  expect(label).toBeGreaterThanOrEqual(bar.y + bar.height);
});
