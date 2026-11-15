import type { Page } from "@playwright/test";
import { readFile } from "node:fs/promises";
export async function observeSpatial(page: Page, delay = 0) {
  await page.addInitScript(
    ({ delay }) => {
      const Native = window.Worker;
      const logs: any[] = [];
      Object.assign(window, { spatialWorkers: logs });
      window.Worker = class extends Native {
        log: any;
        constructor(url: string | URL, options?: WorkerOptions) {
          super(url, options);
          this.log = {
            url: String(url),
            requests: [],
            replies: [],
            active: 0,
            maximum: 0,
            terminated: false,
          };
          logs.push(this.log);
        }
        postMessage(data: any, options?: any) {
          if (data.action === "spatial" && !data.probeOnly) {
            this.log.active++;
            this.log.maximum = Math.max(this.log.maximum, this.log.active);
            this.log.requests.push({
              ...structuredClone(data),
              observedAt: performance.now(),
            });
          }
          super.postMessage(data, options);
        }
        set onmessage(handler: any) {
          super.onmessage = (event: MessageEvent) => {
            const deliver = () => {
              if (this.log.requests.some((r: any) => r.id === event.data.id)) {
                this.log.active--;
                const q = this.log.requests.find(
                  (r: any) => r.id === event.data.id,
                );
                const mesh = event.data.result?.mesh;
                this.log.replies.push({
                  ...structuredClone(event.data),
                  observedElapsed: performance.now() - q.observedAt,
                  observedBytes:
                    (event.data.lifted?.floats?.byteLength ?? 0) +
                    Object.values(mesh ?? {}).reduce<number>(
                      (n: number, v: any) => n + (v?.byteLength ?? 0),
                      0,
                    ) +
                    new TextEncoder().encode(JSON.stringify(event.data.result))
                      .length,
                });
              }
              handler?.call(this, event);
            };
            if (logs.indexOf(this.log) > 0 && delay) setTimeout(deliver, delay);
            else deliver();
          };
        }
        terminate() {
          this.log.terminated = true;
          super.terminate();
        }
      };
    },
    { delay },
  );
}
export async function pngStill(page: Page) {
  await page.getByRole("button", { name: "Export image", exact: true }).click();
  await page
    .getByRole("menuitemradio", { name: "1000 × 760", exact: true })
    .click();
  const download = page.waitForEvent("download");
  await page.getByRole("menuitem", { name: /^PNG/ }).click();
  return readFile((await (await download).path())!);
}
export function pngMetadata(bytes: Buffer) {
  for (let i = 8; i < bytes.length;) {
    const n = bytes.readUInt32BE(i);
    if (bytes.toString("ascii", i + 4, i + 8) === "iTXt") {
      const body = bytes.subarray(i + 8, i + 8 + n);
      return JSON.parse(body.toString("utf8").split("\0").at(-1)!);
    }
    i += n + 12;
  }
  return null;
}
