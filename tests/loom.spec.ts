import { test, expect, type Page, type Locator } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { crc32, deflateRawSync } from "node:zlib";
import { execFileSync } from "node:child_process";
import { wireStudy } from "./study-link-wire";
import { decodePng } from "./png";
import { decodeVideo, probe as videoProbe } from "./video";
import { choosePreset } from "./helpers";
import { checkLoomPortraitPlayer, checkLoomLiveScrub } from "./loom-playback";

for (const title of ["A square grid, curved", "Circles through infinity"])
  test(`loom drawings update during an uninterrupted scrub: ${title}`, async ({
    page,
  }) => {
    await checkLoomLiveScrub(page, title);
  });

for (const title of ["A square grid, curved", "Circles through infinity"])
  test(`portrait loom playback keeps its complete player visible: ${title}`, async ({
    page,
  }) => {
    await checkLoomPortraitPlayer(page, title);
  });

// The complex loom: paired squaring geometry, its entry from the notebook and
// gallery, links, controls, and still and movie exports.

async function settled(page: Page) {
  await expect(
    page.locator(
      ".app:visible .plot-wrap[aria-busy], .app:visible .spatial-stage",
    ),
  ).toHaveAttribute("aria-busy", "false");
}

// Opens the loom on one of its authored families from the examples gallery.
async function openLoomExample(
  page: Page,
  title = "Circles opening into a rosette",
) {
  await page.getByRole("button", { name: "Browse notebook examples" }).click();
  const gallery = page.getByRole("dialog", { name: "Notebook examples" });
  await gallery
    .locator(`[data-loom-example][data-example-title="${title}"]`)
    .click();
  await gallery.waitFor({ state: "hidden" });
}

// The owner's Loops upon loops source, mapped at b=.8, saved at 64 samples.
// Build its link from the production preset rather than an opaque URL token.
async function openEditedLoom(page: Page) {
  const { presets } = await import("../web/presets");
  const { presetStudy } = await import("../web/planar-link");
  const { curveLoom, replaceMap } = await import("../web/loom/model");
  const base = presetStudy(
    presets.findIndex((p) => p.title === "Loops upon loops"),
  );
  const loom = {
    ...replaceMap(curveLoom(base.config), "mobius"),
    samples: 64,
    mapParameter: 0.8,
    exclusionRadius: 0.03427937158324301,
    framing: {
      source: { cx: 0.145558547505649, cy: 0, scale: 215.14396733005353 },
      image: { cx: -1.0690566223618285, cy: 0, scale: 216.01888172746047 },
    },
  };
  const token = deflateRawSync(
    JSON.stringify({ v: 1, notebook: "2d", study: { ...base, loom } }),
  ).toString("base64url");
  await page.goto(`/#s=${token}`);
  const d = page.getByRole("dialog", { name: "The complex loom" });
  await expect(d.locator(".loom-panes")).toHaveAttribute("aria-busy", "false");
  await d.getByText("Sampling and limits", { exact: true }).click();
  return d;
}

for (const variant of ["replace", "edit digits"])
  test(`loom sample editing recovers from intermediate values: ${variant}`, async ({
    page,
  }) => {
    await page.addInitScript(() => {
      const send = Worker.prototype.postMessage;
      (window as any).sampleRequests = [];
      Worker.prototype.postMessage = function (q: any, ...rest: any[]) {
        if (q.action === "loom")
          (window as any).sampleRequests.push({
            samples: q.loom.samples,
            point: q.pointOnly,
          });
        return send.call(this, q, ...rest);
      };
    });
    const d = await openEditedLoom(page),
      samples = d.getByLabel("Samples per member", { exact: true });
    if (variant === "replace") {
      await samples.selectText();
      await samples.pressSequentially("32", { delay: 40 });
    } else {
      await samples.fill("64");
      await samples.press("3");
      await samples.press("ArrowLeft");
      await samples.press("ArrowLeft");
      await samples.press("Backspace");
      await samples.press("ArrowRight");
      await samples.press("ArrowRight");
      await samples.press("ArrowRight");
      await samples.press("2");
      await samples.press("ArrowLeft");
      await samples.press("ArrowLeft");
      await samples.press("Backspace");
    }
    await expect(samples).toHaveValue("32");
    await expect(d.getByRole("alert")).toHaveCount(0);
    await expect(
      d.getByRole("button", { name: "Play traversal", exact: true }),
    ).toBeEnabled();
    expect(
      await page.evaluate(() => (window as any).sampleRequests.at(-1).samples),
    ).toBe(32);
    if (variant === "replace")
      expect(
        await page.evaluate(() =>
          (window as any).sampleRequests.some((q: any) => q.samples === 3),
        ),
      ).toBe(false);
  });

test("loom count inputs retain a blank draft instead of inserting zero", async ({
  page,
}) => {
  const d = await openEditedLoom(page);
  const samples = d.getByLabel("Samples per member", { exact: true });
  await samples.fill("");
  await expect(samples).toHaveValue("");
  await samples.pressSequentially("32");
  await expect(samples).toHaveValue("32");
  await expect(
    d.getByRole("button", { name: "Play traversal", exact: true }),
  ).toBeEnabled();
});

test("complex map help explains the three pictures and expands to their mathematics", async ({
  page,
}) => {
  await page.goto("/");
  await settled(page);
  await openLoomExample(page);
  const d = page.getByRole("dialog", { name: "The complex loom" });
  const toggle = d.getByRole("button", {
    name: "About Complex map",
    exact: true,
  });
  await toggle.click();
  const help = d.locator(
    `[id="${await toggle.getAttribute("aria-controls")}"]`,
  );
  await expect(help).toContainText(/squaring/i);
  await expect(help).toContainText(/Möbius/);
  await expect(
    help.getByRole("button", { name: "Show more", exact: true }),
  ).toBeVisible();
  await help.getByRole("button", { name: "Show more", exact: true }).click();
  for (const text of [
    "z²",
    "zⁿ",
    "2–6",
    "eᶻ",
    "2πi",
    "8π",
    "exp(zⁿ)",
    "1/b",
    "±√λ",
    "identity",
    "pole",
  ])
    await expect(help).toContainText(text);
});

for (const gesture of ["pointer", "touch"])
  test(`loom scrubbing stays enabled and continuous while correspondence is pending: ${gesture}`, async ({
    page,
  }) => {
    await page.addInitScript(() => {
      const send = Worker.prototype.postMessage;
      Worker.prototype.postMessage = function (q: any, ...rest: any[]) {
        if (q.action === "loom" && q.pointOnly)
          setTimeout(() => send.call(this, q, ...rest), 200);
        else send.call(this, q, ...rest);
      };
    });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/");
    await settled(page);
    await openLoomExample(page);
    const d = page.getByRole("dialog", { name: "The complex loom" });
    await expect(d.locator(".loom-panes")).toHaveAttribute(
      "aria-busy",
      "false",
    );
    const slider = d.getByLabel("Source parameter", { exact: true });
    await slider.scrollIntoViewIfNeeded();
    const box = (await slider.boundingBox())!;
    const cdp =
      gesture === "touch"
        ? await page.context().newCDPSession(page)
        : undefined;
    const touch = async (type: string, fraction = 0) =>
      cdp!.send("Input.dispatchTouchEvent", {
        type,
        touchPoints:
          type === "touchEnd"
            ? []
            : [
                {
                  id: 1,
                  x: box.x + box.width * fraction,
                  y: box.y + box.height / 2,
                },
              ],
      });
    if (cdp) {
      await touch("touchStart", 0.1);
      await touch("touchMove", 0.3);
    } else {
      await page.mouse.move(box.x + box.width * 0.1, box.y + box.height / 2);
      await page.mouse.down();
      await page.mouse.move(box.x + box.width * 0.3, box.y + box.height / 2, {
        steps: 3,
      });
    }
    // A request in flight must not disable/recreate the slider or insert a
    // status row that moves the surrounding controls during the gesture.
    await expect(d.locator(".loom-panes")).toHaveAttribute("aria-busy", "true");
    expect(
      await d
        .getByLabel("Selected member", { exact: true })
        .evaluate((e) => e.matches(":disabled")),
    ).toBe(false);
    expect(
      await d
        .getByLabel("Exact source parameter", { exact: true })
        .evaluate((e) => e.matches(":disabled")),
    ).toBe(false);
    expect(
      await d
        .getByRole("button", { name: "Play traversal", exact: true })
        .isDisabled(),
    ).toBe(false);
    expect(
      await d
        .getByRole("button", { name: "Copy link", exact: true })
        .isDisabled(),
    ).toBe(false);
    await page.waitForTimeout(240);
    if (cdp) {
      await touch("touchMove", 0.85);
      await touch("touchEnd");
    } else {
      await page.mouse.move(box.x + box.width * 0.85, box.y + box.height / 2, {
        steps: 8,
      });
      await page.mouse.up();
    }
    expect(Number(await slider.inputValue())).toBeGreaterThan(0.8);
    await expect(d.locator(".loom-panes")).toHaveAttribute(
      "aria-busy",
      "false",
    );
    expect(
      Number(
        await d.locator(".loom-correspondence").getAttribute("data-parameter"),
      ),
    ).toBeGreaterThan(1.6 * Math.PI);
  });

test("a loom still requested during scrubbing resolves the latest marker and settles the view", async ({
  page,
}) => {
  await page.addInitScript(() => {
    const send = Worker.prototype.postMessage;
    Worker.prototype.postMessage = function (q: any, ...rest: any[]) {
      if (q.action === "loom" && q.pointOnly)
        setTimeout(() => send.call(this, q, ...rest), 200);
      else send.call(this, q, ...rest);
    };
  });
  await page.goto("/");
  await settled(page);
  await openLoomExample(page);
  const d = page.getByRole("dialog", { name: "The complex loom" }),
    art = d.locator(".loom-panes");
  await expect(art).toHaveAttribute("aria-busy", "false");
  await d.getByLabel("Source parameter", { exact: true }).fill("0.25");
  const download = page.waitForEvent("download");
  await loomImage(d, "SVG");
  const svg = await readFile((await (await download).path())!, "utf8");
  // The page's color fills a viewer beyond the page, as 2D and 4D exports do.
  expect(svg).toMatch(/^<svg[^>]* style="background:#f3f1ea"/);
  const markers = await page.evaluate((text) => {
    const doc = new DOMParser().parseFromString(text, "image/svg+xml");
    return Array.from(doc.querySelectorAll("[data-marker]"), (e) =>
      JSON.parse(e.getAttribute("data-point")!),
    );
  }, svg);
  expect(markers).toEqual([
    { x: 1, y: 1 },
    { x: 0, y: 2 },
  ]);
  await expect(art).toHaveAttribute("aria-busy", "false");
  await expect(d.locator(".loom-correspondence")).toHaveAttribute(
    "data-parameter",
    String(Math.PI / 2),
  );
});

test("canceling a loom movie during a pending scrub restores the current correspondence", async ({
  page,
}) => {
  await page.addInitScript(() => {
    const send = Worker.prototype.postMessage;
    Worker.prototype.postMessage = function (q: any, ...rest: any[]) {
      if (q.action === "loom" && q.pointOnly)
        setTimeout(() => send.call(this, q, ...rest), 350);
      else send.call(this, q, ...rest);
    };
  });
  await page.goto("/");
  await settled(page);
  await openLoomExample(page);
  const d = page.getByRole("dialog", { name: "The complex loom" });
  await expect(d.locator(".loom-panes")).toHaveAttribute("aria-busy", "false");
  await openLoomExportSettings(d);
  await d.getByLabel("Source parameter", { exact: true }).fill("0.25");
  let downloads = 0;
  page.on("download", () => downloads++);
  await loomMovieAction(d).click();
  await d.getByRole("button", { name: "Cancel export", exact: true }).click();
  await expect(d.locator(".loom-panes")).toHaveAttribute("aria-busy", "false");
  await expect(d.locator(".loom-correspondence")).toHaveAttribute(
    "data-parameter",
    String(Math.PI / 2),
  );
  expect(downloads).toBe(0);
});

test("+ and − zoom each loom pane about its middle, compound when quick, and stop at the zoom limits", async ({
  page,
}) => {
  await page.goto("/");
  await settled(page);
  await openLoomExample(page);
  const d = page.getByRole("dialog", { name: "The complex loom" });
  await expect(d.locator(".loom-panes")).toHaveAttribute("aria-busy", "false");
  const pane = d.locator('[data-pane="source"]'),
    marker = pane.locator("[data-marker]");
  // The drawn marker's offset from the middle of the 1000 × 760 pane.
  const offset = async () => {
    const [cx, cy] = await marker.evaluate((c) => [
      +c.getAttribute("cx")!,
      +c.getAttribute("cy")!,
    ]);
    return { x: cx - 500, y: cy - 380 };
  };
  await pane.focus();
  for (const key of ["ArrowLeft", "ArrowLeft", "ArrowUp"])
    await page.keyboard.press(key);
  await expect(pane).toHaveAttribute("data-pan", "-50,-25");
  const start = await offset();
  expect(Math.hypot(start.x, start.y)).toBeGreaterThan(20);
  // Zooming about the middle leaves it fixed, so every drawn point's
  // offset from it scales by the zoom.
  const scaled = async (zoom: number) => {
    await expect
      .poll(async () => Number(await pane.getAttribute("data-zoom")))
      .toBeCloseTo(zoom, 9);
    const o = await offset();
    expect(o.x).toBeCloseTo(start.x * zoom, 6);
    expect(o.y).toBeCloseTo(start.y * zoom, 6);
  };
  await page.keyboard.press("+");
  await scaled(1.2);
  await page.keyboard.press("-");
  await page.keyboard.press("-");
  await scaled(1 / 1.2);
  // Keys sent within one task, faster than the panes render.
  const burst = (key: string, n: number) =>
    pane.evaluate(
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
  await scaled(1.2 ** 2);
  await burst("=", 40);
  await expect(pane).toHaveAttribute("data-zoom", "100");
  await scaled(100);
  await burst("-", 60);
  await expect(pane).toHaveAttribute("data-zoom", "0.1");
  await scaled(0.1);
  // The image pane keeps its own camera.
  await expect(d.locator('[data-pane="image"]')).toHaveAttribute(
    "data-zoom",
    "1",
  );
  await page.keyboard.press("Home");
  await expect(pane).toHaveAttribute("data-pan", "0,0");
  await expect(pane).toHaveAttribute("data-zoom", "1");
});

test("rational loom controls split poles, seek maps and save vector metadata", async ({
  page,
}) => {
  await page.goto("/");
  await settled(page);
  await openLoomExample(page);
  const d = page.getByRole("dialog", { name: "The complex loom" }),
    art = d.locator(".loom-panes");
  await expect(art).toHaveAttribute("aria-busy", "false");
  const source = await d
    .locator('[data-pane="source"] [data-member="0"]')
    .getAttribute("d");
  await d.locator('[data-pane="source"]').press("+");
  await d.getByLabel("Complex map", { exact: true }).selectOption("mobius");
  await expect(art).toHaveAttribute("aria-busy", "false");
  await expect(d.locator('[data-pane="source"]')).toHaveAttribute(
    "data-zoom",
    "1.2",
  );
  await d.getByText("Map settings", { exact: true }).click();
  await d.getByLabel("Map parameter", { exact: true }).fill(".5");
  await expect(art).toHaveAttribute("aria-busy", "false");
  await expect(d.locator("[data-gaps]")).toContainText("excluded");
  await expect(d.locator('[data-pane="source"] [data-exclusion]')).toHaveCount(
    1,
  );
  await d.getByLabel("Pole exclusion radius", { exact: true }).fill("0");
  await expect(d.getByRole("alert")).toContainText("0.000001");
  await d.getByLabel("Pole exclusion radius", { exact: true }).fill("1/40");
  await expect(art).toHaveAttribute("aria-busy", "false");
  await d.getByLabel("Motion", { exact: true }).selectOption("map");
  await d.getByLabel("Map motion from", { exact: true }).fill(".5");
  await d.getByLabel("Map motion to", { exact: true }).fill("2");
  await expect(d.getByRole("alert")).toContainText("Map motion to");
  await expect(d.getByLabel("Map motion to", { exact: true })).toHaveAttribute(
    "aria-invalid",
    "true",
  );
  await d.getByLabel("Map motion to", { exact: true }).fill("0");
  await d.getByLabel("Motion progress", { exact: true }).fill("1");
  await expect(art).toHaveAttribute("aria-busy", "false");
  await expect(d.getByLabel("Map parameter", { exact: true })).toHaveValue("0");
  await expect(d.locator('[data-pane="source"] [data-exclusion]')).toHaveCount(
    0,
  );
  await expect(d.locator("[data-gaps]")).toContainText("No gaps");
  const a = await d
    .locator('[data-pane="source"] [data-member="0"]')
    .getAttribute("d");
  expect(a).not.toBeNull();
  expect(source).not.toBeNull();
  const download = page.waitForEvent("download");
  await loomImage(d, "SVG");
  const svg = await readFile((await (await download).path())!, "utf8");
  expect(svg).toContain('"map":"mobius"');
  expect(svg).toContain('"exclusionRadius":0.025');
  expect(svg).toContain('"mapParameter":0');
  expect(svg).not.toMatch(/<text|<image/);
  await d.getByLabel("Map parameter", { exact: true }).fill("1e-308");
  await expect(art).toHaveAttribute("aria-busy", "false");
  await expect
    .poll(() =>
      d.locator(".loom-panes svg").evaluateAll((es) => {
        return es.every((svg) =>
          Array.from(svg.querySelectorAll("circle")).every((e) => {
            return ["cx", "cy", "r"].every((k) =>
              Number.isFinite(Number(e.getAttribute(k))),
            );
          }),
        );
      }),
    )
    .toBe(true);
  await d.getByLabel("Complex map", { exact: true }).selectOption("joukowski");
  await d.getByLabel("Exact source parameter", { exact: true }).fill("pi");
  await expect(art).toHaveAttribute("aria-busy", "false");
  await expect(d.locator(".loom-correspondence")).toContainText("excluded");
});

test("changing loom maps waits for pending source scalars and retains manual work", async ({
  page,
}) => {
  await page.addInitScript(() => {
    const send = Worker.prototype.postMessage;
    Worker.prototype.postMessage = function (q: any, ...rest: any[]) {
      if (q.action === "scalars")
        setTimeout(() => send.call(this, q, ...rest), 200);
      else send.call(this, q, ...rest);
    };
  });
  await page.goto("/");
  await settled(page);
  await openLoomExample(page);
  const d = page.getByRole("dialog", { name: "The complex loom" });
  await expect(d.locator(".loom-panes")).toHaveAttribute("aria-busy", "false");
  await d.getByLabel("Circle radius", { exact: true }).fill("phi");
  await d.getByLabel("Complex map", { exact: true }).selectOption("joukowski");
  await expect(d.locator(".loom-panes")).toHaveAttribute("aria-busy", "false");
  await expect
    .poll(async () =>
      JSON.parse(
        (await d
          .locator('[data-pane="source"] [data-marker]')
          .getAttribute("data-point"))!,
      ),
    )
    .toEqual({ x: 1 + Math.sqrt(5), y: 0 });
});

test("rational performances recompute motion, pause safely and decode a moving-pole film", async ({
  page,
}) => {
  await page.goto("/");
  await settled(page);
  await openLoomExample(page, "Circles through infinity");
  const d = page.getByRole("dialog", { name: "The complex loom" }),
    art = d.locator(".loom-panes");
  await expect(art).toHaveAttribute("aria-busy", "false");
  await expect(d.getByLabel("Complex map", { exact: true })).toHaveValue(
    "mobius",
  );
  await expect(d.getByLabel("Source parameter", { exact: true })).toHaveCount(
    0,
  );
  const controls = d.getByRole("group", { name: "Playback", exact: true });
  const playButton = (await controls
    .getByRole("button", { name: "Play map motion", exact: true })
    .boundingBox())!;
  expect(
    (await controls
      .getByLabel("Motion progress", { exact: true })
      .boundingBox())!.y,
  ).toBeGreaterThanOrEqual(playButton.y + playButton.height);
  const image = d.locator('[data-pane="image"] [data-member="0"]');
  const start = await image.getAttribute("d");
  await d.getByLabel("Motion progress", { exact: true }).fill("0.5");
  await expect(art).toHaveAttribute("aria-busy", "false");
  const middle = await image.getAttribute("d");
  expect(middle).not.toBe(start);
  await expect(d.locator("[data-exclusion]")).toHaveCount(0);
  await d.getByLabel("Traversal duration", { exact: true }).fill("10");
  await d.getByRole("button", { name: "Play map motion", exact: true }).click();
  await expect.poll(() => image.getAttribute("d")).not.toBe(middle);
  await d
    .getByRole("button", { name: "Pause map motion", exact: true })
    .click();
  const held = await image.getAttribute("d");
  await page.waitForTimeout(150);
  expect(await image.getAttribute("d")).toBe(held);
  await d.getByRole("button", { name: "Stop map motion", exact: true }).click();
  await expect(art).toHaveAttribute("aria-busy", "false");
  expect(await image.getAttribute("d")).toBe(start);
  // Middle frame b=.5 moves the pole onto the radius-2 source circle.
  await d.getByLabel("Map motion to", { exact: true }).fill(".35");
  // Rasterize the actual live image pane at each absolute movie time. This
  // tests the production renderer, without duplicating either map formula.
  const seeks: number[][] = [];
  for (const progress of [0, 0.5, 1]) {
    await d
      .getByLabel("Motion progress", { exact: true })
      .fill(String(progress));
    await expect(art).toHaveAttribute("aria-busy", "false");
    if (progress === 0.5)
      await expect(d.locator("[data-gaps]")).toContainText("excluded");
    seeks.push(
      await d.locator('[data-pane="image"]').evaluate(async (e) => {
        const svg = e.cloneNode(true) as SVGSVGElement;
        svg.setAttribute("xmlns", "http://www.w3.org/2000/svg");
        svg.setAttribute("width", "500");
        svg.setAttribute("height", "380");
        const url = URL.createObjectURL(
          new Blob([new XMLSerializer().serializeToString(svg)], {
            type: "image/svg+xml",
          }),
        );
        try {
          const image = new Image();
          image.src = url;
          await image.decode();
          const canvas = Object.assign(document.createElement("canvas"), {
            width: 500,
            height: 380,
          });
          const ctx = canvas.getContext("2d")!;
          ctx.drawImage(image, 0, 0);
          return Array.from(ctx.getImageData(0, 0, 500, 380).data);
        } finally {
          URL.revokeObjectURL(url);
        }
      }),
    );
  }
  await d.getByLabel("Motion progress", { exact: true }).fill("0");
  await expect(art).toHaveAttribute("aria-busy", "false");
  await openLoomExportSettings(d);
  await d.getByLabel("Traversal duration", { exact: true }).fill(".2");
  await loomResolution(d, 0.5);
  await d.getByLabel("Export frame rate", { exact: true }).selectOption("15");
  await d.getByLabel("Export format", { exact: true }).selectOption("mp4");
  const download = page.waitForEvent("download");
  await loomMovieAction(d).click();
  const path = (await (await download).path())!,
    bytes = await readFile(path);
  expect(bytes.includes(Buffer.from('"map":"mobius"'))).toBe(true);
  expect(bytes.includes(Buffer.from('"mode":"map"'))).toBe(true);
  const decoded = await decodeVideo(page, bytes);
  expect(decoded.duration).toBeCloseTo(0.2, 3);
  expect(decoded.first.ink).toBeGreaterThan(0);
  expect(decoded.last.ink).toBeGreaterThan(0);
  const timing = videoProbe(path);
  expect(timing?.frames).toBe(3);
  expect(timing?.durations.reduce((a, b) => a + b, 0)).toBe(200);
  const frames = execFileSync(
    "ffmpeg",
    ["-v", "error", "-i", path, "-f", "rawvideo", "-pix_fmt", "rgb24", "-"],
    { maxBuffer: 4 * 1024 * 1024 },
  );
  expect(frames.length).toBe(3 * 1000 * 380 * 3);
  for (let f = 0; f < 3; f++) {
    const errors = seeks.map((expected) => {
      let error = 0;
      for (let y = 0; y < 380; y++)
        for (let x = 0; x < 500; x++)
          for (let c = 0; c < 3; c++)
            error += Math.abs(
              frames[f * 1000 * 380 * 3 + (y * 1000 + x + 500) * 3 + c] -
                expected[(y * 500 + x) * 4 + c],
            );
      return error / (500 * 380 * 3);
    });
    expect(errors[f], `frame ${f}: ${errors}`).toBeLessThan(2);
    for (let other = 0; other < 3; other++)
      if (other !== f)
        expect(
          errors[f],
          `frame ${f} must match its own seek: ${errors}`,
        ).toBeLessThan(errors[other] * 0.7);
  }
});

test("complex loom pairs source and square, seeks through zero and restores the editor", async ({
  page,
}) => {
  await page.goto("/");
  await expect(page.locator(".plot-wrap")).toHaveAttribute(
    "aria-busy",
    "false",
  );
  const original = await page.locator(".plot-wrap svg").innerHTML();
  await openLoomExample(page);
  const dialog = page.getByRole("dialog", { name: "The complex loom" });
  await expect(dialog).toBeVisible();
  await expect(dialog.locator(".loom-panes")).toHaveAttribute(
    "aria-busy",
    "false",
  );
  await expect(
    dialog.locator('[data-pane="source"] [data-member]'),
  ).toHaveCount(12);
  await expect(dialog.locator('[data-pane="image"] [data-member]')).toHaveCount(
    12,
  );
  const mainWidth = (await dialog.locator("main").boundingBox())!.width;
  const artWidth = (await dialog.locator(".loom-panes").boundingBox())!.width;
  expect(artWidth).toBeGreaterThan(mainWidth * 0.95);

  const parameter = async (value: number) =>
    dialog.getByLabel("Source parameter", { exact: true }).evaluate((e, v) => {
      Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value",
      )!.set!.call(e, String((v + 2) / 4));
      e.dispatchEvent(new Event("input", { bubbles: true }));
    }, value);
  await dialog.getByLabel("Exact source parameter", { exact: true }).fill("pi");
  await expect(dialog.locator(".loom-correspondence")).toContainText(
    "Critical point",
  );
  const markers = await dialog
    .locator('[data-marker="true"]')
    .evaluateAll((es) =>
      es.map((e) => JSON.parse(e.getAttribute("data-point")!)),
    );
  expect(markers).toEqual([
    { x: 0, y: 0 },
    { x: 0, y: 0 },
  ]);
  await dialog
    .getByLabel("Source family", { exact: true })
    .selectOption("grid");
  await expect(dialog.locator(".loom-panes")).toHaveAttribute(
    "aria-busy",
    "false",
  );
  await expect(dialog.locator('[data-pane="image"] [data-member]')).toHaveCount(
    26,
  );
  await dialog
    .getByLabel("Selected member", { exact: true })
    .selectOption("14");
  await parameter(1);
  await expect(
    dialog.locator('[data-pane="source"] [data-marker]'),
  ).toHaveAttribute("data-point", JSON.stringify({ x: 1, y: -5 / 3 }));
  await openLoomExportSettings(dialog);
  const download = page.waitForEvent("download");
  await loomImage(dialog, "SVG");
  const svg = await (await download).createReadStream();
  const chunks: Buffer[] = [];
  for await (const b of svg!) chunks.push(b);
  const text = Buffer.concat(chunks).toString();
  expect(text).toContain('data-pane="source"');
  expect(text).toContain('data-pane="image"');
  expect(text).toContain('"map":"square"');
  expect(text).not.toMatch(/<text|<image/);
  await dialog
    .getByRole("button", { name: "Return to study", exact: true })
    .click();
  await expect(dialog).toBeHidden();
  expect(await page.locator(".plot-wrap svg").innerHTML()).toBe(original);
});

