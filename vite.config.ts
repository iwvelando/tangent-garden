import { readFileSync } from "node:fs";
import { defineConfig } from "vite";

// Production sends this policy from CloudFront; preview sends it too so the browser
// tests run under it. See tests/csp.spec.ts.
const csp = readFileSync("deploy/content-security-policy.txt", "utf8").trim();

export default defineConfig({
  base: "./",
  build: { outDir: "dist" },
  preview: { headers: { "Content-Security-Policy": csp } },
});
