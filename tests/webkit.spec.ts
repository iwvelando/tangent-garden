import { test, expect, devices, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";
import {
  exportImage,
  openExportSettings,
  choosePreset,
  open,
  openAnimation,
} from "./helpers";
import { decodeVideo, probe, frameCoverage } from "./video";
import { exportTiming } from "../web/export-quality";
import { deflateRawSync } from "node:zlib";
import { spatialPresets } from "../web/spatial/presets";
import { defaultLayers } from "../web/spatial/renderer";
import { defaultSight, strokeWidth } from "../web/spatial/sight";
import { lineColor, palette } from "../web/spatial/palette";
import {
  checkFitMouseAndReturn,
  checkFitPlaybackLayout,
  checkFitAdoptionVisibility,
  leafFit,
} from "./fourier-fit-checks";

test("construction layer labels work by click, keyboard and scalar blur at phone width in WebKit", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await choosePreset(page, { label: "Flower & a rolling circle" });
  await page.getByLabel("Definition", { exact: true }).selectOption("fourier");
  await expect(page.locator(".plot-wrap")).toHaveAttribute(
    "aria-busy",
    "false",
  );
  const group = page.getByRole("group", {
    name: "Visible layers",
    exact: true,
  });
  const guides = group.getByRole("checkbox", {
    name: "Fourier circles & vectors",
    exact: true,
  });
  const rolling = group.getByRole("checkbox", {
    name: "Rolling circle & arm",
    exact: true,
  });
  await page.getByLabel("Circle radius ρ", { exact: true }).fill("pi/10");
  await group.getByText("Fourier circles & vectors", { exact: true }).click();
  await expect(guides).not.toBeChecked();
  await expect(page.getByTestId("epicycles")).toHaveCount(0);
  await expect(page.getByTestId("rolling-construction")).toBeVisible();
  await expect
    .poll(
      async () =>
        JSON.parse((await page.locator("#artwork desc").textContent())!).rolling
          .radius,
    )
    .toBe(Math.PI / 10);
  await group.getByText("Rolling circle & arm", { exact: true }).click();
  await expect(rolling).not.toBeChecked();
  await expect(page.getByTestId("rolling-construction")).toHaveCount(0);
  await rolling.focus();
  await page.keyboard.press("Space");
  await expect(rolling).toBeChecked();
  await expect(rolling).toBeFocused();
  await expect(page.getByTestId("rolling-construction")).toBeVisible();
  const overflow = await group.evaluate((el) =>
    [...el.querySelectorAll("label")].some(
      (label) =>
        label.getBoundingClientRect().right >
        el.getBoundingClientRect().right + 1,
    ),
  );
  expect(overflow).toBe(false);
});

test("drawn Fourier playback stays with the visible drawing through phone rotations in WebKit", async ({
  page,
}) => {
  await checkFitPlaybackLayout(page);
});

test("drawn Fourier adoption stays prominent and visible while scrolling in WebKit", async ({
  page,
}) => {
  await checkFitAdoptionVisibility(page);
});

test("drawn Fourier input preserves drafts and camera across click, blur and keyboard return in WebKit", async ({
  page,
}) => {
  await checkFitMouseAndReturn(page);
});

test("drawn Fourier controls fit, play, scrub and adopt from label clicks in WebKit", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await expect(page.locator(".plot-wrap")).toHaveAttribute(
    "aria-busy",
    "false",
  );
  const dialog = await leafFit(page, 16);
  await dialog
    .getByLabel("Show original outline in preview", { exact: true })
    .check();
  await expect(dialog.getByTestId("fit-reference")).toBeVisible();
  await dialog
    .getByRole("button", { name: "Play circles", exact: true })
    .click();
  await expect(
    dialog.getByRole("button", { name: "Pause circles", exact: true }),
  ).toBeVisible();
  await dialog
    .getByRole("button", { name: "Pause circles", exact: true })
    .click();
  await dialog.getByLabel("Preview position", { exact: true }).fill("0.5");
  await expect(dialog.getByTestId("epicycles")).toBeVisible();
  await dialog.getByRole("button", { name: "Adopt fitted study" }).click();
  await expect(page.getByLabel("Definition", { exact: true })).toHaveValue(
    "fourier",
  );
  await expect
    .poll(
      async () =>
        JSON.parse((await page.locator("#artwork desc").textContent())!).curve
          .terms.length,
    )
    .toBe(16);
  await expect(page.getByTestId("fit-reference")).toHaveCount(0);
});

// Safari's engine, which every iOS browser also uses: no canvas WebP, and its
// own H.264 encoder and VideoFrame behavior. Runs in the WebKit project only
// (`make test-webkit`, and the macOS CI job).

const exportMP4 = (page: Page) =>
  page.getByRole("button", { name: "Export MP4 video" });

// Safari does not focus a clicked button or checkbox: the engraving's
// controls must work from a click on their labels, and a constant entered in
// a range field must resolve when it loses focus to a tap elsewhere.
test("finite engraving controls work from label clicks and scalar blur in WebKit", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await choosePreset(page, { label: "A lamp's lace" });
  const members = page.locator("#artwork [data-family-member]");
  await expect(members).toHaveCount(16);
  const enabled = page.getByRole("checkbox", {
    name: "Finite engraving",
    exact: true,
  });
  const to = page.getByRole("textbox", { name: "Family to", exact: true });
  await to.fill("pi");
  await page.getByText("Selected member", { exact: true }).click();
  await expect
    .poll(async () =>
      JSON.parse(
        (await page.locator(".plot-wrap").getAttribute("data-family")) ?? "{}",
      ),
    )
    .toMatchObject({ to: Math.PI });
  await expect(members).toHaveCount(16);
  await page
    .getByLabel("Family presentation", { exact: true })
    .selectOption("selected");
  await expect(members).toHaveCount(1);
  await page.getByText("Finite engraving", { exact: true }).click();
  await expect(enabled).not.toBeChecked();
  await expect(members).toHaveCount(0);
  await page.getByText("Finite engraving", { exact: true }).click();
  await expect(enabled).toBeChecked();
  await expect(members).toHaveCount(1);
  await expect(to).toHaveValue("pi");
});

test("anchoring contour normals preserves checkbox clicks and scalar blur in WebKit", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await choosePreset(page, { label: "An engraving of standing waves" });
  const stable = page.getByRole("checkbox", {
    name: "Anchor contour normals",
    exact: true,
  });
  await expect(stable).toBeChecked();
  await page
    .getByRole("textbox", { name: "Shape parameter a", exact: true })
    .fill("pi/7");
  await page.getByText("Anchor contour normals", { exact: true }).click();
  await expect(stable).not.toBeChecked();
  await expect
    .poll(
      async () =>
        JSON.parse((await page.locator("#artwork desc").textContent())!).curve,
    )
    .toMatchObject({ a: Math.PI / 7, implicit: { stableNormals: false } });
  await expect(
    page.getByRole("textbox", { name: "Shape parameter a", exact: true }),
  ).toHaveValue("pi/7");
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(
    390,
  );
});

async function ready(page: Page) {
  await page.goto("/");
  await expect(page.locator("#artwork")).toBeVisible();
  await openExportSettings(page);
  expect(
    await page.evaluate(() => typeof VideoEncoder),
    "WebKit here has no WebCodecs video encoder",
  ).toBe("function");
}
// Resolves with the download, or fails at once with the page's own error.
async function save(page: Page) {
  await expect(exportMP4(page)).toBeEnabled();
  const download = page.waitForEvent("download", { timeout: 120000 });
  const alert = page
    .getByRole("alert")
    .waitFor({ timeout: 120000 })
    .then(async () => {
      throw new Error(await page.getByRole("alert").innerText());
    });
  alert.catch(() => {});
  await exportMP4(page).click();
  return (await Promise.race([download, alert])).path();
}

