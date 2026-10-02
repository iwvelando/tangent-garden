// Draws the example gallery's thumbnails from the built site: each 2D example
// as its plot's own SVG, and each 3D example as a small WebP per theme, just as
// the example first appears. Run `make thumbnails` after adding or changing a
// preset, look at the gallery, and commit web/examples.
//
// 2D thumbnails keep the drawing's geometry, rounded to whole units of the
// plot's 1000 × 760 frame, with each colour replaced by its role in the plot's
// palette (web/palette.ts) so the thumbnail follows the theme. Strokes are
// thickened so they survive a quarter-scale picture.
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { chromium } from "@playwright/test";
import { preview } from "vite";

const port = 4175;
const out = "web/examples";
const stroke = 2.5;
const recorded = { "2d": {}, "3d": {}, "4d": {} };
// Each palette colour, in either theme, by its role.
const roles = Object.fromEntries(
  [
    ...readFileSync("web/palette.ts", "utf8").matchAll(
      /(\w+): "(#[0-9a-f]{6})"/g,
    ),
  ].map(([, role, colour]) => [colour, role]),
);

const server = await preview({
  preview: { host: "127.0.0.1", port, strictPort: true },
});
const browser = await chromium.launch();
try {
  const page = await browser.newPage({
    viewport: { width: 1440, height: 1000 },
    colorScheme: "light",
    reducedMotion: "reduce",
  });
  for (const notebook of ["2d", "3d", "4d"]) {
    rmSync(`${out}/${notebook}`, { recursive: true, force: true });
    mkdirSync(`${out}/${notebook}`, { recursive: true });
    await page.emulateMedia({ colorScheme: "light" });
    await page.goto(
      `http://127.0.0.1:${port}/${notebook === "2d" ? "" : `?study=${notebook}`}`,
    );
    const button = page.getByRole("button", {
      name: "Browse notebook examples",
    });
    const gallery = page.getByRole("dialog", { name: "Notebook examples" });
    await button.click();
    const examples = await gallery
      .locator("[data-example]")
      .evaluateAll((cards) =>
        cards
          .map((c) => ({ ...c.dataset }))
          .sort((a, b) => a.example - b.example),
      );
    await page.keyboard.press("Escape");
    for (const example of examples) {
      await button.click();
      await gallery.locator(`[data-example="${example.example}"]`).click();
      await gallery.waitFor({ state: "hidden" });
      // The drawing is ready once it shows this example's definition: a 3D
      // study's with its cut, when it has one.
      await page.waitForFunction(
        ([notebook, want]) => {
          const spatial = document.querySelector(
            ".spatial-stage[aria-busy=false]",
          )?.dataset;
          const text =
            notebook === "4d"
              ? document.querySelector(".tesseract-stage[aria-busy=false]")
                  ?.dataset.config
              : notebook === "3d"
                ? spatial?.config &&
                  (spatial.cut
                    ? `{"config":${spatial.config},"cut":${spatial.cut}}`
                    : spatial.config)
                : document.querySelector(".plot-wrap[aria-busy=false]") &&
                  document.querySelector("#artwork > desc")?.textContent;
          if (!text) return false;
          let h = 0x811c9dc5;
          for (const c of text) {
            h ^= c.codePointAt(0);
            h = Math.imul(h, 0x01000193) >>> 0;
          }
          return h.toString(16).padStart(8, "0") === want;
        },
        [notebook, example.fingerprint],
        { timeout: 60_000 },
      );
      const name = example.exampleSlug;
      if (name in recorded[notebook])
        throw new Error(`Two examples are named ${name}.`);
      recorded[notebook][name] = example.fingerprint;
      if (notebook === "2d") {
        const svg = await page.evaluate(planarThumbnail, {
          name,
          stroke,
          roles,
        });
        writeFileSync(`${out}/2d/${name}.svg`, svg + "\n");
      } else
        for (const theme of ["light", "dark"]) {
          await page.emulateMedia({ colorScheme: theme });
          // Two frames for the theme to reach the canvas.
          await page.evaluate(
            () =>
              new Promise((done) =>
                requestAnimationFrame(() => requestAnimationFrame(done)),
              ),
          );
          const data = await page.evaluate(
            notebook === "4d" ? tesseractThumbnail : spatialThumbnail,
          );
          writeFileSync(
            `${out}/${notebook}/${name}-${theme}.webp`,
            Buffer.from(data.split(",")[1], "base64"),
          );
        }
      await page.emulateMedia({ colorScheme: "light" });
      console.log(`${notebook} ${name}`);
    }
  }
} finally {
  await browser.close();
  await new Promise((done) => server.httpServer.close(done));
}
writeFileSync(
  `${out}/thumbnails.json`,
  JSON.stringify(recorded, null, 2) + "\n",
);
console.log(`Wrote thumbnails and ${out}/thumbnails.json.`);

