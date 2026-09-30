import { test, expect, type Browser, type Page } from "@playwright/test";
import { choosePreset, chooseNotebook, open, openAnimation } from "./helpers";
import { deflateRawSync } from "node:zlib";
import { presets } from "../web/presets";

// A study link is copied from an edited study and opened by someone else: a
// fresh browser context with no shared storage. Its study, layers, framing,
// and animation setup must match, and its drawing must be the same geometry.

const field = (page: Page, name: string) =>
  page.getByRole("textbox", { name, exact: true });
const copyButton = (page: Page) =>
  page.getByRole("button", { name: "Copy link", exact: true });

async function copyLink(page: Page) {
  await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);
  await copyButton(page).click();
  await expect(page.getByText("Link copied", { exact: true })).toBeVisible();
  const href = await page.evaluate(() => navigator.clipboard.readText());
  expect(href).toMatch(/#s=[A-Za-z0-9_-]+$/);
  return href;
}
async function recipient(browser: Browser, href: string) {
  const context = await browser.newContext({
    viewport: { width: 1440, height: 1000 },
  });
  const page = await context.newPage();
  await page.goto(href);
  return page;
}
// A link encoded independently, as a sender's browser would.
const linkTo = (notebook: string, study: unknown, v = 1) =>
  `/${notebook === "2d" ? "" : `?study=${notebook}`}#s=${deflateRawSync(
    Buffer.from(JSON.stringify({ v, notebook, study })),
  ).toString("base64url")}`;

// 2D ------------------------------------------------------------------------
const planarReady = (page: Page) =>
  expect(page.locator(".plot-wrap")).toHaveAttribute("aria-busy", "false");
const planarDefinition = async (page: Page) =>
  JSON.parse((await page.locator("#artwork desc").textContent())!);
const planarDrawing = (page: Page) =>
  page.locator("#artwork").evaluate((svg) => ({
    paths: [...svg.querySelectorAll("path")].map((p) => p.getAttribute("d")),
    scale: svg.getAttribute("data-camera-scale"),
    center: svg.getAttribute("data-camera-center"),
  }));

