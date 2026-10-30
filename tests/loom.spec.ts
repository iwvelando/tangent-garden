import { test, expect, type Page, type Locator } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { crc32 } from "node:zlib";
import { execFileSync } from "node:child_process";
import { wireStudy } from "./study-link-wire";
import { decodePng } from "./png";
import { decodeVideo, probe as videoProbe } from "./video";
import { choosePreset } from "./helpers";

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
  await expect(page.getByText(/Square this study.s curve/)).toBeVisible();
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
    expect(play.y - scrub.y - scrub.height).toBeGreaterThanOrEqual(0);
    expect(play.y - scrub.y - scrub.height).toBeLessThan(30);
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
    "An ellipse's pedal, inverted",
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
  await expect(cards).toHaveCount(3);
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