test("WebKit offers MP4 only, with 60 fps and no loop setting", async ({
  page,
}) => {
  await ready(page);
  await expect(exportMP4(page)).toBeEnabled();
  await expect(
    page.getByRole("combobox", { name: "Export format" }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("checkbox", { name: "Loop exported animation" }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("combobox", { name: "Export frame rate" }).locator("option"),
  ).toHaveText([
    "60 fps · smoothest motion",
    "30 fps · smoother motion",
    "15 fps · smaller file",
  ]);
});

// The reported Safari failure: WebKit rounds VideoFrame timestamps, first at
// 8.033 s of a 10 s export. The file must be complete with exact timing.
test("a 10 s parameter animation exports every frame with exact timing", async ({
  page,
}) => {
  test.setTimeout(180000);
  await ready(page);
  await choosePreset(page, "2");
  // A preset's animation setup lands when its study has computed, and would
  // undo an animation edited before then.
  await expect(page.locator(".plot-wrap")).toHaveAttribute(
    "aria-busy",
    "false",
  );
  await page
    .getByRole("combobox", { name: "Source coordinates" })
    .selectOption("polar");
  await page
    .getByRole("combobox", { name: "Animate", exact: true })
    .selectOption("parameters");
  await page
    .getByRole("combobox", { name: "Parameter 1", exact: true })
    .selectOption("sourceTheta");
  await page.getByRole("textbox", { name: "Track 1 from" }).fill("0");
  await page.getByRole("textbox", { name: "Track 1 to" }).fill("pi/4");
  // Timestamps do not depend on size; a small frame keeps the job quick.
  await page
    .getByRole("slider", { name: "Export resolution", exact: true })
    .fill("0.5");
  const path = (await save(page))!;
  const durations = exportTiming(10, 30).map((f) => f.duration);
  const probed = probe(path);
  if (probed) {
    expect(probed.codec).toBe("h264");
    // A macOS VM's encoder reports plain Baseline, hardware Constrained
    // Baseline. Neither allows B-frames, which is what the writer relies on.
    expect(probed.profile).toMatch(/^(Constrained )?Baseline$/);
    expect(probed.bFrames).toBe(0);
    expect([probed.width, probed.height]).toEqual([500, 380]);
    expect(probed.frames).toBe(300);
    expect(probed.durations).toEqual(durations);
  }
  // WebKit's own demuxer and decoder.
  const decoded = await decodeVideo(page, await readFile(path));
  expect(decoded.duration).toBeCloseTo(10, 3);
  expect(decoded.first.hash).not.toBe(decoded.last.hash);
});

test("a 60 fps MP4 decodes with exact timing", async ({ page }) => {
  await ready(page);
  await page
    .getByRole("combobox", { name: "Export frame rate" })
    .selectOption("60");
  await page
    .getByRole("slider", { name: "Export resolution", exact: true })
    .fill("0.5");
  await page.getByRole("spinbutton", { name: "Duration (seconds)" }).fill("1");
  const path = (await save(page))!;
  const probed = probe(path);
  if (probed) {
    expect(probed.frames).toBe(60);
    expect(probed.durations).toEqual(
      exportTiming(1, 60).map((f) => f.duration),
    );
  }
  const decoded = await decodeVideo(page, await readFile(path));
  expect(decoded.duration).toBeCloseTo(1, 3);
});

test("PNG export works in WebKit", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator("#artwork")).toBeVisible();
  const download = page.waitForEvent("download");
  await exportImage(page, "PNG");
  const bytes = await readFile((await (await download).path())!);
  expect(bytes.toString("ascii", 12, 16)).toBe("IHDR");
  expect([bytes.readUInt32BE(16), bytes.readUInt32BE(20)]).toEqual([
    2000, 1520,
  ]);
});

for (const [preset, name] of [
  ["3", "custom developable"],
  ["7", "tangent-foot projection"],
  ["8", "tangent-line orthotomic"],
  ["11", "sphere inversion of a projection"],
  ["12", "harmonic generator with vectors and ellipses"],
  ["17", "framed ribbon with an exposed seam"],
  ["18", "ruled harmonic loom"],
  ["23", "canal surface with a vanishing envelope"],
  ["25", "vector-field trajectories standing alone"],
  ["27", "spatial cyclic pursuit with connecting polygons"],
  ["32", "surface with its focal sheets"],
  ["35", "mirror with its caustic sheets"],
  ["40", "refracting dome with its receiver"],
  ["48", "level surface with its sections"],
])
  test(`spatial ${name} renders and exports through WebKit WebGL and H.264`, async ({
    page,
  }) => {
    await page.goto("/?study=3d");
    await choosePreset(page, preset);
    await expect(page.locator(".spatial-stage")).toHaveAttribute(
      "aria-busy",
      "false",
    );
    await expect(page.getByRole("alert")).toHaveCount(0);
    const image = page.waitForEvent("download");
    await exportImage(page, "PNG");
    const bytes = await readFile((await (await image).path())!);
    expect([bytes.readUInt32BE(16), bytes.readUInt32BE(20)]).toEqual([
      2000, 1520,
    ]);
    await open(page, "#spatial-animation-section");
    await page.getByLabel("Duration (seconds)").fill("0.4");
    await open(page, "#spatial-export-settings");
    await page.getByLabel("Export frame rate").selectOption("15");
    await page
      .getByRole("slider", { name: "Export resolution", exact: true })
      .fill("0.5");
    const path = (await save(page))!;
    const data = probe(path);
    if (data) {
      expect(data.frames).toBe(6);
      expect(data.durations.reduce((a, b) => a + b, 0)).toBe(400);
    }
    const video = await decodeVideo(page, await readFile(path));
    expect(video.duration).toBeCloseTo(0.4, 3);
    expect(video.first.hash).not.toBe(video.last.hash);
  });

test("the cut plane draws, exports and peels through WebKit WebGL and H.264", async ({
  page,
}) => {
  await page.goto("/?study=3d");
  await choosePreset(page, { label: "An ellipsoid hiding its centers" });
  const stage = page.locator(".spatial-stage");
  await expect(stage).toHaveAttribute("aria-busy", "false");
  await expect(page.getByRole("alert")).toHaveCount(0);
  const png = async () => {
    const image = page.waitForEvent("download");
    await exportImage(page, "PNG");
    return readFile((await (await image).path())!);
  };
  const cut = await png();
  expect([cut.readUInt32BE(16), cut.readUInt32BE(20)]).toEqual([2000, 1520]);
  const enable = page.getByRole("checkbox", { name: "Cut with a plane" });
  await enable.uncheck();
  const whole = await png();
  expect(whole.equals(cut)).toBe(false);
  await enable.check();
  expect((await png()).equals(cut)).toBe(true);
  // A peel exported as H.264 runs from the whole shell to none of it.
  await open(page, "#spatial-animation-section");
  await page.getByLabel("Animate", { exact: true }).selectOption("cut");
  await page.getByLabel("Duration (seconds)").fill("0.4");
  await open(page, "#spatial-export-settings");
  await page.getByLabel("Export frame rate").selectOption("15");
  await page
    .getByRole("slider", { name: "Export resolution", exact: true })
    .fill("0.5");
  const path = (await save(page))!;
  const data = probe(path);
  if (data) {
    expect(data.frames).toBe(6);
    expect(data.durations.reduce((a, b) => a + b, 0)).toBe(400);
  }
  const video = await decodeVideo(page, await readFile(path));
  expect(video.duration).toBeCloseTo(0.4, 3);
  expect(video.first.hash).not.toBe(video.last.hash);
});

test("see-through sheets and dashed hidden lines draw and export through WebKit WebGL and H.264", async ({
  page,
}) => {
  await page.goto("/?study=3d");
  await choosePreset(page, { label: "A Klein bottle passing through itself" });
  const stage = page.locator(".spatial-stage");
  await expect(stage).toHaveAttribute("aria-busy", "false");
  await expect(page.getByRole("alert")).toHaveCount(0);
  // WebKit renders to half-float targets, so the sheets are seen through,
  // not drawn opaque in their place.
  await expect(page.locator("#spatial-artwork")).toHaveAttribute(
    "data-sight",
    JSON.stringify({ sheets: "through", opacity: 0.3, hidden: "dashed" }),
  );
  const box = page.getByRole("group", { name: "See through" });
  await expect(box.getByText(/cannot draw see-through/)).toHaveCount(0);
  const png = async () => {
    const image = page.waitForEvent("download");
    await exportImage(page, "PNG");
    return readFile((await (await image).path())!);
  };
  const seen = await png();
  expect([seen.readUInt32BE(16), seen.readUInt32BE(20)]).toEqual([2000, 1520]);
  const sheets = box.getByLabel("Sheets", { exact: true });
  await sheets.selectOption("opaque");
  const opaque = await png();
  expect(opaque.equals(seen)).toBe(false);
  await sheets.selectOption("through");
  expect((await png()).equals(seen)).toBe(true);
  await open(page, "#spatial-animation-section");
  await page.getByLabel("Animate", { exact: true }).selectOption("reveal");
  await page.getByLabel("Duration (seconds)").fill("0.4");
  await open(page, "#spatial-export-settings");
  await page.getByLabel("Export frame rate").selectOption("15");
  await page
    .getByRole("slider", { name: "Export resolution", exact: true })
    .fill("0.5");
  const path = (await save(page))!;
  const data = probe(path);
  if (data) expect(data.frames).toBe(6);
  const video = await decodeVideo(page, await readFile(path));
  expect(video.duration).toBeCloseTo(0.4, 3);
  expect(video.first.hash).not.toBe(video.last.hash);
});