test("complex loom layout, invalid recovery, independent cameras and delayed ownership", async ({
  page,
}) => {
  await page.addInitScript(() => {
    const send = Worker.prototype.postMessage;
    Worker.prototype.postMessage = function (message: any, ...rest: any[]) {
      if (message.action === "loom")
        setTimeout(() => send.call(this, message, ...rest), 120);
      else send.call(this, message, ...rest);
    };
  });
  await page.goto("/");
  await settled(page);
  await page.getByLabel("t from", { exact: true }).fill("-pi");
  await page.getByLabel("to", { exact: true }).fill("3*pi");
  await settled(page);
  await openLoomExample(page);
  const d = page.getByRole("dialog", { name: "The complex loom" }),
    art = d.locator(".loom-panes");
  await expect(art).toHaveAttribute("aria-busy", "false");
  await d.getByLabel("Circle radius", { exact: true }).fill("0");
  await expect(d.getByRole("alert").first()).toContainText(/positive/);
  await d.getByLabel("Source family", { exact: true }).selectOption("grid");
  await expect(art).toHaveAttribute("aria-busy", "false");
  await d.getByLabel("Grid x start", { exact: true }).fill("");
  await d.getByLabel("Source family", { exact: true }).selectOption("rosette");
  await expect(art).toHaveAttribute("aria-busy", "false");
  await d.getByLabel("Circle radius", { exact: true }).fill("1");
  await expect(art).toHaveAttribute("aria-busy", "false");
  const image = await d.locator('[data-pane="image"]').innerHTML();
  await d.locator('[data-pane="source"]').press("+");
  expect(await d.locator('[data-pane="image"]').innerHTML()).toBe(image);
  await d.getByLabel("Selected member", { exact: true }).selectOption("2");
  await d.getByLabel("Selected member", { exact: true }).selectOption("4");
  await expect(art).toHaveAttribute("aria-busy", "false");
  await expect(
    d.locator('[data-pane="source"] [data-member="4"]'),
  ).toHaveAttribute("data-selected", "true");
  for (const width of [390, 844, 390]) {
    await page.setViewportSize({ width, height: 844 });
    const a = (await d.locator('[data-pane="source"]').boundingBox())!,
      b = (await d.locator('[data-pane="image"]').boundingBox())!;
    expect(b.y).toBeGreaterThan(a.y + a.height);
    expect(Math.abs(a.width - b.width)).toBeLessThan(1);
    expect(a.width).toBeGreaterThan(200);
  }
  await d.getByRole("button", { name: "Return to study", exact: true }).click();
  await expect(page.getByLabel("t from", { exact: true })).toHaveValue("-pi");
  await expect(page.getByLabel("to", { exact: true })).toHaveValue("3*pi");
});

test("complex loom PNG and decoded traversal movie preserve both panes and endpoints", async ({
  page,
}) => {
  await page.goto("/");
  await settled(page);
  await openLoomExample(page);
  const d = page.getByRole("dialog", { name: "The complex loom" }),
    art = d.locator(".loom-panes");
  await expect(art).toHaveAttribute("aria-busy", "false");
  await openLoomExportSettings(d);
  const still = page.waitForEvent("download");
  await loomImage(d, "PNG");
  const pngBytes = await readFile((await (await still).path())!);
  expect(pngBytes.includes(Buffer.from('"map":"square"'))).toBe(true);
  for (let at = 8; at < pngBytes.length;) {
    const n = pngBytes.readUInt32BE(at);
    expect(crc32(pngBytes.subarray(at + 4, at + 8 + n))).toBe(
      pngBytes.readUInt32BE(at + 8 + n),
    );
    at += 12 + n;
  }
  const png = decodePng(pngBytes);
  expect([png.width, png.height]).toEqual([4000, 1520]);
  await d.getByLabel("Traversal duration", { exact: true }).fill("0.2");
  await loomResolution(d, 0.5);
  await d.getByLabel("Export frame rate", { exact: true }).selectOption("15");
  await d.getByLabel("Export format", { exact: true }).selectOption("mp4");
  const movie = page.waitForEvent("download");
  await loomMovieAction(d).click();
  const moviePath = (await (await movie).path())!;
  const movieBytes = await readFile(moviePath);
  expect(movieBytes.includes(Buffer.from('"map":"square"'))).toBe(true);
  const decoded = await decodeVideo(page, movieBytes);
  const timing = videoProbe(moviePath);
  if (timing) {
    expect(timing.frames).toBe(3);
    expect(timing.durations.reduce((a, b) => a + b, 0)).toBe(200);
  }
  expect([decoded.width, decoded.height]).toEqual([1000, 380]);
  expect(decoded.duration).toBeCloseTo(0.2, 3);
  // This closed circle starts and ends at the same point. The middle frame
  // goes through the critical point; stationary geometry remains identical.
  expect(decoded.first.ink).toBeGreaterThan(0);
  expect(decoded.last.ink).toBeGreaterThan(0);
  // ffmpeg independently decodes all frames. In the authored rosette, the
  // selected circle starts at z=2, w=4, passes through zero, then returns.
  const frames = execFileSync(
    "ffmpeg",
    [
      "-v",
      "error",
      "-i",
      moviePath,
      "-f",
      "rawvideo",
      "-pix_fmt",
      "rgb24",
      "-",
    ],
    { maxBuffer: 4 * 1024 * 1024 },
  );
  const pink = (frame: number, cx: number, cy: number) => {
    let found = 0;
    for (let y = Math.round(cy) - 8; y <= Math.round(cy) + 8; y++)
      for (let x = Math.round(cx) - 8; x <= Math.round(cx) + 8; x++) {
        const i = frame * 1000 * 380 * 3 + (y * 1000 + x) * 3;
        const [r, g, b] = frames.subarray(i, i + 3);
        if (r > 70 && r > g * 1.3 && b > g * 1.2) found++;
      }
    return found;
  };
  // At 50% resolution the probe radius is only 2.75 pixels. H.264 chroma
  // subsampling can leave very few distinctly pink pixels (three on Linux),
  // so test presence at the exact expected position, not a minimum ink area.
  // Contrasting frames must have no probe color there: static geometry alone
  // cannot satisfy these checks, and neither pane may retain an old marker.
  for (const frame of [0, 2]) {
    expect(pink(frame, 397.5, 190)).toBeGreaterThan(0);
    expect(pink(frame, 897.5, 190)).toBeGreaterThan(0);
    expect(pink(frame, 250, 190)).toBe(0);
    expect(pink(frame, 750, 190)).toBe(0);
  }
  expect(pink(1, 250, 190)).toBeGreaterThan(0);
  expect(pink(1, 750, 190)).toBeGreaterThan(0);
  expect(pink(1, 397.5, 190)).toBe(0);
  expect(pink(1, 897.5, 190)).toBe(0);
  // The same source-time sampler also drives animated WebP, with metadata.
  await d.getByLabel("Export format", { exact: true }).selectOption("webp");
  const webp = page.waitForEvent("download");
  await loomMovieAction(d).click();
  const webpBytes = await readFile((await (await webp).path())!);
  expect(webpBytes.includes(Buffer.from('"map":"square"'))).toBe(true);
  const webpTiming = await page.evaluate(async (data) => {
    const decoder = new (window as any).ImageDecoder({
      data: new Uint8Array(data),
      type: "image/webp",
    });
    await decoder.tracks.ready;
    const count = decoder.tracks.selectedTrack.frameCount;
    let duration = 0;
    for (let i = 0; i < count; i++) {
      const { image } = await decoder.decode({ frameIndex: i });
      duration += image.duration;
      image.close();
    }
    decoder.close();
    return { count, duration };
  }, Array.from(webpBytes));
  expect(webpTiming).toEqual({ count: 3, duration: 200000 });
  await d.getByRole("button", { name: "Play traversal", exact: true }).click();
  await expect(
    d.getByRole("button", { name: "Play traversal", exact: true }),
  ).toBeVisible();
  await expect(d.locator(".loom-correspondence")).toHaveAttribute(
    "data-parameter",
    String(2 * Math.PI),
  );
});

test("complex loom delays never mix selected markers, and cancellation drops export", async ({
  page,
}) => {
  await page.addInitScript(() => {
    const send = Worker.prototype.postMessage;
    Worker.prototype.postMessage = function (q: any, ...rest: any[]) {
      if (q.action === "loom")
        setTimeout(() => send.call(this, q, ...rest), 200);
      else send.call(this, q, ...rest);
    };
  });
  await page.goto("/");
  await settled(page);
  await openLoomExample(page);
  const d = page.getByRole("dialog", { name: "The complex loom" });
  await expect(d.locator(".loom-panes")).toHaveAttribute("aria-busy", "false");
  await d.getByLabel("Selected member", { exact: true }).selectOption("4");
  const aligned = await d.locator('[data-pane="source"]').evaluate((svg) => {
    const path = svg.querySelector('[data-selected="true"]')!;
    const start = path.getAttribute("d")!.match(/^M([-.\d]+),([-.\d]+)/)!;
    const marker = svg.querySelector("circle")!;
    return Math.hypot(
      +start[1] - Number(marker.getAttribute("cx")),
      +start[2] - Number(marker.getAttribute("cy")),
    );
  });
  expect(aligned).toBeLessThan(0.01);
  await expect(d.locator(".loom-panes")).toHaveAttribute("aria-busy", "false");
  await openLoomExportSettings(d);
  let downloads = 0;
  page.on("download", () => downloads++);
  await loomMovieAction(d).click();
  await d.getByRole("button", { name: /Cancel export/ }).click();
  await expect(loomMovieAction(d)).toBeEnabled();
  await d.getByLabel("Exact source parameter", { exact: true }).fill("pi");
  await expect(d.locator(".loom-correspondence")).toContainText(
    "Critical point",
  );
  expect(downloads).toBe(0);
  await d.getByRole("button", { name: "Return to study", exact: true }).click();
  await expect(page.locator(".plot-wrap")).toHaveAttribute(
    "aria-busy",
    "false",
  );
});

test("complex loom return cancels an in-flight still download", async ({
  page,
}) => {
  await page.addInitScript(() => {
    const decode = HTMLImageElement.prototype.decode;
    HTMLImageElement.prototype.decode = async function () {
      await new Promise((r) => setTimeout(r, 300));
      return decode.call(this);
    };
    const toBlob = HTMLCanvasElement.prototype.toBlob;
    HTMLCanvasElement.prototype.toBlob = function (callback, ...rest) {
      return toBlob.call(
        this,
        (blob) => {
          callback(blob);
          (window as any).loomEncoded = true;
        },
        ...rest,
      );
    };
  });
  await page.goto("/");
  await settled(page);
  await openLoomExample(page);
  const d = page.getByRole("dialog", { name: "The complex loom" });
  await expect(d.locator(".loom-panes")).toHaveAttribute("aria-busy", "false");
  await openLoomExportSettings(d);
  let downloaded = 0;
  page.on("download", () => downloaded++);
  await loomImage(d, "PNG");
  await d.getByRole("button", { name: "Return to study", exact: true }).click();
  await expect
    .poll(() => page.evaluate(() => (window as any).loomEncoded))
    .toBe(true);
  await page.waitForTimeout(100); // The completed encode has had time to publish.
  expect(downloaded).toBe(0);
});

test("complex loom pause holds the last shown correspondence under delayed point replies", async ({
  page,
}) => {
  await page.addInitScript(() => {
    const send = Worker.prototype.postMessage;
    Worker.prototype.postMessage = function (q: any, ...rest: any[]) {
      if (q.action === "loom" && q.pointOnly)
        setTimeout(() => send.call(this, q, ...rest), 200);
      else send.call(this, q, ...rest);
    };
  });
  await page.goto("/");
  await settled(page);
  await openLoomExample(page);
  const d = page.getByRole("dialog", { name: "The complex loom" }),
    readout = d.locator(".loom-correspondence");
  await expect(d.locator(".loom-panes")).toHaveAttribute("aria-busy", "false");
  await d.getByLabel("Traversal duration", { exact: true }).fill("30");
  await d.getByRole("button", { name: "Play traversal", exact: true }).click();
  await expect
    .poll(async () => Number(await readout.getAttribute("data-parameter")))
    .toBeGreaterThan(0.05);
  await d.getByRole("button", { name: "Pause traversal", exact: true }).click();
  const held = await readout.getAttribute("data-parameter");
  await page.waitForTimeout(350); // A delayed old point must have no effect.
  expect(await readout.getAttribute("data-parameter")).toBe(held);
});

test("complex loom production worker bounds, preparation/transfer and paint observations", async ({
  page,
}) => {
  await page.addInitScript(() => {
    const Native = Worker;
    (window as any).loomMeasurements = [];
    (window as any).loomPeak = 0;
    let running = 0;
    window.Worker = class extends Native {
      sent = new Map<number, { time: number; q: any }>();
      constructor(...args: ConstructorParameters<typeof Worker>) {
        super(...args);
        this.addEventListener("message", (e) => {
          const sent = this.sent.get(e.data.id);
          if (!sent) return;
          this.sent.delete(e.data.id);
          running--;
          if (e.data.result?.members) {
            const r = e.data.result;
            (window as any).loomMeasurements.push({
              source: sent.q.source.kind,
              samples: sent.q.samples,
              tolerance: sent.q.tolerance,
              points: r.points,
              evaluations: r.evaluations,
              entries: r.numericEntries,
              typedEntries: e.data.lifted?.floats.length,
              prepare: e.data.timings.prepare,
              bytes: e.data.timings.bytes,
              roundTrip: performance.now() - sent.time,
              received: performance.now(),
            });
          }
        });
      }
      postMessage(message: any, ...rest: any[]) {
        if (message.action === "loom") {
          this.sent.set(message.id, {
            time: performance.now(),
            q: message.loom,
          });
          running++;
          (window as any).loomPeak = Math.max(
            (window as any).loomPeak,
            running,
          );
        }
        return super.postMessage(message, ...rest);
      }
    } as typeof Worker;
    new MutationObserver(() => {
      const rows = (window as any).loomMeasurements;
      if (
        !rows.length ||
        document.querySelector(".loom-panes")?.getAttribute("aria-busy") !==
          "false"
      )
        return;
      const row = rows.at(-1);
      if (row.commit === undefined) {
        row.commit = performance.now() - row.received;
        requestAnimationFrame(() =>
          requestAnimationFrame(
            () => (row.paint = performance.now() - row.received),
          ),
        );
      }
    }).observe(document, {
      subtree: true,
      attributes: true,
      childList: true,
      attributeFilter: ["aria-busy"],
    });
  });
  await page.goto("/");
  await settled(page);
  await page
    .getByLabel("x(t)", { exact: true })
    .fill("2*cos(t)+0.12*cos(701*t)");
  await page
    .getByLabel("y(t)", { exact: true })
    .fill("2*sin(t)+0.12*sin(701*t)");
  await settled(page);
  await page
    .getByRole("button", { name: "Open complex loom", exact: true })
    .click();
  const d = page.getByRole("dialog", { name: "The complex loom" }),
    art = d.locator(".loom-panes");
  await expect(art).toHaveAttribute("aria-busy", "false");
  await page.emulateMedia({ colorScheme: "light" });
  await d.screenshot({
    path: test.info().outputPath("loom-rosette-light.png"),
  });
  await page.emulateMedia({ colorScheme: "dark" });
  await d.screenshot({ path: test.info().outputPath("loom-rosette-dark.png") });
  await d.getByLabel("Source family", { exact: true }).selectOption("grid");
  await expect(art).toHaveAttribute("aria-busy", "false");
  await d.screenshot({ path: test.info().outputPath("loom-grid-dark.png") });
  await d.getByLabel("Vertical lines", { exact: true }).fill("32");
  await d.getByLabel("Horizontal lines", { exact: true }).fill("32");
  await d.getByText("Sampling and limits", { exact: true }).click();
  await d.getByLabel("Samples per member", { exact: true }).fill("1024");
  await expect(art).toHaveAttribute("aria-busy", "false");
  await d.getByLabel("Source family", { exact: true }).selectOption("curve");
  await expect(art).toHaveAttribute("aria-busy", "false");
  await expect(d.locator('[data-pane="source"] [data-member]')).toHaveCount(1);
  await page.setViewportSize({ width: 390, height: 844 });
  await d.screenshot({ path: test.info().outputPath("loom-phone.png") });
  await d.getByLabel("Source family", { exact: true }).selectOption("grid");
  await d.getByRole("button", { name: "Return to study", exact: true }).click();
  const metrics = await page.evaluate(() => ({
    rows: (window as any).loomMeasurements,
    peak: (window as any).loomPeak,
  }));
  expect(metrics.peak).toBe(1);
  expect(metrics.rows.length).toBeGreaterThanOrEqual(4);
  for (const r of metrics.rows) {
    expect(r.points).toBeLessThanOrEqual(500000);
    expect(r.evaluations).toBeLessThanOrEqual(1000000);
    expect(r.entries).toBeLessThanOrEqual(2000000);
    expect(r.typedEntries).toBeGreaterThan(0);
  }
  console.log(
    "Loom production measurements (milliseconds, bytes; Chromium on local Mac):",
    JSON.stringify(metrics),
  );
});

