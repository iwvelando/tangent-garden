// Renders the link-preview card (public/og-image.png) and the home-screen icon
// (public/apple-touch-icon.png) from the built site, so they carry the garden's
// own drawing, type, and colours. Run after `npm run build`, check the images by
// eye, and commit them; they change only when the site's look does.
import { chromium } from "@playwright/test";
import { preview } from "vite";

const server = await preview({ preview: { port: 4174, strictPort: true } });
const browser = await chromium.launch();
try {
  const page = await browser.newPage({
    viewport: { width: 1200, height: 630 },
    colorScheme: "dark",
    reducedMotion: "reduce",
  });
  await page.goto("http://127.0.0.1:4174/");
  await page.waitForFunction(
    () => document.querySelectorAll("#artwork line").length > 20,
  );

  // The default study, cropped to its own lines, over the header's brand. Centred
  // so a square crop keeps both.
  await page.evaluate(() => {
    const art = document.getElementById("artwork");
    const paper = art.querySelector(":scope > rect");
    paper.style.display = "none";
    const box = art.getBBox();
    paper.style.display = "";
    const pad = Math.max(box.width, box.height) * 0.04;
    const [x, y, w, h] = [
      box.x - pad,
      box.y - pad,
      box.width + 2 * pad,
      box.height + 2 * pad,
    ];
    paper.setAttribute("x", x);
    paper.setAttribute("y", y);
    paper.setAttribute("width", w);
    paper.setAttribute("height", h);
    art.setAttribute("viewBox", `${x} ${y} ${w} ${h}`);
    const scale = Math.min(1080 / w, 420 / h);
    art.setAttribute("width", w * scale);
    art.setAttribute("height", h * scale);

    const brand = document.querySelector("header .brand").cloneNode(true);
    brand.style.cssText = "font-size: 54px; gap: 18px";
    brand.querySelector(".brand-symbol").style.cssText =
      "width: 62px; height: 62px";
    brand.querySelector(".brand-divider").style.cssText =
      "height: 40px; margin: 0 12px";
    brand.querySelector("small").style.cssText =
      "font-size: 17px; letter-spacing: 4px";

    const app = document.querySelector(".app");
    const card = document.createElement("main");
    card.style.cssText = `
      width: 1200px; height: 630px; display: flex; flex-direction: column;
      align-items: center; justify-content: center; gap: 34px;
      background: ${paper.getAttribute("fill")};`;
    card.append(art, brand);
    app.replaceChildren(card);
    app.style.minHeight = "0";
    document.body.style.margin = "0";
  });
  await page.screenshot({ path: "public/og-image.png" });

  // iOS rounds the corners itself and fills transparency with black.
  await page.setViewportSize({ width: 180, height: 180 });
  await page.evaluate(() => {
    const icon = document.createElement("img");
    icon.src = "./tangent-garden.svg";
    icon.style.cssText =
      "width: 140px; height: 140px; margin: 20px; display: block";
    const app = document.querySelector(".app");
    app.replaceChildren(icon);
    app.style.cssText = "min-height: 0; background: var(--panel)";
    return icon.decode();
  });
  await page.screenshot({ path: "public/apple-touch-icon.png" });
} finally {
  await browser.close();
  await new Promise((done) => server.httpServer.close(done));
}
console.log("Wrote public/og-image.png and public/apple-touch-icon.png.");
