import { EngineError } from "./engine-client";

export type AtlasSize = 3 | 5;
// A whole-number axis takes exactly evenly spaced whole numbers, never
// continuous values rounded; its endpoints must differ by a multiple of the
// grid's steps.
export type AtlasAxis = {
  key: string;
  label: string;
  symbol: string;
  path: readonly (string | number)[];
  integer?: boolean;
};
export type AtlasRanges = Record<string, [number, number]>;
export type AtlasCell<F> = {
  values: [number, number];
  frame?: F;
  error?: string;
};
export type AtlasState<F> = {
  cells: AtlasCell<F>[];
  selection: { index: number; frame?: F; error?: string } | null;
  queued: number;
  error?: string;
  failed?: string;
};

// Remove only rounding-sized tails in generated values. Carry the operand
// scale: cancellation in 1.15 - 1 leaves more uncertainty than epsilon times
// its small result. Interpolation uses its endpoint scale for the same reason.
// Never apply this to the source, copied/entered endpoints, or raw scalar text.
export function roundedGenerated(value: number, scale: number) {
  if (!Number.isFinite(value) || value === 0) return value;
  for (let digits = 1; digits <= 16; digits++) {
    const short = Number(value.toPrecision(digits));
    if (
      Number.isFinite(short) &&
      Math.abs(short - value) <=
        Number.EPSILON * Math.max(Math.abs(value), scale)
    )
      return short;
  }
  return value;
}
export function roundedRange(
  from: number,
  to: number,
  scale: number,
): [number, number] {
  const cleaned: [number, number] = [
    roundedGenerated(from, scale),
    roundedGenerated(to, scale),
  ];
  // Do not collapse distinct subnormal endpoints or repair an invalid range.
  return cleaned[0] < cleaned[1] ? cleaned : [from, to];
}
export const whole = (v: number) => Number.isSafeInteger(v);

// Field errors on a pair's ranges, naming the endpoint at fault.
export function axisRangeError(
  ranges: AtlasRanges,
  axes: readonly AtlasAxis[],
  size: AtlasSize,
) {
  for (const { key, label: name, integer } of axes) {
    const [from, to] = ranges[key] ?? [NaN, NaN];
    const lower = name.toLowerCase();
    if (integer) {
      if (!whole(from))
        return {
          label: `${name} from`,
          message: `${name} from must be a whole number.`,
        };
      if (!whole(to) || to <= from)
        return {
          label: `${name} to`,
          message: `${name} to must be a whole number greater than ${lower} from.`,
        };
      // Exact: the difference of safe integers can exceed 2^53.
      if ((BigInt(to) - BigInt(from)) % BigInt(size - 1))
        return {
          label: `${name} to`,
          message: `${name} to must exceed ${lower} from by a multiple of ${size - 1}, so every grid value is a whole number.`,
        };
      continue;
    }
    if (!Number.isFinite(from))
      return {
        label: `${name} from`,
        message: `${name} from must be a finite constant.`,
      };
    if (!Number.isFinite(to) || to <= from)
      return {
        label: `${name} to`,
        message: `${name} to must be finite and greater than ${lower} from.`,
      };
  }
  return null;
}

export function axisField(config: object, axis: AtlasAxis): number {
  return axis.path.reduce<any>((v, key) => v[key], config);
}
function setField(config: object, axis: AtlasAxis, value: number) {
  const owner = axis.path.slice(0, -1).reduce<any>((v, key) => v[key], config);
  owner[axis.path.at(-1)!] = value;
}
// Inclusive interpolation avoids overflow in b-a. Only the center snaps to
// the frozen value within rounding at the scale of it and the endpoints.
// Endpoint arithmetic matters for a small pole coordinate between ±1: using
// only the coordinate's magnitude loses an otherwise symmetric center.
export function axisValues(
  [a, b]: [number, number],
  current: number,
  size: AtlasSize,
  integer?: boolean,
) {
  // Validated whole endpoints whose difference divides: exact, in integer
  // arithmetic, since b − a and its multiples can exceed 2^53. Every value
  // lies between the safe endpoints, so it converts back exactly.
  if (integer)
    return Array.from({ length: size }, (_, i) =>
      Number(
        BigInt(a) + (BigInt(i) * (BigInt(b) - BigInt(a))) / BigInt(size - 1),
      ),
    );
  return Array.from({ length: size }, (_, i) => {
    if (i === 0) return a;
    if (i === size - 1) return b;
    const p = i / (size - 1);
    const value = (1 - p) * a + p * b;
    return i === (size - 1) / 2 &&
      Math.abs(value - current) <=
        Number.EPSILON * Math.max(Math.abs(current), Math.abs(a), Math.abs(b))
      ? current
      : roundedGenerated(value, Math.max(Math.abs(a), Math.abs(b)));
  });
}

export const maxAtlasNumbers = 4000000;
// Bound delivered geometry as well as the preflight reservation: a result
// includes diagnostics, representative circles and refinement breaks too.
// A typed array (a spatial mesh) counts its entries without visiting them.
export function atlasNumbers(value: unknown): number {
  if (typeof value === "number") return 1;
  if (!value || typeof value !== "object") return 0;
  if (ArrayBuffer.isView(value))
    return value instanceof DataView ? value.byteLength : (value as any).length;
  return Object.values(value).reduce<number>((n, v) => n + atlasNumbers(v), 0);
}

/** One caller-owned worker, one numerical request, at most twenty-five grid
 * outcomes and one inspection. A generation invalidates delivery, not just
 * what is painted. A selection has priority over unsent cells; repeated
 * selections coalesce. Subclasses own their catalog, admission and request.
 */