test("riding a ray draws in perspective and exports through WebKit WebGL and H.264", async ({
  page,
}) => {
  await page.goto("/?study=3d");
  await choosePreset(page, { label: "Riding a ray through coma" });
  const stage = page.locator(".spatial-stage");
  await expect(stage).toHaveAttribute("aria-busy", "false");
  await expect(page.getByRole("alert")).toHaveCount(0);
  await open(page, "#spatial-animation-section");
  await expect(
    page.getByLabel("Animation camera", { exact: true }),
  ).toHaveValue("ride");
  await page.getByRole("button", { name: "Play animation" }).click();
  await page.getByRole("button", { name: "Pause", exact: true }).click();
  await page.getByRole("slider", { name: "Animation progress" }).fill("0.1");
  await expect(stage).toHaveAttribute("data-progress", "0.1");
  const view = JSON.parse(
    (await page.locator("#spatial-artwork").getAttribute("data-view"))!,
  );
  expect(view.lens.projection).toBe("perspective");
  // The shaded still has ink wherever the line drawing's visible mirror
  // curves are: WebKit's vertex shader projects as scene.ts does.
  const svgFile = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export image", exact: true }).click();
  await page
    .getByRole("menuitem", { name: "Lines (SVG) · visible only, sampled" })
    .click();
  const svg = (await readFile((await (await svgFile).path())!)).toString();
  const group = svg.match(/<g id="curves"[^>]*>(.*?)<\/g>/)![1];
  const points: [number, number][] = [];
  for (const d of group.matchAll(/ d="([^"]*)"/g))
    for (const line of d[1].split(/(?=M)/).filter(Boolean)) {
      const v = [...line.matchAll(/[ML](-?[\d.]+) (-?[\d.]+)/g)].map(
        (m) => [+m[1], +m[2]] as const,
      );
      for (let k = 1; k < v.length; k++) {
        const [a, b] = [v[k - 1], v[k]];
        const n = Math.floor(Math.hypot(b[0] - a[0], b[1] - a[1]) / 4);
        for (let m = 0; m < n; m++) {
          const x = a[0] + ((b[0] - a[0]) * m) / n,
            y = a[1] + ((b[1] - a[1]) * m) / n;
          if (x > 4 && x < 1996 && y > 4 && y < 1516) points.push([x, y]);
        }
      }
    }
  expect(points.length).toBeGreaterThan(200);
  const image = page.waitForEvent("download");
  await exportImage(page, "PNG");
  const png = await readFile((await (await image).path())!);
  expect([png.readUInt32BE(16), png.readUInt32BE(20)]).toEqual([2000, 1520]);
  const agreement = await page.evaluate(
    async ([input, at]) => {
      const picture = new Image();
      picture.src = `data:image/png;base64,${input}`;
      await picture.decode();
      const c = document.createElement("canvas");
      c.width = picture.width;
      c.height = picture.height;
      const g = c.getContext("2d")!;
      g.drawImage(picture, 0, 0);
      const data = g.getImageData(0, 0, c.width, c.height).data;
      const inked = (x: number, y: number) => {
        for (let dy = -1; dy <= 1; dy++)
          for (let dx = -1; dx <= 1; dx++) {
            const i = 4 * ((Math.round(y) + dy) * c.width + Math.round(x) + dx);
            if (
              Math.abs(data[i] - data[0]) +
                Math.abs(data[i + 1] - data[1]) +
                Math.abs(data[i + 2] - data[2]) >
              30
            )
              return true;
          }
        return false;
      };
      return at.filter(([x, y]) => inked(x, y)).length / at.length;
    },
    [png.toString("base64"), points] as const,
  );
  expect(agreement).toBeGreaterThan(0.9);
  await page.getByRole("button", { name: "Stop", exact: true }).click();
  await page.getByLabel("Duration (seconds)").fill("0.4");
  await open(page, "#spatial-export-settings");
  await page.getByLabel("Export frame rate").selectOption("15");
  await page
    .getByRole("slider", { name: "Export resolution", exact: true })
    .fill("0.5");
  const path = (await save(page))!;
  const data = probe(path);
  if (data) expect(data.frames).toBe(6);
  const video = await decodeVideo(page, await readFile(path));
  expect(video.duration).toBeCloseTo(0.4, 3);
  expect(video.first.hash).not.toBe(video.last.hash);
});

test("the manual camera draws through a perspective lens in WebKit WebGL", async ({
  page,
}) => {
  await page.goto("/?study=3d");
  await choosePreset(page, { label: "A spiral stair, down its well" });
  const stage = page.locator(".spatial-stage");
  await expect(stage).toHaveAttribute("aria-busy", "false");
  await expect(page.getByRole("alert")).toHaveCount(0);
  await expect(page.getByLabel("Projection", { exact: true })).toHaveValue(
    "wide",
  );
  await expect(stage.locator(".plot-meta > span")).toHaveText(
    /^Drag to orbit · /,
  );
  // The shaded still has ink wherever the line drawing's visible curve and
  // rulings are: WebKit's vertex shader projects through the manual lens as
  // scene.ts does.
  const svgFile = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export image", exact: true }).click();
  await page
    .getByRole("menuitem", { name: "Lines (SVG) · visible only, sampled" })
    .click();
  const svg = (await readFile((await (await svgFile).path())!)).toString();
  expect(svg).toContain('"projection":"wide"');
  const points: [number, number][] = [];
  for (const layer of ["base", "rulings"]) {
    const group = svg.match(new RegExp(`<g id="${layer}"[^>]*>(.*?)</g>`))![1];
    for (const d of group.matchAll(/ d="([^"]*)"/g))
      for (const line of d[1].split(/(?=M)/).filter(Boolean)) {
        const v = [...line.matchAll(/[ML](-?[\d.]+) (-?[\d.]+)/g)].map(
          (m) => [+m[1], +m[2]] as const,
        );
        for (let k = 1; k < v.length; k++) {
          const [a, b] = [v[k - 1], v[k]];
          const n = Math.floor(Math.hypot(b[0] - a[0], b[1] - a[1]) / 4);
          for (let m = 0; m < n; m++) {
            const x = a[0] + ((b[0] - a[0]) * m) / n,
              y = a[1] + ((b[1] - a[1]) * m) / n;
            if (x > 4 && x < 1996 && y > 4 && y < 1516) points.push([x, y]);
          }
        }
      }
  }
  expect(points.length).toBeGreaterThan(200);
  const image = page.waitForEvent("download");
  await exportImage(page, "PNG");
  const png = await readFile((await (await image).path())!);
  const agreement = await page.evaluate(
    async ([input, at]) => {
      const picture = new Image();
      picture.src = `data:image/png;base64,${input}`;
      await picture.decode();
      const c = document.createElement("canvas");
      c.width = picture.width;
      c.height = picture.height;
      const g = c.getContext("2d")!;
      g.drawImage(picture, 0, 0);
      const data = g.getImageData(0, 0, c.width, c.height).data;
      const inked = (x: number, y: number) => {
        for (let dy = -1; dy <= 1; dy++)
          for (let dx = -1; dx <= 1; dx++) {
            const i = 4 * ((Math.round(y) + dy) * c.width + Math.round(x) + dx);
            if (
              Math.abs(data[i] - data[0]) +
                Math.abs(data[i + 1] - data[1]) +
                Math.abs(data[i + 2] - data[2]) >
              30
            )
              return true;
          }
        return false;
      };
      return at.filter(([x, y]) => inked(x, y)).length / at.length;
    },
    [png.toString("base64"), points] as const,
  );
  expect(agreement).toBeGreaterThan(0.9);
});

