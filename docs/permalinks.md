# Permalink format and shortening options

Study links can be substantially shorter without a database. A compact, versioned encoding can omit values supplied by an immutable baseline shipped with the app. Very short identifiers for arbitrary user studies require a durable mapping somewhere, but that mapping need not live in a database: object storage or a published static registry also works. Those alternatives introduce shared state and a write/publication path that the current app does not have.

This investigation describes the current implementation and measures a possible encoding. It does not change link generation or introduce a new supported format.

## Current format

The sharing path is `ShareLink` → `writeStudyLink` → `studyHref`:

```text
study object
→ JSON.stringify({ v: 1, notebook: "2d" | "3d" | "4d", study })
→ UTF-8
→ raw DEFLATE
→ base64url, without padding
→ #s=<token>
```

- [`web/ShareLink.tsx`](../web/ShareLink.tsx) snapshots the notebook when Copy link is clicked.
- [`web/study-link.ts`](../web/study-link.ts) uses native `CompressionStream("deflate-raw")`. `studyHref` preserves the page's origin/path and other query parameters, setting `?study=3d` or `?study=4d` as needed. The envelope also names the notebook.
- The token is the data itself, not a hash, encrypted value, or lookup key. It can be decoded without contacting a service. The browser does not send the fragment to the website's server; compression is not encryption.
- The study includes configuration for inactive modes, layers, manual cameras, and animation settings. It omits computed geometry, theme, color scheme, transient playback position, and export settings. Removing inactive settings would lose editable study state.
- The token is limited to 32,768 characters, excluding the rest of the URL. The reader separately limits inflated JSON to 262,144 bytes. Expression fields are limited to 4,000 JavaScript string units by the notebook schemas.
- Reading reverses the encoding, checks the envelope version and notebook, then passes the study to `planarStudy`, `spatialStudy`, or `tesseractStudy`. These functions validate fields and supply compatibility defaults; Go separately validates numerical limits. `web/main.tsx` removes the fragment after reading it.

