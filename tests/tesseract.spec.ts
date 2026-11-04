import { chooseNotebook } from "./helpers";
import { test, expect, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";
import {
  choosePreset,
  exportImage,
  openShapeAnimation,
  openShapeExport,
} from "./helpers";
import { probe, decodeVideo } from "./video";
const stage = (p: Page) => p.locator(".tesseract-stage");
const settle = (p: Page) =>
  expect(stage(p)).toHaveAttribute("aria-busy", "false");
const definition = async (p: Page) =>
  JSON.parse((await stage(p).getAttribute("data-config"))!);
async function pauseMotion(page: Page) {
  await openShapeAnimation(page);
  await page
    .getByRole("button", { name: "Play animation", exact: true })
    .click();
  await page.getByRole("button", { name: "Pause", exact: true }).click();
  await settle(page);
}
async function ready(p: Page) {
  await p.goto("/?study=4d");
  await settle(p);
  await expect(p.locator("#tesseract-artwork")).toBeVisible();
}

test("all constructions, empty and tangent sections, finite curves, and exact motion endpoints", async ({
  page,
}) => {
  await ready(page);
  await expect(
    page.locator('#tesseract-artwork path[data-guide="false"]'),
  ).toHaveCount(32);
  await choosePreset(page, { label: "Spherical loom" });
  await settle(page);
  expect(
    await page.locator('#tesseract-artwork path[data-guide="true"]').count(),
  ).toBeGreaterThan(200);
  expect(await page.locator("#tesseract-artwork").innerHTML()).not.toMatch(
    /NaN|Infinity/,
  );
  await choosePreset(page, { label: "An octahedron within" });
  await settle(page);
  await expect(page.locator(".tesseract-diagnostics")).toContainText(
    "6 vertices · 12 edges · 8 faces",
  );
  await page.getByRole("textbox", { name: "Slice offset h" }).fill("2");
  await settle(page);
  await expect(page.locator(".tesseract-diagnostics")).toContainText(
    "Point contact",
  );
  await page.getByRole("textbox", { name: "Slice offset h" }).fill("2.5");
  await settle(page);
  await expect(page.locator(".tesseract-diagnostics")).toContainText(
    "Empty section",
  );
  await choosePreset(page, { label: "A cube beyond a cube" });
  await settle(page);
  const base = await definition(page);
  await pauseMotion(page);
  const slider = page.getByRole("slider", { name: "Animation progress" });
  await slider.fill("0.37");
  await settle(page);
  const paused = await definition(page);
  expect(paused.angles[3]).toBeCloseTo(2 * Math.PI * 0.37, 12);
  await page.getByRole("spinbutton", { name: "Duration (seconds)" }).fill("1");
  await openShapeAnimation(page);
  await page
    .getByRole("button", {
      name: /^(Play animation|Resume|Replay)$/,
      exact: true,
    })
    .click();
  await expect(
    page.getByRole("button", {
      name: /^(Play animation|Resume|Replay)$/,
      exact: true,
    }),
  ).toBeVisible({ timeout: 5000 });
  await settle(page);
  expect((await definition(page)).angles[3]).toBeCloseTo(2 * Math.PI, 12);
  await expect(slider).toHaveValue("1");
  await page
    .locator("#shape-playback")
    .getByRole("button", { name: /^(Stop|Back to study)$/, exact: true })
    .click();
  await settle(page);
  expect(await definition(page)).toEqual(base);
  await openShapeAnimation(page);
  await page
    .getByRole("button", {
      name: /^(Play animation|Resume|Replay)$/,
      exact: true,
    })
    .click();
  await expect(
    page.getByRole("button", { name: "Pause", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Pause", exact: true }).click();
  await settle(page);
  const value = await slider.inputValue();
  await page.waitForTimeout(150);
  expect(await slider.inputValue()).toBe(value);
  await openShapeAnimation(page);
  await page
    .getByRole("button", {
      name: /^(Play animation|Resume|Replay)$/,
      exact: true,
    })
    .click();
  await page
    .getByRole("textbox", { name: "xw angle", exact: true })
    .fill("pi/7");
  await settle(page);
  expect((await definition(page)).angles[3]).toBeCloseTo(Math.PI / 7);
  await expect(slider).toHaveCount(0);
});

test("notebook switching preserves study and manual camera and stops motion", async ({
  page,
}) => {
  await ready(page);
  const art = page.locator("#tesseract-artwork");
  await art.focus();
  await page.keyboard.press("ArrowLeft");
  await page.keyboard.press("Shift+ArrowUp");
  await page.keyboard.press("+");
  const before = JSON.parse((await art.locator("desc").textContent())!);
  await chooseNotebook(page, "3d");
  await expect(page.locator("#spatial-artwork")).toBeVisible();
  await chooseNotebook(page, "4d");
  await settle(page);
  expect(JSON.parse((await art.locator("desc").textContent())!).view).toEqual(
    before.view,
  );
  await openShapeAnimation(page);
  await page
    .getByRole("button", {
      name: /^(Play animation|Resume|Replay)$/,
      exact: true,
    })
    .click();
  await chooseNotebook(page, "2d");
  await expect(page.locator("#artwork")).toBeVisible();
  await chooseNotebook(page, "4d");
  await settle(page);
  await expect(
    page.getByRole("button", {
      name: /^(Play animation|Resume|Replay)$/,
      exact: true,
    }),
  ).toBeVisible();
  await page.goBack();
  await expect(page.locator("#artwork")).toBeVisible();
  await page.goForward();
  await expect(art).toBeVisible();
});

test("+ and − zoom about the middle of a panned view, compound when quick, and the wheel zooms about the pointer", async ({
  page,
}) => {
  await ready(page);
  const art = page.locator("#tesseract-artwork");
  const view = async () =>
    JSON.parse((await art.locator("desc").textContent())!).view;
  // The first vertex drawn, in page units of the 1000 × 760 drawing.
  const vertex = async () => {
    const d = (await art
      .locator('path[data-guide="false"]')
      .first()
      .getAttribute("d"))!;
    const [x, y] = d.slice(1).split(/[L ]/)[0].split(",").map(Number);
    return { x, y };
  };
  // Zooming by k about a page point leaves it fixed, so a drawn point's
  // offset from it scales by k; the path data carries three decimals.
  const about = (
    from: { x: number; y: number },
    to: { x: number; y: number },
    at: { x: number; y: number },
    k: number,
  ) => {
    const tolerance = 0.002 * Math.max(1, k);
    expect(Math.abs(to.x - at.x - (from.x - at.x) * k)).toBeLessThan(tolerance);
    expect(Math.abs(to.y - at.y - (from.y - at.y) * k)).toBeLessThan(tolerance);
  };
  const middle = { x: 500, y: 380 };
  await art.focus();
  await page.keyboard.press("Shift+ArrowLeft");
  await page.keyboard.press("Shift+ArrowLeft");
  await page.keyboard.press("Shift+ArrowUp");
  await expect.poll(async () => (await view()).panX).toBe(-40);
  expect((await view()).panY).toBe(-20);
  const start = await vertex();
  const zoomed = async (zoom: number) => {
    await expect.poll(async () => (await view()).zoom).toBeCloseTo(zoom, 9);
    about(start, await vertex(), middle, zoom);
  };
  await page.keyboard.press("+");
  await zoomed(1.1);
  await page.keyboard.press("-");
  await page.keyboard.press("-");
  await zoomed(1 / 1.1);
  // Keys sent within one task, faster than the drawing renders.
  const burst = (key: string, n: number) =>
    art.evaluate(
      (el, [key, n]) => {
        for (let i = 0; i < n; i++)
          el.dispatchEvent(
            new KeyboardEvent("keydown", {
              key,
              bubbles: true,
              cancelable: true,
            }),
          );
      },
      [key, n] as const,
    );
  await burst("+", 3);
  await zoomed(1.1 ** 2);
  // Past either limit the zoom stops there, still about the middle.
  await burst("=", 40);
  await zoomed(8);
  await burst("-", 60);
  await zoomed(0.2);
  await page.keyboard.press("Home");
  await expect.poll(async () => (await view()).zoom).toBe(1);
  expect(await view()).toMatchObject({ panX: 0, panY: 0 });
  // The wheel zooms about the page point under the pointer.
  const box = (await art.boundingBox())!;
  const s = Math.min(box.width / 1000, box.height / 760);
  // A whole client pixel near page point (700, 250), and the page point
  // it is.
  const cx = Math.round(box.x + box.width / 2 + 200 * s),
    cy = Math.round(box.y + box.height / 2 - 130 * s);
  const pointer = {
    x: 500 + (cx - (box.x + box.width / 2)) / s,
    y: 380 + (cy - (box.y + box.height / 2)) / s,
  };
  await page.mouse.move(cx, cy);
  const before = await vertex();
  await page.mouse.wheel(0, -200);
  const k = Math.exp(0.2);
  await expect.poll(async () => (await view()).zoom).toBeCloseTo(k, 9);
  about(before, await vertex(), pointer, k);
});

for (const width of [1440, 390])
  for (const theme of ["light", "dark"] as const)
    test(`tesseract visuals and stable layout ${width} ${theme}`, async ({
      page,
    }, info) => {
      await page.setViewportSize({ width, height: 1000 });
      await page.emulateMedia({ colorScheme: theme });
      await ready(page);
      await choosePreset(page, { label: "Spherical loom" });
      await settle(page);
      await expect(page.locator(".tesseract-app")).toHaveClass(
        theme === "dark" ? /dark/ : /app tesseract-app/,
      );
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth),
      ).toBeLessThanOrEqual(width);
      if (width === 1440) {
        const y = (await stage(page).boundingBox())!.y;
        await page
          .locator("aside")
          .evaluate((e) => (e.scrollTop = e.scrollHeight));
        expect((await stage(page).boundingBox())!.y).toBe(y);
      }
      await stage(page).scrollIntoViewIfNeeded();
      await page.screenshot({
        path: info.outputPath(`tesseract-${width}-${theme}.png`),
        fullPage: true,
      });
    });

test("image exports preserve vectors, theme, camera and target resolution", async ({
  page,
}) => {
  await ready(page);
  await choosePreset(page, { label: "Section garden" });
  await settle(page);
  await page.locator("#tesseract-artwork").focus();
  await page.keyboard.press("ArrowRight");
  const expected = JSON.parse(
    (await page.locator("#tesseract-artwork desc").textContent())!,
  );
  let downloading = page.waitForEvent("download");
  await exportImage(page, "SVG");
  let file = await downloading;
  const svg = await readFile((await file.path())!, "utf8");
  expect(svg).toContain("<path");
  expect(svg).not.toContain("<image");
  const camera = await page.evaluate(
    (text) =>
      JSON.parse(
        new DOMParser()
          .parseFromString(text, "image/svg+xml")
          .querySelector("desc")!.textContent!,
      ).view,
    svg,
  );
  expect(camera).toEqual(expected.view);
  downloading = page.waitForEvent("download");
  await exportImage(page, "PNG");
  file = await downloading;
  const png = await readFile((await file.path())!);
  expect(png.readUInt32BE(16)).toBe(2000);
  expect(png.readUInt32BE(20)).toBe(1520);
});

for (const format of ["mp4", "webp"] as const)
  test(`tesseract ${format} export independently decodes with timing and endpoints`, async ({
    page,
  }) => {
    test.slow();
    await ready(page);
    await openShapeAnimation(page);
    await page
      .getByRole("spinbutton", { name: "Duration (seconds)" })
      .fill("1");
    await openShapeExport(page);
    await page
      .getByRole("combobox", { name: "Export format" })
      .selectOption(format);
    await page
      .getByRole("slider", { name: "Export resolution", exact: true })
      .fill("1");
    const fps = format === "mp4" ? 60 : 15;
    await page
      .getByRole("combobox", { name: "Export frame rate" })
      .selectOption(String(fps));
    await page
      .getByRole("slider", { name: "Export quality", exact: true })
      .fill("73");
    if (format === "webp")
      await page
        .getByRole("checkbox", { name: "Loop exported animation" })
        .check();
    const downloading = page.waitForEvent("download");
    await page
      .getByRole("button", { name: /^Export (MP4 video|animated WebP)/ })
      .click();
    const file = await downloading,
      path = (await file.path())!,
      bytes = await readFile(path);
    if (format === "mp4") {
      const p = probe(path);
      if (p) {
        expect(p.frames).toBe(fps);
        expect(p.width).toBe(1000);
        expect(p.height).toBe(760);
        expect(p.durations.reduce((a, b) => a + b, 0)).toBe(1000);
        expect(p.times[0]).toBe(0);
      }
      const v = await decodeVideo(page, bytes);
      expect(v.duration).toBeCloseTo(1, 3);
      expect(v.width).toBe(1000);
    } else {
      const decoded = await page.evaluate(async (input) => {
        const decoder = new (window as any).ImageDecoder({
          data: new Uint8Array(input),
          type: "image/webp",
        });
        await decoder.tracks.ready;
        const count = decoder.tracks.selectedTrack.frameCount;
        const c = document.createElement("canvas");
        c.width = 1000;
        c.height = 760;
        const ctx = c.getContext("2d")!;
        const durations: number[] = [],
          hashes: number[] = [];
        for (let i = 0; i < count; i++) {
          const { image } = await decoder.decode({ frameIndex: i });
          durations.push(image.duration);
          ctx.drawImage(image, 0, 0);
          let hash = 0;
          for (const value of ctx.getImageData(0, 0, 1000, 760).data)
            hash = (Math.imul(hash, 31) + value) | 0;
          hashes.push(hash);
          image.close();
        }
        decoder.close();
        return { count, durations, hashes };
      }, Array.from(bytes));
      expect(decoded.count).toBe(fps);
      expect(decoded.durations.reduce((a, b) => a + b, 0)).toBe(1000000);
      expect(new Set(decoded.hashes).size).toBeGreaterThan(10);
      const anim = bytes.indexOf(Buffer.from("ANIM"));
      expect(anim).toBeGreaterThan(0);
      expect(bytes.readUInt16LE(anim + 12)).toBe(0);
      expect(decoded.hashes[0]).toBe(decoded.hashes.at(-1));
    }
    await expect(
      page.getByRole("button", { name: /^Export (MP4 video|animated WebP)/ }),
    ).toBeEnabled();
  });

test("the timeline follows rendered export frames, like 2D and 3D", async ({
  page,
}) => {
  await ready(page);
  await openShapeExport(page);
  await page
    .getByRole("button", { name: /^Export (MP4 video|animated WebP)/ })
    .click();
  const slider = page.getByRole("slider", { name: "Animation progress" });
  await expect
    .poll(async () => +(await slider.inputValue()))
    .toBeGreaterThan(0);
  await page.getByRole("button", { name: "Cancel export" }).click();
  await expect(page.getByRole("button", { name: "Cancel export" })).toHaveCount(
    0,
  );
  await expect(slider).toHaveCount(0);
});

test("cancellation and edits discard motion exports", async ({ page }) => {
  await ready(page);
  await openShapeExport(page);
  let downloads = 0;
  page.on("download", () => downloads++);
  for (const action of ["cancel", "edit", "switch"]) {
    await page
      .getByRole("button", { name: /^Export (MP4 video|animated WebP)/ })
      .click();
    await expect(
      page.getByRole("button", { name: "Cancel export" }),
    ).toBeVisible();
    if (action === "cancel")
      await page.getByRole("button", { name: "Cancel export" }).click();
    else if (action === "edit")
      await page
        .getByRole("textbox", { name: "xy angle", exact: true })
        .fill("pi/6");
    else {
      await chooseNotebook(page, "2d");
      await chooseNotebook(page, "4d");
    }
    await expect(
      page.getByRole("button", { name: "Cancel export" }),
    ).toHaveCount(0);
    await settle(page);
  }
  expect(downloads).toBe(0);
});

test("reselecting an example while computation is pending settles the latest study", async ({
  page,
}) => {
  await ready(page);
  await choosePreset(page, { label: "Spherical loom" });
  await choosePreset(page, { label: "Spherical loom" });
  await settle(page);
  await expect(
    page.getByRole("button", { name: "Export image" }),
  ).toBeEnabled();
  // Rapid scrubs keep only the latest request, including a repeated final value.
  await pauseMotion(page);
  const slider = page.getByRole("slider", { name: "Animation progress" });
  await slider.evaluate((el) => {
    const input = el as HTMLInputElement;
    const set = Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value",
    )!.set!;
    for (const v of ["0.9", "0.2", "0.7", "0.1", "0.1"]) {
      set.call(input, v);
      input.dispatchEvent(new Event("input", { bubbles: true }));
    }
  });
  await settle(page);
  expect((await definition(page)).angles[3]).toBeCloseTo(
    0.62 + 2 * Math.PI * 0.1,
    10,
  );
});

test("system and manual themes remain shared with the tesseract notebook", async ({
  page,
}) => {
  await page.emulateMedia({ colorScheme: "dark" });
  await ready(page);
  await expect(page.locator(".tesseract-app")).toHaveClass(/dark/);
  await page.emulateMedia({ colorScheme: "light" });
  await expect(page.locator(".tesseract-app")).not.toHaveClass(/dark/);
  await page.getByRole("button", { name: "Use dark background" }).click();
  await page.emulateMedia({ colorScheme: "dark" });
  await page.emulateMedia({ colorScheme: "light" });
  await expect(page.locator(".tesseract-app")).toHaveClass(/dark/);
  await page.reload();
  await settle(page);
  await expect(page.locator(".tesseract-app")).toHaveClass(/dark/);
  await page
    .getByRole("button", { name: "Follow system", exact: true })
    .click();
  await expect(page.locator(".tesseract-app")).not.toHaveClass(/dark/);
});

test("an invalid hidden construction does not block a different view", async ({
  page,
}) => {
  await ready(page);
  await page.getByRole("textbox", { name: "4D eye distance" }).fill("1/0");
  await expect(page.getByRole("alert")).toBeVisible();
  await page
    .getByRole("combobox", { name: "View of the tesseract" })
    .selectOption("orthographic");
  await settle(page);
  await expect(page.getByRole("alert")).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Export image" }),
  ).toBeEnabled();
  await page
    .getByRole("combobox", { name: "View of the tesseract" })
    .selectOption("perspective");
  await settle(page);
  await expect(page.getByRole("alert")).toBeVisible();
  await page
    .getByRole("combobox", { name: "View of the tesseract" })
    .selectOption("section");
  await page.getByRole("spinbutton", { name: "Section count" }).fill("1.5");
  await settle(page);
  await expect(page.getByRole("alert")).toBeVisible();
  await page
    .getByRole("combobox", { name: "View of the tesseract" })
    .selectOption("orthographic");
  await settle(page);
  await expect(page.getByRole("alert")).toHaveCount(0);
});