// Strokes need instanced drawing, which WebKit's WebGL offers: a bold
// curve is drawn its weight wide, a share of the page, in a still.
test("line weights draw strokes in WebKit WebGL", async ({ page }) => {
  await page.goto("/?study=3d");
  await choosePreset(page, { label: "An engraved trefoil tube" });
  const art = page.locator("#spatial-artwork");
  await expect(art).toHaveAttribute("data-strokes", '{"weight":"bold"}');
  const study = {
    config: {
      ...structuredClone(spatialPresets[0].config),
      format: "parametric",
      curve: {
        x: "2*cos(t)",
        y: "2*sin(t)",
        z: "0",
        a: 1,
        min: 0,
        max: 2 * Math.PI,
      },
    },
    layers: Object.fromEntries(
      Object.keys(defaultLayers).map((k) => [k, false]),
    ),
    view: { yaw: 0, pitch: 0, zoom: 1, panX: 0, panY: 0 },
    animation: { mode: "reveal", camera: "hold", duration: 10, tracks: [] },
    sight: { ...defaultSight, weight: "bold" },
  };
  await page.goto(
    `/?study=3d#s=${deflateRawSync(
      Buffer.from(JSON.stringify({ v: 1, notebook: "3d", study })),
    ).toString("base64url")}`,
  );
  await expect(page.locator(".spatial-stage")).toHaveAttribute(
    "aria-busy",
    "false",
  );
  await expect(art).toHaveAttribute("data-strokes", '{"weight":"bold"}');
  const image = page.waitForEvent("download");
  await exportImage(page, "PNG");
  const png = await readFile((await (await image).path())!);
  const ground = palette.background[0].map((v) => v * 255),
    ink = lineColor(2, 0, false).map((v) => v * 255);
  const width = await page.evaluate(
    async ([input, ink, ground]) => {
      const picture = new Image();
      picture.src = `data:image/png;base64,${input}`;
      await picture.decode();
      const c = document.createElement("canvas");
      c.width = picture.width;
      c.height = picture.height;
      const g = c.getContext("2d")!;
      g.drawImage(picture, 0, 0);
      // The circle's leftmost point is on the middle row, its tangent
      // vertical: each pixel's share of the way to the curve's color.
      const row = g.getImageData(0, c.height >> 1, c.width >> 1, 1).data;
      const d = [0, 1, 2].map((k) => ink[k] - ground[k]);
      const dd = d.reduce((s, v) => s + v * v, 0);
      let sum = 0;
      for (let i = 0; i < row.length; i += 4) {
        let dot = 0;
        for (let k = 0; k < 3; k++) dot += (row[i + k] - ground[k]) * d[k];
        sum += Math.max(0, Math.min(1, dot / dd));
      }
      return sum;
    },
    [png.toString("base64"), ink, ground] as const,
  );
  const want = strokeWidth({ ink: 2 }, "bold", { width: 2000, height: 1520 })!;
  console.log("WebKit bold stroke", { want, width });
  expect(Math.abs(width - want)).toBeLessThan(0.15 * want);
});

// An iterated map's density is a PNG embedded in the SVG; drawing that SVG
// to a canvas must keep it and must not taint the canvas.
test("PNG export keeps an iterated map's embedded density in WebKit", async ({
  page,
}) => {
  await page.goto("/");
  await expect(page.locator("#artwork")).toBeVisible();
  await choosePreset(page, { label: "Clifford attractor" });
  await expect(page.getByTestId("attractor-density")).toHaveCount(1);
  await expect(page.locator(".plot-wrap")).toHaveAttribute(
    "aria-busy",
    "false",
  );
  const download = page.waitForEvent("download");
  await exportImage(page, "PNG");
  const bytes = await readFile((await (await download).path())!);
  const shaded = await page.evaluate(async (png) => {
    const bitmap = await createImageBitmap(
      new Blob([new Uint8Array(png)], { type: "image/png" }),
    );
    const canvas = document.createElement("canvas");
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    const ctx = canvas.getContext("2d")!;
    ctx.drawImage(bitmap, 0, 0);
    const data = ctx.getImageData(0, 0, bitmap.width, bitmap.height).data;
    let n = 0;
    for (let i = 0; i < data.length; i += 4)
      if (data[i] !== data[0] || data[i + 1] !== data[1]) n++;
    return n / (data.length / 4);
  }, Array.from(bytes));
  expect(shaded).toBeGreaterThan(0.1);
});

for (const name of ["A sphere in passing", "A ring in passing"])
  test(`curved 4D ${name} renders and exports through WebKit`, async ({
    page,
  }) => {
    await page.goto("/?study=4d");
    await choosePreset(page, { label: name });
    await expect(page.locator(".tesseract-stage")).toHaveAttribute(
      "aria-busy",
      "false",
    );
    await expect(page.getByRole("alert")).toHaveCount(0);
    const image = page.waitForEvent("download");
    await exportImage(page, "PNG");
    const bytes = await readFile((await (await image).path())!);
    expect([bytes.readUInt32BE(16), bytes.readUInt32BE(20)]).toEqual([
      2000, 1520,
    ]);
    await page.getByLabel("Duration (seconds)").fill(".4");
    await open(page, "#shape-export-settings");
    await page.getByLabel("Export frame rate").selectOption("15");
    await page
      .getByRole("slider", { name: "Export resolution", exact: true })
      .fill("0.5");
    const path = (await save(page))!;
    const data = probe(path);
    if (data) {
      expect(data.frames).toBe(6);
      expect(data.durations.reduce((a, b) => a + b, 0)).toBe(400);
    }
    const video = await decodeVideo(page, await readFile(path));
    expect(video.duration).toBeCloseTo(0.4, 3);
    const coverage = frameCoverage(path, 500, 380);
    if (coverage) {
      console.log("WebKit curved decoded coverage", coverage);
      expect(coverage[0]).toBeLessThan(0.001);
      expect(coverage.at(-1)!).toBeLessThan(0.001);
      expect(coverage[2]).toBeGreaterThan(0.005);
    }
  });

for (const mode of ["reference", "lifted"])
  test(`localized lift ${mode} renders and exports through WebKit`, async ({
    page,
  }) => {
    await page.goto("/?study=4d");
    await choosePreset(page, { label: "The missing middle" });
    const settle = () =>
      expect(page.locator(".tesseract-stage")).toHaveAttribute(
        "aria-busy",
        "false",
      );
    await settle();
    await page
      .getByRole("combobox", { name: "View operation", exact: true })
      .selectOption(mode);
    await settle();
    await expect(page.getByRole("alert")).toHaveCount(0);
    await expect(page.locator("#tesseract-artwork text")).toHaveCount(0);
    await page
      .getByRole("checkbox", { name: "Missing-region guide", exact: true })
      .check();
    if (mode === "lifted")
      await page
        .getByRole("checkbox", { name: "Displacement connectors", exact: true })
        .check();
    const image = page.waitForEvent("download");
    await exportImage(page, "PNG");
    const bytes = await readFile((await (await image).path())!);
    expect([bytes.readUInt32BE(16), bytes.readUInt32BE(20)]).toEqual([
      2000, 1520,
    ]);
    await page.getByLabel("Duration (seconds)").fill(".4");
    await open(page, "#shape-export-settings");
    await page.getByLabel("Export frame rate").selectOption("15");
    await page
      .getByRole("slider", { name: "Export resolution", exact: true })
      .fill("0.5");
    const path = (await save(page))!,
      data = probe(path);
    if (data) {
      expect(data.frames).toBe(6);
      expect(data.durations.reduce((a, b) => a + b, 0)).toBe(400);
    }
    const video = await decodeVideo(page, await readFile(path));
    expect(video.duration).toBeCloseTo(0.4, 3);
    expect(video.first.hash).not.toBe(video.last.hash);
  });

for (const name of ["Rings from a sphere", "Tori between two circles"])
  test(`spherical weave ${name} renders and exports through WebKit`, async ({
    page,
  }) => {
    await page.goto("/?study=4d");
    await choosePreset(page, { label: name });
    const settle = () =>
      expect(page.locator(".tesseract-stage")).toHaveAttribute(
        "aria-busy",
        "false",
      );
    await settle();
    await expect(page.getByRole("alert")).toHaveCount(0);
    await expect(page.locator("#tesseract-artwork text")).toHaveCount(0);
    await expect(
      page.locator('#tesseract-artwork path[data-role="window"]'),
    ).toHaveCount(3);
    const image = page.waitForEvent("download");
    await exportImage(page, "PNG");
    const bytes = await readFile((await (await image).path())!);
    expect([bytes.readUInt32BE(16), bytes.readUInt32BE(20)]).toEqual([
      2000, 1520,
    ]);
    // A full rotation returns to its start; the latitude sweep does not.
    await page
      .getByRole("combobox", { name: "Animate", exact: true })
      .selectOption("latitude");
    await page.getByLabel("Duration (seconds)").fill(".4");
    await open(page, "#shape-export-settings");
    await page.getByLabel("Export frame rate").selectOption("15");
    await page
      .getByRole("slider", { name: "Export resolution", exact: true })
      .fill("0.5");
    const path = (await save(page))!,
      data = probe(path);
    if (data) {
      expect(data.frames).toBe(6);
      expect(data.durations.reduce((a, b) => a + b, 0)).toBe(400);
    }
    const video = await decodeVideo(page, await readFile(path));
    expect(video.duration).toBeCloseTo(0.4, 3);
    expect(video.first.hash).not.toBe(video.last.hash);
  });

