import type { EngineClient } from "./engine-client";
import type { PlanarStudy } from "./planar-link";
import type { OverlayKind } from "./overlay-journeys";
import { loomRequest, type LoomResult, type LoomMarker } from "./loom/model";
import { gardenRequest, type GardenResult } from "./garden/model";
import { laceRequest, type LaceResult } from "./lace/model";
import {
  familyTimes,
  shortenRequest,
  type ShortenReply,
} from "./shorten/model";

export type PreparedOverlay =
  | { kind: "loom"; result: LoomResult; marker: LoomMarker }
  | { kind: "garden"; result: GardenResult }
  | { kind: "lace"; result: LaceResult }
  | { kind: "shorten"; result: ShortenReply };
export type OverlayFailure = { message: string; field?: string };
export type OverlayScene = {
  study: PlanarStudy;
  prepared?: PreparedOverlay;
  failure?: OverlayFailure;
};
export const overlayCacheLimit = { scenes: 4, numbers: 4_000_000 } as const;

// Settings are small; bulk geometry gets a separate, explicit count. Count a
// static result only when its identity changes, never on every playback tick.
function numbers(value: unknown): number {
  if (typeof value === "number") return 1;
  if (!value || typeof value !== "object") return 0;
  if (ArrayBuffer.isView(value))
    return (value as unknown as { length: number }).length;
  let count = 0;
  for (const v of Array.isArray(value) ? value : Object.values(value))
    count += numbers(v);
  return count;
}
export class OverlayScenes {
  private entries = new Map<number, { scene: OverlayScene; numbers: number }>();
  get(index: number) {
    return this.entries.get(index)?.scene;
  }
  get size() {
    return this.entries.size;
  }
  get numericEntries() {
    return [...this.entries.values()].reduce((n, v) => n + v.numbers, 0);
  }
  set(index: number, scene: OverlayScene) {
    const old = this.entries.get(index);
    const count =
      old && old.scene.prepared?.result === scene.prepared?.result
        ? old.numbers
        : numbers(scene.prepared?.result);
    if (
      (!old && this.size >= overlayCacheLimit.scenes) ||
      this.numericEntries - (old?.numbers ?? 0) + count >
        overlayCacheLimit.numbers
    )
      throw new Error("The journey exceeded its retained geometry budget.");
    this.entries.set(index, { scene, numbers: count });
  }
  clear() {
    this.entries.clear();
  }
}

// Same production request builders and two-pass shortening preparation as
// the native workspaces. One caller owns the sequential worker lane.
export async function prepareOverlay(
  client: EngineClient,
  kind: OverlayKind,
  study: PlanarStudy,
): Promise<PreparedOverlay> {
  if (kind === "loom") {
    const result = (await client.loom(loomRequest(study.loom!))) as LoomResult;
    return { kind, result, marker: result.marker };
  }
  if (kind === "garden")
    return { kind, result: await client.garden(gardenRequest(study.garden!)) };
  if (kind === "lace")
    return { kind, result: await client.lace(laceRequest(study.lace!)) };
  const s = study.shorten!;
  const head = await client.shorten(shortenRequest(s, []));
  const times = familyTimes(head.result.end, s.contours, s.spacing);
  return {
    kind,
    result: (await client.shorten(shortenRequest(s, times))).result,
  };
}