test("complex loom copied links restore the frozen source, selection, parameter and both views", async ({
  page,
}) => {
  await page.addInitScript(() =>
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: {
        writeText: async (value: string) => {
          (window as any).loomCopied = value;
        },
      },
    }),
  );
  await page.goto("/");
  await settled(page);
  await page.getByLabel("x(t)", { exact: true }).fill("3+2*cos(t)");
  await settled(page);
  await page
    .getByRole("button", { name: "Open complex loom", exact: true })
    .click();
  const d = page.getByRole("dialog", { name: "The complex loom" });
  await d.getByLabel("Source family", { exact: true }).selectOption("curve");
  await expect(d.locator(".loom-panes")).toHaveAttribute("aria-busy", "false");
  await d.getByLabel("Exact source parameter", { exact: true }).fill("pi");
  await expect
    .poll(
      async () =>
        JSON.parse(
          (await d
            .locator('[data-pane="source"] [data-marker]')
            .getAttribute("data-point"))!,
        ).x,
    )
    .toBe(1);
  const mapped = JSON.parse(
    (await d
      .locator('[data-pane="image"] [data-marker]')
      .getAttribute("data-point"))!,
  );
  expect(mapped.x).toBeCloseTo(1, 12);
  expect(mapped.y).toBeCloseTo(0, 12);
  await d.locator('[data-pane="source"]').press("+");
  await d.locator('[data-pane="image"]').press("ArrowRight");
  const source = await d
    .locator('[data-pane="source"] [data-member]')
    .getAttribute("d");
  const image = await d
    .locator('[data-pane="image"] [data-member]')
    .getAttribute("d");
  await openLoomExportSettings(d);
  await d.getByRole("button", { name: "Copy link", exact: true }).click();
  await expect(d.getByText("Link copied", { exact: true })).toBeVisible();
  const link = await page.evaluate(() => (window as any).loomCopied as string);
  const saved = wireStudy(new URL(link).hash.slice(3));
  expect(saved.loom.source.curve.x).toBe("3+2*cos(t)");
  expect(saved.loom.views.source.zoom).toBe(1.2);
  expect(saved.loom.views.image.x).toBe(25);
  await d.getByRole("button", { name: "Return to study", exact: true }).click();
  await page.getByLabel("x(t)", { exact: true }).fill("cos(t)");
  await settled(page);
  await page.goto(link);
  await expect(page).not.toHaveURL(/#s=/);
  await expect(d).toBeVisible();
  await expect(d.locator(".loom-panes")).toHaveAttribute("aria-busy", "false");
  expect(
    await d.locator('[data-pane="source"] [data-member]').getAttribute("d"),
  ).toBe(source);
  expect(
    await d.locator('[data-pane="image"] [data-member]').getAttribute("d"),
  ).toBe(image);
  await expect(
    d.getByLabel("Exact source parameter", { exact: true }),
  ).toHaveValue("pi");
});

test("complex loom refuses invalid traversal duration before play or export", async ({
  page,
}) => {
  await page.goto("/");
  await settled(page);
  await openLoomExample(page);
  const d = page.getByRole("dialog", { name: "The complex loom" });
  await expect(d.locator(".loom-panes")).toHaveAttribute("aria-busy", "false");
  await d.getByLabel("Traversal duration", { exact: true }).fill("0");
  await expect(
    d.getByRole("button", { name: "Play traversal", exact: true }),
  ).toBeDisabled();
  await expect(d.getByRole("alert").first()).toContainText("0.1–3,600");
  await d.getByLabel("Traversal duration", { exact: true }).fill("2");
  await expect(
    d.getByRole("button", { name: "Play traversal", exact: true }),
  ).toBeEnabled();
});

test("complex loom freezes the latest editor source while an engraving suspends ordinary computation", async ({
  page,
}) => {
  await page.goto("/");
  await settled(page);
  await page.getByLabel("x(t)", { exact: true }).fill("3+2*cos(t)");
  await settled(page);
  await page
    .getByRole("checkbox", { name: "Finite engraving", exact: true })
    .check();
  await settled(page);
  await page.getByLabel("x(t)", { exact: true }).fill("5+2*cos(t)");
  await settled(page);
  await page
    .getByRole("button", { name: "Open complex loom", exact: true })
    .click();
  const d = page.getByRole("dialog", { name: "The complex loom" });
  await d.getByLabel("Source family", { exact: true }).selectOption("curve");
  await expect(d.locator(".loom-panes")).toHaveAttribute("aria-busy", "false");
  await expect
    .poll(
      async () =>
        JSON.parse(
          (await d
            .locator('[data-pane="source"] [data-marker]')
            .getAttribute("data-point"))!,
        ).x,
    )
    .toBe(7);
});

test("complex loom uses shared export actions and inherits appearance without duplicate pickers", async ({
  page,
}) => {
  await page.goto("/");
  await settled(page);
  await page
    .getByRole("button", { name: "About complex loom", exact: true })
    .click();
  await expect(
    page.getByText(/Map this study.s curve or its derived curve/),
  ).toBeVisible();
  await openLoomExample(page);
  const d = page.getByRole("dialog", { name: "The complex loom" });
  await expect(
    d.getByRole("button", { name: "Export image", exact: false }),
  ).toBeVisible();
  await expect(
    d.getByRole("button", { name: "Animation", exact: false }),
  ).toBeVisible();
  await expect(d.getByLabel("Color scheme", { exact: true })).toHaveCount(0);
  await expect(
    d.getByRole("button", { name: /Use (light|dark) (theme|background)/ }),
  ).toHaveCount(0);
  await d.getByRole("button", { name: "Animation", exact: false }).click();
  await expect(d.locator("#loom-export-settings > summary")).toBeVisible();
});

test("complex loom consumes wheel zoom and preserves visible radius changes", async ({
  page,
}) => {
  await page.goto("/");
  await settled(page);
  await openLoomExample(page);
  const d = page.getByRole("dialog", { name: "The complex loom" });
  await expect(d.locator(".loom-panes")).toHaveAttribute("aria-busy", "false");
  const svg = d.locator('[data-pane="source"]');
  const consumed = await svg.evaluate(
    (e) =>
      !e.dispatchEvent(
        new WheelEvent("wheel", {
          deltaY: -100,
          bubbles: true,
          cancelable: true,
          clientX: e.getBoundingClientRect().x + 100,
          clientY: e.getBoundingClientRect().y + 100,
        }),
      ),
  );
  expect(consumed).toBe(true);
  await d.getByRole("button", { name: "Fit source", exact: true }).click();
  const span = () =>
    svg
      .locator("path")
      .first()
      .evaluate((e) => e.getBBox().width);
  const before = await span();
  await d.getByLabel("Circle radius", { exact: true }).fill("0.5");
  await expect(d.locator(".loom-panes")).toHaveAttribute("aria-busy", "false");
  expect(await span()).toBeCloseTo(before * 0.5, 1);
});

async function openLoomExportSettings(d: Locator) {
  const settings = d.locator("#loom-export-settings");
  if (!(await settings.evaluate((e) => (e as HTMLDetailsElement).open)))
    await settings.locator(":scope > summary").click();
}
async function loomImage(d: Locator, kind: "SVG" | "PNG") {
  await d.getByRole("button", { name: "Export image", exact: false }).click();
  await d
    .getByRole("menuitem", {
      name: kind === "SVG" ? /SVG · vector/ : /PNG image/,
    })
    .click();
}
function loomMovieAction(d: Locator) {
  return d.getByRole("button", { name: /^Export (MP4 video|animated WebP)/ });
}
async function loomResolution(d: Locator, n: number) {
  await d
    .getByLabel("Export resolution", { exact: true })
    .evaluate((input, value) => {
      Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value",
      )!.set!.call(input, String(value));
      input.dispatchEvent(new Event("input", { bubbles: true }));
    }, n);
}

test("complex loom pinch zooms independently and mobile Play reveals both panes before the first point", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await settled(page);
  await openLoomExample(page);
  const d = page.getByRole("dialog", { name: "The complex loom" }),
    source = d.locator('[data-pane="source"]'),
    image = d.locator('[data-pane="image"]');
  await expect(d.locator(".loom-panes")).toHaveAttribute("aria-busy", "false");
  await source.scrollIntoViewIfNeeded();
  const box = (await source.boundingBox())!,
    cx = box.x + box.width / 2,
    cy = box.y + box.height / 2;
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Input.dispatchTouchEvent", {
    type: "touchStart",
    touchPoints: [
      { x: cx - 40, y: cy, id: 1 },
      { x: cx + 40, y: cy, id: 2 },
    ],
  });
  await cdp.send("Input.dispatchTouchEvent", {
    type: "touchMove",
    touchPoints: [
      { x: cx - 60, y: cy, id: 1 },
      { x: cx + 60, y: cy, id: 2 },
    ],
  });
  await cdp.send("Input.dispatchTouchEvent", {
    type: "touchEnd",
    touchPoints: [],
  });
  await expect
    .poll(async () => Number(await source.getAttribute("data-zoom")))
    .toBeGreaterThan(1.4);
  await expect(image).toHaveAttribute("data-zoom", "1");
  await d.getByRole("button", { name: "Fit source", exact: true }).click();
  const play = d.getByRole("button", { name: "Play traversal", exact: true });
  await play.scrollIntoViewIfNeeded();
  await play.click();
  const panes = (await d.locator(".loom-panes").boundingBox())!,
    bar = (await d.locator("#loom-playback").boundingBox())!;
  expect(panes.y).toBeGreaterThanOrEqual(-1);
  expect(panes.y + panes.height).toBeLessThanOrEqual(bar.y + 1);
  await expect
    .poll(async () =>
      Number(
        await d.locator(".loom-correspondence").getAttribute("data-parameter"),
      ),
    )
    .toBeGreaterThan(0);
});

test("complex loom controls leave room for keyboard focus rings and viewport clicks select a source", async ({
  page,
}) => {
  await page.goto("/");
  await settled(page);
  await openLoomExample(page);
  const d = page.getByRole("dialog", { name: "The complex loom" });
  await expect(d.locator(".loom-panes")).toHaveAttribute("aria-busy", "false");
  const aside = (await d.locator("aside").boundingBox())!;
  for (const label of ["Source family", "Circle radius"]) {
    const e = d.getByLabel(label, { exact: true });
    await e.press("Tab");
    const r = (await e.boundingBox())!;
    expect(r.x - aside.x).toBeGreaterThanOrEqual(6);
    expect(aside.x + aside.width - r.x - r.width).toBeGreaterThanOrEqual(6);
  }
  const at = await d
    .locator('[data-pane="source"] [data-member="3"]')
    .evaluate((e) => {
      const m = (e.ownerSVGElement as SVGSVGElement).getScreenCTM()!;
      const p = (e as SVGPathElement).getPointAtLength(0);
      return { x: m.a * p.x + m.c * p.y + m.e, y: m.b * p.x + m.d * p.y + m.f };
    });
  await page.mouse.click(at.x, at.y);
  await expect(d.getByLabel("Selected member", { exact: true })).toHaveValue(
    "3",
  );
});

test("complex loom cancels a movie if the inherited system theme changes", async ({
  page,
}) => {
  await page.emulateMedia({ colorScheme: "light" });
  await page.addInitScript(() => {
    const send = Worker.prototype.postMessage;
    Worker.prototype.postMessage = function (q: any, ...rest: any[]) {
      if (q.action === "loom" && q.pointOnly)
        setTimeout(() => send.call(this, q, ...rest), 200);
      else send.call(this, q, ...rest);
    };
  });
  await page.goto("/");
  await settled(page);
  await openLoomExample(page);
  const d = page.getByRole("dialog", { name: "The complex loom" });
  await expect(d.locator(".loom-panes")).toHaveAttribute("aria-busy", "false");
  await loomMovieAction(d).click();
  await expect(
    d.getByRole("button", { name: "Cancel export", exact: true }),
  ).toBeVisible();
  await expect(
    d.getByRole("status").filter({ hasText: /Exporting/ }),
  ).toHaveAttribute("aria-live", "off");
  await page.emulateMedia({ colorScheme: "dark" });
  await expect(
    d.getByRole("button", { name: "Cancel export", exact: true }),
  ).toHaveCount(0);
  await expect(loomMovieAction(d)).toBeEnabled();
});

test("complex loom shows an invalid field message once under its control", async ({
  page,
}) => {
  await page.goto("/");
  await settled(page);
  await openLoomExample(page);
  const d = page.getByRole("dialog", { name: "The complex loom" });
  await expect(d.locator(".loom-panes")).toHaveAttribute("aria-busy", "false");
  await d.getByLabel("Circle radius", { exact: true }).fill("0");
  await expect(d.getByRole("alert")).toHaveCount(1);
  await expect(d.getByLabel("Circle radius", { exact: true })).toHaveAttribute(
    "aria-invalid",
    "true",
  );
});

test("a preset replacement cancels a complex loom entry waiting for old input", async ({
  page,
}) => {
  await page.addInitScript(() => {
    const send = Worker.prototype.postMessage;
    Worker.prototype.postMessage = function (q: any, ...rest: any[]) {
      if (q.action === "compute")
        setTimeout(() => send.call(this, q, ...rest), 600);
      else send.call(this, q, ...rest);
    };
  });
  await page.goto("/");
  await settled(page);
  await page.getByLabel("x(t)", { exact: true }).fill("3*cos(t)");
  await page
    .getByRole("button", { name: "Open complex loom", exact: true })
    .click();
  await page.getByRole("button", { name: "Next example", exact: true }).click();
  await settled(page);
  await expect(
    page.getByRole("dialog", { name: "The complex loom" }),
  ).toHaveCount(0);
});

test("complex loom fits supported tiny and large circle units in both planes", async ({
  page,
}) => {
  await page.goto("/");
  await settled(page);
  await openLoomExample(page);
  const d = page.getByRole("dialog", { name: "The complex loom" });
  await expect(d.locator(".loom-panes")).toHaveAttribute("aria-busy", "false");
  for (const radius of ["0.000001", "1000000"]) {
    await d.getByLabel("Circle radius", { exact: true }).fill(radius);
    await expect(d.locator(".loom-panes")).toHaveAttribute(
      "aria-busy",
      "false",
    );
    await d.getByRole("button", { name: "Fit source", exact: true }).click();
    await d.getByRole("button", { name: "Fit image", exact: true }).click();
    for (const pane of ["source", "image"]) {
      const width = await d
        .locator(`[data-pane="${pane}"] path`)
        .first()
        .evaluate((p) => (p as SVGPathElement).getBBox().width);
      expect(width, `${radius} ${pane}`).toBeGreaterThan(200);
      expect(width).toBeLessThan(700);
    }
  }
});

test("complex loom inherits an alternate palette in both panes, its note and vector export", async ({
  page,
}) => {
  await page.emulateMedia({ colorScheme: "light" });
  await page.goto("/");
  await settled(page);
  await page.getByRole("button", { name: "Color scheme", exact: true }).click();
  await page.getByText("Cobalt & rose", { exact: true }).click();
  await openLoomExample(page);
  const d = page.getByRole("dialog", { name: "The complex loom" });
  await expect(d.locator(".loom-panes")).toHaveAttribute("aria-busy", "false");
  await expect(d.getByText(/Cobalt threads retain/)).toBeVisible();
  for (const pane of ["source", "image"]) {
    await expect(
      d.locator(`[data-pane="${pane}"] [data-selected="false"]`).first(),
    ).toHaveAttribute("stroke", "#2758a5");
    await expect(
      d.locator(`[data-pane="${pane}"] [data-selected="true"]`),
    ).toHaveAttribute("stroke", "#ac365f");
  }
  const saved = page.waitForEvent("download");
  await loomImage(d, "SVG");
  const text = await readFile((await (await saved).path())!, "utf8");
  expect(text).toContain('"scheme":"cobalt"');
  expect(text).toContain('stroke="#2758a5"');
  expect(text).toContain('stroke="#ac365f"');
  await d.screenshot({ path: test.info().outputPath("loom-cobalt-light.png") });
});

async function openComplexLoom(page: Page) {
  await page.goto("/");
  await settled(page);
  await openLoomExample(page);
  const d = page.getByRole("dialog", { name: "The complex loom" });
  await expect(d.locator(".loom-panes")).toHaveAttribute("aria-busy", "false");
  return d;
}

test("complex loom slider endpoints preserve the exact source interval", async ({
  page,
}) => {
  const d = await openComplexLoom(page);
  const slider = d.getByLabel("Source parameter", { exact: true });
  for (const [key, value] of [
    ["End", 2 * Math.PI],
    ["Home", 0],
  ] as const) {
    await slider.press(key);
    await expect(d.locator(".loom-correspondence")).toHaveAttribute(
      "data-parameter",
      String(value),
    );
    await expect(d.getByRole("alert")).toHaveCount(0);
  }
  await d.getByLabel("Source family", { exact: true }).selectOption("grid");
  await expect(d.locator(".loom-panes")).toHaveAttribute("aria-busy", "false");
  for (const [key, value] of [
    ["Home", -2],
    ["End", 2],
  ] as const) {
    await slider.press(key);
    await expect(d.locator(".loom-correspondence")).toHaveAttribute(
      "data-parameter",
      String(value),
    );
    await expect(d.getByRole("alert")).toHaveCount(0);
  }
});

// A short desktop window keeps contained columns; phones held sideways have
// their own single-scroll layout, tested below.
for (const size of [
  { width: 1440, height: 900 },
  { width: 1280, height: 560 },
])
  test(`complex loom desktop scroll contains all controls at ${size.width}x${size.height}`, async ({
    page,
  }) => {
    await page.setViewportSize(size);
    const d = await openComplexLoom(page);
    await d.screenshot({
      path: test.info().outputPath(`loom-feedback-${size.width}-light.png`),
    });
    await page.emulateMedia({ colorScheme: "dark" });
    await d.screenshot({
      path: test.info().outputPath(`loom-feedback-${size.width}-dark.png`),
    });
    const main = (await d.locator("main").boundingBox())!;
    expect(main.y + main.height).toBeLessThanOrEqual(size.height + 1);
    await loomMovieAction(d).scrollIntoViewIfNeeded();
    const exportBox = (await loomMovieAction(d).boundingBox())!;
    expect(exportBox.y + exportBox.height).toBeLessThanOrEqual(size.height);
    expect(exportBox.y).toBeGreaterThanOrEqual(0);
    await d.getByRole("button", { name: /^Animation/ }).click();
    await expect
      .poll(async () => (await d.locator("header").boundingBox())!.y)
      .toBe(0);
    const slider = d.getByLabel("Source parameter", { exact: true });
    await slider.scrollIntoViewIfNeeded();
    const scrub = (await slider.boundingBox())!;
    const play = (await d
      .getByRole("button", { name: "Play traversal", exact: true })
      .boundingBox())!;
    const parameter = (await d.locator(".loom-parameter").boundingBox())!;
    expect(parameter.y - play.y - play.height).toBeGreaterThanOrEqual(0);
    expect(parameter.y - play.y - play.height).toBeLessThanOrEqual(30);
    expect(scrub.y).toBeGreaterThanOrEqual(parameter.y);
    expect(scrub.y + scrub.height).toBeLessThanOrEqual(
      parameter.y + parameter.height + 1,
    );
  });

test("complex loom phone configuration appears before the artwork", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const d = await openComplexLoom(page);
  await d.screenshot({
    path: test.info().outputPath("loom-feedback-phone.png"),
  });
  const family = (await d
    .getByLabel("Source family", { exact: true })
    .boundingBox())!;
  const art = (await d.locator(".loom-panes").boundingBox())!;
  expect(family.y + family.height).toBeLessThan(art.y);
  expect(art.y - family.y - family.height).toBeLessThan(110);
  const settings = d.locator(".loom-source-settings");
  await expect(settings).toHaveJSProperty("open", false);
  await settings.locator(":scope > summary").click();
  await d.getByLabel("Circle radius", { exact: true }).fill("1/phi");
  await expect(d.locator(".loom-panes")).toHaveAttribute("aria-busy", "false");
  await settings.locator(":scope > summary").click();
  await expect(d.getByLabel("Source family", { exact: true })).toBeVisible();
});

test("complex loom entry info spacing matches Draw a loop", async ({
  page,
}) => {
  await page.goto("/");
  await settled(page);
  const gaps = [];
  for (const label of ["Draw a loop", "Open complex loom"]) {
    const b = page.getByRole("button", { name: label, exact: true });
    const box = (await b.boundingBox())!;
    const info = (await b
      .locator("xpath=ancestor::div[@class='fit-entry'][1]")
      .getByRole("button")
      .nth(1)
      .boundingBox())!;
    gaps.push(info.x - box.x - box.width);
  }
  expect(gaps[1]).toBe(gaps[0]);
  expect(gaps[1]).toBeGreaterThanOrEqual(8);
});

test("complex loom lazy loading covers the page without shifting the notebook", async ({
  page,
}) => {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route(/\/assets\/Preview-[^/]+\.js$/, async (route) => {
    await gate;
    await route.continue();
  });
  await page.goto("/");
  await settled(page);
  const header = page.locator(".app > header").first();
  const before = (await header.boundingBox())!;
  await page
    .getByRole("button", { name: "Open complex loom", exact: true })
    .click();
  const loading = page.getByText("Opening the complex loom…", { exact: true });
  try {
    await expect(loading).toBeVisible();
    expect((await header.boundingBox())!.y).toBe(before.y);
    const box = (await loading.boundingBox())!;
    expect(box.y).toBe(0);
    expect(box.height).toBe(1000);
    expect(await loading.evaluate((e) => getComputedStyle(e).position)).toBe(
      "fixed",
    );
  } finally {
    release();
  }
  await expect(
    page.getByRole("dialog", { name: "The complex loom" }),
  ).toBeVisible();
});

test("complex loom near misses select thin members without adding export paths", async ({
  page,
}) => {
  const d = await openComplexLoom(page);
  await d
    .getByLabel("Source family", { exact: true })
    .selectOption("concentric");
  await d.getByLabel("Circle count", { exact: true }).fill("3");
  await expect(d.locator(".loom-panes")).toHaveAttribute("aria-busy", "false");
  const path = d.locator('[data-pane="source"] [data-member="2"]');
  const point = await path.evaluate((e) => {
    const path = e as SVGPathElement,
      matrix = path.getScreenCTM()!;
    const pt = path
      .getPointAtLength(path.getTotalLength() / 4)
      .matrixTransform(matrix);
    return { x: pt.x, y: pt.y - 5 };
  });
  await page.mouse.click(point.x, point.y);
  await expect(d.getByLabel("Selected member", { exact: true })).toHaveValue(
    "2",
  );
  // Panning near a different member must not turn the gesture into selection.
  const p = await d
    .locator('[data-pane="source"] [data-member="1"]')
    .evaluate((e) => {
      const path = e as SVGPathElement;
      const pt = path
        .getPointAtLength(path.getTotalLength() / 4)
        .matrixTransform(path.getScreenCTM()!);
      return { x: pt.x, y: pt.y - 5 };
    });
  await page.mouse.move(p.x, p.y);
  await page.mouse.down();
  await page.mouse.move(p.x + 30, p.y + 20);
  await page.mouse.up();
  await expect(d.getByLabel("Selected member", { exact: true })).toHaveValue(
    "2",
  );
  const saved = page.waitForEvent("download");
  await loomImage(d, "SVG");
  const text = await readFile((await (await saved).path())!, "utf8");
  expect(text).not.toContain("data-hit-member");
  expect(text.match(/data-member=/g)).toHaveLength(6);
});

test("complex loom hairline explains its fixed pixel width", async ({
  page,
}) => {
  const d = await openComplexLoom(page);
  await d.getByLabel("Line weight", { exact: true }).selectOption("hairline");
  await expect(
    d.locator('[data-pane="source"] [data-member]').first(),
  ).toHaveAttribute("stroke-width", "1");
  await expect(
    d.locator('[data-pane="source"] [data-member]').first(),
  ).toHaveAttribute("vector-effect", "non-scaling-stroke");
  await d.getByRole("button", { name: "About Line weight" }).click();
  await d.getByRole("button", { name: /Show more/i }).click();
  await expect(
    d.getByText(/small paired panes.*heavier than Fine/i),
  ).toBeVisible();
});