for (const mode of ["shadow", "diagram"])
  test(`shell bypass ${mode} renders and exports through WebKit`, async ({
    page,
  }) => {
    await page.goto("/?study=4d");
    await choosePreset(page, { label: "Beside the wall" });
    const settle = () =>
      expect(page.locator(".tesseract-stage")).toHaveAttribute(
        "aria-busy",
        "false",
      );
    await settle();
    await page
      .getByRole("combobox", { name: "View operation", exact: true })
      .selectOption(mode);
    await settle();
    await expect(page.getByRole("alert")).toHaveCount(0);
    await expect(page.locator("#tesseract-artwork text")).toHaveCount(0);
    await page
      .getByRole("checkbox", { name: "Comparison points", exact: true })
      .check();
    const image = page.waitForEvent("download");
    await exportImage(page, "PNG");
    const bytes = await readFile((await (await image).path())!);
    expect([bytes.readUInt32BE(16), bytes.readUInt32BE(20)]).toEqual([
      2000, 1520,
    ]);
    await page.getByLabel("Duration (seconds)").fill(".4");
    await open(page, "#shape-export-settings");
    await page.getByLabel("Export frame rate").selectOption("15");
    await page
      .getByRole("slider", { name: "Export resolution", exact: true })
      .fill("0.5");
    const path = (await save(page))!,
      data = probe(path);
    if (data) {
      expect(data.frames).toBe(6);
      expect(data.durations.reduce((a, b) => a + b, 0)).toBe(400);
    }
    const video = await decodeVideo(page, await readFile(path));
    expect(video.duration).toBeCloseTo(0.4, 3);
    expect(video.first.hash).not.toBe(video.last.hash);
  });

for (const width of [1440, 390])
  test(`paired bypass ${width}px exports synchronized geometry through WebKit`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 1000 });
    await page.goto("/?study=4d");
    await choosePreset(page, { label: "Beside the wall" });
    const settle = () =>
      expect(page.locator(".tesseract-stage")).toHaveAttribute(
        "aria-busy",
        "false",
      );
    await settle();
    await page
      .getByRole("combobox", { name: "View operation", exact: true })
      .selectOption("paired");
    await settle();
    await expect(
      page.locator("#tesseract-artwork svg[data-representation]"),
    ).toHaveCount(2);
    await expect(page.locator("#tesseract-artwork text")).toHaveCount(0);
    await page
      .getByRole("spinbutton", { name: "Duration (seconds)" })
      .fill(".4");
    await open(page, "#shape-export-settings");
    await page.getByLabel("Export frame rate").selectOption("15");
    await page
      .getByRole("slider", { name: "Export resolution", exact: true })
      .fill("0.5");
    const path = (await save(page))!,
      data = probe(path);
    if (data) {
      expect([data.width, data.height, data.frames]).toEqual(
        width > 700 ? [1000, 380, 6] : [500, 760, 6],
      );
      expect(data.durations.reduce((a, b) => a + b, 0)).toBe(400);
    }
    const video = await decodeVideo(page, await readFile(path));
    expect(video.duration).toBeCloseTo(0.4, 3);
    expect(video.first.hash).not.toBe(video.last.hash);
  });

test("WebKit opens a study link made elsewhere and copies its own", async ({
  page,
}) => {
  // Encoded by Node's zlib, as another browser's deflate-raw stream would be.
  const { deflateRawSync } = await import("node:zlib");
  const { presets } = await import("../web/presets");
  const config = structuredClone(presets[1].config);
  config.curve.a = 1.25;
  const token = deflateRawSync(
    Buffer.from(
      JSON.stringify({
        v: 1,
        notebook: "2d",
        study: { config, bounds: { min: "0", max: "2*pi" } },
      }),
    ),
  ).toString("base64url");
  await page.goto(`/#s=${token}`);
  await expect(page.locator(".plot-wrap")).toHaveAttribute(
    "aria-busy",
    "false",
  );
  await expect(page.getByRole("alert")).toHaveCount(0);
  const shown = JSON.parse(
    (await page.locator("#artwork desc").textContent())!,
  );
  expect(shown.curve.a).toBe(1.25);
  expect(new URL(page.url()).hash).toBe("");
  // Its own encoder round-trips through its decoder.
  const reopened = await page.evaluate(async () => {
    const stream = new Blob([new TextEncoder().encode('{"v":1}')])
      .stream()
      .pipeThrough(new CompressionStream("deflate-raw"))
      .pipeThrough(new DecompressionStream("deflate-raw"));
    return new Response(stream).text();
  });
  expect(reopened).toBe('{"v":1}');
});

// iOS WebKit ignores padding and height on a select drawn natively, so it
// shrank to about 21 px and clipped its text until tapped. Every select, in
// every notebook, must keep the fields' 36 px and padding on a phone.
// This file already runs in WebKit, so only the phone's viewport, scale,
// touch and mobile layout are taken from the device.
const { defaultBrowserType: _, ...iPhone } = devices["iPhone 16 Pro Max"];
test.describe("on an iPhone", () => {
  test.use(iPhone);
  for (const [study, setup] of [
    ["2d", async () => {}],
    [
      "3d",
      async (page: Page) =>
        page.getByRole("checkbox", { name: "Cut with a plane" }).check(),
    ],
    ["4d", async () => {}],
  ] as const)
    test(`every ${study} select keeps the fields' height`, async ({ page }) => {
      await page.goto(`/?study=${study}`);
      await expect(page.locator("select:visible").first()).toBeVisible();
      await setup(page);
      const selects = await page
        .locator(".app:visible select")
        .evaluateAll((els) =>
          els
            .filter((e) => (e as HTMLElement).offsetParent !== null)
            .map((e) => {
              const s = getComputedStyle(e);
              return {
                name: e.getAttribute("aria-label") ?? e.id ?? "",
                height: Math.round(e.getBoundingClientRect().height),
                padding: s.paddingTop,
              };
            }),
        );
      expect(selects.length).toBeGreaterThan(1);
      for (const s of selects) {
        expect(s.height, s.name).toBeGreaterThanOrEqual(36);
        expect(s.padding, s.name).toBe("7px");
      }
    });
});

// Safari does not focus a button it clicks, so pressing the palette button
// while its menu is open blurs the focused item to nothing first.
test("the palette button closes its open menu in WebKit", async ({ page }) => {
  await page.goto("/");
  const button = page.getByRole("button", {
    name: "Color scheme",
    exact: true,
  });
  const menu = page.getByRole("menu", { name: "Color scheme", exact: true });
  await button.click();
  await expect(menu).toBeVisible();
  await expect(menu.getByRole("menuitemradio").first()).toBeFocused();
  await button.click();
  await expect(menu).toHaveCount(0);
  await expect(button).toHaveAttribute("aria-expanded", "false");
  // And opens it again on the next press.
  await button.click();
  await expect(menu).toBeVisible();
});

test("a receiver view inset draws and exports through WebKit", async ({
  page,
}) => {
  await page.goto("/?study=3d");
  await choosePreset(page, { label: "A glass dome's luminous ring, close up" });
  const stage = page.locator(".spatial-stage");
  await expect(stage).toHaveAttribute("aria-busy", "false");
  await expect(page.getByTestId("rays-note")).toContainText("inset");
  await expect(page.getByRole("alert")).toHaveCount(0);
  const download = page.waitForEvent("download");
  await exportImage(page, "PNG");
  const bytes = await readFile((await (await download).path())!);
  expect([bytes.readUInt32BE(16), bytes.readUInt32BE(20)]).toEqual([
    2000, 1520,
  ]);
  const option = page.getByRole("checkbox", {
    name: "Refine the receiver to the view",
    exact: true,
  });
  await option.uncheck();
  await expect(stage).toHaveAttribute("aria-busy", "false");
  await expect(page.getByTestId("rays-note")).not.toContainText("inset");
});

test("easing factor accepts edits and preserves them across checkbox click and blur in both notebooks", async ({
  page,
}) => {
  for (const [url, label] of [
    ["/", "Inside a star's point"],
    ["/?study=3d", "Viviani's curve, from every side"],
  ]) {
    await page.goto(url);
    await choosePreset(page, { label });
    const section = page.locator(
      url === "/" ? "#animation-section" : "#spatial-animation-section",
    );
    if ((await section.getAttribute("open")) === null)
      await section.locator(":scope > summary").click();
    const toggle = page.getByRole("checkbox", {
      name: "Ease key-view transitions",
      exact: true,
    });
    await toggle.check();
    const factor = page.getByRole("spinbutton", {
      name: "Easing factor",
      exact: true,
    });
    await factor.fill("0.75");
    await toggle.click();
    await expect(factor).toBeDisabled();
    await toggle.click();
    await expect(factor).toBeEnabled();
    await expect(factor).toHaveValue("0.75");
    await factor.focus();
    await factor.press("ArrowUp");
    await factor.press("Tab");
    await expect(factor).toHaveValue("0.8");
  }
});

