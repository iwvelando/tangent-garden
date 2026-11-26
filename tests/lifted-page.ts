import { readFileSync } from "node:fs";
import { transformWithOxc } from "vite";
import type { Page } from "@playwright/test";

// The page's own restore (web/lifted.ts), compiled for the page and
// installed as window.restoreLifted, so test code reading a worker's reply
// in the page sees it as the engine client does: a planar, spatial or 4D
// result's large arrays arrive lifted, beside its JSON. It returns the
// reply, restored in place; a reply without lifted arrays is unchanged.
let script: Promise<string> | undefined;
const compiled = () =>
  (script ??= transformWithOxc(
    readFileSync("web/lifted.ts", "utf8"),
    "lifted.ts",
    { lang: "ts" },
  ).then(
    ({ code }) => `(() => {
  ${code.replace(/^export /gm, "")}
  window.restoreLifted = (data) => {
    if (data && data.result && data.lifted) restore(data.result, data.lifted);
    return data;
  };
})();`,
  ));

export const installLiftedRestore = async (page: Page) =>
  page.addInitScript({ content: await compiled() });
