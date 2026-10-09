import { readFileSync } from "node:fs";
import basicSsl from "@vitejs/plugin-basic-ssl";
import { defineConfig } from "vite";

// Production sends this policy from CloudFront; preview sends it too so the browser
// tests run under it. See tests/csp.spec.ts.
const csp = readFileSync("deploy/content-security-policy.txt", "utf8").trim();

export default defineConfig(({ mode }) => ({
  base: "./",
  build: { outDir: "dist" },
  preview: { headers: { "Content-Security-Policy": csp } },
  // `make dev-lan` and `make preview-lan` serve over HTTPS with a self-signed
  // certificate. A plain-HTTP address other than localhost is no secure
  // context: Safari then runs JavaScript and WebAssembly several times slower,
  // and browsers withhold the video encoder that MP4 export needs.
  plugins: mode === "lan" ? [basicSsl()] : [],
}));