// Safari's own masking and snapping of the gallery's journey row: only an
// end with more to scroll to fades, a scroll settles at a journey's start
// clear of the fade, and focus brings a journey fully past the fades.
for (const [width, height] of [
  [390, 844],
  [844, 390],
])
  test(`journey row fades, snaps and reveals focus in WebKit at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height });
    await page.goto("/");
    await page
      .getByRole("button", { name: "Browse notebook examples" })
      .click();
    const track = page
      .getByRole("dialog", { name: "Notebook examples" })
      .locator(".gallery-journey-list");
    const state = () =>
      track.evaluate((t) => ({
        start: t.hasAttribute("data-more-start"),
        end: t.hasAttribute("data-more-end"),
        mask:
          getComputedStyle(t).maskImage ||
          getComputedStyle(t).getPropertyValue("-webkit-mask-image"),
      }));
    expect(await state()).toMatchObject({ start: false, end: true });
    expect((await state()).mask).toContain("gradient");
    await track.evaluate((t) => {
      const b = t.children[1] as HTMLElement;
      t.scrollTo({ left: b.offsetLeft - t.offsetLeft + b.offsetWidth / 3 });
    });
    await expect
      .poll(() =>
        track.evaluate((t) => {
          const left = t.getBoundingClientRect().left;
          const max = t.scrollWidth - t.clientWidth;
          return (
            Math.abs(t.scrollLeft - max) < 1 ||
            [...t.children].some(
              (b) => Math.abs(b.getBoundingClientRect().left - left - 32) < 1.5,
            )
          );
        }),
      )
      .toBe(true);
    await expect.poll(async () => (await state()).start).toBe(true);
    await track.evaluate((t) => t.scrollTo({ left: 0 }));
    await expect.poll(async () => (await state()).start).toBe(false);
    const last = track.getByRole("button").last();
    await last.focus();
    await expect(last).toBeInViewport({ ratio: 1 });
    await expect.poll(async () => (await state()).end).toBe(false);
    const box = (await track.boundingBox())!;
    const ring = (await last.boundingBox())!;
    expect(ring.x - 5).toBeGreaterThanOrEqual(box.x + 32);
    expect(ring.x + ring.width + 5).toBeLessThanOrEqual(box.x + box.width);
  });

test("journey pointer and keyboard navigation restore focus without Safari rings", async ({
  page,
}) => {
  await page.goto("/");
  const browse = page.getByRole("button", { name: "Browse notebook examples" });
  await browse.click();
  const gallery = page.getByRole("dialog", { name: "Notebook examples" });
  await gallery
    .getByRole("button", { name: "Light finding a cusp", exact: true })
    .click();
  const journey = page.getByRole("dialog", {
    name: "Light finding a cusp",
    exact: true,
  });
  await expect(journey).toBeVisible();
  await expect(
    journey.getByRole("button", { name: "Return to my study" }),
  ).toBeFocused();
  await expect(journey).toHaveAttribute("data-quiet", "");
  await page.keyboard.press("Tab");
  await expect(journey).not.toHaveAttribute("data-quiet", "");
  await journey.getByRole("button", { name: "Next step", exact: true }).click();
  await expect(
    journey.getByRole("heading", {
      name: "Parallel light & a circle",
      exact: true,
    }),
  ).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(browse).toBeFocused();
  await expect(page.locator(".example-picker")).not.toHaveAttribute(
    "data-quiet",
    "",
  );
  await browse.press("Enter");
  const entry = gallery.getByRole("button", {
    name: "Light finding a cusp",
    exact: true,
  });
  await entry.focus();
  await entry.press("Enter");
  await expect(journey).toBeVisible();
  await expect(journey).not.toHaveAttribute("data-quiet", "");
  await journey.getByRole("button", { name: "Return to my study" }).click();
  await expect(browse).toBeFocused();
  await expect(page.locator(".example-picker")).toHaveAttribute(
    "data-quiet",
    "",
  );
  await page.getByRole("button", { name: "Color scheme", exact: true }).focus();
  await expect(page.locator(".example-picker")).not.toHaveAttribute(
    "data-quiet",
    "",
  );
});

test("journey navigation and playback keep the viewport and buttons steady in WebKit", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await page.getByRole("button", { name: "Browse notebook examples" }).click();
  await page
    .getByRole("dialog", { name: "Notebook examples" })
    .getByRole("button", { name: "Light finding a cusp", exact: true })
    .click();
  const journey = page.getByRole("dialog", {
    name: "Light finding a cusp",
    exact: true,
  });
  const ready = () =>
    expect(journey.locator(".journey-art")).toHaveAttribute(
      "aria-busy",
      "false",
    );
  await ready();
  const positions = () =>
    journey.evaluate((d) =>
      [".journey-art", ".journey-navigation"].map((selector) => {
        const r = d.querySelector(selector)!.getBoundingClientRect();
        return [r.x + d.scrollLeft, r.y + d.scrollTop, r.width, r.height];
      }),
    );
  const original = await positions();
  for (let i = 0; i < 2; i++) {
    await journey
      .getByRole("button", { name: "Next step", exact: true })
      .click();
    await ready();
    expect(await positions()).toEqual(original);
  }
  await journey
    .getByRole("button", { name: "Play animation", exact: true })
    .click();
  await expect(
    journey.getByRole("button", { name: "Pause", exact: true }),
  ).toBeVisible();
  expect(await positions()).toEqual(original);
  await journey.getByRole("button", { name: "Pause", exact: true }).click();
  expect(await positions()).toEqual(original);
  await page.keyboard.press("Escape");
  await expect(
    page.getByRole("button", { name: "Browse notebook examples" }),
  ).toBeFocused();
});

test("journey control keeps focus and its text while its drawing updates", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Browse notebook examples" }).click();
  await page
    .getByRole("dialog", { name: "Notebook examples" })
    .getByRole("button", { name: "Light finding a cusp", exact: true })
    .click();
  const journey = page.getByRole("dialog", {
    name: "Light finding a cusp",
    exact: true,
  });
  await expect(journey.locator(".journey-art")).toHaveAttribute(
    "aria-busy",
    "false",
  );
  const field = journey.getByRole("textbox", { name: "Source x", exact: true });
  await field.click();
  await field.press("Meta+a");
  await page.keyboard.type("1/2");
  await expect
    .poll(
      async () =>
        JSON.parse((await journey.locator("svg desc").textContent())!).source
          .position.x,
    )
    .toBe(0.5);
  await expect(field).toBeFocused();
  await expect(field).toHaveValue("1/2");
});

for (const source of ["3d", "4d"] as const)
  test(`journey cross-notebook controls and adoption preserve Safari focus from ${source}`, async ({
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(`/?study=${source}`);
    const browse = page.getByRole("button", {
      name: "Browse notebook examples",
    });
    await browse.click();
    const gallery = page.getByRole("dialog", { name: "Notebook examples" });
    await gallery
      .getByRole("button", { name: "Order inside apparent chaos", exact: true })
      .click();
    const mixed = page.getByRole("dialog", {
      name: "Order inside apparent chaos",
      exact: true,
    });
    for (let n = 0; n < 2; n++)
      await mixed
        .getByRole("button", { name: "Next step", exact: true })
        .click();
    await expect(mixed.locator(".journey-art")).toHaveAttribute(
      "aria-busy",
      "false",
    );
    await expect(
      mixed.getByRole("heading", { name: "Lorenz's two wings", exact: true }),
    ).toBeVisible();
    await mixed
      .getByRole("button", { name: "Return to my study", exact: true })
      .click();
    await expect(browse).toBeFocused();
    await expect(page.locator(".app:visible .example-picker")).toHaveAttribute(
      "data-quiet",
      "",
    );
    await browse.press("Enter");
    const entry = gallery.getByRole("button", {
      name: "A glimpse of four dimensions",
      exact: true,
    });
    await entry.focus();
    await entry.press("Enter");
    const dialog = page.getByRole("dialog", {
      name: "A glimpse of four dimensions",
      exact: true,
    });
    await expect(dialog.locator(".journey-art")).toHaveAttribute(
      "aria-busy",
      "false",
    );
    await expect(dialog).not.toHaveAttribute("data-quiet", "");
    const control = dialog.getByLabel("4D eye distance", { exact: true });
    await control.fill("2*pi");
    await expect(control).toBeFocused();
    await expect(dialog.locator(".journey-art")).toHaveAttribute(
      "aria-busy",
      "false",
    );
    await dialog
      .getByRole("button", { name: "Open study", exact: true })
      .click();
    await expect(dialog).toBeHidden();
    const target = page.locator(".app:visible");
    await expect(
      target.getByLabel("4D eye distance", { exact: true }),
    ).toHaveValue("2*pi");
    if (source === "3d") {
      await expect(
        target.getByRole("radio", { name: "4D studies", exact: true }),
      ).toBeFocused();
      await expect(target.locator(".notebook-mode")).toHaveAttribute(
        "data-quiet",
        "",
      );
    } else await expect(browse).toBeFocused();
  });

for (const width of [390, 1440])
  test(`atlas pointer blur and keyboard focus preserve the study at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: width === 390 ? 844 : 1000 });
    await page.goto("/");
    await choosePreset(page, { label: "Hypotrochoid & its evolute" });
    await expect(page.locator(".plot-wrap")).toHaveAttribute(
      "aria-busy",
      "false",
    );
    const entry = page.getByRole("button", {
      name: "Explore parameter atlas",
      exact: true,
    });
    await entry.click();
    const atlas = page.getByRole("dialog", {
      name: "A field of possible flowers",
      exact: true,
    });
    await expect(atlas).toBeVisible();
    await expect(atlas).toHaveAttribute("data-quiet", "");
    const first = atlas.getByRole("button", {
      name: "Inspect row 1, column 1",
      exact: true,
    });
    await first.click();
    await expect(
      atlas.getByRole("button", { name: "Adopt variant", exact: true }),
    ).toBeEnabled();
    await expect(
      atlas.getByRole("tab", { name: "Selected variant", exact: true }),
    ).toBeFocused();
    await atlas.getByRole("tab", { name: "Atlas grid", exact: true }).click();
    await expect(
      atlas.getByRole("tab", { name: "Atlas grid", exact: true }),
    ).toBeFocused();
    await first.focus();
    await page.keyboard.press("Enter");
    await expect(atlas).not.toHaveAttribute("data-quiet", "");
    await page.keyboard.press("Escape");
    await expect(atlas).toBeHidden();
    await expect(entry).toBeFocused();
    await expect(page.locator(".atlas-entry")).not.toHaveAttribute(
      "data-quiet",
      "",
    );
    await entry.click();
    await atlas.getByLabel("Rolling radius from", { exact: true }).fill("pi/2");
    await atlas
      .getByRole("button", { name: "Generate atlas", exact: true })
      .click();
    await expect(atlas.locator('.atlas-cell[data-state="valid"]')).toHaveCount(
      9,
    );
    await atlas
      .getByRole("button", { name: "Cancel atlas", exact: true })
      .click();
    await expect(entry).toBeFocused();
    await expect(page.locator(".atlas-entry")).toHaveAttribute(
      "data-quiet",
      "",
    );
    await expect(page.locator("#artwork")).toBeVisible();
  });

