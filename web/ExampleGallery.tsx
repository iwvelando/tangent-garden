import type { ColorScheme } from "./color-schemes";
import { useTheme } from "./useTheme";
import {
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
} from "react";
import { plotPalette } from "./palette";
import { useQuietFocus } from "./quiet-focus";
import { journeys, type Journey } from "./journeys";
import "./gallery.css";
import "./journey.css";

// A notebook example as the gallery shows it. The fingerprint identifies the
// definition a thumbnail was drawn from, so an edited preset never shows an
// outdated picture.
export type Example = {
  title: string;
  caption: string;
  family: string;
  // Extra words search matches, such as the curve's format.
  keywords: string;
  fingerprint: string;
};

// A thumbnail is either the plot's own SVG, with colors recorded by role, or
// a pair of raster images, one per theme, for drawings SVG cannot carry.
export type Thumbnail =
  | { kind: "svg"; markup: string }
  | { kind: "image"; light: string; dark: string };
export type ThumbnailSource = (
  example: Example,
) => Promise<Thumbnail | undefined>;

// FNV-1a over the definition's JSON. scripts/build-thumbnails.mjs records it
// beside each thumbnail it draws.
export function fingerprint(value: unknown) {
  let h = 0x811c9dc5;
  for (const c of JSON.stringify(value)) {
    h ^= c.codePointAt(0)!;
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, "0");
}

export const slug = (title: string) =>
  title
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");

const words = (s: string) => s.toLowerCase().split(/\s+/).filter(Boolean);

// Examples of a mode that opens over the notebook's study.
type Overlay = {
  examples: Example[];
  open: (
    index: number,
    restoreFocus: (via: "keyboard" | "pointer") => void,
    via: "keyboard" | "pointer",
  ) => void;
};
type EntryKind = "curve" | "loom" | "garden";