for (const width of [1440, 390])
  test(`complex loom source help sits between its label and scrubber at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 1000 });
    await page.goto("/");
    await settled(page);
    // Existing notebook fields retain their default help placement.
    await page
      .getByRole("button", { name: "About shape parameter a", exact: true })
      .click();
    const ordinary = page.getByLabel("Shape parameter a", { exact: true });
    const before = await ordinary.locator("..").locator(".hint").boundingBox();
    const control = (await ordinary.boundingBox())!;
    expect(before!.y).toBeGreaterThanOrEqual(control.y + control.height);
    await openLoomExample(page);
    const d = page.getByRole("dialog", { name: "The complex loom" });
    await expect(d.locator(".loom-panes")).toHaveAttribute(
      "aria-busy",
      "false",
    );
    const slider = d.getByLabel("Source parameter", { exact: true });
    const field = slider.locator("..");
    await d
      .getByRole("button", { name: "About Source parameter", exact: true })
      .click();
    const checkOrder = async () => {
      const label = (await field.locator(".field-label").boundingBox())!;
      const help = (await field.locator(".hint").boundingBox())!;
      const bar = (await slider.boundingBox())!;
      expect(help.y).toBeGreaterThanOrEqual(label.y + label.height);
      expect(help.y + help.height).toBeLessThanOrEqual(bar.y - 6);
      expect(
        await field.evaluate((e) => {
          const help = e.querySelector(".hint")!,
            input = e.querySelector("input")!;
          return !!(
            help.compareDocumentPosition(input) &
            Node.DOCUMENT_POSITION_FOLLOWING
          );
        }),
      ).toBe(true);
    };
    await checkOrder();
    await field.getByRole("button", { name: "Show more", exact: true }).click();
    await checkOrder();
    await expect(slider).toHaveAttribute(
      "aria-describedby",
      await field.locator(".hint").getAttribute("id"),
    );
    await d.screenshot({
      path: test.info().outputPath(`loom-help-${width}.png`),
    });
  });

test("complex loom names the frozen base study curve and explains it beside the family picker on phones", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const d = await openComplexLoom(page);
  const family = d.getByLabel("Source family", { exact: true });
  await expect(family.locator('option[value="curve"]')).toHaveText(
    "Curve from your base study",
  );
  await family.selectOption("curve");
  await expect(d.locator(".loom-panes")).toHaveAttribute("aria-busy", "false");
  await expect(d.locator(".loom-source-settings")).toHaveJSProperty(
    "open",
    false,
  );
  const note = d.getByText(
    /This is a frozen copy of your base study’s parametric curve/,
  );
  await expect(note).toBeVisible();
  await expect(note).toContainText(
    "Return to study, edit the curve, then reopen the loom",
  );
  const selectBox = (await family.boundingBox())!,
    noteBox = (await note.boundingBox())!;
  const settings = (await d
    .getByText("Source settings", { exact: true })
    .boundingBox())!;
  expect(noteBox.y).toBeGreaterThanOrEqual(selectBox.y + selectBox.height);
  expect(noteBox.y + noteBox.height).toBeLessThanOrEqual(settings.y);
  await d
    .getByRole("button", { name: "About Source family", exact: true })
    .click();
  const help = family.locator("..").locator(".hint");
  await help.getByRole("button", { name: "Show more", exact: true }).click();
  await expect(help).toContainText("when you opened the loom");
  await expect(d.locator('[data-pane="source"] [data-member]')).toHaveCount(1);
  await d.screenshot({
    path: test.info().outputPath("loom-base-study-copy-phone.png"),
  });
});

for (const dark of [false, true])
  test(`complex loom unsupported sources use the standard field error in ${dark ? "dark" : "light"} theme`, async ({
    page,
  }) => {
    await page.emulateMedia({ colorScheme: dark ? "dark" : "light" });
    await page.goto("/");
    await settled(page);
    // Compare against an actual standard field error, not a new loom color.
    const shape = page.getByLabel("Shape parameter a", { exact: true });
    await shape.fill("t");
    const standard = shape.locator("..").getByRole("alert");
    await expect(standard).toBeVisible();
    const expected = await standard.evaluate((e) => {
      const c = getComputedStyle(e);
      return { color: c.color, fontSize: c.fontSize, lineHeight: c.lineHeight };
    });
    await shape.fill("1");
    await settled(page);
    await page
      .getByLabel("Definition", { exact: true })
      .selectOption("pursuit");
    await settled(page);
    await openLoomExample(page);
    const d = page.getByRole("dialog", { name: "The complex loom" });
    const family = d.getByLabel("Source family", { exact: true });
    const scrollBefore = await d.locator("main").evaluate((e) => e.scrollTop);
    await family.selectOption("curve");
    const alert = d.getByRole("alert").filter({ hasText: /unsupported/ });
    await expect(alert).toHaveCSS("color", expected.color);
    await expect(alert).toHaveCSS("font-size", expected.fontSize);
    await expect(alert).toHaveCSS("line-height", expected.lineHeight);
    await expect(d.getByRole("alert")).toHaveCount(1);
    expect(await d.locator("main").evaluate((e) => e.scrollTop)).toBe(
      scrollBefore,
    );
    await expect(family).toHaveAttribute("aria-invalid", "true");
    const associated = await family.getAttribute("aria-describedby");
    expect(associated?.split(" ")).toContain(await alert.getAttribute("id"));
    const select = (await family.boundingBox())!,
      error = (await alert.boundingBox())!;
    expect(error.y).toBeGreaterThanOrEqual(select.y + select.height);
    await d.screenshot({
      path: test
        .info()
        .outputPath(`loom-unsupported-${dark ? "dark" : "light"}.png`),
    });
    await family.selectOption("rosette");
    await expect(d.locator(".loom-panes")).toHaveAttribute(
      "aria-busy",
      "false",
    );
    await expect(d.getByRole("alert")).toHaveCount(0);
    await expect(family).not.toHaveAttribute("aria-invalid", "true");
  });

test("complex loom unclaimed export errors use the shared study error presentation", async ({
  page,
}) => {
  await page.addInitScript(() => {
    HTMLCanvasElement.prototype.toBlob = function () {
      throw new Error("Unsupported test image encoder");
    };
  });
  const d = await openComplexLoom(page);
  await loomImage(d, "PNG");
  const alert = d.getByRole("alert");
  await expect(alert).toContainText("Unsupported test image encoder");
  await expect(alert).toHaveClass("study-error");
  await expect(alert).toHaveCSS("font-size", "12.5px");
});

test("the loom button opens the study's own curve, including one with undefined stretches", async ({
  page,
}) => {
  await page.goto("/");
  await settled(page);
  // Defined only for t in [2, 4]: a semicircle of radius 1 about the origin.
  await page.getByLabel("x(t)", { exact: true }).fill("t-3");
  await page.getByLabel("y(t)", { exact: true }).fill("sqrt(1-(t-3)^2)");
  await settled(page);
  await page
    .getByRole("button", { name: "Open complex loom", exact: true })
    .click();
  const d = page.getByRole("dialog", { name: "The complex loom" });
  await expect(d.locator(".loom-panes")).toHaveAttribute("aria-busy", "false");
  await expect(d.getByLabel("Source family", { exact: true })).toHaveValue(
    "curve",
  );
  for (const pane of ["source", "image"]) {
    const path = d.locator(`[data-pane="${pane}"] [data-member]`);
    await expect(path).toHaveCount(1);
    expect((await path.getAttribute("d"))!.length).toBeGreaterThan(100);
  }
  await expect(d.locator("[data-gaps]")).toContainText("Gaps: 2 undefined.");
  await expect(d.locator("[data-gaps]")).not.toContainText("budget");
  // The marker starts at the source interval's start, where it is undefined.
  await expect(d.locator(".loom-correspondence")).toContainText(
    "Correspondence undefined",
  );
  await d.getByLabel("Exact source parameter", { exact: true }).fill("3");
  await expect
    .poll(async () =>
      JSON.parse(
        (await d
          .locator('[data-pane="image"] [data-marker]')
          .getAttribute("data-point")) ?? "null",
      ),
    )
    .toEqual({ x: -1, y: 0 });
});

test("the loom button is unavailable for unsupported sources and says why", async ({
  page,
}) => {
  await page.goto("/");
  await settled(page);
  const button = page.getByRole("button", {
    name: "Open complex loom",
    exact: true,
  });
  await expect(button).toBeEnabled();
  for (const label of [
    "Cassini ovals & the lemniscate",
    "Seven pursuers & an evolute",
  ]) {
    await choosePreset(page, { label });
    await settled(page);
    await expect(button, label).toBeDisabled();
  }
  await page
    .getByRole("button", { name: "About complex loom", exact: true })
    .click();
  const help = button.locator("xpath=ancestor::div[1]/following-sibling::*[1]");
  await help.getByRole("button", { name: "Show more", exact: true }).click();
  await expect(help).toContainText(
    "parametric, Cartesian, polar, roulette, Lissajous and Fourier",
  );
  await expect(help).toContainText("Complex maps");
  await choosePreset(page, { label: "Ellipse & its evolute" });
  await settled(page);
  await expect(button).toBeEnabled();
});

test("gallery loom examples open their family over the study and return to it", async ({
  page,
}) => {
  await page.goto("/");
  await settled(page);
  await page.getByLabel("x(t)", { exact: true }).fill("3*cos(t)");
  await settled(page);
  await page.getByRole("button", { name: "Browse notebook examples" }).click();
  const gallery = page.getByRole("dialog", { name: "Notebook examples" });
  const section = gallery.getByRole("region", { name: "Complex maps" });
  const cards = section.locator("[data-loom-example]");
  await expect(cards).toHaveCount(18);
  await expect(gallery.locator("[data-example]")).toHaveCount(72);
  for (const card of await cards.all()) {
    await card.scrollIntoViewIfNeeded();
    await expect(
      card.locator(".example-thumb"),
      (await card.getAttribute("data-example-title")) ?? "",
    ).toHaveAttribute("data-state", "ready");
    expect(await card.getAttribute("aria-current")).toBeNull();
  }
  // Search reaches them, and Enter opens the first match.
  await gallery
    .getByRole("searchbox", { name: "Search examples" })
    .fill("square grid");
  await page.keyboard.press("Enter");
  const d = page.getByRole("dialog", { name: "The complex loom" });
  await expect(d.locator(".loom-panes")).toHaveAttribute("aria-busy", "false");
  await expect(d.getByLabel("Source family", { exact: true })).toHaveValue(
    "grid",
  );
  await expect(d.locator('[data-pane="source"] [data-member]')).toHaveCount(26);
  // The study's own curve remains the loom's curve source.
  await d.getByLabel("Source family", { exact: true }).selectOption("curve");
  await expect(d.locator(".loom-panes")).toHaveAttribute("aria-busy", "false");
  await d.getByLabel("Exact source parameter", { exact: true }).fill("0");
  await expect
    .poll(async () =>
      JSON.parse(
        (await d
          .locator('[data-pane="source"] [data-marker]')
          .getAttribute("data-point")) ?? "null",
      ),
    )
    .toEqual({ x: 3, y: 0 });
  await d.getByRole("button", { name: "Return to study", exact: true }).click();
  await expect(d).toBeHidden();
  await expect(
    page.getByRole("button", { name: "Browse notebook examples" }),
  ).toBeFocused();
  await expect(page.getByLabel("x(t)", { exact: true })).toHaveValue(
    "3*cos(t)",
  );
  await expect(page.locator(".example-current")).toHaveText("Custom study");
});

test("returning from an opened loom link shows the link's base study", async ({
  page,
  browser,
}) => {
  await page.addInitScript(() =>
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: {
        writeText: async (value: string) => {
          (window as any).loomCopied = value;
        },
      },
    }),
  );
  await page.goto("/");
  await settled(page);
  await page.getByLabel("x(t)", { exact: true }).fill("3+2*cos(t)");
  await settled(page);
  await page
    .getByRole("button", { name: "Open complex loom", exact: true })
    .click();
  const d = page.getByRole("dialog", { name: "The complex loom" });
  await expect(d.locator(".loom-panes")).toHaveAttribute("aria-busy", "false");
  await d.getByRole("button", { name: "Copy link", exact: true }).click();
  await expect
    .poll(() => page.evaluate(() => (window as any).loomCopied))
    .toBeTruthy();
  const link: string = await page.evaluate(() => (window as any).loomCopied);
  const fresh = await browser.newPage();
  await fresh.goto(link);
  const opened = fresh.getByRole("dialog", { name: "The complex loom" });
  await expect(opened.locator(".loom-panes")).toHaveAttribute(
    "aria-busy",
    "false",
  );
  await opened
    .getByRole("button", { name: "Return to study", exact: true })
    .click();
  await settled(fresh);
  await expect(fresh.getByLabel("x(t)", { exact: true })).toHaveValue(
    "3+2*cos(t)",
  );
  await fresh.close();
});

// A phone held sideways scrolls one page: both panes side by side at their
// own proportions, held in view beside the controls column while it scrolls.
for (const size of [
  { width: 844, height: 390 },
  { width: 667, height: 375 },
])
  test(`complex loom keeps both panes legible beside its controls in phone landscape ${size.width}x${size.height}`, async ({
    page,
  }) => {
    await page.setViewportSize(size);
    await page.goto("/");
    await settled(page);
    await openLoomExample(page);
    const d = page.getByRole("dialog", { name: "The complex loom" });
    await expect(d.locator(".loom-panes")).toHaveAttribute(
      "aria-busy",
      "false",
    );
    await expect(d.locator(".loom-source-settings")).toHaveJSProperty(
      "open",
      false,
    );
    // One scroll container: the dialog, not its columns.
    for (const column of ["aside", "main"])
      expect(
        await d
          .locator(`.loom-layout > ${column}`)
          .evaluate((e) => getComputedStyle(e).overflowY),
      ).toBe("visible");
    const panes = d.locator(".loom-panes svg");
    const boxes = async () =>
      Promise.all([0, 1].map(async (i) => (await panes.nth(i).boundingBox())!));
    let [source, image] = await boxes();
    expect(Math.abs(source.y - image.y)).toBeLessThan(1);
    expect(image.x).toBeGreaterThan(source.x + source.width);
    for (const box of [source, image]) {
      // Not letterboxed: the box keeps the drawing's own proportions.
      expect(Math.abs(box.width / box.height - 1000 / 760)).toBeLessThan(0.02);
      expect(box.height).toBeGreaterThanOrEqual(130);
    }
    // Scrubbing and playing keep both panes wholly in view.
    const play = d.getByRole("button", { name: "Play traversal" });
    const slider = d.getByLabel("Source parameter", { exact: true });
    await play.scrollIntoViewIfNeeded();
    for (const control of [play, slider]) {
      const c = (await control.boundingBox())!;
      expect(c.y).toBeGreaterThanOrEqual(0);
      expect(c.y + c.height).toBeLessThanOrEqual(size.height);
      expect(c.x).toBeGreaterThanOrEqual(image.x + image.width);
    }
    [source, image] = await boxes();
    for (const box of [source, image]) {
      expect(box.y).toBeGreaterThanOrEqual(0);
      expect(box.y + box.height).toBeLessThanOrEqual(size.height);
    }
    await play.click();
    await expect(
      d.getByRole("button", { name: "Pause traversal" }),
    ).toBeVisible();
    const docked = await d
      .locator("#loom-playback")
      .evaluate((e) => getComputedStyle(e).position);
    expect(docked).not.toBe("fixed");
    await d.getByRole("button", { name: "Pause traversal" }).click();
    // Export is reachable below, and the header above.
    await loomMovieAction(d).scrollIntoViewIfNeeded();
    const exportBox = (await loomMovieAction(d).boundingBox())!;
    expect(exportBox.y).toBeGreaterThanOrEqual(0);
    expect(exportBox.y + exportBox.height).toBeLessThanOrEqual(size.height);
    await d
      .getByRole("button", { name: "Return to study" })
      .scrollIntoViewIfNeeded();
    expect((await d.locator("header").boundingBox())!.y).toBeGreaterThanOrEqual(
      0,
    );
  });

// The power map's correspondence, read from the drawing's own markers.
async function loomPoint(d: Locator, pane: "source" | "image") {
  return JSON.parse(
    (await d
      .locator(`[data-pane="${pane}"] [data-marker]`)
      .getAttribute("data-point"))!,
  ) as { x: number; y: number };
}
const power = (z: { x: number; y: number }, n: number) => {
  const r = Math.hypot(z.x, z.y) ** n,
    a = n * Math.atan2(z.y, z.x);
  return { x: r * Math.cos(a), y: r * Math.sin(a) };
};

test("power loom degree redraws both words and geometry, keeps cameras and saves vector metadata", async ({
  page,
}) => {
  await page.goto("/");
  await settled(page);
  await openLoomExample(page, "A quintic rosette");
  const d = page.getByRole("dialog", { name: "The complex loom" }),
    art = d.locator(".loom-panes");
  await expect(art).toHaveAttribute("aria-busy", "false");
  await expect(d.locator(".eyebrow")).toHaveText(
    "Complex transformation · w = z⁵",
  );
  await expect(d.locator(".loom-pane-heading h3").nth(1)).toHaveText(
    "Image plane · z⁵",
  );
  await expect(d.getByLabel("Degree", { exact: true })).toHaveValue("5");
  // The rotated circle starts at z = 2, so its fifth power is 32.
  expect(await loomPoint(d, "image")).toEqual({ x: 32, y: 0 });
  // No pole, exclusion or map motion belongs to a power.
  await expect(d.getByText("Map settings", { exact: true })).toHaveCount(0);
  await expect(d.getByLabel("Motion", { exact: true })).toHaveCount(0);
  await expect(d.locator("[data-exclusion]")).toHaveCount(0);
  await d.locator('[data-pane="image"]').press("+");
  const quintic = await d
    .locator('[data-pane="image"] [data-member="3"]')
    .getAttribute("d");
  await d.getByLabel("Degree", { exact: true }).selectOption("3");
  await expect(art).toHaveAttribute("aria-busy", "false");
  await expect.poll(() => loomPoint(d, "image")).toEqual({ x: 8, y: 0 });
  await expect(d.locator(".eyebrow")).toHaveText(
    "Complex transformation · w = z³",
  );
  expect(
    await d.locator('[data-pane="image"] [data-member="3"]').getAttribute("d"),
  ).not.toBe(quintic);
  await expect(d.locator('[data-pane="image"]')).toHaveAttribute(
    "data-zoom",
    "1.2",
  );
  await expect(d.locator("[data-gaps]")).toContainText("No gaps");
  // The rosette's θ = π is exactly the critical zero in both panes.
  await d.getByLabel("Exact source parameter", { exact: true }).fill("pi");
  await expect.poll(() => loomPoint(d, "source")).toEqual({ x: 0, y: 0 });
  expect(await loomPoint(d, "image")).toEqual({ x: 0, y: 0 });
  await expect(d.locator(".loom-correspondence")).toContainText(
    "Critical point",
  );
  const download = page.waitForEvent("download");
  await loomImage(d, "SVG");
  expect((await download).suggestedFilename()).toBe("complex-power-3.svg");
  const svg = await readFile((await (await download).path())!, "utf8");
  for (const text of ['"map":"power"', '"degree":3', '"formula":"w = z³"'])
    expect(svg).toContain(text);
  expect(svg).toContain("1e100");
  expect(svg).not.toMatch(/<text|<image/);
  // Squaring has no degree; a retained degree returns with the power map.
  await d.getByLabel("Complex map", { exact: true }).selectOption("square");
  await expect(art).toHaveAttribute("aria-busy", "false");
  await expect(d.getByLabel("Degree", { exact: true })).toHaveCount(0);
  await expect(d.locator(".eyebrow")).toHaveText(
    "Complex transformation · w = z²",
  );
  await d.getByLabel("Complex map", { exact: true }).selectOption("power");
  await expect(d.getByLabel("Degree", { exact: true })).toHaveValue("3");
  await expect(art).toHaveAttribute("aria-busy", "false");
  expect(await loomPoint(d, "image")).toEqual({ x: 0, y: 0 });
});

test("changing the power degree stops traversal and a copied link restores it", async ({
  page,
}) => {
  await page.addInitScript(() =>
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: {
        writeText: async (value: string) => {
          (window as any).loomCopied = value;
        },
      },
    }),
  );
  await page.goto("/");
  await settled(page);
  await openLoomExample(page, "A grid cubed into a star");
  const d = page.getByRole("dialog", { name: "The complex loom" }),
    art = d.locator(".loom-panes");
  await expect(art).toHaveAttribute("aria-busy", "false");
  await expect(d.getByLabel("Selected member", { exact: true })).toHaveValue(
    "5",
  );
  // The selected line x = 1/4 starts at its lower end, z = 1/4 − i.
  expect(await loomPoint(d, "source")).toEqual({ x: 0.25, y: -1 });
  const start = await loomPoint(d, "image");
  expect(start.x).toBeCloseTo(power({ x: 0.25, y: -1 }, 3).x, 12);
  expect(start.y).toBeCloseTo(power({ x: 0.25, y: -1 }, 3).y, 12);
  await d.getByLabel("Traversal duration", { exact: true }).fill("30");
  await d.getByRole("button", { name: "Play traversal", exact: true }).click();
  await expect(
    d.getByRole("button", { name: "Pause traversal", exact: true }),
  ).toBeVisible();
  await d.getByLabel("Degree", { exact: true }).selectOption("6");
  await expect(
    d.getByRole("button", { name: /^(Play|Resume) traversal$/ }),
  ).toBeVisible();
  await expect(art).toHaveAttribute("aria-busy", "false");
  // Whatever point playback held, the shown image is its sixth power.
  await expect
    .poll(async () => {
      const z = await loomPoint(d, "source"),
        w = await loomPoint(d, "image"),
        want = power(z, 6);
      return (
        Math.hypot(w.x - want.x, w.y - want.y) <
        1e-12 * Math.max(1, Math.hypot(want.x, want.y))
      );
    })
    .toBe(true);
  const image = await d
    .locator('[data-pane="image"] [data-member="5"]')
    .getAttribute("d");
  await d.getByRole("button", { name: "Copy link", exact: true }).click();
  await expect(d.getByText("Link copied", { exact: true })).toBeVisible();
  const link = await page.evaluate(() => (window as any).loomCopied as string);
  const saved = wireStudy(new URL(link).hash.slice(3));
  expect(saved.loom.map).toBe("power");
  expect(saved.loom.degree).toBe(6);
  await d.getByRole("button", { name: "Return to study", exact: true }).click();
  await page.goto(link);
  await expect(page).not.toHaveURL(/#s=/);
  await expect(d.locator(".loom-panes")).toHaveAttribute("aria-busy", "false");
  await expect(d.getByLabel("Degree", { exact: true })).toHaveValue("6");
  expect(
    await d.locator('[data-pane="image"] [data-member="5"]').getAttribute("d"),
  ).toBe(image);
});

test("a decoded power traversal film matches direct seeks in both panes", async ({
  page,
}) => {
  await page.goto("/");
  await settled(page);
  await openLoomExample(page, "A quintic rosette");
  const d = page.getByRole("dialog", { name: "The complex loom" }),
    art = d.locator(".loom-panes");
  await expect(art).toHaveAttribute("aria-busy", "false");
  // Direct seeks give each frame's expected marker centers in page units.
  const centers: { source: number[]; image: number[] }[] = [];
  for (const at of ["0", "pi"]) {
    await d.getByLabel("Exact source parameter", { exact: true }).fill(at);
    await expect(art).toHaveAttribute("aria-busy", "false");
    await expect
      .poll(
        async () =>
          (await d
            .locator(".loom-correspondence")
            .getAttribute("data-parameter"))!,
      )
      .toBe(at === "0" ? "0" : String(Math.PI));
    const read = async (pane: string) => {
      const c = d.locator(`[data-pane="${pane}"] [data-marker]`);
      return [
        Number(await c.getAttribute("cx")),
        Number(await c.getAttribute("cy")),
      ];
    };
    centers.push({ source: await read("source"), image: await read("image") });
  }
  expect(centers[0].image).not.toEqual(centers[1].image);
  await d.getByLabel("Exact source parameter", { exact: true }).fill("0");
  await expect(art).toHaveAttribute("aria-busy", "false");
  await openLoomExportSettings(d);
  await d.getByLabel("Traversal duration", { exact: true }).fill("0.2");
  await loomResolution(d, 0.5);
  await d.getByLabel("Export frame rate", { exact: true }).selectOption("15");
  await d.getByLabel("Export format", { exact: true }).selectOption("mp4");
  const movie = page.waitForEvent("download");
  await loomMovieAction(d).click();
  expect((await movie).suggestedFilename()).toBe(
    "tangent-garden-complex-power-5.mp4",
  );
  const moviePath = (await (await movie).path())!;
  const bytes = await readFile(moviePath);
  expect(bytes.includes(Buffer.from('"degree":5'))).toBe(true);
  const timing = videoProbe(moviePath);
  if (timing) expect(timing.frames).toBe(3);
  const frames = execFileSync(
    "ffmpeg",
    [
      "-v",
      "error",
      "-i",
      moviePath,
      "-f",
      "rawvideo",
      "-pix_fmt",
      "rgb24",
      "-",
    ],
    { maxBuffer: 4 * 1024 * 1024 },
  );
  const pink = (frame: number, cx: number, cy: number) => {
    let found = 0;
    for (let y = Math.round(cy) - 8; y <= Math.round(cy) + 8; y++)
      for (let x = Math.round(cx) - 8; x <= Math.round(cx) + 8; x++) {
        const i = frame * 1000 * 380 * 3 + (y * 1000 + x) * 3;
        const [r, g, b] = frames.subarray(i, i + 3);
        if (r > 70 && r > g * 1.3 && b > g * 1.2) found++;
      }
    return found;
  };
  // Frames at p = 0, 1/2 and 1 are θ = 0, π and 2π; the half-scale film
  // puts the source pane at x/2 and the image pane at 500 + x/2.
  const at = (frame: number, seek: number, hit: boolean) => {
    const { source, image } = centers[seek];
    const n = (v: number) => (hit ? v > 0 : v === 0);
    expect(n(pink(frame, source[0] / 2, source[1] / 2))).toBe(true);
    expect(n(pink(frame, 500 + image[0] / 2, image[1] / 2))).toBe(true);
  };
  for (const frame of [0, 2]) {
    at(frame, 0, true);
    at(frame, 1, false);
  }
  at(1, 1, true);
  at(1, 0, false);
});

test("a base-study curve crossing the power fence breaks with a clipped gap and no stray geometry", async ({
  page,
}) => {
  await page.goto("/");
  await settled(page);
  // |z| = 10¹⁷|t| crosses the sixth-power fence, 10^(100/6) ≈ 4.6·10¹⁶,
  // at |t| ≈ 0.46; the rest of the curve stays inside it.
  await page.getByLabel("x(t)", { exact: true }).fill("1e17*t");
  await page.getByLabel("y(t)", { exact: true }).fill("0");
  await settled(page);
  await page
    .getByRole("button", { name: "Open complex loom", exact: true })
    .click();
  const d = page.getByRole("dialog", { name: "The complex loom" }),
    art = d.locator(".loom-panes");
  await d.getByLabel("Source family", { exact: true }).selectOption("curve");
  await expect(art).toHaveAttribute("aria-busy", "false");
  await expect(d.locator("[data-gaps]")).toContainText("No gaps");
  await d.getByLabel("Complex map", { exact: true }).selectOption("power");
  await d.getByLabel("Degree", { exact: true }).selectOption("6");
  await expect(art).toHaveAttribute("aria-busy", "false");
  await expect(d.locator("[data-gaps]")).toContainText("clipped");
  await d.getByLabel("Exact source parameter", { exact: true }).fill("1");
  await expect(d.locator(".loom-correspondence")).toContainText(
    "Correspondence undefined, excluded or clipped",
  );
  await expect(d.locator('[data-pane="image"] [data-marker]')).toHaveCount(0);
  const image = (await d
    .locator('[data-pane="image"] [data-member="0"]')
    .getAttribute("d"))!;
  expect(image).not.toMatch(/NaN|Infinity/);
  // Every chord of z⁶ here jumps farther than the drawing joins, so nothing
  // is stroked; the lone moveto once written for it painted nothing.
  expect(image).not.toMatch(/L/);
  await d.getByLabel("Exact source parameter", { exact: true }).fill("0.1");
  await expect(d.locator(".loom-correspondence")).toContainText(
    "Regular map point",
  );
});

// The exponential's correspondence, read from the drawing's own markers.
const exp = (z: { x: number; y: number }) => ({
  x: Math.exp(z.x) * Math.cos(z.y),
  y: Math.exp(z.x) * Math.sin(z.y),
});
const near = (
  a: { x: number; y: number },
  b: { x: number; y: number },
  scale = 1,
) => Math.hypot(a.x - b.x, a.y - b.y) <= 1e-12 * Math.max(1, scale);
async function translates(d: Locator) {
  return Promise.all(
    (await d.locator('[data-pane="source"] [data-translate]').all()).map(
      async (c) =>
        JSON.parse((await c.getAttribute("data-point"))!) as {
          x: number;
          y: number;
        },
    ),
  );
}

test("exponential strip shows periodic source points, keeps both edges and saves vector metadata", async ({
  page,
}) => {
  await page.goto("/");
  await settled(page);
  await openLoomExample(page, "A strip wrapped into rings");
  const d = page.getByRole("dialog", { name: "The complex loom" }),
    art = d.locator(".loom-panes");
  await expect(art).toHaveAttribute("aria-busy", "false");
  await expect(d.locator(".eyebrow")).toHaveText(
    "Complex transformation · w = eᶻ",
  );
  await expect(d.locator(".loom-pane-heading h3").nth(1)).toHaveText(
    "Image plane · eᶻ",
  );
  await expect(d.getByLabel("Complex map", { exact: true })).toHaveValue("exp");
  // No degree, pole, exclusion or map motion belongs to the exponential.
  for (const label of ["Degree", "Motion"])
    await expect(d.getByLabel(label, { exact: true })).toHaveCount(0);
  await expect(d.getByText("Map settings", { exact: true })).toHaveCount(0);
  await expect(d.locator("[data-exclusion]")).toHaveCount(0);
  await expect(d.locator("[data-gaps]")).toContainText("No gaps");
  // The selected ring Re z = 0 starts at the strip's lower edge, −π: by
  // Euler's formula, e^{−iπ} = −1.
  const z = await loomPoint(d, "source");
  expect(z).toEqual({ x: 0, y: -Math.PI });
  expect(near(await loomPoint(d, "image"), { x: -1, y: 0 })).toBe(true);
  // Its translates z + 2πik, k = −3…4, fill the window |Im z| ≤ 8π; each
  // has the same image, and k = 1 is on the strip's upper edge.
  const shown = await translates(d);
  expect(shown.map((p) => p.y)).toEqual(
    [-3, -2, -1, 1, 2, 3, 4].map((k) => -Math.PI + 2 * Math.PI * k),
  );
  for (const p of shown) {
    expect(p.x).toBe(0);
    expect(near(exp(p), exp(z))).toBe(true);
  }
  await expect(d.locator('[data-pane="image"] [data-translate]')).toHaveCount(
    0,
  );
  await expect(d.locator(".loom-correspondence")).toContainText(
    "7 other source points",
  );
  await expect(d.locator(".loom-correspondence")).toContainText(
    "Regular map point",
  );
  // The lower and upper edges are distinct members with one image.
  const members = d.getByLabel("Selected member", { exact: true });
  const edges: { x: number; y: number }[][] = [];
  for (const name of ["Horizontal 1", "Horizontal 25"]) {
    await members.selectOption({ label: name });
    await d.getByLabel("Exact source parameter", { exact: true }).fill("0.3");
    await expect
      .poll(async () => (await loomPoint(d, "source")).x)
      .toBeCloseTo(0.3, 14);
    edges.push([await loomPoint(d, "source"), await loomPoint(d, "image")]);
  }
  expect(edges[1][0].y - edges[0][0].y).toBeCloseTo(2 * Math.PI, 14);
  expect(near(edges[0][1], edges[1][1], Math.exp(0.3))).toBe(true);
  expect(near(edges[0][1], { x: -Math.exp(0.3), y: 0 }, Math.exp(0.3))).toBe(
    true,
  );
  const download = page.waitForEvent("download");
  await loomImage(d, "SVG");
  expect((await download).suggestedFilename()).toBe("complex-exp.svg");
  const svg = await readFile((await (await download).path())!, "utf8");
  for (const text of ['"map":"exp"', '"formula":"w = eᶻ"', "ln 10⁸", "8π"])
    expect(svg).toContain(text);
  expect(svg.match(/data-translate/g)?.length).toBe(7);
  expect(svg).not.toMatch(/<text|<image/);
  // Squaring has no translates; returning keeps the source and selection.
  await d.getByLabel("Complex map", { exact: true }).selectOption("square");
  await expect(art).toHaveAttribute("aria-busy", "false");
  await expect(d.locator("[data-translate]")).toHaveCount(0);
  await expect(d.locator(".loom-correspondence")).not.toContainText(
    "other source points",
  );
  await d.getByLabel("Complex map", { exact: true }).selectOption("exp");
  await expect(art).toHaveAttribute("aria-busy", "false");
  await expect(members).toHaveValue("39");
  await expect.poll(async () => (await translates(d)).length).toBe(7);
});

test("exponential traversal follows exp in both panes and a copied link restores it", async ({
  page,
}) => {
  await page.addInitScript(() =>
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: {
        writeText: async (value: string) => {
          (window as any).loomCopied = value;
        },
      },
    }),
  );
  await page.goto("/");
  await settled(page);
  await openLoomExample(page, "Circles curled into a nautilus");
  const d = page.getByRole("dialog", { name: "The complex loom" }),
    art = d.locator(".loom-panes");
  await expect(art).toHaveAttribute("aria-busy", "false");
  await expect(d.getByLabel("Selected member", { exact: true })).toHaveValue(
    "31",
  );
  // The outermost circle starts at z = 6, image e⁶.
  expect(await loomPoint(d, "source")).toEqual({ x: 6, y: 0 });
  expect(near(await loomPoint(d, "image"), { x: Math.exp(6), y: 0 }, 500)).toBe(
    true,
  );
  // At θ = π, z = −6 maps to e^−6, back on the positive real axis.
  await d.getByLabel("Exact source parameter", { exact: true }).fill("pi");
  await expect.poll(async () => (await loomPoint(d, "source")).x).toBe(-6);
  const w = await loomPoint(d, "image");
  expect(w.x).toBeCloseTo(Math.exp(-6), 15);
  await d.getByLabel("Traversal duration", { exact: true }).fill("30");
  await d.getByRole("button", { name: "Play traversal", exact: true }).click();
  await expect(
    d.getByRole("button", { name: "Pause traversal", exact: true }),
  ).toBeVisible();
  await d.getByRole("button", { name: "Pause traversal", exact: true }).click();
  // Whatever point playback held, the shown image is its exponential.
  const held = await loomPoint(d, "source");
  expect(near(await loomPoint(d, "image"), exp(held), Math.exp(6))).toBe(true);
  const image = await d
    .locator('[data-pane="image"] [data-member="31"]')
    .getAttribute("d");
  await d.getByRole("button", { name: "Copy link", exact: true }).click();
  await expect(d.getByText("Link copied", { exact: true })).toBeVisible();
  const link = await page.evaluate(() => (window as any).loomCopied as string);
  const saved = wireStudy(new URL(link).hash.slice(3));
  expect(saved.loom.map).toBe("exp");
  for (const key of ["degree", "mapParameter", "motion"])
    expect(key in saved.loom).toBe(false);
  await d.getByRole("button", { name: "Return to study", exact: true }).click();
  await page.goto(link);
  await expect(page).not.toHaveURL(/#s=/);
  await expect(d.locator(".loom-panes")).toHaveAttribute("aria-busy", "false");
  await expect(d.getByLabel("Complex map", { exact: true })).toHaveValue("exp");
  expect(
    await d.locator('[data-pane="image"] [data-member="31"]').getAttribute("d"),
  ).toBe(image);
});

test("a decoded exponential traversal film matches direct seeks in both panes", async ({
  page,
}) => {
  await page.goto("/");
  await settled(page);
  await openLoomExample(page, "Circles curled into a nautilus");
  const d = page.getByRole("dialog", { name: "The complex loom" }),
    art = d.locator(".loom-panes");
  await expect(art).toHaveAttribute("aria-busy", "false");
  const centers: { source: number[]; image: number[] }[] = [];
  for (const at of ["0", "pi"]) {
    await d.getByLabel("Exact source parameter", { exact: true }).fill(at);
    await expect(art).toHaveAttribute("aria-busy", "false");
    await expect
      .poll(
        async () =>
          (await d
            .locator(".loom-correspondence")
            .getAttribute("data-parameter"))!,
      )
      .toBe(at === "0" ? "0" : String(Math.PI));
    const read = async (pane: string) => {
      const c = d.locator(`[data-pane="${pane}"] [data-marker]`);
      return [
        Number(await c.getAttribute("cx")),
        Number(await c.getAttribute("cy")),
      ];
    };
    centers.push({ source: await read("source"), image: await read("image") });
  }
  expect(centers[0].image).not.toEqual(centers[1].image);
  await d.getByLabel("Exact source parameter", { exact: true }).fill("0");
  await expect(art).toHaveAttribute("aria-busy", "false");
  await openLoomExportSettings(d);
  await d.getByLabel("Traversal duration", { exact: true }).fill("0.2");
  // Full size: at half size the light marker ring blends into its thread.
  await loomResolution(d, 1);
  await d.getByLabel("Export frame rate", { exact: true }).selectOption("15");
  await d.getByLabel("Export format", { exact: true }).selectOption("mp4");
  const movie = page.waitForEvent("download");
  await loomMovieAction(d).click();
  expect((await movie).suggestedFilename()).toBe(
    "tangent-garden-complex-exp.mp4",
  );
  const moviePath = (await (await movie).path())!;
  const bytes = await readFile(moviePath);
  expect(bytes.includes(Buffer.from('"map":"exp"'))).toBe(true);
  const timing = videoProbe(moviePath);
  if (timing) expect(timing.frames).toBe(3);
  const frames = execFileSync(
    "ffmpeg",
    [
      "-v",
      "error",
      "-i",
      moviePath,
      "-f",
      "rawvideo",
      "-pix_fmt",
      "rgb24",
      "-",
    ],
    { maxBuffer: 16 * 1024 * 1024 },
  );
  const pink = (frame: number, cx: number, cy: number) => {
    let found = 0;
    for (let y = Math.round(cy) - 8; y <= Math.round(cy) + 8; y++)
      for (let x = Math.round(cx) - 8; x <= Math.round(cx) + 8; x++) {
        const i = frame * 2000 * 760 * 3 + (y * 2000 + x) * 3;
        const [r, g, b] = frames.subarray(i, i + 3);
        if (r > 70 && r > g * 1.3 && b > g * 1.2) found++;
      }
    return found;
  };
  // Frames at p = 0, 1/2 and 1 are θ = 0, π and 2π.
  const at = (frame: number, seek: number, hit: boolean) => {
    const { source, image } = centers[seek];
    const n = (v: number) => (hit ? v > 0 : v === 0);
    expect(n(pink(frame, source[0], source[1]))).toBe(true);
    expect(n(pink(frame, 1000 + image[0], image[1]))).toBe(true);
  };
  for (const frame of [0, 2]) {
    at(frame, 0, true);
    at(frame, 1, false);
  }
  at(1, 1, true);
  at(1, 0, false);
});

test("a base-study curve leaving the exponential window breaks with a clipped gap and no stray markers", async ({
  page,
}) => {
  await page.goto("/");
  await settled(page);
  // Re z = 10t leaves the window, |Re z| ≤ ln 10⁸ ≈ 18.42, at |t| ≈ 1.84.
  await page.getByLabel("x(t)", { exact: true }).fill("10*t");
  await page.getByLabel("y(t)", { exact: true }).fill("t");
  await settled(page);
  await page
    .getByRole("button", { name: "Open complex loom", exact: true })
    .click();
  const d = page.getByRole("dialog", { name: "The complex loom" }),
    art = d.locator(".loom-panes");
  await d.getByLabel("Source family", { exact: true }).selectOption("curve");
  await expect(art).toHaveAttribute("aria-busy", "false");
  await d.getByLabel("Complex map", { exact: true }).selectOption("exp");
  await expect(art).toHaveAttribute("aria-busy", "false");
  await expect(d.locator("[data-gaps]")).toContainText("clipped");
  await d.getByLabel("Exact source parameter", { exact: true }).fill("1.9");
  await expect(d.locator(".loom-correspondence")).toContainText(
    "Correspondence undefined, excluded or clipped",
  );
  await expect(d.locator('[data-pane="image"] [data-marker]')).toHaveCount(0);
  await expect(d.locator("[data-translate]")).toHaveCount(0);
  const image = (await d
    .locator('[data-pane="image"] [data-member="0"]')
    .getAttribute("d"))!;
  expect(image).not.toMatch(/NaN|Infinity/);
  await d.getByLabel("Exact source parameter", { exact: true }).fill("0.1");
  await expect(d.locator(".loom-correspondence")).toContainText(
    "Regular map point",
  );
  expect(near(await loomPoint(d, "image"), exp({ x: 1, y: 0.1 }), 3)).toBe(
    true,
  );
});

// The composite exp(zⁿ), written independently: the polar power, then exp.
const composite = (z: { x: number; y: number }, n: number) => exp(power(z, n));

test("composite shell shows its intermediate point, shared-image points and critical zero, and saves vector metadata", async ({
  page,
}) => {
  await page.goto("/");
  await settled(page);
  await openLoomExample(page, "A quintic rosette wrapped into a shell");
  const d = page.getByRole("dialog", { name: "The complex loom" }),
    art = d.locator(".loom-panes");
  await expect(art).toHaveAttribute("aria-busy", "false");
  await expect(d.locator(".eyebrow")).toHaveText(
    "Complex transformation · w = exp(z⁵)",
  );
  await expect(d.locator(".loom-pane-heading h3").nth(1)).toHaveText(
    "Image plane · exp(z⁵)",
  );
  await expect(d.getByLabel("Complex map", { exact: true })).toHaveValue(
    "exp-power",
  );
  await expect(d.getByLabel("Degree", { exact: true })).toHaveValue("5");
  // Neither stage has a pole or exclusion. The composite is s = 1 of its
  // map motion's family, at point traversal.
  await expect(d.getByLabel("Motion", { exact: true })).toHaveValue("point");
  await d.getByText("Map settings", { exact: true }).click();
  await expect(d.getByLabel("Map parameter", { exact: true })).toHaveValue("1");
  await expect(
    d.getByLabel("Pole exclusion radius", { exact: true }),
  ).toHaveCount(0);
  await expect(d.getByText("Show pole exclusion")).toHaveCount(0);
  await expect(d.locator("[data-exclusion]")).toHaveCount(0);
  await expect(d.locator("[data-gaps]")).toContainText("No gaps");
  await expect(d.locator('[data-pane="image"] [data-member]')).toHaveCount(24);
  // Circle 1 starts at z = 1.2, whose fifth power is 1.2⁵ = 2.48832.
  const z = await loomPoint(d, "source");
  expect(z).toEqual({ x: 1.2, y: 0 });
  expect(
    near(await loomPoint(d, "image"), composite(z, 5), Math.exp(2.5)),
  ).toBe(true);
  const readout = d.locator(".loom-correspondence");
  await expect(readout).toContainText("z⁵ = (2.4883, 0.0000) → w = (12.041");
  await expect(readout).toContainText("Regular map point");
  // The other source points with this image: four turns of z and the fifth
  // roots of 1.2⁵ + 2πik, k = −4…4 but 0, all with z's image.
  await expect(readout).toContainText("44 other source points");
  let shown = await translates(d);
  expect(shown).toHaveLength(44);
  for (const p of shown)
    expect(near(composite(p, 5), composite(z, 5), 1e3 * Math.exp(2.5))).toBe(
      true,
    );
  // At θ = π the point is the critical zero, mapping to exactly 1; its
  // shared-image points are only the fifth roots of 2πik, k ≠ 0.
  await d.getByLabel("Exact source parameter", { exact: true }).fill("pi");
  await expect.poll(() => loomPoint(d, "source")).toEqual({ x: 0, y: 0 });
  expect(await loomPoint(d, "image")).toEqual({ x: 1, y: 0 });
  await expect(readout).toContainText("z⁵ = (0.0000, 0.0000) → w = (1.0000");
  await expect(readout).toContainText("Critical point");
  await expect.poll(async () => (await translates(d)).length).toBe(40);
  const download = page.waitForEvent("download");
  await loomImage(d, "SVG");
  expect((await download).suggestedFilename()).toBe("complex-exp-power-5.svg");
  const svg = await readFile((await (await download).path())!, "utf8");
  for (const text of [
    '"map":"exp-power"',
    '"degree":5',
    '"formula":"w = exp(z⁵)"',
    "ln 10⁸",
    "8π",
  ])
    expect(svg).toContain(text);
  expect(svg.match(/data-translate/g)?.length).toBe(40);
  expect(svg).not.toMatch(/<text|<image/);
  // The power alone keeps the degree and has no intermediate or shared
  // points; returning restores both.
  await d.getByLabel("Complex map", { exact: true }).selectOption("power");
  await expect(art).toHaveAttribute("aria-busy", "false");
  await expect(d.getByLabel("Degree", { exact: true })).toHaveValue("5");
  await expect(d.locator("[data-translate]")).toHaveCount(0);
  await expect(readout).not.toContainText("z⁵ =");
  expect(await loomPoint(d, "image")).toEqual({ x: 0, y: 0 });
  await d.getByLabel("Complex map", { exact: true }).selectOption("exp-power");
  await expect(art).toHaveAttribute("aria-busy", "false");
  await expect.poll(async () => (await translates(d)).length).toBe(40);
  await expect(readout).toContainText("z⁵ = (0.0000, 0.0000)");
});

test("changing the composite degree stops traversal and a copied link restores it", async ({
  page,
}) => {
  await page.addInitScript(() =>
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: {
        writeText: async (value: string) => {
          (window as any).loomCopied = value;
        },
      },
    }),
  );
  await page.goto("/");
  await settled(page);
  await openLoomExample(page, "A squared grid wrapped into a web");
  const d = page.getByRole("dialog", { name: "The complex loom" }),
    art = d.locator(".loom-panes");
  await expect(art).toHaveAttribute("aria-busy", "false");
  await expect(d.getByLabel("Selected member", { exact: true })).toHaveValue(
    "16",
  );
  // The rim x = 5/4 starts at z = 5/4 − 5i/4, whose square is −25i/8.
  const z = await loomPoint(d, "source");
  expect(z).toEqual({ x: 1.25, y: -1.25 });
  expect(near(await loomPoint(d, "image"), composite(z, 2))).toBe(true);
  await d.getByLabel("Traversal duration", { exact: true }).fill("30");
  await d.getByRole("button", { name: "Play traversal", exact: true }).click();
  await expect(
    d.getByRole("button", { name: "Pause traversal", exact: true }),
  ).toBeVisible();
  await d.getByLabel("Degree", { exact: true }).selectOption("3");
  await expect(
    d.getByRole("button", { name: /^(Play|Resume) traversal$/ }),
  ).toBeVisible();
  await expect(art).toHaveAttribute("aria-busy", "false");
  // Whatever point playback held, the shown image is exp of its cube.
  await expect
    .poll(async () => {
      const held = await loomPoint(d, "source"),
        w = await loomPoint(d, "image"),
        want = composite(held, 3);
      return (
        Math.hypot(w.x - want.x, w.y - want.y) <
        1e-11 * Math.max(1, Math.hypot(want.x, want.y))
      );
    })
    .toBe(true);
  await expect(d.locator(".loom-correspondence")).toContainText("z³ = (");
  const image = await d
    .locator('[data-pane="image"] [data-member="16"]')
    .getAttribute("d");
  await d.getByRole("button", { name: "Copy link", exact: true }).click();
  await expect(d.getByText("Link copied", { exact: true })).toBeVisible();
  const link = await page.evaluate(() => (window as any).loomCopied as string);
  const saved = wireStudy(new URL(link).hash.slice(3));
  expect(saved.loom.map).toBe("exp-power");
  expect(saved.loom.degree).toBe(3);
  for (const key of ["mapParameter", "motion"])
    expect(key in saved.loom).toBe(false);
  await d.getByRole("button", { name: "Return to study", exact: true }).click();
  await page.goto(link);
  await expect(page).not.toHaveURL(/#s=/);
  await expect(d.locator(".loom-panes")).toHaveAttribute("aria-busy", "false");
  await expect(d.getByLabel("Complex map", { exact: true })).toHaveValue(
    "exp-power",
  );
  await expect(d.getByLabel("Degree", { exact: true })).toHaveValue("3");
  expect(
    await d.locator('[data-pane="image"] [data-member="16"]').getAttribute("d"),
  ).toBe(image);
});

test("a decoded composite traversal film matches direct seeks in both panes", async ({
  page,
}) => {
  await page.goto("/");
  await settled(page);
  await openLoomExample(page, "A quintic rosette wrapped into a shell");
  const d = page.getByRole("dialog", { name: "The complex loom" }),
    art = d.locator(".loom-panes");
  await expect(art).toHaveAttribute("aria-busy", "false");
  const centers: { source: number[]; image: number[] }[] = [];
  for (const at of ["0", "pi"]) {
    await d.getByLabel("Exact source parameter", { exact: true }).fill(at);
    await expect(art).toHaveAttribute("aria-busy", "false");
    await expect
      .poll(
        async () =>
          (await d
            .locator(".loom-correspondence")
            .getAttribute("data-parameter"))!,
      )
      .toBe(at === "0" ? "0" : String(Math.PI));
    const read = async (pane: string) => {
      const c = d.locator(`[data-pane="${pane}"] [data-marker]`);
      return [
        Number(await c.getAttribute("cx")),
        Number(await c.getAttribute("cy")),
      ];
    };
    centers.push({ source: await read("source"), image: await read("image") });
  }
  expect(centers[0].image).not.toEqual(centers[1].image);
  await d.getByLabel("Exact source parameter", { exact: true }).fill("0");
  await expect(art).toHaveAttribute("aria-busy", "false");
  await openLoomExportSettings(d);
  await d.getByLabel("Traversal duration", { exact: true }).fill("0.2");
  await loomResolution(d, 1);
  await d.getByLabel("Export frame rate", { exact: true }).selectOption("15");
  await d.getByLabel("Export format", { exact: true }).selectOption("mp4");
  const movie = page.waitForEvent("download");
  await loomMovieAction(d).click();
  expect((await movie).suggestedFilename()).toBe(
    "tangent-garden-complex-exp-power-5.mp4",
  );
  const moviePath = (await (await movie).path())!;
  const bytes = await readFile(moviePath);
  expect(bytes.includes(Buffer.from('"map":"exp-power"'))).toBe(true);
  expect(bytes.includes(Buffer.from('"degree":5'))).toBe(true);
  const timing = videoProbe(moviePath);
  if (timing) expect(timing.frames).toBe(3);
  const frames = execFileSync(
    "ffmpeg",
    [
      "-v",
      "error",
      "-i",
      moviePath,
      "-f",
      "rawvideo",
      "-pix_fmt",
      "rgb24",
      "-",
    ],
    { maxBuffer: 16 * 1024 * 1024 },
  );
  const pink = (frame: number, cx: number, cy: number) => {
    let found = 0;
    for (let y = Math.round(cy) - 8; y <= Math.round(cy) + 8; y++)
      for (let x = Math.round(cx) - 8; x <= Math.round(cx) + 8; x++) {
        const i = frame * 2000 * 760 * 3 + (y * 2000 + x) * 3;
        const [r, g, b] = frames.subarray(i, i + 3);
        if (r > 70 && r > g * 1.3 && b > g * 1.2) found++;
      }
    return found;
  };
  // Frames at p = 0, 1/2 and 1 are θ = 0, π and 2π.
  const at = (frame: number, seek: number, hit: boolean) => {
    const { source, image } = centers[seek];
    const n = (v: number) => (hit ? v > 0 : v === 0);
    expect(n(pink(frame, source[0], source[1]))).toBe(true);
    expect(n(pink(frame, 1000 + image[0], image[1]))).toBe(true);
  };
  for (const frame of [0, 2]) {
    at(frame, 0, true);
    at(frame, 1, false);
  }
  at(1, 1, true);
  at(1, 0, false);
});

// The composite's map motion, w = s + (exp(s·zⁿ) − 1)/s, written
// independently of the engine's evaluation.
const grown = (z: { x: number; y: number }, n: number, s: number) => {
  const u = power(z, n);
  if (s === 0) return u;
  const r = Math.exp(s * u.x);
  return {
    x: s + (r * Math.cos(s * u.y) - 1) / s,
    y: (r * Math.sin(s * u.y)) / s,
  };
};

test("composite map motion grows a squared grid's fan into the web, and its map parameter edits a frame directly", async ({
  page,
}) => {
  await page.addInitScript(() =>
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: {
        writeText: async (value: string) => {
          (window as any).loomCopied = value;
        },
      },
    }),
  );
  await page.goto("/");
  await settled(page);
  await openLoomExample(page, "A squared grid grown into a web");
  const d = page.getByRole("dialog", { name: "The complex loom" }),
    art = d.locator(".loom-panes"),
    progress = d.getByLabel("Motion progress", { exact: true }),
    values = d.locator(".animation-values"),
    readout = d.locator(".loom-correspondence");
  await expect(art).toHaveAttribute("aria-busy", "false");
  await expect(d.locator(".eyebrow")).toHaveText(
    "Complex transformation · w = s + (exp(s·z²) − 1)/s",
  );
  await expect(d.locator(".loom-pane-heading h3").nth(1)).toHaveText(
    "Image plane · w",
  );
  await expect(d.getByLabel("Motion", { exact: true })).toHaveValue("map");
  await expect(d.getByLabel("Map motion from", { exact: true })).toHaveValue(
    "0",
  );
  await expect(d.getByLabel("Map motion to", { exact: true })).toHaveValue("1");
  // It opens at s = 0 on the edge x = 5/4 from 5/4 − 5i/4, whose square is
  // exactly −25i/8: the power map's own image.
  const z = await loomPoint(d, "source");
  expect(z).toEqual({ x: 1.25, y: -1.25 });
  expect(await loomPoint(d, "image")).toEqual({ x: 0, y: -3.125 });
  await expect(values).toContainText("s = 0.00000");
  await expect(readout).toContainText("z² = (0.0000, -3.1250) → w = (0.0000");
  await progress.fill("0.5");
  await expect(art).toHaveAttribute("aria-busy", "false");
  await expect
    .poll(async () => near(await loomPoint(d, "image"), grown(z, 2, 0.5), 10))
    .toBe(true);
  await expect(values).toContainText("s = 0.500000");
  // The intermediate point stays z², unscaled.
  await expect(readout).toContainText("z² = (0.0000, -3.1250)");
  await progress.fill("1");
  await expect(art).toHaveAttribute("aria-busy", "false");
  await expect
    .poll(async () => near(await loomPoint(d, "image"), composite(z, 2), 10))
    .toBe(true);
  // The preset's own motion plays from the power to the composite.
  await d.getByLabel("Traversal duration", { exact: true }).fill("0.4");
  await d.getByRole("button", { name: "Stop map motion", exact: true }).click();
  await expect(values).toContainText("s = 0.00000");
  await expect(art).toHaveAttribute("aria-busy", "false");
  await d.getByRole("button", { name: "Play map motion", exact: true }).click();
  await expect(
    d.getByRole("button", { name: "Play map motion", exact: true }),
  ).toBeVisible();
  await expect(values).toContainText("s = 1.00000");
  await expect
    .poll(async () => near(await loomPoint(d, "image"), composite(z, 2), 10))
    .toBe(true);
  // No pole: the map settings hold the parameter alone.
  await d.getByText("Map settings", { exact: true }).click();
  const parameter = d.getByLabel("Map parameter", { exact: true });
  await expect(parameter).toHaveValue("1");
  await expect(
    d.getByLabel("Pole exclusion radius", { exact: true }),
  ).toHaveCount(0);
  await expect(d.locator("[data-exclusion]")).toHaveCount(0);
  // Point traversal keeps the frame, which the map parameter then edits.
  await d.getByLabel("Motion", { exact: true }).selectOption("point");
  await expect(d.locator(".eyebrow")).toHaveText(
    "Complex transformation · w = exp(z²)",
  );
  await parameter.fill("0.25");
  await expect(art).toHaveAttribute("aria-busy", "false");
  await expect
    .poll(async () => near(await loomPoint(d, "image"), grown(z, 2, 0.25), 10))
    .toBe(true);
  await expect(d.locator(".eyebrow")).toHaveText(
    "Complex transformation · w = s + (exp(s·z²) − 1)/s",
  );
  // Go refuses s beyond 0–1 under this field.
  await parameter.fill("1.5");
  await expect(parameter).toHaveAttribute("aria-invalid", "true");
  await expect(d.getByRole("alert")).toContainText("0–1");
  await expect(d.getByRole("alert")).toHaveCount(1);
  await parameter.fill("0.25");
  await expect(art).toHaveAttribute("aria-busy", "false");
  await expect(d.getByRole("alert")).toHaveCount(0);
  const image = await d
    .locator('[data-pane="image"] [data-member="16"]')
    .getAttribute("d");
  const download = page.waitForEvent("download");
  await loomImage(d, "SVG");
  const svg = await readFile((await (await download).path())!, "utf8");
  for (const text of [
    '"map":"exp-power"',
    '"wrap":0.25',
    '"formula":"w = s + (exp(s·z²) − 1)/s"',
  ])
    expect(svg).toContain(text);
  await d.getByRole("button", { name: "Copy link", exact: true }).click();
  await expect(d.getByText("Link copied", { exact: true })).toBeVisible();
  const link = await page.evaluate(() => (window as any).loomCopied as string);
  const saved = wireStudy(new URL(link).hash.slice(3));
  expect(saved.loom.wrap).toBe(0.25);
  expect(saved.loom.motion).toBeUndefined();
  await d.getByRole("button", { name: "Return to study", exact: true }).click();
  await page.goto(link);
  await expect(page).not.toHaveURL(/#s=/);
  await expect(art).toHaveAttribute("aria-busy", "false");
  expect(
    await d.locator('[data-pane="image"] [data-member="16"]').getAttribute("d"),
  ).toBe(image);
});

test("an older composite link carrying another map's parameter still opens on the composite", async ({
  page,
}) => {
  const { presetStudy } = await import("../web/planar-link");
  const { presetLoom, loomPresets } = await import("../web/loom/model");
  const base = presetStudy(0);
  const web = presetLoom(
    loomPresets.findIndex(
      (p) => p.title === "A squared grid wrapped into a web",
    ),
    base.config,
  );
  // As a study switched from z + λ/z kept them before s existed.
  const loom = { ...web, mapParameter: 0.5, exclusionRadius: 0.1 };
  const token = deflateRawSync(
    JSON.stringify({ v: 1, notebook: "2d", study: { ...base, loom } }),
  ).toString("base64url");
  await page.goto(`/#s=${token}`);
  const d = page.getByRole("dialog", { name: "The complex loom" });
  await expect(d.locator(".loom-panes")).toHaveAttribute("aria-busy", "false");
  await expect(d.locator(".eyebrow")).toHaveText(
    "Complex transformation · w = exp(z²)",
  );
  const z = await loomPoint(d, "source");
  expect(near(await loomPoint(d, "image"), composite(z, 2), 10)).toBe(true);
  await d.getByText("Map settings", { exact: true }).click();
  await expect(d.getByLabel("Map parameter", { exact: true })).toHaveValue("1");
});