[DEFLATE](https://www.rfc-editor.org/rfc/rfc1951) already compresses repeated text. [Base64url](https://www.rfc-editor.org/rfc/rfc4648#section-5) then represents six bits per character, expanding the compressed bytes by about one third. Changing the alphabet alone cannot provide the large savings available from removing redundant study data.

## Measured opportunity

Measured on revision `be64390a8c6748eae2475a809ad81390e91c9640`, using every preset's production `presetStudy(index)` and the production `writeStudyLink` compressor. Lengths below count token characters, not the URL prefix.

The prototype uses each notebook's first complete preset study as a baseline. It recursively omits equal object fields, replaces changed arrays in full, and represents a missing baseline key with a `null` deletion marker. Study schemas do not accept null values, so the marker is distinguishable from study data. Exact reconstruction was asserted for all 216 preset studies, and reconstructed studies were also checked through the production notebook validators.

| Notebook | Presets | Current token, min / median / max | Delta token, min / median / max | Median per-study reduction |
| --- | ---: | ---: | ---: | ---: |
| 2D | 65 | 1,264 / 1,420 / 1,539 | 48 / 191 / 384 | 86.6% |
| 3D | 138 | 1,803 / 1,856.5 / 2,078 | 48 / 303 / 610 | 83.6% |
| 4D | 13 | 344 / 378 / 450 | 48 / 136 / 255 | 60.9% |

The delta was compressed inside the existing envelope solely to compare sizes with the same compressor. These tokens are **not valid replacement study links**: the production reader has no delta decoder. A real format needs a version selecting the immutable baseline and delta rules. A numeric version change from 1 to 2 would occupy the same JSON space, but final implementation choices could change these measurements.

The 48-character minimum is the envelope plus an empty delta for the baseline preset. These studies are close to common defaults, so the measurements do not predict arbitrary edited studies. Unique expressions, non-default inactive settings, large lists, and detailed camera paths still travel in full when changed. Some deltas could even be larger than a full encoding; a future writer can choose the shorter of supported full and delta formats.

## Recommended direction

1. Keep the current v1 decoder. Add a versioned compact format whose baseline snapshots and decoding rules are immutable application data. An embedded baseline is shared decoding knowledge, not a per-link database.
2. Restore the complete study before the notebook's ordinary validation and compatibility handling. Do not merely remove fields and trust today's defaults. For example, a missing 3D line weight intentionally opens with the historical hairline weight, while a new preset opens with regular strokes. Probe behavior also depends on whether older fields were present. The 4D object descriptor supplies object-specific defaults.
3. Preserve exact expressions, numerical values, inactive settings, optional-field absence, cameras, and animation setup. Avoid rounding coordinates or simplifying expressions just to shorten the token.
4. Bound encoded bytes, inflated bytes, patch depth/size, and reconstructed data; validate patch keys and operations before merging. Never allow untrusted keys to mutate object prototypes. Then use the existing schema and numerical checks. Keep malformed/future-link errors and old-link behavior.
5. Use TDD for implementation: retain v1 fixtures, assert exact study restoration across every preset and edited studies, exercise copy/open in every notebook, and test deletion markers, invalid patches, limits, and frozen-default behavior. Compare full and compact sizes using actual copied links.

Stable preset identifiers plus a delta can shorten links even further when a study closely matches a preset. Such identifiers must reference frozen study snapshots, not array positions or mutable preset titles. A compiled snapshot registry can remain entirely static. A compact field dictionary, positional binary representation, or another compressor could be benchmarked later; none is needed to demonstrate the main savings above.

## When stored state is required

A short code such as `#s=Ab3xYz12` has only 48 bits of information with a 64-character alphabet. It cannot losslessly represent all studies whose definitions contain many more independent bits. Hashing the current payload produces an identifier, not a way to recover the payload.

| Approach | Database required? | Where the study is recovered |
| --- | --- | --- |
| Compressed full study or versioned delta | No | URL plus immutable decoder/baseline bundled with the app |
| Stable identifier for a curated preset | No | Frozen preset snapshot bundled with the app |
| Short identifier for an arbitrary saved study | No specific database required; durable shared storage is required | Object storage, a static registry, a key-value store, or another retained mapping |
| Browser-local identifier | No | Only that browser's storage; it does not make a portable link |
| Hash or content-addressed identifier | Storage is still required | Retained content under that hash; the hash cannot reconstruct it |

Static files could host arbitrary saved studies, but creating them needs an authorized write or publication workflow, collision handling where relevant, retention, and limits. A third-party URL shortener similarly stores a mapping externally. Neither is stateless. These options would change the app's current promise that no study is uploaded and would need a separate product and hosting decision.

Prefer a compact self-contained format if the goal is substantially shorter portable links while preserving the current static architecture. Use durable shared storage only if arbitrary studies must have uniformly tiny codes.

## Reproducing the measurements

The following temporary Playwright spec imports the production codec directly; it needs neither a build nor a browser/server. Save it as `tests/permalink-measurement.tmp.spec.ts`, then run just that file with `BASE_URL=http://127.0.0.1:43971 npx playwright test tests/permalink-measurement.tmp.spec.ts --workers=1 --reporter=line`. Setting `BASE_URL` suppresses Playwright's automatic preview server; no request is made to that address. Remove the temporary spec afterward. Preset changes can change the results, so use the revision named above to reproduce the table.

```ts
import { test } from "@playwright/test";
import assert from "node:assert/strict";
import { inflateRawSync } from "node:zlib";
import { writeStudyLink, readStudyLink } from "../web/study-link";
import { presetStudy as planar, planarStudy } from "../web/planar-link";
import { presetStudy as spatial, spatialStudy } from "../web/spatial/link";
import { presetStudy as tesseract, tesseractStudy } from "../web/tesseract/link";
import { presets } from "../web/presets";
import { spatialPresets } from "../web/spatial/presets";
import { tesseractPresets } from "../web/tesseract/presets";

const object = (v: any) => v !== null && typeof v === "object" && !Array.isArray(v);
function delta(value: any, baseline: any): any {
  if (JSON.stringify(value) === JSON.stringify(baseline)) return undefined;
  if (!object(value) || !object(baseline)) return value;
  const out: any = {};
  for (const key of new Set([...Object.keys(baseline), ...Object.keys(value)])) {
    if (!Object.hasOwn(value, key)) out[key] = null;
    else {
      const change = delta(value[key], baseline[key]);
      if (change !== undefined) out[key] = change;
    }
  }
  return out;
}
function restore(change: any, baseline: any): any {
  if (change === undefined) return structuredClone(baseline);
  if (!object(change) || !object(baseline)) return structuredClone(change);
  const out = structuredClone(baseline);
  for (const [key, value] of Object.entries(change)) {
    if (value === null) delete out[key];
    else out[key] = restore(value, baseline[key]);
  }
  return out;
}
const summary = (xs: number[]) => {
  const sorted = [...xs].sort((a,b) => a-b);
  const n = sorted.length;
  return { min: sorted[0], median: n % 2 ? sorted[(n-1)/2] : (sorted[n/2-1]+sorted[n/2])/2, max: sorted[n-1] };
};

test("measure full and sparse envelopes with the production compressor", async () => {
  for (const [notebook, entries, make, conform] of [
    ["2d", presets, planar, planarStudy],
    ["3d", spatialPresets, spatial, spatialStudy],
    ["4d", tesseractPresets, tesseract, tesseractStudy],
  ] as const) {
    // A hypothetical codec would ship this snapshot immutably, not read
    // the current preset at decode time. This experiment never emits v2.
    const baseline = JSON.parse(JSON.stringify(make(0)));
    const full: number[] = [], sparse: number[] = [], jsonBytes: number[] = [];
    for (let i = 0; i < entries.length; i++) {
      const study = JSON.parse(JSON.stringify(make(i)));
      const token = await writeStudyLink(notebook, study);
      assert.deepEqual((await readStudyLink(token)).study, study);
      assert.deepEqual(JSON.parse(inflateRawSync(Buffer.from(token, "base64url")).toString()), { v: 1, notebook, study });
      const patch = delta(study, baseline) ?? {};
      const restored = restore(patch, baseline);
      assert.deepEqual(restored, study);
      assert.deepEqual(conform(restored), conform(study));
      // Same v1 envelope/production compressor for an apples-to-apples
      // length estimate. The patch is NOT a supported study-link format.
      const candidate = await writeStudyLink(notebook, patch);
      full.push(token.length);
      sparse.push(candidate.length);
      jsonBytes.push(Buffer.byteLength(JSON.stringify({ v: 1, notebook, study })));
    }
    console.log(JSON.stringify({ notebook, count: entries.length, jsonBytes: summary(jsonBytes), full: summary(full), sparse: summary(sparse), medianReductionPercent: summary(full.map((n,i) => 100 * (n-sparse[i])/n)).median }));
  }
});
```
