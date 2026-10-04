// Portable study links. A link carries one notebook's study in the URL
// fragment, which browsers never send to a server:
//
//   ?study=3d#s=<base64url(deflate-raw(JSON))>
//
// The JSON is { v, notebook, study }. This module owns the envelope and the
// validation vocabulary; each notebook's link module (planar-link.ts,
// spatial/link.ts, tesseract/link.ts) conforms its own study, so a notebook's
// definitions load only with that notebook. A link is untrusted input: every
// field is checked against a schema before it reaches the study, and Go
// still validates numerical limits as for typed input.

import type { Pace, Repeat } from "./timing";

export const studyLinkVersion = 1;
export type Notebook = "2d" | "3d" | "4d";
// Encoded fragment and inflated JSON bounds. Presets need about 1.2 KB.
export const maxLinkLength = 32 * 1024;
export const maxStudyBytes = 256 * 1024;
export const maxText = 4000;

// A refusal naming the offending field, or "link" for the envelope.
export class LinkError extends Error {
  constructor(
    public field: string,
    message: string,
  ) {
    super(message);
  }
}
const damaged = () =>
  new LinkError("link", "This link is incomplete or damaged.");

// A schema mirrors a study's type, so tsc fails when a field is added to a
// study without deciding how links validate it. Text is free (an
// expression), options are closed, lists are bounded, and tuples are exact.
export type Schema =
  | "number"
  | "boolean"
  | "text"
  | { options: Record<string, true> }
  | { list: Schema; max: number; fill?: unknown }
  | { tuple: Schema; length: number }
  | { fields: Record<string, Schema> }
  | { optional: Schema; fill?: unknown }
  | { range: [number, number] };
export type SchemaOf<T> = [T] extends [number]
  ? "number" | { range: [number, number] }
  : [T] extends [boolean]
    ? "boolean"
    : [T] extends [string]
      ? string extends T
        ? "text"
        : { options: Record<T, true> }
      : T extends readonly unknown[]
        ? number extends T["length"]
          ? { list: SchemaOf<T[number]>; max: number; fill?: T[number] }
          : { tuple: SchemaOf<T[number]>; length: T["length"] }
        : {
            fields: {
              [K in keyof T]-?: {} extends Pick<T, K>
                ? {
                    optional: SchemaOf<Exclude<T[K], undefined>>;
                    fill?: Exclude<T[K], undefined>;
                  }
                : SchemaOf<T[K]>;
            };
          };

// Boolean flags named by a typed default, such as a notebook's layers.
export const flags = <T extends Record<string, boolean>>(defaults: T) =>
  ({
    fields: Object.fromEntries(
      Object.keys(defaults).map((k) => [k, "boolean"]),
    ),
  }) as { fields: { [K in keyof T]: "boolean" } };

const plain = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const child = (path: string, key: string | number) =>
  typeof key === "number" ? `${path}[${key}]` : path ? `${path}.${key}` : key;