test("phone playback brings the drawing into view and keeps controls reachable", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await ready(page);
  await openShapeAnimation(page);
  await page
    .getByRole("button", {
      name: /^(Play animation|Resume|Replay)$/,
      exact: true,
    })
    .click();
  const navigation = page.getByRole("navigation", {
    name: "Notebook sections",
  });
  await expect
    .poll(async () => {
      const nav = (await navigation.boundingBox())!;
      return (await stage(page).boundingBox())!.y - (nav.y + nav.height);
    })
    .toBeGreaterThanOrEqual(0);
  await expect(stage(page)).toBeInViewport({ ratio: 1 });
  const bar = page.locator(".tesseract-playback.active");
  await expect(bar).toBeVisible();
  expect(await bar.evaluate((e) => getComputedStyle(e).position)).toBe("fixed");
  await page.getByRole("button", { name: "Pause", exact: true }).click();
  await settle(page);
  await page.getByRole("slider", { name: "Animation progress" }).fill("0.5");
  await settle(page);
  expect((await definition(page)).angles[3]).toBeCloseTo(Math.PI);
  await page
    .locator("#shape-playback")
    .getByRole("button", { name: /^(Stop|Back to study)$/, exact: true })
    .click();
  await expect(page.locator(".tesseract-playback.active")).toHaveCount(0);
});

