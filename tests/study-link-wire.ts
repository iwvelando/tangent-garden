import { inflateRawSync } from "node:zlib";
import { baselineV2 } from "../web/study-link-baselines-v2";
import type { Notebook } from "../web/study-link";

// Independent Node transport and patch implementation for emitted links.
// Only published literal data is shared; pinned fixture checksums protect it.
export function wireEnvelope(token: string) {
  return JSON.parse(inflateRawSync(Buffer.from(token, "base64url")).toString());
}
export function wireStudy(token: string): any {
  const envelope = wireEnvelope(token);
  if (envelope.v === 1) return envelope.study;
  if (envelope.v !== 2) throw new Error("Unsupported test fixture version");
  const study = baselineV2(envelope.notebook as Notebook);
  function apply(target: any, patch: any): void {
    for (const key of Object.keys(patch)) {
      const value = patch[key];
      if (value === null) delete target[key];
      else if (typeof value === "object" && !Array.isArray(value)) {
        if (
          !target[key] ||
          typeof target[key] !== "object" ||
          Array.isArray(target[key])
        )
          target[key] = {};
        apply(target[key], value);
      } else target[key] = value;
    }
  }
  apply(study, envelope.delta);
  return study;
}