// The value checked against the schema, with fields the link lacks taken
// from the fallback: a link made before a field existed keeps opening.
export function conform<T>(
  value: unknown,
  schema: SchemaOf<T>,
  fallback: T | undefined,
  path: string,
): T;
export function conform(
  value: unknown,
  schema: Schema,
  fallback: unknown,
  path: string,
): unknown {
  const name = path || "study";
  const fail = (message: string): never => {
    throw new LinkError(name, `${name} ${message}.`);
  };
  if (value === undefined) {
    if (fallback === undefined) fail("is missing");
    return structuredClone(fallback);
  }
  if (
    schema === "number" ||
    (typeof schema === "object" && "range" in schema)
  ) {
    if (typeof value !== "number" || !Number.isFinite(value))
      fail("must be a finite number");
    if (typeof schema === "object") {
      const [low, high] = schema.range;
      if ((value as number) < low || (value as number) > high)
        fail(`must be from ${low} to ${high}`);
    }
    return value;
  }
  if (schema === "boolean") {
    if (typeof value !== "boolean") fail("must be true or false");
    return value;
  }
  if (schema === "text") {
    if (typeof value !== "string") fail("must be text");
    if ((value as string).length > maxText)
      fail(`is too long (at most ${maxText} characters)`);
    return value;
  }
  if ("options" in schema) {
    if (typeof value !== "string" || !Object.hasOwn(schema.options, value))
      fail(`must be one of ${Object.keys(schema.options).join(", ")}`);
    return value;
  }
  if ("list" in schema) {
    if (!Array.isArray(value)) fail("must be a list");
    const list = value as unknown[];
    if (list.length > schema.max) fail(`has more than ${schema.max} items`);
    return list.map((item, i) =>
      conform(item, schema.list as never, schema.fill, child(path, i)),
    );
  }
  if ("tuple" in schema) {
    if (!Array.isArray(value) || value.length !== schema.length)
      fail(`must be a list of ${schema.length}`);
    return (value as unknown[]).map((item, i) =>
      conform(
        item,
        schema.tuple as never,
        (fallback as unknown[] | undefined)?.[i],
        child(path, i),
      ),
    );
  }
  if ("optional" in schema) {
    // Reached only through its parent object, which skips absent fields.
    return conform(
      value,
      schema.optional as never,
      fallback ?? schema.fill,
      path,
    );
  }
  if (!plain(value)) fail("must be a group of fields");
  const record = value as Record<string, unknown>;
  for (const key of Object.keys(record))
    if (!Object.hasOwn(schema.fields, key))
      throw new LinkError(
        child(path, key),
        `${child(path, key)} is not a known field.`,
      );
  const out: Record<string, unknown> = {};
  const defaults = plain(fallback) ? fallback : undefined;
  for (const [key, field] of Object.entries(schema.fields)) {
    const optional = typeof field === "object" && "optional" in field;
    if (optional && record[key] === undefined) continue;
    out[key] = conform(
      record[key],
      field as never,
      defaults?.[key],
      child(path, key),
    );
  }
  return out;
}

// Base64url without padding, as the fragment's alphabet.
function encode(bytes: Uint8Array) {
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000)
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}
function decode(text: string) {
  if (!/^[A-Za-z0-9_-]+$/.test(text)) throw damaged();
  try {
    const binary = atob(text.replace(/-/g, "+").replace(/_/g, "/"));
    return Uint8Array.from(binary, (c) => c.charCodeAt(0));
  } catch {
    throw damaged();
  }
}
async function collect(
  stream: ReadableStream<Uint8Array>,
  limit: number,
): Promise<Uint8Array> {
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > limit) {
      void reader.cancel();
      throw new LinkError("link", "This link's study is too large to open.");
    }
    chunks.push(value);
  }
  const out = new Uint8Array(size);
  let at = 0;
  for (const c of chunks) {
    out.set(c, at);
    at += c.byteLength;
  }
  return out;
}
const pipe = (
  bytes: Uint8Array,
  transform: CompressionStream | DecompressionStream,
) => new Blob([bytes as BlobPart]).stream().pipeThrough(transform);

// The fragment token for a study. Refused when the link would be too long.
export async function writeStudyLink(
  notebook: Notebook,
  study: unknown,
): Promise<string> {
  const json = JSON.stringify({ v: studyLinkVersion, notebook, study });
  const packed = await collect(
    pipe(new TextEncoder().encode(json), new CompressionStream("deflate-raw")),
    Infinity,
  );
  const token = encode(packed);
  if (token.length > maxLinkLength)
    throw new LinkError(
      "link",
      "This study is too large to share as a link. Shorten its expressions or remove list items.",
    );
  return token;
}