// Runs in the page: a lean, theme-free copy of the plot.
async function planarThumbnail({ name, stroke, roles }) {
  const art = document.getElementById("artwork").cloneNode(true);
  const round = (v) => {
    const n = Math.round(+v);
    return Object.is(n, -0) ? "0" : String(n);
  };
  const fine = (v) => String(Math.round(+v * 100) / 100);
  const numbers = /-?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?/gi;
  // Each polyline simplified (Douglas–Peucker) to within 0.6 units, about a
  // seventh of a thumbnail pixel, then rounded to whole units.
  const simplify = (points, from, to, keep) => {
    const [ax, ay] = points[from];
    const [bx, by] = points[to];
    const length = Math.hypot(bx - ax, by - ay);
    let far = 0;
    let index = -1;
    for (let i = from + 1; i < to; i++) {
      const [px, py] = points[i];
      const d = length
        ? Math.abs((bx - ax) * (ay - py) - (ax - px) * (by - ay)) / length
        : Math.hypot(px - ax, py - ay);
      if (d > far) [far, index] = [d, i];
    }
    if (far > 0.6) {
      simplify(points, from, index, keep);
      keep.add(index);
      simplify(points, index, to, keep);
    }
  };
  const path = (d) => {
    if (/[^ML\d\s,.eE+-]/.test(d)) return d.replace(numbers, round);
    return (d.match(/M[^M]*/g) ?? [])
      .map((run) => {
        const values = (run.match(numbers) ?? []).map(Number);
        const points = [];
        for (let i = 0; i + 1 < values.length; i += 2)
          points.push([values[i], values[i + 1]]);
        const keep = new Set([0, points.length - 1]);
        if (points.length > 2) simplify(points, 0, points.length - 1, keep);
        return [...keep]
          .sort((a, b) => a - b)
          .map(
            (i, k) =>
              `${k ? (k === 1 ? "L" : " ") : "M"}${round(points[i][0])} ${round(points[i][1])}`,
          )
          .join("");
      })
      .join("");
  };
  for (const e of art.querySelectorAll("title, desc")) e.remove();
  for (const e of [art, ...art.querySelectorAll("*")]) {
    for (const { name: attr, value } of [...e.attributes]) {
      if (
        /^(id|style|role|class|tabindex|width|height|data-.*|aria-.*)$/.test(
          attr,
        ) &&
        !(e !== art && /^(width|height)$/.test(attr))
      )
        e.removeAttribute(attr);
      else if (attr === "stroke" || attr === "fill") {
        const role = roles[value.toLowerCase()];
        if (role) {
          e.removeAttribute(attr);
          e.classList.add(`${attr[0]}-${role}`);
        }
      } else if (attr === "stroke-width")
        e.setAttribute(attr, fine(+value * stroke));
      else if (attr === "d") e.setAttribute(attr, path(value));
      else if (attr === "points")
        e.setAttribute(attr, value.replace(numbers, round));
      else if (/^(x|y|x1|y1|x2|y2|cx|cy|r|rx|ry|width|height)$/.test(attr))
        e.setAttribute(attr, round(value));
      else if (/^(opacity|stroke-opacity|fill-opacity)$/.test(attr))
        e.setAttribute(attr, fine(value));
    }
  }
  // An iterated map's density becomes a mask over the base colour, at the
  // thumbnail's resolution rather than one pixel per cell.
  for (const image of art.querySelectorAll("image")) {
    const source = new Image();
    source.src = image.getAttribute("href");
    await source.decode();
    const w = Math.max(1, Math.round(+image.getAttribute("width") * 0.4));
    const h = Math.max(1, Math.round(+image.getAttribute("height") * 0.4));
    const canvas = Object.assign(document.createElement("canvas"), {
      width: w,
      height: h,
    });
    const context = canvas.getContext("2d");
    context.drawImage(source, 0, 0, w, h);
    const pixels = context.getImageData(0, 0, w, h);
    for (let k = 0; k < pixels.data.length; k += 4)
      pixels.data.fill(255, k, k + 3);
    context.putImageData(pixels, 0, 0);
    const ns = "http://www.w3.org/2000/svg";
    const mask = document.createElementNS(ns, "mask");
    mask.id = `density-${name}`;
    const copy = document.createElementNS(ns, "image");
    const rect = document.createElementNS(ns, "rect");
    for (const attr of ["x", "y", "width", "height"]) {
      copy.setAttribute(attr, image.getAttribute(attr));
      rect.setAttribute(attr, image.getAttribute(attr));
    }
    copy.setAttribute("preserveAspectRatio", "none");
    copy.setAttribute("href", canvas.toDataURL("image/png"));
    mask.append(copy);
    rect.setAttribute("class", "f-base");
    rect.setAttribute("mask", `url(#${mask.id})`);
    image.replaceWith(mask, rect);
  }
  art.setAttribute("aria-hidden", "true");
  art.setAttribute("focusable", "false");
  art.removeAttribute("xmlns");
  // Groups left with no attributes add nothing.
  for (const g of art.querySelectorAll("g"))
    if (!g.attributes.length) g.replaceWith(...g.childNodes);
  return new XMLSerializer()
    .serializeToString(art)
    .replace(/ xmlns="[^"]*"/g, "")
    .replace(/>\s+</g, "><");
}

