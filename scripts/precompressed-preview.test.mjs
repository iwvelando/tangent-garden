// The preview's choice must match the production viewer-request function's
// (iwvelando/cloud-accounts, modules/static-site/tests/function.test.mjs).
import { test } from "node:test";
import assert from "node:assert/strict";
import { chooseEncoding } from "./precompressed-preview.mjs";

test("Brotli, else gzip, else the plain file, by Accept-Encoding", () => {
  for (const [accepted, chosen] of [
    ["gzip, deflate, br, zstd", "br"],
    ["br;q=1.0, gzip;q=0.8", "br"],
    ["BR", "br"],
    ["*", "br"],
    ["gzip, deflate", "gzip"],
    ["br;q=0, gzip", "gzip"],
    ["br; q=0.0, gzip; q=0.5", "gzip"],
    ["deflate", undefined],
    ["identity", undefined],
    ["gzip;q=0, br;q=0", undefined],
    ["", undefined],
    [undefined, undefined],
  ])
    assert.equal(chooseEncoding(accepted), chosen, String(accepted));
});
