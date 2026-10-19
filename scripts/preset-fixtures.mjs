// Writes the engines' copies of the 2D and 3D presets, which their Go tests
// read: engine/testdata/presets.json (each preset's title and
// configuration, as web/presets.ts defines them) and
// engine3/testdata/presets.json (each spatial preset's configuration, keyed
// by name, exactly as web/spatial/presets.ts gives it to the engine). Vite
// resolves the presets' imports, which Node cannot.
//
//   make preset-fixtures
import { writeFile } from "node:fs/promises";
import { createServer } from "vite";

const server = await createServer({
  logLevel: "silent",
  server: { ws: false },
});
try {
  const { presets } = await server.ssrLoadModule("/web/presets.ts");
  const { spatialPresets } = await server.ssrLoadModule(
    "/web/spatial/presets.ts",
  );
  await writeFile(
    "engine/testdata/presets.json",
    "[\n" +
      presets
        .map((p) => JSON.stringify({ title: p.title, config: p.config }))
        .join(",\n") +
      "\n]\n",
  );
  await writeFile(
    "engine3/testdata/presets.json",
    "{\n" +
      spatialPresets
        .map((p) => JSON.stringify(p.name) + ": " + JSON.stringify(p.config))
        .join(",\n") +
      "\n}\n",
  );
} finally {
  await server.close();
}
