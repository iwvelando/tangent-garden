# Portable study links

Copy link automatically chooses the shorter eligible full-study or compact encoding. Both carry the study in the URL itself. There is no study upload, registry, storage lookup, account, or server to provision. A compatible self-host needs the decoder and frozen baseline data for the link's version.

## Wire format and versions

`ShareLink` reads the notebook when Copy link is clicked. `writeStudyLink` synchronously JSON-materializes that study before compression starts, so later edits cannot change either candidate. Each candidate uses UTF-8 JSON, native `CompressionStream("deflate-raw")`, then unpadded base64url in `#s=<token>`:

- **v1:** `{ "v": 1, "notebook": "2d" | "3d" | "4d", "study": <full study> }`.
- **v2:** `{ "v": 2, "notebook": "2d" | "3d" | "4d", "delta": <object patch> }`.

Version and notebook select exactly one immutable baseline and patch contract. There is no redundant baseline identifier. The writer compresses both eligible candidates with the same production compressor and compares final token lengths; v1 wins ties. Each candidate's size eligibility is independent, so a full candidate exceeding a limit does not prevent a valid compact link. Raw writer inputs containing null, unsupported structure or reserved keys use v1 when it fits. The writer serializes data; it does not perform notebook conformance.

`studyHref` preserves the page's origin, subpath and unrelated query parameters, selects the notebook with `?study=3d` or `?study=4d` (no selector for 2D), and puts the data in the fragment. Browsers do not send fragments to the server. Compression is not encryption. The token is data, not a hash or lookup key.

## Frozen baseline policy

[`web/study-link-baselines-v2.ts`](../web/study-link-baselines-v2.ts) contains one complete, JSON-materialized `presetStudy(0)` snapshot per notebook, captured at revision `6e7c35d69335b6b83688f5d8178063750345e5c3`. The first presets give substantial savings across all three notebooks without a maintained preset registry. The snapshots are literal JSON strings, with no imports from live defaults, presets, renderers or notebook modules. Parsing yields fresh data on every read. The module is about 6.7 KB of source (2.6 KB gzipped).

Published baseline data and patch semantics are append-only. Never regenerate v2 data after a preset or default changes. A new baseline set or incompatible patch contract requires a new version, retaining all older supported decoders and data. Fixed independently generated tokens and baseline checksums protect this contract.

Baselines freeze saved input data, not engine algorithms. They do not promise identical pixels after arbitrary numerical or rendering changes. Older app versions cannot read newer formats; compatible self-hosts must retain the corresponding baseline data.

## v2 patch semantics

1. The root delta is an object. `{}` retains the complete baseline study.
2. An omitted object member retains its baseline value. Scalars, including `0`, `false` and `""`, replace it exactly.
3. Object members compare in any order; arrays compare in order. Unchanged data needs no patch, however its members are ordered. Object patches recurse into a baseline object, or into an empty object if the baseline at that key is absent, scalar or array. An empty patch retains an existing object; clearing its members requires explicit deletions.
4. `null` at a patch object's member deletes that member. Deleting an absent member is an idempotent no-op. Nested deletions and optional-field absence are preserved.
5. Arrays replace in full, including empty arrays, preserving order, length and literal contents. Array indices are never merged. An array's entire subtree is literal data: null anywhere inside it is invalid. Current study schemas do not accept null data, so null is reserved for deletion elsewhere in v2.
6. Restored studies own fresh storage. Changing a decoded study cannot change another decode or the frozen snapshots.

For example, `{ "camera": { "x": 0 }, "probe": null, "animation": { "tracks": [] } }` retains the baseline's other camera values, removes the probe member, and replaces the tracks with an empty list.

Exactness is equality in the existing JSON-serialized data domain. Configuration for inactive modes, optional presence, numeric values, stored expression and bounds text, layer choices, manual cameras and animation settings all survive. JSON's normalization of undefined and negative zero still applies. A scalar field that stores only an evaluated number cannot preserve the spelling originally typed into that field. Theme, color scheme, computed geometry, playback position and export settings remain outside the study.

## Reading and untrusted input

