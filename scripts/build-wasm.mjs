import { execFileSync } from "node:child_process";
import { mkdirSync, copyFileSync, existsSync, chmodSync } from "node:fs";
import { join } from "node:path";
mkdirSync("public", { recursive: true });
execFileSync(
  "go",
  ["build", "-trimpath", "-o", "public/engine.wasm", "./cmd/wasm"],
  { stdio: "inherit", env: { ...process.env, GOOS: "js", GOARCH: "wasm" } },
);
const root = execFileSync("go", ["env", "GOROOT"], { encoding: "utf8" }).trim();
copyRuntimeFile(join(root, "lib/wasm/wasm_exec.js"), "public/wasm_exec.js");
const license = [join(root, "LICENSE"), join(root, "..", "LICENSE")].find(
  existsSync,
);
if (!license) throw new Error("Cannot locate the Go distribution license");
copyRuntimeFile(license, "public/GO-LICENSE.txt");

function copyRuntimeFile(source, destination) {
  // Downloaded Go toolchains have read-only files; keep generated copies writable
  // so repeated builds work, including after an older build copied those modes.
  if (existsSync(destination)) chmodSync(destination, 0o644);
  copyFileSync(source, destination);
  chmodSync(destination, 0o644);
}