export function ExampleGallery({
  examples,
  current,
  onChoose,
  thumbnail,
  dark,
  onJourney,
  onBrowse,
  looms,
  gardens,
}: {
  examples: Example[];
  // null while the study is the reader's own.
  current: number | null;
  onChoose: (index: number) => void;
  thumbnail: ThumbnailSource;
  dark: boolean;
  onJourney?: (
    journey: Journey,
    restoreFocus: (via: "keyboard" | "pointer") => void,
    via: "keyboard" | "pointer",
  ) => void;
  onBrowse?: () => void;
  // Examples that open the complex loom over the study instead of replacing
  // it. They join the families, search and thumbnails, but not the
  // previous/next steps through the notebook's own examples.
  looms?: Overlay;
  // Examples that open the Apollonian garden over the study, likewise.
  gardens?: Overlay;
}) {
  const { scheme } = useTheme();
  const wrap = useRef<HTMLDivElement>(null);
  const quiet = useQuietFocus(wrap);
  const via = useRef<"keyboard" | "pointer">("keyboard");
  const dialog = useRef<HTMLDialogElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const search = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [family, setFamily] = useState<string | null>(null);
  const currentId = useId();
  const entries = useMemo(
    () => [
      ...examples.map((example, index) => ({
        example,
        index,
        kind: "curve" as EntryKind,
      })),
      ...(looms?.examples ?? []).map((example, index) => ({
        example,
        index,
        kind: "loom" as EntryKind,
      })),
      ...(gardens?.examples ?? []).map((example, index) => ({
        example,
        index,
        kind: "garden" as EntryKind,
      })),
    ],
    [examples, looms?.examples, gardens?.examples],
  );
  const families = useMemo(
    () => [...new Set(entries.map((e) => e.example.family))],
    [entries],
  );
  const matches = useMemo(() => {
    const terms = words(query);
    return entries.filter(
      ({ example: e }) =>
        (family === null || e.family === family) &&
        terms.every((t) =>
          `${e.title} ${e.caption} ${e.family} ${e.keywords}`
            .toLowerCase()
            .includes(t),
        ),
    );
  }, [entries, query, family]);
  // Grouped by family, keeping preset order within each.
  const groups = families
    .map((f) => ({
      family: f,
      items: matches.filter((m) => m.example.family === f),
    }))
    .filter((g) => g.items.length > 0);

  const show = () => {
    onBrowse?.();
    quiet.quiet();
    setQuery("");
    setFamily(null);
    setOpen(true);
    dialog.current?.showModal();
  };
  // Focus goes to search where a keyboard is likely; on touch screens it
  // would raise the on-screen keyboard over the pictures.
  useEffect(() => {
    if (!open) return;
    if (matchMedia("(pointer: fine)").matches) search.current?.focus();
    dialog.current
      ?.querySelector('[aria-current="true"]')
      ?.scrollIntoView({ block: "center" });
  }, [open]);
  // Marks each end of the journey row that has more to scroll to, so only
  // that end fades.
  const journeyRow = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const row = journeyRow.current;
    if (!row) return;
    const edges = () => {
      const end = row.scrollWidth - row.clientWidth;
      row.toggleAttribute("data-more-start", row.scrollLeft > 1);
      row.toggleAttribute("data-more-end", row.scrollLeft < end - 1);
    };
    edges();
    row.addEventListener("scroll", edges, { passive: true });
    const resize = new ResizeObserver(edges);
    resize.observe(row);
    for (const button of row.children) resize.observe(button);
    return () => {
      row.removeEventListener("scroll", edges);
      resize.disconnect();
    };
  }, [open]);
  const close = () => dialog.current?.close();
  const choose = (index: number) => {
    onChoose(index);
    close();
  };
  const openOverlay = (kind: EntryKind, index: number) => {
    close();
    (kind === "loom" ? looms : gardens)?.open(
      index,
      (returnVia) => {
        via.current = returnVia;
        if (returnVia === "pointer") quiet.onPointerDown();
        else quiet.onKeyDownCapture();
        quiet.quiet();
        trigger.current?.focus();
      },
      via.current,
    );
  };
  const step = (by: number) => {
    const n = examples.length;
    onChoose(current === null ? (by > 0 ? 0 : n - 1) : (current + by + n) % n);
  };

  // Arrow keys move between visible cards: left and right in reading order,
  // up and down to the nearest card in the adjacent row.
  const move = (e: KeyboardEvent<HTMLDivElement>) => {
    const cards = [
      ...e.currentTarget.querySelectorAll<HTMLButtonElement>(".example-card"),
    ];
    const from = cards.indexOf(document.activeElement as HTMLButtonElement);
    if (from < 0) return;
    let to: HTMLButtonElement | undefined;
    if (e.key === "ArrowRight") to = cards[from + 1];
    else if (e.key === "ArrowLeft") to = cards[from - 1];
    else if (e.key === "Home") to = cards[0];
    else if (e.key === "End") to = cards[cards.length - 1];
    else if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      const box = cards[from].getBoundingClientRect();
      const down = e.key === "ArrowDown";
      let best = Infinity;
      for (const card of cards) {
        const b = card.getBoundingClientRect();
        const dy = down ? b.top - box.bottom : box.top - b.bottom;
        if (dy < 0) continue;
        const d = dy * 4 + Math.abs(b.left - box.left);
        if (d < best) [best, to] = [d, card];
      }
    } else return;
    e.preventDefault();
    to?.focus();
  };

  const currentExample = current === null ? undefined : examples[current];
  return (
    <div
      className="example-picker"
      ref={wrap}
      onPointerDown={() => {
        via.current = "pointer";
        quiet.onPointerDown();
      }}
      onKeyDownCapture={() => {
        via.current = "keyboard";
        quiet.onKeyDownCapture();
      }}
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget)) quiet.ring();
      }}
    >
      <button
        ref={trigger}
        type="button"
        className="example-trigger"
        aria-haspopup="dialog"
        aria-label="Browse notebook examples"
        aria-describedby={currentId}
        onClick={show}
      >
        <ExampleThumb
          example={currentExample}
          source={thumbnail}
          dark={dark}
          scheme={scheme}
          eager
        />
        <span className="example-trigger-text">
          <span className="example-kicker">Example</span>
          <span className="example-current" id={currentId}>
            {currentExample?.title ?? "Custom study"}
          </span>
          <span className="example-browse">
            Browse all {entries.length} <span aria-hidden="true">→</span>
          </span>
        </span>
      </button>
      <div className="example-step">
        <button
          type="button"
          aria-label="Previous example"
          onClick={() => step(-1)}
        >
          ‹
        </button>
        <button type="button" aria-label="Next example" onClick={() => step(1)}>
          ›
        </button>
      </div>
      <dialog
        ref={dialog}
        className="gallery"
        aria-labelledby={`${currentId}-title`}
        onClose={() => {
          setOpen(false);
          quiet.quiet();
          trigger.current?.focus();
        }}
        // A click on the backdrop lands on the dialog itself.
        onClick={(e) => {
          if (e.target === e.currentTarget) close();
        }}
      >
        {open && (
          <div className="gallery-body">
            <div className="gallery-head">
              <h2 id={`${currentId}-title`}>Notebook examples</h2>
              <input
                ref={search}
                type="search"
                className="gallery-search"
                aria-label="Search examples"
                placeholder="Search examples"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && matches.length > 0) {
                    e.preventDefault();
                    const top = groups[0].items[0];
                    if (top.kind === "curve") choose(top.index);
                    else openOverlay(top.kind, top.index);
                  }
                }}
              />
              <button
                type="button"
                className="gallery-close"
                aria-label="Close"
                onClick={close}
              >
                ×
              </button>
            </div>
            {onJourney && (
              <div
                className="gallery-journeys"
                role="group"
                aria-labelledby={`${currentId}-journeys`}
                aria-describedby={`${currentId}-journeys-note`}
              >
                <span id={`${currentId}-journeys`} className="example-kicker">
                  Try a guided journey
                </span>
                {/* Outside the scrolling row, so it is never scrolled away. */}
                <span id={`${currentId}-journeys-note`} className="note">
                  Previewing keeps your work
                </span>
                {/* One scrolling row, however many journeys there are.
                    Browsers scroll a focused button only when it is wholly
                    hidden, so a partly visible one is brought fully in. */}
                <div
                  ref={journeyRow}
                  className="gallery-journey-list"
                  onFocus={(e) =>
                    e.target.scrollIntoView({
                      block: "nearest",
                      inline: "nearest",
                    })
                  }
                >
                  {journeys.map((journey) => (
                    <button
                      key={journey.title}
                      onClick={() => {
                        close();
                        onJourney(
                          journey,
                          (returnVia) => {
                            via.current = returnVia;
                            if (returnVia === "pointer") quiet.onPointerDown();
                            else quiet.onKeyDownCapture();
                            quiet.quiet();
                            trigger.current?.focus();
                          },
                          via.current,
                        );
                      }}
                    >
                      {journey.title}
                    </button>
                  ))}
                </div>
              </div>
            )}
            <div
              className="gallery-families"
              role="group"
              aria-label="Example family"
            >
              {[null, ...families].map((f) => (
                <button
                  key={f ?? ""}
                  type="button"
                  aria-pressed={family === f}
                  onClick={() => setFamily(f)}
                >
                  {f ?? "All"}{" "}
                  <small>
                    {f === null
                      ? entries.length
                      : entries.filter((e) => e.example.family === f).length}
                  </small>
                </button>
              ))}
            </div>
            <div className="gallery-grid-wrap" onKeyDown={move}>
              {groups.length === 0 && (
                <p className="gallery-empty">
                  No examples match &ldquo;{query}&rdquo;.
                </p>
              )}
              {groups.map((g) => (
                <section key={g.family} aria-label={g.family}>
                  <h3>{g.family}</h3>
                  <div className="gallery-grid">
                    {g.items.map(({ example, index, kind }) => (
                      <button
                        key={`${kind[0]}${index}`}
                        type="button"
                        className="example-card"
                        data-example={kind === "curve" ? index : undefined}
                        data-loom-example={kind === "loom" ? index : undefined}
                        data-garden-example={
                          kind === "garden" ? index : undefined
                        }
                        data-example-title={example.title}
                        data-example-slug={slug(example.title)}
                        data-fingerprint={example.fingerprint}
                        aria-current={
                          kind === "curve" && index === current
                            ? "true"
                            : undefined
                        }
                        aria-label={example.title}
                        aria-describedby={`${currentId}-${kind[0]}${index}`}
                        onClick={() =>
                          kind === "curve"
                            ? choose(index)
                            : openOverlay(kind, index)
                        }
                      >
                        <ExampleThumb
                          example={example}
                          source={thumbnail}
                          dark={dark}
                          scheme={scheme}
                        />
                        <span className="example-card-title">
                          {example.title}
                        </span>
                        <span
                          className="example-card-caption"
                          id={`${currentId}-${kind[0]}${index}`}
                        >
                          {example.caption}
                        </span>
                      </button>
                    ))}
                  </div>
                </section>
              ))}
            </div>
          </div>
        )}
      </dialog>
    </div>
  );
}