// Runs in the page: the 3D canvas, cropped to the gallery's frame.
function spatialThumbnail() {
  const source = document.getElementById("spatial-artwork");
  const [w, h] = [480, Math.round((480 * 760) / 1000)];
  const scale = Math.max(w / source.width, h / source.height);
  const canvas = Object.assign(document.createElement("canvas"), {
    width: w,
    height: h,
  });
  const context = canvas.getContext("2d");
  context.imageSmoothingQuality = "high";
  const [sw, sh] = [w / scale, h / scale];
  context.drawImage(
    source,
    (source.width - sw) / 2,
    (source.height - sh) / 2,
    sw,
    sh,
    0,
    0,
    w,
    h,
  );
  return canvas.toDataURL("image/webp", 0.82);
}

async function tesseractThumbnail() {
  const svg = document.getElementById("tesseract-artwork").cloneNode(true);
  svg.setAttribute("width", "480");
  svg.setAttribute("height", "365");
  const canvas = Object.assign(document.createElement("canvas"), {
    width: 480,
    height: 365,
  });
  const url = URL.createObjectURL(
    new Blob([new XMLSerializer().serializeToString(svg)], {
      type: "image/svg+xml",
    }),
  );
  try {
    const image = new Image();
    image.src = url;
    await image.decode();
    canvas.getContext("2d").drawImage(image, 0, 0);
    return canvas.toDataURL("image/webp", 0.88);
  } finally {
    URL.revokeObjectURL(url);
  }
}
