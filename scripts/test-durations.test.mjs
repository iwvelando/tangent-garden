import { test } from "node:test";
import assert from "node:assert/strict";
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const script = fileURLToPath(new URL("./test-durations.mjs", import.meta.url));
const spec = (file, ...durations) => ({
  file,
  tests: [{ results: durations.map((duration) => ({ duration })) }],
});

test("timings belong to the spec that runs a shared helper, including nested describes", () => {
  const dir = mkdtempSync(join(tmpdir(), "tangent-test-durations-"));
  try {
    mkdirSync(join(dir, "tests"));
    const report = join(dir, "report.json");
    writeFileSync(
      report,
      JSON.stringify({
        suites: [
          {
            file: "first.spec.ts",
            specs: [spec("shared.ts", 1500, 500)],
            suites: [{ file: "shared.ts", specs: [spec("shared.ts", 3000)] }],
          },
          { file: "second.spec.ts", specs: [spec("shared.ts", 6000)] },
          { file: "ordinary.spec.ts", specs: [spec("ordinary.spec.ts", 100)] },
        ],
      }),
    );
    const result = spawnSync(process.execPath, [script, report], {
      cwd: dir,
      encoding: "utf8",
    });
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(
      JSON.parse(readFileSync(join(dir, "tests/test-durations.json"), "utf8")),
      {
        "first.spec.ts": 5,
        "ordinary.spec.ts": 1,
        "second.spec.ts": 6,
      },
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
