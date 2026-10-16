import { test, expect } from "@playwright/test";
import { chooseNotebook } from "./helpers";

// Search engines find each notebook through /sitemap.xml, which robots.txt
// names. Every listed address must open its own notebook and declare itself
// canonical, or the sitemap and the page would contradict each other.
const site = "https://tangent-garden.isaacvelando.com";

async function sitemapUrls(
  request: import("@playwright/test").APIRequestContext,
) {
  const response = await request.get("/sitemap.xml");
  expect(response.ok()).toBe(true);
  const xml = await response.text();
  expect(xml).toContain('xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"');
  return [...xml.matchAll(/<loc>([^<]*)<\/loc>/g)].map((m) => m[1]);
}

test("@smoke robots.txt allows crawling and names the sitemap", async ({
  request,
}) => {
  const response = await request.get("/robots.txt");
  expect(response.ok()).toBe(true);
  const robots = await response.text();
  expect(robots).toMatch(/^User-agent: \*$/m);
  expect(robots).not.toMatch(/^Disallow: \/\s*$/m);
  expect(robots).toMatch(new RegExp(`^Sitemap: ${site}/sitemap\\.xml$`, "m"));
});

test("@smoke the sitemap lists each notebook once", async ({ request }) => {
  expect(await sitemapUrls(request)).toEqual([
    `${site}/`,
    `${site}/?study=3d`,
    `${site}/?study=4d`,
  ]);
});

test("each sitemap address opens its notebook and is its canonical address", async ({
  page,
  request,
}) => {
  for (const url of await sitemapUrls(request)) {
    const path = url.slice(site.length);
    await page.goto(path);
    const kind = new URL(url).searchParams.get("study") ?? "2d";
    await expect(
      page
        .locator(".app:visible")
        .getByRole("radio", { name: `${kind.toUpperCase()} studies` }),
    ).toBeChecked();
    await expect(page.locator('link[rel="canonical"]')).toHaveAttribute(
      "href",
      url,
    );
  }
});

test("switching notebooks moves the canonical address with it", async ({
  page,
}) => {
  await page.goto("/");
  const canonical = page.locator('link[rel="canonical"]');
  const og = page.locator('meta[property="og:url"]');
  await chooseNotebook(page, "4d");
  await expect(canonical).toHaveAttribute("href", `${site}/?study=4d`);
  await expect(og).toHaveAttribute("content", `${site}/?study=4d`);
  await chooseNotebook(page, "2d");
  await expect(canonical).toHaveAttribute("href", `${site}/`);
  await expect(og).toHaveAttribute("content", `${site}/`);
});