test("early animation clocks never move behind the scrubbed start", async ({
  page,
}) => {
  await page.addInitScript(() => {
    const raf = window.requestAnimationFrame.bind(window);
    window.requestAnimationFrame = (cb) => raf((t) => cb(t - 80));
  });
  await ready(page);
  await pauseMotion(page);
  await page.getByRole("slider", { name: "Animation progress" }).fill("0.73");
  await settle(page);
  await page.evaluate(() => {
    (window as any).seenProgress = [];
    const s = document.querySelector(".tesseract-stage")!;
    new MutationObserver(() => {
      (window as any).seenProgress.push(
        Number(s.getAttribute("data-progress")),
      );
    }).observe(s, { attributes: true, attributeFilter: ["data-progress"] });
  });
  await page.getByRole("spinbutton", { name: "Duration (seconds)" }).fill("1");
  await openShapeAnimation(page);
  await page
    .getByRole("button", {
      name: /^(Play animation|Resume|Replay)$/,
      exact: true,
    })
    .click();
  await expect(
    page.getByRole("button", {
      name: /^(Play animation|Resume|Replay)$/,
      exact: true,
    }),
  ).toBeVisible({ timeout: 5000 });
  await settle(page);
  const seen = await page.evaluate(
    () => (window as any).seenProgress as number[],
  );
  expect(seen.length).toBeGreaterThan(1);
  expect(Math.min(...seen)).toBeGreaterThanOrEqual(0.73);
  expect(Math.max(...seen)).toBe(1);
});

test("a completed 4D animation frees the view buttons without Back to study", async ({
  page,
}) => {
  await ready(page);
  await openShapeAnimation(page);
  await page
    .getByRole("spinbutton", { name: "Duration (seconds)" })
    .fill("0.2");
  await page
    .getByRole("button", { name: "Play animation", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Replay", exact: true }),
  ).toBeVisible();
  await settle(page);
  const art = page.locator("#tesseract-artwork");
  const final = await art.innerHTML();
  await expect(page.getByRole("button", { name: "Reset view" })).toBeEnabled();
  await expect(page.getByRole("button", { name: "Rotate view" })).toBeEnabled();
  await art.focus();
  await page.keyboard.press("ArrowRight");
  await expect.poll(() => art.innerHTML()).not.toBe(final);
  await page.getByRole("button", { name: "Reset view" }).click();
  await expect.poll(() => art.innerHTML()).toBe(final);
  // Scrubbing is playback again, with the view buttons held.
  await page.getByRole("slider", { name: "Animation progress" }).fill("0.5");
  await expect(page.getByRole("button", { name: "Reset view" })).toBeDisabled();
});