test("atlas portrait Generate clearance survives first open and landscape rotation", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await choosePreset(page, { label: "Hypotrochoid & its evolute" });
  await page
    .getByRole("button", { name: "Explore parameter atlas", exact: true })
    .click();
  const atlas = page.getByRole("dialog", {
    name: "A field of possible flowers",
    exact: true,
  });
  await expect(atlas).toBeVisible();
  const spacing = () =>
    atlas.evaluate((root) => {
      const inputs = [...root.querySelectorAll(".atlas-controls input")];
      const input = inputs.at(-1)!.getBoundingClientRect();
      const generate = [...root.querySelectorAll("button")]
        .find((b) => b.textContent?.trim() === "Generate atlas")!
        .getBoundingClientRect();
      return generate.top - input.bottom;
    });
  await expect.poll(spacing).toBeGreaterThanOrEqual(12);
  const first = await spacing();
  await page.setViewportSize({ width: 844, height: 390 });
  await expect.poll(spacing).toBeGreaterThanOrEqual(12);
  await page.setViewportSize({ width: 390, height: 844 });
  await expect.poll(spacing).toBe(first);
  await atlas
    .getByRole("button", { name: "Inspect row 1, column 1", exact: true })
    .click();
  const adopt = atlas.getByRole("button", {
    name: "Adopt variant",
    exact: true,
  });
  await expect(adopt).toBeEnabled();
  await expect(adopt).toBeInViewport({ ratio: 1 });
});

for (const width of [390, 1440])
  test(`atlas curated pair, size, framing and range controls preserve focus at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: width === 390 ? 844 : 1000 });
    await page.goto("/");
    await choosePreset(page, { label: "Ellipse & its pedal" });
    await expect(page.locator(".plot-wrap")).toHaveAttribute(
      "aria-busy",
      "false",
    );
    const entry = page.getByRole("button", {
      name: "Explore parameter atlas",
      exact: true,
    });
    await entry.click();
    const atlas = page.getByRole("dialog", {
      name: "A field of possible flowers",
      exact: true,
    });
    await atlas.getByLabel("Grid size", { exact: true }).selectOption("5");
    await atlas.getByLabel("Pole x from", { exact: true }).fill("-pi");
    await atlas.getByLabel("Pole x to", { exact: true }).fill("pi");
    await atlas.getByLabel("Pole y to", { exact: true }).fill("-2");
    await expect(
      atlas.getByLabel("Pole y to", { exact: true }),
    ).toHaveAttribute("aria-invalid", "true");
    await expect(
      atlas.getByRole("button", { name: "Generate atlas", exact: true }),
    ).toBeDisabled();
    await atlas.getByLabel("Pole y to", { exact: true }).fill("phi");
    await atlas
      .getByRole("button", { name: "Generate atlas", exact: true })
      .click();
    await expect(atlas.locator('.atlas-cell[data-state="valid"]')).toHaveCount(
      25,
    );
    await atlas.getByLabel("Framing", { exact: true }).selectOption("shared");
    await expect(
      atlas.getByText("Shared framing", { exact: true }),
    ).toBeVisible();
    const first = atlas.getByRole("button", {
      name: "Inspect row 1, column 1",
      exact: true,
    });
    await first.focus();
    await page.keyboard.press("ArrowRight");
    await expect(
      atlas.getByRole("button", {
        name: "Inspect row 1, column 2",
        exact: true,
      }),
    ).toBeFocused();
    await page.keyboard.press("ArrowDown");
    await expect(
      atlas.getByRole("button", {
        name: "Inspect row 2, column 2",
        exact: true,
      }),
    ).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(
      atlas.getByRole("button", { name: "Adopt variant", exact: true }),
    ).toBeEnabled();
    await expect(
      atlas.getByRole("tab", { name: "Selected variant", exact: true }),
    ).toBeFocused();
    await expect(atlas).not.toHaveAttribute("data-quiet", "");
    await atlas
      .getByRole("button", { name: "Cancel atlas", exact: true })
      .click();
    await expect(entry).toBeFocused();
    await expect(page.locator(".atlas-entry")).toHaveAttribute(
      "data-quiet",
      "",
    );
  });

for (const suppressMargins of [false, true])
  test(`atlas first range has independent portrait clearance before native UI relayout (margin suppression ${suppressMargins})`, async ({
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    if (suppressMargins)
      await page.addInitScript(() => {
        // Model the on-device first-paint loss of subgrid child margins.
        // Desktop WebKit alone cannot reproduce the native iPhone invalidation.
        const sheet = new CSSStyleSheet();
        sheet.replaceSync(
          ".atlas-controls > .pair > .field { margin-bottom: 0 }",
        );
        document.adoptedStyleSheets = [...document.adoptedStyleSheets, sheet];
      });
    await page.goto("/");
    await choosePreset(page, { label: "Clifford attractor" });
    await page
      .getByRole("button", { name: "Explore parameter atlas", exact: true })
      .click();
    const atlas = page.getByRole("dialog", {
      name: "A field of possible flowers",
      exact: true,
    });
    const spacing = () =>
      atlas.evaluate((root) => {
        const options = [
          ...root.querySelectorAll<HTMLSelectElement>(
            ".atlas-controls > .pair select",
          ),
        ];
        const first = [
          ...root.querySelectorAll(
            ".atlas-ranges > .pair:first-child .field-label",
          ),
        ];
        return (
          Math.min(...first.map((e) => e.getBoundingClientRect().top)) -
          Math.max(...options.map((e) => e.getBoundingClientRect().bottom))
        );
      });
    expect(
      await atlas.evaluate((root) => {
        const control = root
          .querySelector(".atlas-controls > .field:first-child select")!
          .getBoundingClientRect();
        const labels = [
          ...root.querySelectorAll(".atlas-controls > .pair .field-label"),
        ].map((e) => e.getBoundingClientRect().top);
        return Math.min(...labels) - control.bottom;
      }),
    ).toBe(16);
    await expect.poll(spacing).toBeGreaterThanOrEqual(12);
    const first = await spacing();
    await atlas.getByLabel("Grid size", { exact: true }).focus();
    await page.keyboard.press("Tab");
    expect(await spacing()).toBe(first);
    await page.setViewportSize({ width: 844, height: 390 });
    await expect.poll(spacing).toBeGreaterThanOrEqual(12);
    await page.setViewportSize({ width: 390, height: 844 });
    await expect.poll(spacing).toBe(first);
  });

// The engraving's range pair sits between ordinary fields: the gaps above and
// below it are the same as between any two of its fields, owned by those
// fields rather than by the pair's subgrid children.
for (const suppressMargins of [false, true])
  test(`finite engraving range pair has ordinary field gaps on first open (margin suppression ${suppressMargins})`, async ({
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    if (suppressMargins)
      await page.addInitScript(() => {
        // Model the on-device first-paint loss of subgrid child margins.
        const sheet = new CSSStyleSheet();
        sheet.replaceSync(".family-panel .pair > .field { margin: 0 }");
        document.adoptedStyleSheets = [...document.adoptedStyleSheets, sheet];
      });
    await page.goto("/");
    await choosePreset(page, { label: "A lamp's lace" });
    const panel = page.locator(".family-panel");
    await expect(panel.locator(".pair")).toBeVisible();
    const gaps = () =>
      panel.evaluate((root) => {
        const control = (label: string) =>
          root
            .querySelector(
              `[id="${
                [...root.querySelectorAll("label")].find(
                  (l) => l.textContent === label,
                )!.htmlFor
              }"]`,
            )!
            .getBoundingClientRect();
        const label = (text: string) =>
          [...root.querySelectorAll(".field-label")]
            .find((l) => l.querySelector("label")!.textContent === text)!
            .getBoundingClientRect();
        return {
          above: label("Family from").top - control("Family parameter").bottom,
          below: label("Family members").top - control("Family to").bottom,
          ordinary:
            label("Family presentation").top - control("Family members").bottom,
        };
      });
    const first = await gaps();
    expect(first.ordinary).toBeGreaterThan(10);
    expect(first.above).toBe(first.ordinary);
    expect(first.below).toBe(first.ordinary);
  });

