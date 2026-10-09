// The large numeric arrays of a spatial or 4D result cross from Go as one
// Float64Array rather than as JSON (cmd/wasm/lift): copying their float64
// bytes costs far less than writing them as text in Go and parsing them
// here. restore puts each back where JSON would have put it, as the same
// values, so nothing that reads a result changes.

// Mirrors cmd/wasm/lift.Place: where a lifted array goes back. A "point"
// is {x, y, z} or null (three NaN), a "vector" {x, y, z}, a "triple"
// [x, y, z], a "quad" [x, y, z, w], a "number" a number, and a "maybe" a
// number or null (NaN). An array of arrays has rows, each row's length,
// -1 for null; any other array has count.
export type Place = {
  path: (string | number)[];
  kind: "point" | "vector" | "triple" | "quad" | "number" | "maybe";
  offset: number;
  count?: number;
  rows?: number[];
};

// What the worker passes with a result: the floats, and the places as
// JSON.
export type Lifted = { floats: Float64Array; places: string };

const width = { point: 3, vector: 3, triple: 3, quad: 4, number: 1, maybe: 1 };

// The n items of kind starting at float at.
function items(
  floats: Float64Array,
  kind: Place["kind"],
  at: number,
  n: number,
) {
  const out: unknown[] = new Array(n);
  switch (kind) {
    case "point":
    case "vector":
      for (let k = 0; k < n; k++, at += 3) {
        const x = floats[at];
        // JSON has no NaN, so a NaN can only mark a missing point.
        out[k] =
          kind === "point" && Number.isNaN(x)
            ? null
            : { x, y: floats[at + 1], z: floats[at + 2] };
      }
      break;
    case "triple":
      for (let k = 0; k < n; k++, at += 3)
        out[k] = [floats[at], floats[at + 1], floats[at + 2]];
      break;
    case "quad":
      for (let k = 0; k < n; k++, at += 4)
        out[k] = [floats[at], floats[at + 1], floats[at + 2], floats[at + 3]];
      break;
    case "number":
      for (let k = 0; k < n; k++) out[k] = floats[at + k];
      break;
    case "maybe":
      for (let k = 0; k < n; k++) {
        const x = floats[at + k];
        out[k] = Number.isNaN(x) ? null : x;
      }
      break;
  }
  return out;
}

// Puts every lifted array back into result, in place, and returns it. A
// place holds null in the JSON, or for a field left out when empty, no key.
export function restore<T>(result: T, lifted: Lifted | undefined): T {
  if (!lifted) return result;
  const { floats } = lifted;
  for (const p of JSON.parse(lifted.places) as Place[]) {
    let value: unknown;
    if (p.rows) {
      let at = p.offset;
      value = p.rows.map((n) => {
        if (n < 0) return null;
        const row = items(floats, p.kind, at, n);
        at += width[p.kind] * n;
        return row;
      });
    } else value = items(floats, p.kind, p.offset, p.count ?? 0);
    let parent: any = result;
    for (const key of p.path.slice(0, -1)) parent = parent[key];
    parent[p.path[p.path.length - 1]] = value;
  }
  return result;
}
