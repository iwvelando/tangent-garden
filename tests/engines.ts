import type { Page } from "@playwright/test";

// One entry per engine worker the page creates, in order of creation: how
// many requests of each action it received, the first request of each, and
// whether it was terminated.
export type EngineLog = {
  sent: Record<string, number>;
  first: Record<string, any>;
  terminated: boolean;
};

// Numbers each engine worker and records its requests and termination, with
// the core count the browser reports. Requests of an action in `slow` reach
// the worker that many milliseconds late, standing in for a study slow to
// calculate (each engine's requests keep their order). Call before the page
// loads.
export async function watchEngines(
  page: Page,
  cores: number,
  slow: Record<string, number> = {},
) {
  await page.addInitScript(
    ({ cores, slow }) => {
      Object.defineProperty(navigator, "hardwareConcurrency", {
        get: () => cores,
      });
      const log: EngineLog[] = [];
      (window as any).engines = log;
      const Base = window.Worker;
      window.Worker = class extends Base {
        private entry: EngineLog = { sent: {}, first: {}, terminated: false };
        constructor(...args: ConstructorParameters<typeof Worker>) {
          super(...args);
          log.push(this.entry);
        }
        terminate() {
          this.entry.terminated = true;
          super.terminate();
        }
        postMessage(message: any, ...rest: any[]) {
          const action = message?.action;
          if (typeof action === "string") {
            this.entry.sent[action] = (this.entry.sent[action] ?? 0) + 1;
            if (!(action in this.entry.first))
              this.entry.first[action] = structuredClone(message);
          }
          const send = () => (super.postMessage as any)(message, ...rest);
          if (slow[action]) setTimeout(send, slow[action]);
          else send();
        }
      };
    },
    { cores, slow },
  );
}

export const engines = (page: Page): Promise<EngineLog[]> =>
  page.evaluate(() => structuredClone((window as any).engines));