test("finite engraving shares Safari playback, slider keys and selected construction clicks", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await choosePreset(page, { label: "A lamp's lace" });
  await expect(page.locator("#artwork [data-family-member]")).toHaveCount(16);
  await page.getByText("Incident rays", { exact: true }).click();
  await expect
    .poll(() => page.locator('#artwork [data-family-member="4"] line').count())
    .toBe(24);
  await openAnimation(page);
  await page
    .getByRole("button", { name: "Play animation", exact: true })
    .click();
  await page.getByRole("button", { name: "Pause", exact: true }).click();
  const slider = page.getByRole("slider", {
    name: "Animation progress",
    exact: true,
  });
  await slider.fill("0.45");
  await slider.press("ArrowRight");
  await expect(page.locator("#artwork [data-family-member]")).toHaveCount(16);
  await slider.press("Home");
  await expect(page.locator("#artwork [data-family-member]")).toHaveAttribute(
    "data-family-member",
    "0",
  );
  await page.getByRole("button", { name: "Stop", exact: true }).click();
  await expect(page.locator("#artwork [data-family-member]")).toHaveCount(16);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(
    390,
  );
});

test("finite engraving all-member construction label clicks work in WebKit", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await choosePreset(page, { label: "A lamp's lace" });
  await expect(page.locator("#artwork [data-family-member]")).toHaveCount(16);
  await page.getByText("Incident rays", { exact: true }).click();
  await page
    .getByText("Construction lines for all members", { exact: true })
    .click();
  await expect(
    page.getByRole("checkbox", {
      name: "Construction lines for all members",
      exact: true,
    }),
  ).toBeChecked();
  await expect
    .poll(() => page.locator('#artwork [data-family-member="0"] line').count())
    .toBe(24);
  await openAnimation(page);
  await page
    .getByRole("button", { name: "Play animation", exact: true })
    .click();
  await page.getByRole("button", { name: "Pause", exact: true }).click();
  await page
    .getByRole("slider", { name: "Animation progress", exact: true })
    .press("Home");
  await expect(page.locator("#artwork [data-family-member]")).toHaveAttribute(
    "data-family-member",
    "0",
  );
  await expect
    .poll(() => page.locator('#artwork [data-family-member="0"] line').count())
    .toBe(24);
});

// Safari does not focus a clicked button; the phase camera's buttons act on
// the click alone, and Show returns a paused phrase to the study.
test("phrase camera buttons set and show a key view in WebKit at phone width", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await choosePreset(page, { label: "A circle's caustic, opened" });
  await expect(page.locator(".plot-wrap")).toHaveAttribute(
    "aria-busy",
    "false",
  );
  await openAnimation(page);
  const hint = page.locator(".phrase-phases li").nth(4).locator(".hint");
  await expect(hint).toContainText("zoom 1.7×, centered at (-0.19, 0)");
  await page
    .getByRole("button", { name: "Play animation", exact: true })
    .click();
  await page.getByRole("button", { name: "Pause", exact: true }).click();
  await page
    .getByRole("button", {
      name: "Set phase 5 view to the drawing's view",
      exact: true,
    })
    .click();
  await expect(page.locator("#artwork")).not.toHaveAttribute(
    "data-animation-time",
  );
  await expect(hint).toContainText("zoom 1×");
  const fitted = await page.locator("#artwork path").first().getAttribute("d");
  await page
    .getByRole("combobox", { name: "Phase 5 camera", exact: true })
    .selectOption("view");
  await page.locator("#artwork").hover();
  await page.mouse.wheel(0, -300);
  await expect(page.locator("#artwork path").first()).not.toHaveAttribute(
    "d",
    fitted!,
  );
  await page
    .getByRole("button", { name: "Show phase 5 view", exact: true })
    .click();
  await expect(page.locator("#artwork path").first()).toHaveAttribute(
    "d",
    fitted!,
  );
});

test("phrase keys survive scalar blur, invalid drafts and seek in WebKit at phone width", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await choosePreset(page, { label: "A circle's caustic, opened" });
  await expect(page.locator(".plot-wrap")).toHaveAttribute(
    "aria-busy",
    "false",
  );
  await openAnimation(page);
  const key = page.getByRole("textbox", { name: "Phase 4 key", exact: true });
  await key.fill("pi/4");
  await page
    .getByRole("button", { name: "About animation modes", exact: true })
    .click();
  await expect(key).toHaveValue("pi/4");
  await page
    .getByRole("button", { name: "Play animation", exact: true })
    .click();
  await page.getByRole("button", { name: "Pause", exact: true }).click();
  await page
    .getByRole("slider", { name: "Animation progress", exact: true })
    .fill("0.5");
  await expect(page.locator("#artwork")).toHaveAttribute(
    "data-animation-time",
    "0.5",
  );
  const config = JSON.parse(
    (await page.locator("#artwork desc").textContent())!,
  );
  expect(config.source.position.x).toBe(Math.PI / 4);
  const caption = page.getByRole("group", {
    name: "Animation stage",
    exact: true,
  });
  await expect(caption).toContainText("Separate the cusps");
  const placement = page.getByRole("checkbox", {
    name: "Stage label in drawing",
    exact: true,
  });
  await placement.check();
  await page
    .getByRole("button", { name: "About stage label in drawing", exact: true })
    .click();
  await expect(page.locator("#artwork [data-phrase-caption]")).toContainText(
    "Separate the cusps",
  );
  await expect(page.locator("#artwork")).toHaveAttribute(
    "data-animation-time",
    "0.5",
  );
  await expect(
    page.getByRole("button", { name: "Resume", exact: true }),
  ).toBeVisible();
  await placement.uncheck();
  await page.setViewportSize({ width: 320, height: 667 });
  await page.locator(".plot-wrap").scrollIntoViewIfNeeded();
  const captionBox = (await caption.boundingBox())!;
  const dockBox = (await page.locator("#playback").boundingBox())!;
  expect(captionBox.y + captionBox.height).toBeLessThanOrEqual(dockBox.y);
  await expect(page.locator("#artwork text")).toHaveCount(0);
  // Rotating to landscape restores the same minimum as ordinary drawings.
  await page.setViewportSize({ width: 956, height: 440 });
  expect((await page.locator("#artwork").boundingBox())!.height).toBe(420);
  await placement.check();
  expect((await page.locator("#artwork").boundingBox())!.height).toBe(420);
  await key.fill("t");
  await page
    .getByRole("button", { name: "About animation modes", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Play animation", exact: true }),
  ).toBeDisabled();
  await expect(key).toHaveValue("t");
  await expect(key.locator("..").getByRole("alert")).toContainText(
    "Phase 4 key",
  );
  await expect(page.locator("#artwork")).not.toHaveAttribute(
    "data-animation-progress",
  );
});