test("a 2D link reopens the edited study, bounds text, layers, framing, and animation", async ({
  page,
  browser,
}) => {
  await page.goto("/");
  await choosePreset(page, { label: "Hypotrochoid & its evolute" });
  await planarReady(page);
  await field(page, "Fixed radius R").fill("2*e");
  await field(page, "to").fill("4*pi");
  await page.getByRole("checkbox", { name: "Construction lines" }).uncheck();
  const art = page.locator("#artwork");
  const box = (await art.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(
    box.x + box.width / 2 + 60,
    box.y + box.height / 2 - 25,
    {
      steps: 4,
    },
  );
  await page.mouse.up();
  await page.mouse.wheel(0, -400);
  await openAnimation(page);
  await page
    .getByRole("combobox", { name: "Animate", exact: true })
    .selectOption("parameters");
  const parameter = page.getByRole("combobox", {
    name: "Parameter 1",
    exact: true,
  });
  await parameter.selectOption({ index: 1 });
  const target = await parameter.inputValue();
  await page.getByRole("textbox", { name: "Track 1 to" }).fill("pi/3");
  await page
    .getByRole("combobox", { name: "Animation camera" })
    .selectOption("fit");
  await page
    .getByRole("spinbutton", { name: "Duration (seconds)" })
    .fill("7.5");
  await planarReady(page);
  const definition = await planarDefinition(page);
  const drawing = await planarDrawing(page);
  expect(drawing.scale).not.toBe(null);

  const href = await copyLink(page);
  const other = await recipient(browser, href);
  await planarReady(other);
  expect(await planarDefinition(other)).toEqual(definition);
  expect(await planarDrawing(other)).toEqual(drawing);
  await expect(field(other, "to")).toHaveValue("4*pi");
  await expect(
    other.getByRole("checkbox", { name: "Construction lines" }),
  ).not.toBeChecked();
  await openAnimation(other);
  await expect(
    other.getByRole("combobox", { name: "Animate", exact: true }),
  ).toHaveValue("parameters");
  await expect(
    other.getByRole("combobox", { name: "Parameter 1", exact: true }),
  ).toHaveValue(target);
  await expect(other.getByRole("textbox", { name: "Track 1 to" })).toHaveValue(
    "pi/3",
  );
  await expect(
    other.getByRole("combobox", { name: "Animation camera" }),
  ).toHaveValue("fit");
  await expect(
    other.getByRole("spinbutton", { name: "Duration (seconds)" }),
  ).toHaveValue("7.5");
  // The fragment is consumed, so later edits never sit under the old link.
  expect(new URL(other.url()).hash).toBe("");
  await expect(other.getByRole("alert")).toHaveCount(0);

  // Fit view still returns to the fitted framing, not the linked one.
  await other.getByRole("button", { name: "↔ Fit view" }).click();
  expect((await planarDrawing(other)).scale).not.toBe(drawing.scale);
  // A preset replaces a linked study as usual.
  await choosePreset(other, 0);
  await planarReady(other);
  expect((await planarDefinition(other)).curve.format).toBe("parametric");
  await other.context().close();
});

test("damaged, newer, and invalid links leave the default study with a notice", async ({
  page,
}) => {
  await page.goto("/");
  await planarReady(page);
  const original = await planarDefinition(page);

  await page.goto("/#s=not!base64");
  await expect(page.getByRole("alert")).toContainText("damaged");
  await planarReady(page);
  expect(await planarDefinition(page)).toEqual(original);
  expect(new URL(page.url()).hash).toBe("");

  await page.goto(linkTo("2d", {}, 2));
  await expect(page.getByRole("alert")).toContainText("newer version");

  await page.goto(
    linkTo("2d", {
      config: { curve: { x: 7 } },
      bounds: { min: "0", max: "1" },
    }),
  );
  const alert = page.getByRole("alert");
  await expect(alert).toContainText("config.curve.x must be text");
  await planarReady(page);
  expect(await planarDefinition(page)).toEqual(original);
  await alert.getByRole("button", { name: "Dismiss" }).click();
  await expect(page.getByRole("alert")).toHaveCount(0);

  // A link for another notebook that fails opens that notebook's notice.
  await page.goto(linkTo("3d", { config: { format: "knot" } }));
  await expect(page.locator(".spatial-app")).toBeVisible();
  await expect(page.getByRole("alert")).toContainText("config.format");
});

test("a link pasted into an open page replaces the study and drops pending edits", async ({
  page,
}) => {
  // Hold Go's evaluation of one entry, so it is still pending when the link
  // arrives, and release it afterwards: its late result must be dropped.
  await page.addInitScript(() => {
    const post = Worker.prototype.postMessage;
    Worker.prototype.postMessage = function (this: Worker, message: any) {
      if (message?.expressions?.includes?.("pi*1.5"))
        (window as any).release = () => post.call(this, message);
      else post.call(this, message);
    } as typeof post;
  });
  await page.goto("/");
  await choosePreset(page, { label: "Hypotrochoid & its evolute" });
  await planarReady(page);
  await field(page, "Fixed radius R").fill("2.5");
  const box = (await page.locator("#artwork").boundingBox())!;
  await page.mouse.move(box.x + 300, box.y + 300);
  await page.mouse.wheel(0, -300);
  await planarReady(page);
  const href = await copyLink(page);
  const linked = await planarDefinition(page);
  const framing = await planarDrawing(page);
  await field(page, "Fixed radius R").fill("3.25");
  await page.mouse.wheel(0, 500);
  await planarReady(page);
  expect((await planarDrawing(page)).scale).not.toBe(framing.scale);
  // An entry is still being evaluated by Go when the link arrives.
  await field(page, "Fixed radius R").fill("pi*1.5");
  await page.evaluate((h) => {
    location.hash = new URL(h).hash;
  }, href);
  // The study is replaced at once; the field's entry is dropped when its
  // evaluation returns, as for an example chosen meanwhile.
  await expect
    .poll(async () => (await planarDefinition(page)).curve.roulette)
    .toEqual(linked.curve.roulette);
  await page.waitForFunction(
    () => typeof (window as any).release === "function",
  );
  await page.evaluate(() => (window as any).release());
  await page.waitForTimeout(300);
  await planarReady(page);
  await expect(field(page, "Fixed radius R")).toHaveValue("2.5");
  expect(await planarDefinition(page)).toEqual(linked);
  // The linked framing replaces the open page's.
  expect(await planarDrawing(page)).toEqual(framing);
  expect(new URL(page.url()).hash).toBe("");
});

test("a linked trace animation survives the recipient's default study", async ({
  page,
}) => {
  // The recipient starts on a study that cannot trace light, and the linked
  // setup must not be judged against it before the linked study is drawn.
  const index = presets.findIndex((p) => p.config.kind === "catacaustic");
  const config = structuredClone(presets[index].config);
  await page.goto(
    linkTo("2d", {
      config,
      bounds: { min: String(config.curve.min), max: String(config.curve.max) },
      animation: { mode: "trace", camera: "hold", duration: 5, tracks: [] },
    }),
  );
  await planarReady(page);
  await openAnimation(page);
  await expect(
    page.getByRole("combobox", { name: "Animate", exact: true }),
  ).toHaveValue("trace");
  expect((await planarDefinition(page)).kind).toBe("catacaustic");
});

test("copy is refused while the study has an error, and falls back when the clipboard is denied", async ({
  page,
}) => {
  await page.goto("/");
  await planarReady(page);
  await field(page, "to").fill("pi/");
  await expect(copyButton(page)).toBeDisabled();
  await field(page, "to").fill("pi");
  await planarReady(page);
  await expect(copyButton(page)).toBeEnabled();
  await page.evaluate(() => {
    navigator.clipboard.writeText = () =>
      Promise.reject(new DOMException("denied", "NotAllowedError"));
  });
  await copyButton(page).click();
  const manual = page.getByRole("textbox", { name: "Copy this link" });
  await expect(manual).toBeVisible();
  expect(await manual.inputValue()).toMatch(/#s=[A-Za-z0-9_-]+$/);
  await page.keyboard.press("Escape");
  await expect(manual).toHaveCount(0);
});

// 3D ------------------------------------------------------------------------
const spatialStage = (page: Page) => page.locator(".spatial-stage");
const spatialReady = (page: Page) =>
  expect(spatialStage(page)).toHaveAttribute("aria-busy", "false");
const spatialState = (page: Page) =>
  page.evaluate(() => ({
    config: JSON.parse(
      document.querySelector(".spatial-stage")!.getAttribute("data-config")!,
    ),
    view: JSON.parse(
      (document.querySelector("#spatial-artwork") as HTMLElement).dataset.view!,
    ),
  }));

test("a 3D link reopens the study, layers, camera, and animation", async ({
  page,
  browser,
}) => {
  await page.goto("/?study=3d");
  await spatialReady(page);
  await choosePreset(page, { label: "Cinquefoil · (2, 5)" });
  await spatialReady(page);
  await field(page, "Minor radius r").fill("pi/5");
  await spatialReady(page);
  const layerName = "Tangent rulings";
  await page.getByRole("checkbox", { name: layerName, exact: true }).uncheck();
  const canvas = page.locator("#spatial-artwork");
  const box = (await canvas.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(
    box.x + box.width / 2 + 80,
    box.y + box.height / 2 + 30,
    {
      steps: 4,
    },
  );
  await page.mouse.up();
  await page.mouse.wheel(0, -300);
  const panel = page.locator("#spatial-animation-section");
  if ((await panel.getAttribute("open")) === null)
    await panel.locator(":scope > summary").click();
  await page
    .getByRole("combobox", { name: "Animate", exact: true })
    .selectOption("orbit");
  await page.getByRole("spinbutton", { name: "Duration (seconds)" }).fill("6");
  await spatialReady(page);
  const state = await spatialState(page);
  expect(state.view.yaw).not.toBe(0.3);

  const href = await copyLink(page);
  expect(new URL(href).searchParams.get("study")).toBe("3d");
  const other = await recipient(browser, href);
  await spatialReady(other);
  await expect
    .poll(async () => (await spatialState(other)).view)
    .toEqual(state.view);
  expect((await spatialState(other)).config).toEqual(state.config);
  await expect(
    other.getByRole("checkbox", { name: layerName, exact: true }),
  ).not.toBeChecked();
  const otherPanel = other.locator("#spatial-animation-section");
  if ((await otherPanel.getAttribute("open")) === null)
    await otherPanel.locator(":scope > summary").click();
  await expect(
    other.getByRole("combobox", { name: "Animate", exact: true }),
  ).toHaveValue("orbit");
  await expect(
    other.getByRole("spinbutton", { name: "Duration (seconds)" }),
  ).toHaveValue("6");
  // Reset view returns to the notebook's default camera.
  await other.getByRole("button", { name: "Reset view" }).click();
  await expect.poll(async () => (await spatialState(other)).view.yaw).toBe(0.3);
  await other.context().close();
});

// 4D ------------------------------------------------------------------------
const tesseractReady = (page: Page) =>
  expect(page.locator(".tesseract-stage")).toHaveAttribute(
    "aria-busy",
    "false",
  );
const tesseractState = (page: Page) =>
  page.evaluate(() => ({
    config: JSON.parse(
      document.querySelector(".tesseract-stage")!.getAttribute("data-config")!,
    ),
    // The whole drawing, since a flat view pans by a group transform. Its
    // description is compared as data, independently of key order.
    drawing: document
      .querySelector(".tesseract-stage")!
      .innerHTML.replace(/<desc>.*?<\/desc>/gs, ""),
    desc: JSON.parse(
      document.querySelector("#tesseract-artwork desc")!.textContent!,
    ),
  }));

test("a 4D link reopens the object's parameters, layers, views, and motion", async ({
  page,
  browser,
}) => {
  await page.goto("/");
  await chooseNotebook(page, "4d");
  await tesseractReady(page);
  await choosePreset(page, { label: "The missing middle" });
  await tesseractReady(page);
  await field(page, "Lift height A").fill("phi/2");
  await tesseractReady(page);
  const guide = page
    .locator(".tesseract-app .layer-grid input[type=checkbox]")
    .last();
  const guideName = (await guide.locator("xpath=..").textContent())!.trim();
  await guide.uncheck();
  const before = (await tesseractState(page)).drawing;
  const art = page.locator("#tesseract-artwork");
  const box = (await art.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(
    box.x + box.width / 2 - 70,
    box.y + box.height / 2 + 20,
    {
      steps: 4,
    },
  );
  await page.mouse.up();
  await page.mouse.wheel(0, -250);
  await expect
    .poll(async () => (await tesseractState(page)).drawing)
    .not.toBe(before);
  await open(page, "#shape-animation-section");
  const motion = page.getByRole("combobox", { name: "Animate", exact: true });
  await motion.selectOption({ index: 1 });
  const chosen = await motion.inputValue();
  await page.getByRole("spinbutton", { name: "Duration (seconds)" }).fill("4");
  await tesseractReady(page);
  const state = await tesseractState(page);
  expect(state.config.lift.height).toBeCloseTo((1 + Math.sqrt(5)) / 4, 14);

  const href = await copyLink(page);
  expect(new URL(href).searchParams.get("study")).toBe("4d");
  const other = await recipient(browser, href);
  await tesseractReady(other);
  await expect.poll(() => tesseractState(other)).toEqual(state);
  await expect(
    other.getByRole("checkbox", { name: guideName, exact: true }),
  ).not.toBeChecked();
  await open(other, "#shape-animation-section");
  await expect(
    other.getByRole("combobox", { name: "Animate", exact: true }),
  ).toHaveValue(chosen);
  await expect(
    other.getByRole("spinbutton", { name: "Duration (seconds)" }),
  ).toHaveValue("4");
  await other.context().close();
});