export abstract class AtlasQueue<
  S extends { config: object },
  F,
  V = undefined,
> {
  state: AtlasState<F> = { cells: [], selection: null, queued: 0 };
  protected source: S | null = null;
  protected axes: readonly [AtlasAxis, AtlasAxis] | null = null;
  protected size: AtlasSize = 3;
  private generation = 0;
  private choice = 0;
  private working = false;
  private failed?: string;
  private remaining: number[] = [];
  private wanted: { index: number; choice: number; view?: V } | null = null;
  private retained = new Map<number, number>();
  constructor(
    private worker: { dispose?: () => void },
    private changed: (state: AtlasState<F>) => void,
  ) {}
  // The request for one variant: a preview, or the original-quality
  // inspection (selection), possibly refined to a view.
  protected abstract request(
    study: S,
    index: number,
    selection: { view?: V } | null,
  ): Promise<F>;
  // The geometry of a delivered frame, which the retained-number limit counts.
  protected abstract geometry(frame: F): unknown;
  private emit() {
    this.state = {
      ...this.state,
      queued: this.remaining.length + (this.wanted ? 1 : 0),
    };
    this.changed(this.state);
  }
  cancel() {
    this.generation++;
    this.choice++;
    this.remaining = [];
    this.wanted = null;
    this.source = null;
    this.retained.clear();
    this.state = {
      cells: [],
      selection: null,
      queued: 0,
      ...(this.failed && { error: this.failed, failed: this.failed }),
    };
    this.emit();
  }
  // Generation starts over: an earlier failure, or the caller's admission
  // error, refuses it; otherwise every cell is queued in row-major order.
  protected begin(
    study: S,
    axes: readonly [AtlasAxis, AtlasAxis],
    ranges: AtlasRanges,
    size: AtlasSize,
    error: () => string | undefined,
  ) {
    this.cancel();
    const refusal = this.failed ?? error();
    if (refusal) {
      this.state = { ...this.state, error: refusal };
      this.emit();
      return;
    }
    this.source = structuredClone(study);
    this.axes = axes;
    this.size = size;
    this.state = {
      cells: axisValues(
        ranges[axes[1].key],
        axisField(study.config, axes[1]),
        size,
        axes[1].integer,
      ).flatMap((y) =>
        axisValues(
          ranges[axes[0].key],
          axisField(study.config, axes[0]),
          size,
          axes[0].integer,
        ).map((x) => ({ values: [x, y] as [number, number] })),
      ),
      selection: null,
      queued: 0,
    };
    this.remaining = this.state.cells.map((_, i) => i);
    this.emit();
    this.pump();
  }
  inspect(index: number, view?: V) {
    const cell = this.state.cells[index];
    if (!cell?.frame || !this.source) return;
    this.wanted = { index, choice: ++this.choice, view };
    this.state = { ...this.state, selection: { index } };
    this.retained.delete(-1);
    this.emit();
    this.pump();
  }
  candidate(): S | null {
    const selection = this.state.selection;
    if (!selection?.frame || !this.source) return null;
    return this.variant(selection.index);
  }
  protected variant(index: number) {
    const study = structuredClone(this.source!);
    this.axes!.forEach((axis, i) =>
      setField(study.config, axis, this.state.cells[index].values[i]),
    );
    return study;
  }
  private pump() {
    if (this.working || !this.source) return;
    const selection = this.wanted;
    const index = selection?.index ?? this.remaining.shift();
    if (index === undefined) return;
    this.wanted = null;
    const generation = this.generation;
    const study = this.variant(index);
    this.working = true;
    this.emit();
    const current = () =>
      generation === this.generation &&
      (!selection || selection.choice === this.choice);
    const refuse = (message: string) => {
      if (selection)
        this.state = { ...this.state, selection: { index, error: message } };
      else
        this.state = {
          ...this.state,
          cells: this.state.cells.map((cell, i) =>
            i === index ? { ...cell, error: message } : cell,
          ),
        };
    };
    void this.request(study, index, selection && { view: selection.view })
      .then(
        (frame) => {
          if (!current()) return;
          const count = atlasNumbers(this.geometry(frame));
          const total =
            [...this.retained.values()].reduce((a, b) => a + b, 0) + count;
          if (total > maxAtlasNumbers) {
            refuse(
              "The atlas geometry limit was reached. Reduce the study’s quality and try again.",
            );
            return;
          }
          this.retained.set(selection ? -1 : index, count);
          // Ownership crosses this boundary once; no result or caller-supplied
          // config can mutate another candidate or the frozen source.
          const own = structuredClone(frame);
          if (selection)
            this.state = { ...this.state, selection: { index, frame: own } };
          else
            this.state = {
              ...this.state,
              cells: this.state.cells.map((cell, i) =>
                i === index ? { ...cell, frame: own } : cell,
              ),
            };
        },
        (error: Error) => {
          // Go refuses a cell with an EngineError. Anything else is the worker
          // failing: a request deadline does not stop synchronous Go work, so
          // never send another cell behind that computation, even after
          // regeneration.
          if (!(error instanceof EngineError)) {
            this.failed = `The atlas’s numerical engine stopped: ${error.message} Close the atlas and reopen it to continue.`;
            this.remaining = [];
            this.wanted = null;
            this.source = null;
            // Reported even when an edit already canceled this generation.
            this.state = {
              ...this.state,
              selection: null,
              error: this.failed,
              failed: this.failed,
            };
            this.emit();
            this.worker.dispose?.();
            return;
          }
          if (current()) refuse(error.message);
        },
      )
      .finally(() => {
        this.working = false;
        if (current()) this.emit();
        this.pump();
      });
  }
}