test("a decoded composite growth film matches direct seeks in both panes", async ({
  page,
}) => {
  await page.goto("/");
  await settled(page);
  await openLoomExample(page, "A quintic rosette grown into a shell");
  const d = page.getByRole("dialog", { name: "The complex loom" }),
    art = d.locator(".loom-panes"),
    progress = d.getByLabel("Motion progress", { exact: true });
  await expect(art).toHaveAttribute("aria-busy", "false");
  const seeks: number[][] = [];
  for (const p of [0, 0.5, 1]) {
    await progress.fill(String(p));
    await expect(art).toHaveAttribute("aria-busy", "false");
    seeks.push(
      await d.locator('[data-pane="image"]').evaluate(async (e) => {
        const svg = e.cloneNode(true) as SVGSVGElement;
        svg.setAttribute("xmlns", "http://www.w3.org/2000/svg");
        svg.setAttribute("width", "500");
        svg.setAttribute("height", "380");
        const url = URL.createObjectURL(
          new Blob([new XMLSerializer().serializeToString(svg)], {
            type: "image/svg+xml",
          }),
        );
        try {
          const image = new Image();
          image.src = url;
          await image.decode();
          const canvas = Object.assign(document.createElement("canvas"), {
            width: 500,
            height: 380,
          });
          const ctx = canvas.getContext("2d")!;
          ctx.drawImage(image, 0, 0);
          return Array.from(ctx.getImageData(0, 0, 500, 380).data);
        } finally {
          URL.revokeObjectURL(url);
        }
      }),
    );
  }
  await progress.fill("0");
  await expect(art).toHaveAttribute("aria-busy", "false");
  await openLoomExportSettings(d);
  await d.getByLabel("Traversal duration", { exact: true }).fill(".2");
  await loomResolution(d, 0.5);
  await d.getByLabel("Export frame rate", { exact: true }).selectOption("15");
  await d.getByLabel("Export format", { exact: true }).selectOption("mp4");
  const download = page.waitForEvent("download");
  await loomMovieAction(d).click();
  expect((await download).suggestedFilename()).toBe(
    "tangent-garden-complex-exp-power-5.mp4",
  );
  const path = (await (await download).path())!,
    bytes = await readFile(path);
  for (const text of ['"map":"exp-power"', '"mode":"map"', '"degree":5'])
    expect(bytes.includes(Buffer.from(text))).toBe(true);
  const timing = videoProbe(path);
  expect(timing?.frames).toBe(3);
  expect(timing?.durations.reduce((a, b) => a + b, 0)).toBe(200);
  const frames = execFileSync(
    "ffmpeg",
    ["-v", "error", "-i", path, "-f", "rawvideo", "-pix_fmt", "rgb24", "-"],
    { maxBuffer: 4 * 1024 * 1024 },
  );
  expect(frames.length).toBe(3 * 1000 * 380 * 3);
  for (let f = 0; f < 3; f++) {
    const errors = seeks.map((expected) => {
      let error = 0;
      for (let y = 0; y < 380; y++)
        for (let x = 0; x < 500; x++)
          for (let c = 0; c < 3; c++)
            error += Math.abs(
              frames[f * 1000 * 380 * 3 + (y * 1000 + x + 500) * 3 + c] -
                expected[(y * 500 + x) * 4 + c],
            );
      return error / (500 * 380 * 3);
    });
    // Pixels where some channel differs from the seek by more than 20%:
    // what a wrong or misplaced frame changes, and compression does not.
    const changed = seeks.map((expected) => {
      let count = 0;
      for (let y = 0; y < 380; y++)
        for (let x = 0; x < 500; x++)
          for (let c = 0; c < 3; c++)
            if (
              Math.abs(
                frames[f * 1000 * 380 * 3 + (y * 1000 + x + 500) * 3 + c] -
                  expected[(y * 500 + x) * 4 + c],
              ) > 51
            ) {
              count++;
              break;
            }
      return count;
    });
    // The final shell is the densest frame, and its predicted frame
    // compresses least faithfully: a mean error of 2.9 on macOS and 3.2 on
    // CI's Linux encoder, yet it differs from its own seek beyond 20% in
    // about 500 of 190,000 pixels against over 5,000 for the other seeks.
    // The pixel count and the relative checks tell the frames apart.
    expect(errors[f], `frame ${f}: ${errors}`).toBeLessThan(4);
    expect(changed[f], `frame ${f} changed pixels: ${changed}`).toBeLessThan(
      1900,
    );
    for (let other = 0; other < 3; other++)
      if (other !== f) {
        expect(
          errors[f],
          `frame ${f} must match its own seek: ${errors}`,
        ).toBeLessThan(errors[other] * 0.7);
        expect(
          changed[f],
          `frame ${f} must match its own seek: ${changed}`,
        ).toBeLessThan(changed[other] * 0.3);
      }
  }
});