The reader restores the full raw study before handing it to `planarStudy`, `spatialStudy` or `tesseractStudy`. The ordinary schemas then validate every field, reject unknown fields and supply historical compatibility defaults; Go validates numerical limits. In particular, older 3D links retain historical line weights and probe-presence behavior, and 4D links retain object-specific defaults. Compact omissions are expanded from the frozen snapshot, never today's defaults. Planar layers include independent `definitionGuides` (Fourier, Lissajous and roulette guides) and `rollingGuides` (the Rolling study's circle or curve, arm and markers). Older links inherit both from their conformed `layers.lines` value. Legacy phrase events that set `lines` inherit that same combined behavior unless they explicitly set the new flags. The frozen compact baselines remain unchanged.

Limits apply independently:

| Budget | Limit |
| --- | ---: |
| Encoded fragment token | 32,768 characters |
| Inflated JSON envelope, v1 and v2 | 262,144 UTF-8 bytes |
| Reconstructed v2 study JSON | 262,144 UTF-8 bytes |
| v2 patch and restored tree depth | 32 edges from the root |
| v2 patch and restored tree nodes, each | 16,384 values |
| Text field after notebook conformance | 4,000 JavaScript string units |

Supported studies have nesting below 12; list limits include 12 camera keys, up to 16 planar terms, seeds or pursuers, and up to 16 spatial pursuers. The structural budgets leave ample room for these settings and tracks. Patch validation runs before recursive restoration, scans newly inserted groups and replacement arrays, rejects nonfinite numbers and prototype-related keys (`__proto__`, `constructor`, `prototype`) at every depth, and bounds traversal. Restoration charges JSON bytes and nodes while building output, before storing each value. An envelope fitting its cap can still fail the reconstruction budget because retained baseline fields add bytes. Syntactic or budget refusals are `LinkError`s; restored invalid fields still receive ordinary field-specific schema errors.

`main.tsx` rejects stale asynchronous link reads, consumes the fragment after the latest read, and applies a valid study through the preset replacement path. A failed link leaves user work intact. A successful link invalidates pending scalar evaluations and restores layers, manual framing and animation setup. Clipboard denial still offers a selected manual-copy field.

## Measurements

Measurements use the production compressor for both candidates and `presetStudy(index)` for all 218 presets as of `4249e17`, after the frozen baseline was captured. Lengths count token characters, excluding the URL prefix. Every selected token is no longer than its eligible full equivalent; all preset studies restore exactly both before and after notebook conformance.

| Notebook | Presets | v1 full, min / median / max | Selected, min / median / max |
| --- | ---: | ---: | ---: |
| 2D | 65 | 1,264 / 1,420 / 1,539 | 48 / 190 / 383 |
| 3D | 140 | 1,803 / 1,858 / 2,078 | 48 / 304 / 610 |
| 4D | 13 | 344 / 378 / 450 | 48 / 136 / 258 |

Edited study examples measured 1,428 → 223 (2D), 1,962 → 560 (3D), and 376–478 → 144–326 (4D across all presets' objects). Larger examples with multiple tracks and 12 camera keys measured 2,698 → 1,534 in 2D (including a long unique expression and 16 seeds), and 2,174 → 788 in 3D. These are examples, not a promise that arbitrary studies shrink. Unique expressions, detailed paths and changed lists still need to travel in the URL. A delta can exceed a full encoding; automatic selection then retains v1.

The browser-free codec tests import production TypeScript directly and independently inflate emitted links with Node zlib. To reproduce the corpus measurements without a server or build:

```sh
BASE_URL=http://127.0.0.1:43971 npx playwright test tests/study-link.spec.ts --workers=1 --reporter=line
```

The dummy address suppresses the preview server only for this source-import spec. Actual browser specs require a production build and a real preview server, as [contributing](contributing.md#running-the-tests) describes.

Uniformly tiny identifiers for arbitrary studies require a retained mapping somewhere. Hashing a study cannot reconstruct it. A hosted shortener, object-storage write service or arbitrary-study registry would introduce shared state and a publication path. Those remain outside this static, self-contained format; alternative compressors and preset-ID registries are deferred too.
