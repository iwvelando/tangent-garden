import { test, expect } from "@playwright/test";

// What a messaging app or social site shows for a shared link. Scrapers need
// absolute URLs, so the tags name production; the images are fetched from
// whichever deployment is under test.
const site = "https://tangent-garden.isaacvelando.com";

// Width and height from a PNG's IHDR chunk.
const pngSize = (png: Buffer) => [png.readUInt32BE(16), png.readUInt32BE(20)];

test("@smoke a shared link unfurls into the site's card", async ({
  page,
  request,
}) => {
  await page.goto("/");
  const meta = (key: string) =>
    expect(page.locator(`meta[property="${key}"], meta[name="${key}"]`), key);
  const title = await page.title();
  const description = await page
    .locator('meta[name="description"]')
    .getAttribute("content");
  expect(title).toBe("Tangent Garden — curves & constructions");
  await meta("og:type").toHaveAttribute("content", "website");
  await meta("og:url").toHaveAttribute("content", `${site}/`);
  await meta("og:title").toHaveAttribute("content", title);
  await meta("og:description").toHaveAttribute("content", description!);
  await meta("og:image").toHaveAttribute("content", `${site}/og-image.png`);
  await meta("og:image:width").toHaveAttribute("content", "1200");
  await meta("og:image:height").toHaveAttribute("content", "630");
  await meta("og:image:alt").toHaveAttribute("content", /\S/);
  await meta("twitter:card").toHaveAttribute("content", "summary_large_image");
  await expect(page.locator('link[rel="canonical"]')).toHaveAttribute(
    "href",
    `${site}/`,
  );
  await expect(page.locator('link[rel="apple-touch-icon"]')).toHaveAttribute(
    "href",
    "./apple-touch-icon.png",
  );

  for (const [path, size] of [
    ["/og-image.png", [1200, 630]],
    ["/apple-touch-icon.png", [180, 180]],
  ] as const) {
    const image = await request.get(path);
    expect(image.status(), path).toBe(200);
    expect(image.headers()["content-type"], path).toBe("image/png");
    expect(pngSize(await image.body()), path).toEqual(size);
  }
});