test("a base-study curve leaving the composite's domain breaks with a clipped gap and no stray markers", async ({
  page,
}) => {
  await page.goto("/");
  await settled(page);
  // z = 10t + it squares to 99t² + 20t²i, leaving the window where
  // 99t² > ln 10⁸, at |t| ≈ 0.431.
  await page.getByLabel("x(t)", { exact: true }).fill("10*t");
  await page.getByLabel("y(t)", { exact: true }).fill("t");
  await settled(page);
  await page
    .getByRole("button", { name: "Open complex loom", exact: true })
    .click();
  const d = page.getByRole("dialog", { name: "The complex loom" }),
    art = d.locator(".loom-panes");
  await d.getByLabel("Source family", { exact: true }).selectOption("curve");
  await expect(art).toHaveAttribute("aria-busy", "false");
  await d.getByLabel("Complex map", { exact: true }).selectOption("exp-power");
  await expect(art).toHaveAttribute("aria-busy", "false");
  await expect(d.getByLabel("Degree", { exact: true })).toHaveValue("2");
  await expect(d.locator("[data-gaps]")).toContainText("clipped");
  await d.getByLabel("Exact source parameter", { exact: true }).fill("0.5");
  await expect(d.locator(".loom-correspondence")).toContainText(
    "Correspondence undefined, excluded or clipped",
  );
  await expect(d.locator('[data-pane="image"] [data-marker]')).toHaveCount(0);
  await expect(d.locator("[data-translate]")).toHaveCount(0);
  const image = (await d
    .locator('[data-pane="image"] [data-member="0"]')
    .getAttribute("d"))!;
  expect(image).not.toMatch(/NaN|Infinity/);
  await d.getByLabel("Exact source parameter", { exact: true }).fill("0.1");
  await expect(d.locator(".loom-correspondence")).toContainText(
    "Regular map point",
  );
  expect(
    near(await loomPoint(d, "image"), composite({ x: 1, y: 0.1 }, 2), 3),
  ).toBe(true);
});

// The default ellipse under exp(z³) reaches the window's real edge, where
// its image spirals out to 10⁸: an exhausted result of about 470,000 points.
// Moving only the marker must reuse the drawn geometry rather than format
// every drawn vertex again on each seek and playback frame. pathData formats
// each drawn vertex with toFixed, so counting calls observes redrawing
// without timing; a pan, which does redraw, is the control.
test("moving the loom marker reuses the drawn geometry of a large result", async ({
  page,
}) => {
  await page.goto("/");
  await settled(page);
  await page
    .getByRole("button", { name: "Open complex loom", exact: true })
    .click();
  const d = page.getByRole("dialog", { name: "The complex loom" }),
    art = d.locator(".loom-panes");
  await expect(art).toHaveAttribute("aria-busy", "false");
  await d.getByLabel("Complex map", { exact: true }).selectOption("exp-power");
  await d.getByLabel("Degree", { exact: true }).selectOption("3");
  await expect(art).toHaveAttribute("aria-busy", "false");
  await expect(d.locator("[data-gaps]")).toContainText("out of budget");
  // Each drawn vertex of the source pane is formatted twice, x and y.
  const vertices = await d
    .locator('[data-pane="source"] [data-member]')
    .evaluateAll((paths) =>
      paths.reduce(
        (n, p) => n + (p.getAttribute("d")!.match(/[ML]/g)?.length ?? 0),
        0,
      ),
    );
  expect(vertices).toBeGreaterThan(1000);
  await page.evaluate(() => {
    const native = Number.prototype.toFixed;
    (window as any).formatted = 0;
    Number.prototype.toFixed = function (this: number, digits?: number) {
      (window as any).formatted++;
      return native.call(this, digits);
    };
  });
  const formatted = () =>
    page.evaluate(() => {
      const n = (window as any).formatted as number;
      (window as any).formatted = 0;
      return n;
    });
  await d.getByLabel("Exact source parameter", { exact: true }).fill("1");
  await expect(d.locator(".loom-correspondence")).toHaveAttribute(
    "data-parameter",
    "1",
  );
  await expect(art).toHaveAttribute("aria-busy", "false");
  expect(await formatted()).toBeLessThan(1000);
  await d.locator('[data-pane="source"]').press("ArrowLeft");
  await expect(d.locator('[data-pane="source"]')).toHaveAttribute(
    "data-pan",
    "-25,0",
  );
  expect(await formatted()).toBeGreaterThan(vertices);
});

