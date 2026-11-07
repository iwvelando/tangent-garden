// A separate local research build. The public build/catalog stay unchanged.
// Run npm run build first for WASM, notices and application type checking.
import { build } from "vite";
import { execFileSync } from "node:child_process";
execFileSync(
  "npx",
  ["tsc", "--project", "scripts/implicit-atlas-research/tsconfig.json"],
  { stdio: "inherit" },
);
await build({
  base: "/",
  build: {
    outDir: ".codex/implicit-atlas-dist",
    rollupOptions: {
      input: ["index.html", "scripts/implicit-atlas-research/index.html"],
    },
  },
});
