import {
  readFileSync,
  writeFileSync,
  copyFileSync,
  mkdirSync,
  existsSync,
} from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";

// Walk installed runtime dependencies so their exact locked versions and full
// licenses accompany the static distribution. Vite also emits a preload helper.
const require = createRequire(resolve("package.json"));
const root = JSON.parse(readFileSync("package.json", "utf8"));
const seen = new Set();
const notices = [
  "Tangent Garden — third-party notices\n\nGenerated from installed dependencies. Go's license is in GO-LICENSE.txt.\n",
];
function include(name, resolver) {
  const manifest = resolver.resolve(`${name}/package.json`);
  if (seen.has(manifest)) return;
  seen.add(manifest);
  const pkg = JSON.parse(readFileSync(manifest, "utf8"));
  const folder = dirname(manifest);
  const license = ["LICENSE", "LICENSE.md", "LICENSE.txt"]
    .map((file) => join(folder, file))
    .find(existsSync);
  if (!license)
    throw new Error(
      `Missing license for ${pkg.name}; review its distribution notices.`,
    );
  notices.push(
    `\n--- ${pkg.name} ${pkg.version} (${pkg.license ?? "see below"}) ---\n\n${readFileSync(license, "utf8")}`,
  );
  // Vite's own LICENSE.md already includes notices for its bundled dependencies;
  // its development toolchain is not shipped with the website.
  if (name !== "vite") {
    const next = createRequire(manifest);
    for (const dependency of Object.keys(pkg.dependencies ?? {}).sort())
      include(dependency, next);
  }
}
for (const name of [...Object.keys(root.dependencies), "vite"].sort())
  include(name, require);
mkdirSync("public", { recursive: true });
writeFileSync("public/THIRD-PARTY-NOTICES.txt", notices.join("\n"));
copyFileSync("LICENSE", "public/LICENSE.txt");