// The loom draws in a 1000 × 760 frame whose pane is about 350 pixels wide
// on a phone. Refinement for the image can leave its source curve with
// vertices hundredths of a pixel apart, and a far image with spirals wholly
// outside the pane; Safari rasterizes all of it per tile. The loom's path
// data keeps a vertex only 0.1 frame units from the last one kept, keeps
// every run's ends, and drops segments wholly outside the pane, so what is
// visible does not move.
test("loom path data thins sub-pixel detail and off-pane segments without moving what is visible", async () => {
  const { pathData } = await import("../web/Plot");
  const identity = (p: { x: number; y: number }) => p;
  const points: ({ x: number; y: number } | null)[] = [];
  // A dense circle, 20,000 vertices about 0.094 units apart.
  for (let i = 0; i <= 20000; i++) {
    const a = (2 * Math.PI * i) / 20000;
    points.push({ x: 500 + 300 * Math.cos(a), y: 380 + 300 * Math.sin(a) });
  }
  points.push(null);
  // A spiral wholly outside the pane, then a segment crossing it.
  for (let i = 0; i <= 2000; i++) {
    const a = (2 * Math.PI * i) / 200,
      r = 5000 + i;
    points.push({ x: 500 + r * Math.cos(a), y: 380 + r * Math.sin(a) });
  }
  // Both ends of this segment lie outside the pane, but it cuts its corner.
  points.push(null, { x: -60, y: 300 }, { x: 300, y: -60 }, null);
  // An isolated point is a lone moveto, never stroked, and is dropped.
  points.push({ x: 40, y: 40 });
  const parse = (d: string) => {
    const runs: { x: number; y: number }[][] = [];
    for (const [, c, x, y] of d.matchAll(/([ML])(-?[\d.]+),(-?[\d.]+)/g)) {
      if (c === "M") runs.push([]);
      runs.at(-1)!.push({ x: +x, y: +y });
    }
    return runs;
  };
  const full = parse(pathData(points, identity));
  const thin = parse(
    pathData(points, identity, undefined, undefined, { tolerance: 0.1 }),
  );
  const count = (runs: unknown[][]) => runs.reduce((n, r) => n + r.length, 0);
  expect(count(full)).toBeGreaterThan(22000);
  expect(count(thin)).toBeLessThan(11000);
  // Each run's ends are kept exactly; nothing joins across a break.
  expect(thin[0][0]).toEqual(full[0][0]);
  expect(thin[0].at(-1)).toEqual(full[0].at(-1));
  expect(full.at(-1)).toEqual([{ x: 40, y: 40 }]);
  expect(thin.flat()).not.toContainEqual({ x: 40, y: 40 });
  // The crossing segment stays; no spiral vertex survives.
  expect(thin).toContainEqual([
    { x: -60, y: 300 },
    { x: 300, y: -60 },
  ]);
  for (const run of thin)
    for (const p of run)
      expect(Math.hypot(p.x - 500, p.y - 380)).toBeLessThan(4000);
  // Every vertex of the full drawing inside the pane lies within the
  // tolerance of the thinned one (segments bucketed by 10-unit cells).
  const cells = new Map<string, [number, number, number, number][]>();
  for (const run of thin)
    for (let i = 0; i < run.length; i++) {
      const a = run[i],
        b = run[Math.min(i + 1, run.length - 1)];
      for (
        let cx = Math.floor(Math.min(a.x, b.x) / 10) - 1;
        cx <= Math.floor(Math.max(a.x, b.x) / 10) + 1 &&
        cx - Math.floor(Math.min(a.x, b.x) / 10) < 300;
        cx++
      )
        for (
          let cy = Math.floor(Math.min(a.y, b.y) / 10) - 1;
          cy <= Math.floor(Math.max(a.y, b.y) / 10) + 1 &&
          cy - Math.floor(Math.min(a.y, b.y) / 10) < 300;
          cy++
        ) {
          const key = `${cx},${cy}`;
          if (!cells.has(key)) cells.set(key, []);
          cells.get(key)!.push([a.x, a.y, b.x, b.y]);
        }
    }
  const distance = (px: number, py: number, s: number[]) => {
    const [ax, ay, bx, by] = s,
      dx = bx - ax,
      dy = by - ay,
      t = Math.max(
        0,
        Math.min(
          1,
          ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy || 1),
        ),
      );
    return Math.hypot(px - ax - t * dx, py - ay - t * dy);
  };
  let worst = 0;
  // Lone movetos are never stroked, in either drawing.
  for (const run of full.filter((r) => r.length > 1))
    for (const p of run) {
      if (p.x < 0 || p.x > 1000 || p.y < 0 || p.y > 760) continue;
      const near =
        cells.get(`${Math.floor(p.x / 10)},${Math.floor(p.y / 10)}`) ?? [];
      worst = Math.max(
        worst,
        Math.min(...near.map((s) => distance(p.x, p.y, s))),
      );
    }
  expect(worst).toBeLessThanOrEqual(0.1 + 0.002);
});

// The default ellipse under exp(z³): its source curve carries about 140,000
// vertices of refinement, which iPhone Safari could not paint while
// scrolling. Its panes now hold a few thousand, the transparent hit paths
// are hidden from painting yet still select, and the drawing is unchanged
// where it is visible.
test("a large loom result reaches the page as a paintable drawing", async ({
  page,
}) => {
  await page.goto("/");
  await settled(page);
  await page
    .getByRole("button", { name: "Open complex loom", exact: true })
    .click();
  const d = page.getByRole("dialog", { name: "The complex loom" }),
    art = d.locator(".loom-panes");
  await expect(art).toHaveAttribute("aria-busy", "false");
  await d.getByLabel("Complex map", { exact: true }).selectOption("exp-power");
  await d.getByLabel("Degree", { exact: true }).selectOption("3");
  await expect(art).toHaveAttribute("aria-busy", "false");
  await expect(d.locator("[data-gaps]")).toContainText("out of budget");
  const vertices = (selector: string) =>
    d
      .locator(selector)
      .evaluateAll((paths) =>
        paths.reduce(
          (n, p) => n + (p.getAttribute("d")!.match(/[ML]/g)?.length ?? 0),
          0,
        ),
      );
  expect(await vertices('[data-pane="source"] [data-member]')).toBeLessThan(
    20000,
  );
  expect(await vertices('[data-pane="image"] [data-member]')).toBeLessThan(
    20000,
  );
  for (const hit of await d.locator("[data-hit-member]").all()) {
    await expect(hit).toHaveAttribute("visibility", "hidden");
    await expect(hit).toHaveAttribute("pointer-events", "stroke");
  }
  // Hidden hit paths still take a tap: on the shell, a tap on a circle
  // selects the member whose hit path the page finds under it.
  await d.getByRole("button", { name: "Return to study", exact: true }).click();
  await openLoomExample(page, "A quintic rosette wrapped into a shell");
  await expect(art).toHaveAttribute("aria-busy", "false");
  const members = d.getByLabel("Selected member", { exact: true });
  await expect(members).toHaveValue("0");
  const target = await d
    .locator('[data-pane="source"] [data-member="6"]')
    .evaluate((path: SVGPathElement) => {
      const p = path.getPointAtLength(path.getTotalLength() / 3);
      const m = path.getScreenCTM()!;
      const x = m.a * p.x + m.c * p.y + m.e,
        y = m.b * p.x + m.d * p.y + m.f;
      const hit = document
        .elementFromPoint(x, y)
        ?.closest("[data-hit-member]")
        ?.getAttribute("data-hit-member");
      return { x, y, hit };
    });
  expect(target.hit).toBeDefined();
  expect(target.hit).not.toBe("0");
  await page.mouse.click(target.x, target.y);
  await expect(members).toHaveValue(target.hit!);
});

// The general Möbius map, written here in complex arithmetic. Its flow is
// computed in Go; the expectations below use closed forms of each frame.
type C = { x: number; y: number };
const cmul = (a: C, b: C) => ({
  x: a.x * b.x - a.y * b.y,
  y: a.x * b.y + a.y * b.x,
});
const cadd = (a: C, b: C) => ({ x: a.x + b.x, y: a.y + b.y });
const cdiv = (a: C, b: C) => {
  const d = b.x * b.x + b.y * b.y;
  return { x: (a.x * b.x + a.y * b.y) / d, y: (a.y * b.x - a.x * b.y) / d };
};
const real = (x: number) => ({ x, y: 0 });
const fractional = ([a, b, c, d]: C[], z: C) =>
  cdiv(cadd(cmul(a, z), b), cadd(cmul(c, z), d));
// Rotation by 2φ about ±i: [[cos φ, sin φ], [−sin φ, cos φ]].
const quarter = (phi: number) => [
  real(Math.cos(phi)),
  real(Math.sin(phi)),
  real(-Math.sin(phi)),
  real(Math.cos(phi)),
];

test("general Möbius loom flows through the identity, follows edited coefficients and saves vector metadata", async ({
  page,
}) => {
  await page.addInitScript(() =>
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: {
        writeText: async (value: string) => {
          (window as any).loomCopied = value;
        },
      },
    }),
  );
  await page.goto("/");
  await settled(page);
  await openLoomExample(page, "A grid turned about two fixed points");
  const d = page.getByRole("dialog", { name: "The complex loom" }),
    art = d.locator(".loom-panes"),
    progress = d.getByLabel("Motion progress", { exact: true });
  await expect(art).toHaveAttribute("aria-busy", "false");
  await expect(d.locator(".eyebrow")).toHaveText(
    "Complex transformation · w = (az + b)/(cz + d)",
  );
  await expect(d.getByLabel("Complex map", { exact: true })).toHaveValue(
    "fractional",
  );
  // (1 + z)/(1 − z) turns a quarter turn about ±i. The preset opens at its
  // inverse, s = −1, on the line Re z = 1 from 1 − 2i.
  const z = await loomPoint(d, "source");
  expect(z).toEqual({ x: 1, y: -2 });
  const at = async (s: number, scale = 1) =>
    near(
      await loomPoint(d, "image"),
      fractional(quarter((s * Math.PI) / 4), z),
      scale,
    );
  expect(await at(-1)).toBe(true);
  // The inverse's pole −1 lies on the grid: excluded, with its circle.
  await expect(d.locator('[data-pane="source"] [data-exclusion]')).toHaveCount(
    1,
  );
  await expect(d.locator("[data-gaps]")).toContainText("excluded");
  // The flow passes exactly through the identity, with no pole.
  await progress.fill("0.5");
  await expect(art).toHaveAttribute("aria-busy", "false");
  await expect.poll(() => loomPoint(d, "image")).toEqual(z);
  await expect(d.locator("[data-exclusion]")).toHaveCount(0);
  await expect(d.locator("[data-gaps]")).toContainText("No gaps");
  // s = 1/2 is an eighth turn, and s = 1 the entered map: (1 + z)/(1 − z).
  await progress.fill("0.75");
  await expect(art).toHaveAttribute("aria-busy", "false");
  await expect.poll(() => at(0.5)).toBe(true);
  await expect(d.locator(".animation-values")).toContainText("s = 0.500000");
  await progress.fill("1");
  await expect(art).toHaveAttribute("aria-busy", "false");
  await expect.poll(() => at(1)).toBe(true);
  // Editing a coefficient redraws the map: (z + 2)/(−z + 1).
  await d.getByText("Map settings", { exact: true }).click();
  for (const [name, value] of [
    ["Re a", "1"],
    ["Im a", "0"],
    ["Re b", "1"],
    ["Re c", "-1"],
    ["Re d", "1"],
  ])
    await expect(d.getByLabel(name, { exact: true })).toHaveValue(value);
  await d.getByLabel("Re b", { exact: true }).fill("2");
  await expect(art).toHaveAttribute("aria-busy", "false");
  const edited = [real(1), real(2), real(-1), real(1)];
  await expect
    .poll(async () => near(await loomPoint(d, "image"), fractional(edited, z)))
    .toBe(true);
  // ad − bc = 0 names no single coefficient: the refusal shows under the
  // one changed last, and correcting it recovers.
  await d.getByLabel("Re d", { exact: true }).fill("-2");
  await expect(d.getByLabel("Re d", { exact: true })).toHaveAttribute(
    "aria-invalid",
    "true",
  );
  await expect(d.getByRole("alert")).toContainText("|ad − bc|");
  await expect(d.getByRole("alert")).toHaveCount(1);
  await d.getByLabel("Re d", { exact: true }).fill("1");
  await expect(art).toHaveAttribute("aria-busy", "false");
  await d.getByLabel("Im c", { exact: true }).fill("2000000");
  await expect(d.getByLabel("Im c", { exact: true })).toHaveAttribute(
    "aria-invalid",
    "true",
  );
  await expect(d.getByRole("alert")).toContainText("Im c must be within");
  await d.getByLabel("Im c", { exact: true }).fill("0");
  await expect(art).toHaveAttribute("aria-busy", "false");
  await expect(d.getByRole("alert")).toHaveCount(0);
  await expect
    .poll(async () => near(await loomPoint(d, "image"), fractional(edited, z)))
    .toBe(true);
  const download = page.waitForEvent("download");
  await loomImage(d, "SVG");
  expect((await download).suggestedFilename()).toBe("complex-fractional.svg");
  const svg = await readFile((await (await download).path())!, "utf8");
  for (const text of [
    '"map":"fractional"',
    '"formula":"w = (az + b)/(cz + d)"',
    '"coefficients":{"a":{"x":1,"y":0},"b":{"x":2,"y":0},"c":{"x":-1,"y":0},"d":{"x":1,"y":0}}',
    '"mapParameter":1',
    "|ad−bc|",
  ])
    expect(svg).toContain(text);
  expect(svg).not.toMatch(/<text|<image/);
  // Another map keeps the coefficients for a return to this one.
  await d.getByLabel("Complex map", { exact: true }).selectOption("square");
  await expect(art).toHaveAttribute("aria-busy", "false");
  await expect(d.getByLabel("Re b", { exact: true })).toHaveCount(0);
  await d.getByLabel("Complex map", { exact: true }).selectOption("fractional");
  await expect(art).toHaveAttribute("aria-busy", "false");
  await expect(d.getByLabel("Re b", { exact: true })).toHaveValue("2");
  // Choosing the map again opens on the map itself, s = 1, with point
  // traversal; map motion then grows the map out of the identity.
  await expect(d.getByLabel("Map parameter", { exact: true })).toHaveValue("1");
  await expect(d.getByLabel("Motion", { exact: true })).toHaveValue("point");
  await d.getByLabel("Motion", { exact: true }).selectOption("map");
  await expect(d.getByLabel("Map motion from", { exact: true })).toHaveValue(
    "0",
  );
  await expect(d.getByLabel("Map motion to", { exact: true })).toHaveValue("1");
  await d.getByLabel("Motion", { exact: true }).selectOption("point");
  await expect
    .poll(async () => near(await loomPoint(d, "image"), fractional(edited, z)))
    .toBe(true);
  const image = await d
    .locator('[data-pane="image"] [data-member="12"]')
    .getAttribute("d");
  await d.getByRole("button", { name: "Copy link", exact: true }).click();
  await expect(d.getByText("Link copied", { exact: true })).toBeVisible();
  const link = await page.evaluate(() => (window as any).loomCopied as string);
  const saved = wireStudy(new URL(link).hash.slice(3));
  expect(saved.loom.map).toBe("fractional");
  expect(saved.loom.coefficients.b).toEqual({ x: 2, y: 0 });
  await d.getByRole("button", { name: "Return to study", exact: true }).click();
  await page.goto(link);
  await expect(page).not.toHaveURL(/#s=/);
  await expect(d.locator(".loom-panes")).toHaveAttribute("aria-busy", "false");
  await expect(d.getByLabel("Complex map", { exact: true })).toHaveValue(
    "fractional",
  );
  expect(
    await d.locator('[data-pane="image"] [data-member="12"]').getAttribute("d"),
  ).toBe(image);
});

test("a decoded general Möbius flow film matches direct seeks, with its moving pole", async ({
  page,
}) => {
  await page.goto("/");
  await settled(page);
  await openLoomExample(page, "Circles whirled between two fixed points");
  const d = page.getByRole("dialog", { name: "The complex loom" }),
    art = d.locator(".loom-panes"),
    progress = d.getByLabel("Motion progress", { exact: true });
  await expect(art).toHaveAttribute("aria-busy", "false");
  // The exclusion circle follows each frame's pole, Mˢ's own: at s = ±1
  // it is −d/c and a/c of M = [[1+2i, 1−2i], [1−2i, 1+2i]].
  const exclusion = d.locator('[data-pane="source"] [data-exclusion]');
  const centers: string[] = [];
  const seeks: number[][] = [];
  for (const p of [0, 0.5, 1]) {
    await progress.fill(String(p));
    await expect(art).toHaveAttribute("aria-busy", "false");
    await expect(exclusion).toHaveCount(p === 0.5 ? 0 : 1);
    if (p !== 0.5)
      centers.push(
        `${await exclusion.getAttribute("cx")},${await exclusion.getAttribute("cy")}`,
      );
    seeks.push(
      await d.locator('[data-pane="image"]').evaluate(async (e) => {
        const svg = e.cloneNode(true) as SVGSVGElement;
        svg.setAttribute("xmlns", "http://www.w3.org/2000/svg");
        svg.setAttribute("width", "500");
        svg.setAttribute("height", "380");
        const url = URL.createObjectURL(
          new Blob([new XMLSerializer().serializeToString(svg)], {
            type: "image/svg+xml",
          }),
        );
        try {
          const image = new Image();
          image.src = url;
          await image.decode();
          const canvas = Object.assign(document.createElement("canvas"), {
            width: 500,
            height: 380,
          });
          const ctx = canvas.getContext("2d")!;
          ctx.drawImage(image, 0, 0);
          return Array.from(ctx.getImageData(0, 0, 500, 380).data);
        } finally {
          URL.revokeObjectURL(url);
        }
      }),
    );
  }
  // −d/c = −(1+2i)/(1−2i) = (3 − 4i)/5 and a/c = −(3 − 4i)/5: the poles of
  // the map and its inverse, opposite across zero on the drawing.
  const [x0, y0] = centers[0].split(",").map(Number),
    [x1, y1] = centers[1].split(",").map(Number);
  const [cx, cy] = await d.locator('[data-pane="source"]').evaluate((svg) => {
    const b = (svg as SVGSVGElement).viewBox.baseVal;
    return [b.x + b.width / 2, b.y + b.height / 2];
  });
  expect(x0 + x1).toBeCloseTo(2 * cx, 6);
  expect(y0 + y1).toBeCloseTo(2 * cy, 6);
  // The drawing's y axis points down: 3 − 4i lies right and below.
  expect((x1 - cx) / (y1 - cy)).toBeCloseTo(3 / 4, 6);
  expect(x1).toBeGreaterThan(cx);
  await progress.fill("0");
  await expect(art).toHaveAttribute("aria-busy", "false");
  await openLoomExportSettings(d);
  await d.getByLabel("Traversal duration", { exact: true }).fill(".2");
  await loomResolution(d, 0.5);
  await d.getByLabel("Export frame rate", { exact: true }).selectOption("15");
  await d.getByLabel("Export format", { exact: true }).selectOption("mp4");
  const download = page.waitForEvent("download");
  await loomMovieAction(d).click();
  expect((await download).suggestedFilename()).toBe(
    "tangent-garden-complex-fractional.mp4",
  );
  const path = (await (await download).path())!,
    bytes = await readFile(path);
  for (const text of ['"map":"fractional"', '"mode":"map"', '"coefficients"'])
    expect(bytes.includes(Buffer.from(text))).toBe(true);
  const timing = videoProbe(path);
  expect(timing?.frames).toBe(3);
  expect(timing?.durations.reduce((a, b) => a + b, 0)).toBe(200);
  const frames = execFileSync(
    "ffmpeg",
    ["-v", "error", "-i", path, "-f", "rawvideo", "-pix_fmt", "rgb24", "-"],
    { maxBuffer: 4 * 1024 * 1024 },
  );
  expect(frames.length).toBe(3 * 1000 * 380 * 3);
  for (let f = 0; f < 3; f++) {
    const errors = seeks.map((expected) => {
      let error = 0;
      for (let y = 0; y < 380; y++)
        for (let x = 0; x < 500; x++)
          for (let c = 0; c < 3; c++)
            error += Math.abs(
              frames[f * 1000 * 380 * 3 + (y * 1000 + x + 500) * 3 + c] -
                expected[(y * 500 + x) * 4 + c],
            );
      return error / (500 * 380 * 3);
    });
    // Thin circles crowd into a fan near each frame's pole, and its last,
    // predicted frame compresses a little less faithfully than the
    // rational film's (2.2 against 1.7 observed; at a 20% fuzz the frame
    // and its seek differ in 4 pixels). The relative check below is what
    // tells the frames apart.
    expect(errors[f], `frame ${f}: ${errors}`).toBeLessThan(3);
    for (let other = 0; other < 3; other++)
      if (other !== f)
        expect(
          errors[f],
          `frame ${f} must match its own seek: ${errors}`,
        ).toBeLessThan(errors[other] * 0.7);
  }
});

const nearPoint = (
  got: { x: number; y: number },
  want: { x: number; y: number },
  tolerance = 1e-9,
) =>
  expect(
    Math.hypot(got.x - want.x, got.y - want.y),
    `${JSON.stringify(got)} near ${JSON.stringify(want)}`,
  ).toBeLessThan(tolerance * Math.max(1, Math.hypot(want.x, want.y)));
const square = (z: { x: number; y: number }) => power(z, 2);