// The notebook and its still-unchecked study, from a fragment token.
export async function readStudyLink(
  token: string,
): Promise<{ notebook: Notebook; study: unknown }> {
  if (token.length > maxLinkLength)
    throw new LinkError("link", "This link is too long to open.");
  const bytes = decode(token);
  let json: unknown;
  try {
    const text = await collect(
      pipe(bytes, new DecompressionStream("deflate-raw")),
      maxStudyBytes,
    );
    json = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(text));
  } catch (e) {
    if (e instanceof LinkError) throw e;
    throw damaged();
  }
  if (!plain(json)) throw damaged();
  const { v, notebook, study } = json;
  if (typeof v !== "number" || !Number.isInteger(v) || v < 1) throw damaged();
  if (v > studyLinkVersion)
    throw new LinkError(
      "link",
      "This link was made by a newer version of Tangent Garden. Reload the page to update it.",
    );
  if (notebook !== "2d" && notebook !== "3d" && notebook !== "4d")
    throw new LinkError("notebook", "This link names an unknown notebook.");
  if (study === undefined)
    throw new LinkError("study", "This link has no study.");
  return { notebook, study };
}

// The token of a location's `#s=` fragment, if any.
export const linkToken = (hash: string) => /^#s=(.*)$/.exec(hash)?.[1] ?? null;

// A shareable address: this page, its notebook, and the study token.
export function studyHref(href: string, notebook: Notebook, token: string) {
  const url = new URL(href);
  if (notebook === "2d") url.searchParams.delete("study");
  else url.searchParams.set("study", notebook);
  url.hash = `s=${token}`;
  return url.href;
}

// A notebook's animation setup. Playback position and export settings are
// transient and stay out of links.
export type AnimationSettings<Mode extends string, Target extends string> = {
  mode: Mode;
  camera: "hold" | "current" | "follow" | "fit";
  duration: number;
  tracks: { target: Target; from: string; to: string }[];
};
export const cameraModes = {
  hold: true,
  current: true,
  follow: true,
  fit: true,
} satisfies Record<AnimationSettings<string, string>["camera"], true>;
export const durationRange: [number, number] = [0.1, 3600];
// Tracks name targets the study offers, each at most once. Their endpoints
// are text, resolved by Go like typed endpoints.
export function animationSettings<Mode extends string, Target extends string>(
  value: unknown,
  modes: Record<Mode, true>,
  targets: readonly Target[],
  fallback: AnimationSettings<Mode, Target>,
): AnimationSettings<Mode, Target> {
  const settings = conform<AnimationSettings<string, string>>(
    value,
    {
      fields: {
        // Typed as text here; the options still close the set.
        mode: { options: modes } as never,
        camera: { options: cameraModes },
        duration: { range: durationRange },
        tracks: {
          list: { fields: { target: "text", from: "text", to: "text" } },
          max: Math.max(1, targets.length),
        },
      },
    },
    fallback,
    "animation",
  );
  const seen = new Set<string>();
  settings.tracks.forEach(({ target }, i) => {
    const field = `animation.tracks[${i}].target`;
    if (!(targets as readonly string[]).includes(target))
      throw new LinkError(field, `${field} is not available in this study.`);
    if (seen.has(target))
      throw new LinkError(field, `${field} animates ${target} twice.`);
    seen.add(target);
  });
  return settings as AnimationSettings<Mode, Target>;
}

// How an animation spends its duration (see timing.ts), shared by every
// notebook. Links made before it play once, steadily.
export type Timing = { repeat: Repeat; pace: Pace };
export const defaultTiming: Timing = { repeat: "once", pace: "steady" };
const timingSchema: SchemaOf<Timing> = {
  fields: {
    repeat: { options: { once: true, loop: true, "back-and-forth": true } },
    pace: { options: { steady: true, ease: true } },
  },
};
// The repeat and pace among a group's fields at path; one left out takes
// its default. The notebook decides which motions can loop.
export function animationTiming(
  raw: { repeat?: unknown; pace?: unknown },
  path: string,
): Timing {
  return conform(
    {
      ...(raw.repeat !== undefined && { repeat: raw.repeat }),
      ...(raw.pace !== undefined && { pace: raw.pace }),
    },
    timingSchema,
    defaultTiming,
    path,
  );
}

// A link handed to a notebook: its unchecked study, or why it was refused.
// The id distinguishes links opened one after another in the same page.
export type SharedStudy = { id: number } & (
  { study: unknown; error?: undefined } | { error: string; study?: undefined }
);