// Thumbnails load once they near the screen, and each is kept once loaded.
const loaded = new Map<string, Promise<Thumbnail | undefined>>();

function ExampleThumb({
  example,
  source,
  dark,
  scheme,
  eager,
}: {
  example?: Example;
  source: ThumbnailSource;
  dark: boolean;
  scheme: ColorScheme;
  eager?: boolean;
}) {
  const box = useRef<HTMLSpanElement>(null);
  const [thumb, setThumb] = useState<Thumbnail | null | undefined>(null);
  const [near, setNear] = useState(!!eager);
  useEffect(() => {
    if (near || !box.current) return;
    const seen = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) setNear(true);
      },
      { rootMargin: "300px" },
    );
    seen.observe(box.current);
    return () => seen.disconnect();
  }, [near]);
  useEffect(() => {
    setThumb(null);
    if (!example || !near) return;
    const key = example.fingerprint;
    if (!loaded.has(key))
      loaded.set(
        key,
        source(example).catch(() => undefined),
      );
    let live = true;
    void loaded.get(key)!.then((t) => live && setThumb(t));
    return () => {
      live = false;
    };
  }, [example, near, source]);
  // The thumbnail's colors follow the theme through the plot's palette.
  const palette = plotPalette(dark, scheme);
  const style = Object.fromEntries(
    Object.entries(palette).map(([role, value]) => [`--tg-${role}`, value]),
  ) as CSSProperties;
  const state = !example
    ? "custom"
    : thumb === null
      ? "loading"
      : thumb === undefined
        ? "missing"
        : "ready";
  return (
    <span
      ref={box}
      className="example-thumb"
      data-state={state}
      style={style}
      aria-hidden="true"
    >
      {thumb?.kind === "svg" && (
        <span
          className="example-thumb-art"
          dangerouslySetInnerHTML={{ __html: thumb.markup }}
        />
      )}
      {thumb?.kind === "image" && (
        <img src={dark ? thumb.dark : thumb.light} alt="" decoding="async" />
      )}
      {state === "custom" && <span className="example-thumb-glyph">✎</span>}
    </span>
  );
}