// The default study is an ellipse x = 2 cos t, y = 3 sin t with its evolute,
// E(t) = (−(5/2) cos³t, (5/3) sin³t), centers of curvature. The loom opens on
// the ellipse, as it always did; Path takes it to the evolute, drawn over the
// faint ellipse with the radius of curvature at the point, and on through
// the frozen study's other paths.
test("Path takes the loom from a study's curve to its derived curves, with their base and construction", async ({
  page,
}) => {
  await page.goto("/");
  await settled(page);
  await page
    .getByRole("button", { name: "Open complex loom", exact: true })
    .click();
  const d = page.getByRole("dialog", { name: "The complex loom" }),
    art = d.locator(".loom-panes"),
    path = d.getByLabel("Path", { exact: true });
  await expect(art).toHaveAttribute("aria-busy", "false");
  await expect(path).toHaveValue("curve");
  await expect(d.locator('[data-pane="source"] [data-base]')).toHaveCount(0);
  await path.selectOption("evolute");
  await expect(art).toHaveAttribute("aria-busy", "false");
  await expect(d.locator("[data-path-note]")).toContainText(
    "maps the evolute of a frozen copy of your base study’s parametric curve",
  );
  const source = d.locator('[data-pane="source"]');
  await expect(source.locator("[data-base]")).toHaveCount(1);
  await expect(d.locator('[data-pane="image"] [data-base]')).toHaveCount(0);
  nearPoint(await loomPoint(d, "source"), { x: -2.5, y: 0 });
  nearPoint(await loomPoint(d, "image"), { x: 6.25, y: 0 });
  const construction = source.locator("[data-construction]");
  await expect(construction.locator("line")).toHaveCount(1);
  nearPoint(
    JSON.parse(
      (await construction.locator("circle").getAttribute("data-point"))!,
    ),
    { x: 2, y: 0 },
    1e-12,
  );
  await expect(d.locator(".loom-correspondence")).toContainText(
    "Base point (2.0000, 0.0000);",
  );
  await expect(d.locator("[data-gaps]")).toContainText("No gaps.");
  await d.getByLabel("Exact source parameter", { exact: true }).fill("pi/2");
  await expect
    .poll(async () => (await loomPoint(d, "source")).y)
    .toBeCloseTo(5 / 3, 9);
  nearPoint(
    await loomPoint(d, "image"),
    square(await loomPoint(d, "source")),
    1e-12,
  );
  // The pedal about the study's pole, the origin: at t = 0 the tangent is
  // vertical through (2, 0), so the foot is the base point itself.
  await path.selectOption("pedal");
  await expect(art).toHaveAttribute("aria-busy", "false");
  await expect(d.locator("[data-path-note]")).toContainText(
    "pedal curve about the pole (0, 0)",
  );
  await expect
    .poll(async () => {
      const z = await loomPoint(d, "source");
      return Math.hypot(z.x - 2, z.y) < 1e-9;
    })
    .toBe(true);
  await expect(construction.locator("line")).toHaveCount(2);
  await expect(construction.locator("circle")).toHaveCount(2);
  // The orthotomic reflects the pole across the tangent: solid from r and P
  // to the foot H = (P + Q)/2, and the reflected half H→Q dashed, ending at
  // the marker.
  await path.selectOption("orthotomic");
  await expect(art).toHaveAttribute("aria-busy", "false");
  const dashed = construction.locator("line[stroke-dasharray]");
  await expect(dashed).toHaveCount(1);
  await expect(construction.locator("line")).toHaveCount(3);
  const marker = source.locator("[data-marker]");
  for (const [end, at] of [
    ["x2", "cx"],
    ["y2", "cy"],
  ])
    expect(Number(await dashed.getAttribute(end))).toBeCloseTo(
      Number(await marker.getAttribute(at)),
      6,
    );
  await path.selectOption("curve");
  await expect(art).toHaveAttribute("aria-busy", "false");
  await expect(source.locator("[data-base]")).toHaveCount(0);
  await expect(source.locator("[data-construction]")).toHaveCount(0);
  await expect(d.locator(".loom-correspondence")).not.toContainText(
    "Base point",
  );
  nearPoint(await loomPoint(d, "image"), { x: 4, y: 0 });
  await d.getByRole("button", { name: "Return to study", exact: true }).click();
  await expect(d).toBeHidden();
  await expect(page.getByLabel("x(t)", { exact: true })).toHaveValue(
    "2*cos(t)",
  );
});

// A study whose construction acts on a derived input, which the loom used to
// refuse, opens on that input; one on the curve itself opens on the curve.
test("the loom opens on a construction's derived input, and on the curve otherwise", async ({
  page,
}) => {
  await page.goto("/");
  await settled(page);
  const button = page.getByRole("button", {
      name: "Open complex loom",
      exact: true,
    }),
    d = page.getByRole("dialog", { name: "The complex loom" });
  for (const [label, path] of [
    ["An ellipse's pedal, inverted", "pedal"],
    ["Flower & its offset", "curve"],
    ["Offsets of an evolute", "evolute"],
  ]) {
    await choosePreset(page, { label });
    await settled(page);
    await expect(button, label).toBeEnabled();
    await button.click();
    await expect(d.locator(".loom-panes")).toHaveAttribute(
      "aria-busy",
      "false",
    );
    await expect(d.getByLabel("Path", { exact: true }), label).toHaveValue(
      path,
    );
    await expect(d.getByRole("alert")).toHaveCount(0);
    await d
      .getByRole("button", { name: "Return to study", exact: true })
      .click();
    await expect(d).toBeHidden();
  }
});

// The five-cusped hypocycloid's evolute breaks at each base cusp, where the
// tangent reverses; a copied link restores the path, and the vector export
// records it with the base curve and construction as geometry only.
test("a derived loom preset breaks at its cusps, a copied link restores its path and SVG records it", async ({
  page,
}) => {
  await page.addInitScript(() =>
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: {
        writeText: async (value: string) => {
          (window as any).loomCopied = value;
        },
      },
    }),
  );
  await page.goto("/");
  await settled(page);
  await openLoomExample(page, "A hypocycloid's evolute squared into a star");
  const d = page.getByRole("dialog", { name: "The complex loom" }),
    art = d.locator(".loom-panes");
  await expect(art).toHaveAttribute("aria-busy", "false");
  await expect(d.getByLabel("Path", { exact: true })).toHaveValue("evolute");
  await expect(d.locator("[data-gaps]")).toContainText("singular");
  await expect(d.locator("[data-gaps]")).not.toContainText("budget");
  await expect(d.locator(".loom-correspondence")).toContainText("Base point");
  nearPoint(
    await loomPoint(d, "image"),
    square(await loomPoint(d, "source")),
    1e-12,
  );
  const image = await d
    .locator('[data-pane="image"] [data-member]')
    .getAttribute("d");
  await d.getByRole("button", { name: "Copy link", exact: true }).click();
  await expect(d.getByText("Link copied", { exact: true })).toBeVisible();
  const link = await page.evaluate(() => (window as any).loomCopied as string);
  const saved = wireStudy(new URL(link).hash.slice(3));
  expect(saved.loom.source.input).toBe("evolute");
  expect(saved.loom.source.curve.format).toBe("roulette");
  const download = page.waitForEvent("download");
  await loomImage(d, "SVG");
  const svg = await readFile((await (await download).path())!, "utf8");
  expect(svg).toContain('"input":"evolute"');
  expect(svg).toContain("data-base");
  expect(svg).toContain("data-construction");
  expect(svg).not.toMatch(/<text|<image/);
  await d.getByRole("button", { name: "Return to study", exact: true }).click();
  await page.goto(link);
  await expect(page).not.toHaveURL(/#s=/);
  await expect(art).toHaveAttribute("aria-busy", "false");
  await expect(d.getByLabel("Path", { exact: true })).toHaveValue("evolute");
  expect(
    await d.locator('[data-pane="image"] [data-member]').getAttribute("d"),
  ).toBe(image);
});

// The star's offset under z⁴: frames at p = 0, 1/2 and 1 are θ = 0, π and
// 2π, each matching a direct seek's markers in both panes.
test("a decoded derived traversal film matches direct seeks in both panes", async ({
  page,
}) => {
  await page.goto("/");
  await settled(page);
  await openLoomExample(page, "A star's offset raised to the fourth power");
  const d = page.getByRole("dialog", { name: "The complex loom" }),
    art = d.locator(".loom-panes");
  await expect(art).toHaveAttribute("aria-busy", "false");
  await expect(d.getByLabel("Path", { exact: true })).toHaveValue("offset");
  const centers: { source: number[]; image: number[] }[] = [];
  for (const at of ["0", "pi"]) {
    await d.getByLabel("Exact source parameter", { exact: true }).fill(at);
    await expect(art).toHaveAttribute("aria-busy", "false");
    await expect
      .poll(
        async () =>
          (await d
            .locator(".loom-correspondence")
            .getAttribute("data-parameter"))!,
      )
      .toBe(at === "0" ? "0" : String(Math.PI));
    nearPoint(
      await loomPoint(d, "image"),
      power(await loomPoint(d, "source"), 4),
      1e-12,
    );
    const read = async (pane: string) => {
      const c = d.locator(`[data-pane="${pane}"] [data-marker]`);
      return [
        Number(await c.getAttribute("cx")),
        Number(await c.getAttribute("cy")),
      ];
    };
    centers.push({ source: await read("source"), image: await read("image") });
  }
  expect(centers[0].image).not.toEqual(centers[1].image);
  await d.getByLabel("Exact source parameter", { exact: true }).fill("0");
  await expect(art).toHaveAttribute("aria-busy", "false");
  await openLoomExportSettings(d);
  await d.getByLabel("Traversal duration", { exact: true }).fill("0.2");
  await loomResolution(d, 0.5);
  await d.getByLabel("Export frame rate", { exact: true }).selectOption("15");
  await d.getByLabel("Export format", { exact: true }).selectOption("mp4");
  const movie = page.waitForEvent("download");
  await loomMovieAction(d).click();
  const moviePath = (await (await movie).path())!;
  const bytes = await readFile(moviePath);
  expect(bytes.includes(Buffer.from('"input":"offset"'))).toBe(true);
  const timing = videoProbe(moviePath);
  if (timing) expect(timing.frames).toBe(3);
  const frames = execFileSync(
    "ffmpeg",
    [
      "-v",
      "error",
      "-i",
      moviePath,
      "-f",
      "rawvideo",
      "-pix_fmt",
      "rgb24",
      "-",
    ],
    { maxBuffer: 4 * 1024 * 1024 },
  );
  const pink = (frame: number, cx: number, cy: number) => {
    let found = 0;
    for (let y = Math.round(cy) - 8; y <= Math.round(cy) + 8; y++)
      for (let x = Math.round(cx) - 8; x <= Math.round(cx) + 8; x++) {
        const i = frame * 1000 * 380 * 3 + (y * 1000 + x) * 3;
        const [r, g, b] = frames.subarray(i, i + 3);
        if (r > 70 && r > g * 1.3 && b > g * 1.2) found++;
      }
    return found;
  };
  const at = (frame: number, seek: number, hit: boolean) => {
    const { source, image } = centers[seek];
    const n = (v: number) => (hit ? v > 0 : v === 0);
    expect(n(pink(frame, source[0] / 2, source[1] / 2))).toBe(true);
    expect(n(pink(frame, 500 + image[0] / 2, image[1] / 2))).toBe(true);
  };
  for (const frame of [0, 2]) {
    at(frame, 0, true);
    at(frame, 1, false);
  }
  at(1, 1, true);
  at(1, 0, false);
});

// The derived performance opens at λ = 1, where each image point is
// z + 1/z of its source point on the star's offset; map motion ends at the
// identity, where the image is the offset itself, point for point.
test("a derived performance folds its path by z + λ/z and unfolds it to the identity", async ({
  page,
}) => {
  await page.goto("/");
  await settled(page);
  await openLoomExample(page, "A star's offset folded into lace");
  const d = page.getByRole("dialog", { name: "The complex loom" }),
    art = d.locator(".loom-panes");
  await expect(art).toHaveAttribute("aria-busy", "false");
  await expect(d.getByLabel("Path", { exact: true })).toHaveValue("offset");
  await expect(d.getByLabel("Complex map", { exact: true })).toHaveValue(
    "joukowski",
  );
  const fold = (z: { x: number; y: number }, lambda: number) => {
    const r = z.x * z.x + z.y * z.y;
    return { x: z.x + (lambda * z.x) / r, y: z.y - (lambda * z.y) / r };
  };
  const z = await loomPoint(d, "source");
  nearPoint(await loomPoint(d, "image"), fold(z, 1), 1e-12);
  const member = d.locator('[data-pane="source"] [data-member="0"]');
  const image = d.locator('[data-pane="image"] [data-member="0"]');
  const lace = await image.getAttribute("d");
  await d.getByLabel("Motion progress", { exact: true }).fill("1");
  await expect(art).toHaveAttribute("aria-busy", "false");
  await expect.poll(() => image.getAttribute("d")).not.toBe(lace);
  nearPoint(await loomPoint(d, "image"), z, 1e-15);
  // Each pane keeps its own fixed reference scale, 260 for the still source
  // and 150 for the image, about one center: the identity's image is its
  // source, chord for chord.
  const plane = async (path: typeof image, scale: number) =>
    [
      ...(await path.getAttribute("d"))!.matchAll(/([ML])([-\d.]+),([-\d.]+)/g),
    ].map(
      ([, move, x, y]) =>
        [move, (+x - 500) / scale, (380 - +y) / scale] as const,
    );
  const drawn = await plane(image, 150),
    source = await plane(member, 260);
  expect(drawn.length).toBe(source.length);
  drawn.forEach(([move, x, y], i) => {
    expect(move).toBe(source[i][0]);
    expect(Math.abs(x - source[i][1])).toBeLessThan(1e-5);
    expect(Math.abs(y - source[i][2])).toBeLessThan(1e-5);
  });
  await expect(d.locator("[data-path-note]")).toHaveText(
    "The loom maps the offset at distance 0.25 of the example’s own polar curve, drawn faintly beneath it.",
  );
  await expect(
    d.getByLabel("Source family", { exact: true }).locator("option:checked"),
  ).toHaveText("The example’s curve");
});

// An older loom link froze no pole or distance; a derived path chosen from
// it takes them from the study beneath it, here the pedal study's pole.
test("an older loom link's derived path takes its pole from the study beneath it", async ({
  page,
}) => {
  const { presets } = await import("../web/presets");
  const { presetStudy } = await import("../web/planar-link");
  const { curveLoom } = await import("../web/loom/model");
  const base = presetStudy(
    presets.findIndex((p) => p.title === "Ellipse & its pedal"),
  );
  const loom = curveLoom(base.config);
  delete loom.source.pole;
  delete loom.source.distance;
  const token = deflateRawSync(
    JSON.stringify({ v: 1, notebook: "2d", study: { ...base, loom } }),
  ).toString("base64url");
  await page.goto(`/#s=${token}`);
  const d = page.getByRole("dialog", { name: "The complex loom" }),
    art = d.locator(".loom-panes");
  await expect(art).toHaveAttribute("aria-busy", "false");
  await expect(d.getByLabel("Path", { exact: true })).toHaveValue("curve");
  await d.getByLabel("Path", { exact: true }).selectOption("pedal");
  await expect(art).toHaveAttribute("aria-busy", "false");
  await expect(d.locator("[data-path-note]")).toContainText(
    "pedal curve about the pole (1.65, 0.3)",
  );
  await expect(d.getByRole("alert")).toHaveCount(0);
  const pole = d.locator('[data-pane="source"] [data-construction] circle');
  await expect(pole).toHaveCount(2);
  expect(JSON.parse((await pole.nth(1).getAttribute("data-point"))!)).toEqual({
    x: 1.65,
    y: 0.3,
  });
});

// A degree retained from the power map rides along under maps that ignore
// it; traversal must keep playing rather than mistake the frames it shows
// for stale geometry.
test("traversal keeps playing under a map that ignores a retained degree", async ({
  page,
}) => {
  const { presetStudy } = await import("../web/planar-link");
  const { curveLoom, replaceMap } = await import("../web/loom/model");
  const base = presetStudy(0);
  const loom = {
    ...replaceMap(curveLoom(base.config), "exp"),
    degree: 3,
    duration: 4,
  };
  const token = deflateRawSync(
    JSON.stringify({ v: 1, notebook: "2d", study: { ...base, loom } }),
  ).toString("base64url");
  await page.goto(`/#s=${token}`);
  const d = page.getByRole("dialog", { name: "The complex loom" });
  await expect(d.locator(".loom-panes")).toHaveAttribute("aria-busy", "false");
  await d.getByRole("button", { name: "Play traversal", exact: true }).click();
  const parameter = () =>
    d
      .locator(".loom-correspondence")
      .getAttribute("data-parameter")
      .then(Number);
  await expect.poll(parameter).toBeGreaterThan(1);
  await expect(
    d.getByRole("button", { name: "Pause traversal", exact: true }),
  ).toBeVisible();
});

// Scrubbing must never make a button blink. Map motion changes the geometry
// on every scrubbed frame, and traversal only the marker; in both, Play,
// copy-link and the exports stay enabled while each frame computes.
for (const [example, name, label] of [
  ["Circles through infinity", "Play map motion", "Motion progress"],
  ["A squared grid grown into a web", "Play map motion", "Motion progress"],
  [undefined, "Play traversal", "Source parameter"],
] as const)
  test(`scrubbing never disables a button (${label}${example ? `: ${example}` : ""})`, async ({
    page,
  }) => {
    await page.goto("/");
    await settled(page);
    await openLoomExample(page, example);
    const d = page.getByRole("dialog", { name: "The complex loom" });
    await expect(d.locator(".loom-panes")).toHaveAttribute(
      "aria-busy",
      "false",
    );
    const actions = [
      d.getByRole("button", { name, exact: true }),
      d.getByRole("button", { name: "Copy link", exact: true }),
      d.getByRole("button", { name: "Export image", exact: false }),
      loomMovieAction(d),
    ];
    for (const action of actions) await expect(action).toBeEnabled();
    await d.evaluate((dialog) => {
      const blinked: string[] = ((window as any).blinked = []);
      new MutationObserver((records) => {
        for (const r of records) {
          const button = r.target as HTMLButtonElement;
          if (button.disabled) blinked.push(button.textContent ?? "");
        }
      }).observe(dialog, {
        attributes: true,
        attributeFilter: ["disabled"],
        subtree: true,
      });
    });
    const slider = d.getByRole("slider", { name: label, exact: true });
    const box = (await slider.boundingBox())!;
    await page.mouse.move(box.x + 5, box.y + box.height / 2);
    await page.mouse.down();
    for (let i = 0; i <= 30; i++) {
      await page.mouse.move(
        box.x + 5 + ((box.width - 10) * i) / 30,
        box.y + box.height / 2,
      );
      await page.waitForTimeout(25);
    }
    await page.mouse.up();
    await expect(d.locator(".loom-panes")).toHaveAttribute(
      "aria-busy",
      "false",
    );
    expect(await page.evaluate(() => (window as any).blinked)).toEqual([]);
    for (const action of actions) await expect(action).toBeEnabled();
  });

// While a scrubbed map parameter's frame is on its way, every action stays
// available. A still saved then waits for that frame, so it never pairs the
// previous map's geometry with this one's parameter and marker.
test("a still saved during a pending map-motion frame draws that frame", async ({
  page,
}) => {
  await page.addInitScript(() => {
    const send = Worker.prototype.postMessage;
    const held: (() => void)[] = [];
    (window as any).holdGeometry = false;
    (window as any).releaseGeometry = () => held.splice(0).forEach((f) => f());
    Worker.prototype.postMessage = function (q: any, ...rest: any[]) {
      if (q.action === "loom" && !q.pointOnly && (window as any).holdGeometry)
        held.push(() => send.call(this, q, ...rest));
      else send.call(this, q, ...rest);
    };
  });
  await page.goto("/");
  await settled(page);
  await openLoomExample(page, "Circles through infinity");
  const d = page.getByRole("dialog", { name: "The complex loom" }),
    art = d.locator(".loom-panes");
  await expect(art).toHaveAttribute("aria-busy", "false");
  const image = d.locator('[data-pane="image"] [data-member="0"]');
  const before = (await image.getAttribute("d"))!;
  const actions = [
    d.getByRole("button", { name: "Play map motion", exact: true }),
    d.getByRole("button", { name: "Copy link", exact: true }),
    d.getByRole("button", { name: "Export image", exact: false }),
    loomMovieAction(d),
  ];
  await page.evaluate(() => ((window as any).holdGeometry = true));
  const slider = d.getByLabel("Motion progress", { exact: true });
  await slider.focus();
  await slider.press("ArrowRight");
  await expect(art).toHaveAttribute("aria-busy", "true");
  for (const action of actions) await expect(action).toBeEnabled();
  let saved = false;
  const download = page.waitForEvent("download").then((f) => {
    saved = true;
    return f;
  });
  await loomImage(d, "SVG");
  await page.waitForTimeout(300);
  expect(saved).toBe(false);
  await page.evaluate(() => {
    (window as any).holdGeometry = false;
    (window as any).releaseGeometry();
  });
  const svg = await readFile((await (await download).path())!, "utf8");
  expect(svg).not.toContain(`d="${before}"`);
  await expect(art).toHaveAttribute("aria-busy", "false");
  const after = (await image.getAttribute("d"))!;
  expect(after).not.toBe(before);
  expect(svg).toContain(`d="${after}"`);
  const shown = await slider.getAttribute("aria-valuetext");
  expect(svg).toContain(`"mapParameter":${shown}`);
  for (const action of actions) await expect(action).toBeEnabled();
});

// A movie started while a scrubbed map frame is on its way supersedes that
// frame's request; once the movie is saved, the drawing still reaches it.
test("a movie saved during a pending map-motion frame leaves the drawing current", async ({
  page,
}) => {
  await page.addInitScript(() => {
    const send = Worker.prototype.postMessage;
    const held: (() => void)[] = [];
    (window as any).holdGeometry = false;
    (window as any).releaseGeometry = () => held.splice(0).forEach((f) => f());
    Worker.prototype.postMessage = function (q: any, ...rest: any[]) {
      if (q.action === "loom" && !q.pointOnly && (window as any).holdGeometry)
        held.push(() => send.call(this, q, ...rest));
      else send.call(this, q, ...rest);
    };
  });
  await page.goto("/");
  await settled(page);
  await openLoomExample(page, "Circles through infinity");
  const d = page.getByRole("dialog", { name: "The complex loom" }),
    art = d.locator(".loom-panes");
  await expect(art).toHaveAttribute("aria-busy", "false");
  await openLoomExportSettings(d);
  await d.getByLabel("Traversal duration", { exact: true }).fill("0.2");
  await d.getByLabel("Export frame rate", { exact: true }).selectOption("15");
  await expect(art).toHaveAttribute("aria-busy", "false");
  const image = d.locator('[data-pane="image"] [data-member="0"]');
  const before = (await image.getAttribute("d"))!;
  await page.evaluate(() => ((window as any).holdGeometry = true));
  const slider = d.getByLabel("Motion progress", { exact: true });
  await slider.focus();
  await slider.press("ArrowRight");
  await expect(art).toHaveAttribute("aria-busy", "true");
  await page.evaluate(() => ((window as any).holdGeometry = false));
  const movie = page.waitForEvent("download");
  await loomMovieAction(d).click();
  // The movie's first request must replace the held one before it settles;
  // its export module loads lazily first.
  await page.waitForTimeout(1000);
  await page.evaluate(() => (window as any).releaseGeometry());
  await movie;
  await expect(art).toHaveAttribute("aria-busy", "false");
  expect(await image.getAttribute("d")).not.toBe(before);
});
