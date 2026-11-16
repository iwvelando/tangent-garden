// The atlas dialog's shell, shared by the planar (AtlasPreview.tsx) and 3D
// (spatial/AtlasPreview.tsx) atlases: the modal's opening, focus and phone
// viewport fit, the grid/variant tabs, keyboard movement between cells, and
// the range fields with their scalar evaluation.
import {
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type RefObject,
} from "react";
import type { AtlasAxis, AtlasRanges } from "./atlas-queue";
import { atlasRangeHelp, atlasWholeRangeHelp } from "./atlas";
import {
  emptyPath,
  maxPathStops,
  pathError,
  removeStop,
  stepSeconds,
  type AtlasPath,
} from "./atlas-path";
import type { EngineClient } from "./engine-client";
import { CheckSetting, Field, FieldErrorContext } from "./Field";
import type { JourneyVia } from "./JourneyContext";
import type { useQuietFocus } from "./quiet-focus";
import { ScalarInput, ScalarStatus, type ScalarState } from "./ScalarInput";

export type AtlasTab = "grid" | "variant";

// Open as a modal over an inert page, focus Cancel, and fit the phone's
// visual viewport above its keyboard, scrolling only the dialog's contents.
export function useAtlasModal(
  dialog: RefObject<HTMLDialogElement | null>,
  back: RefObject<HTMLButtonElement | null>,
  via: JourneyVia,
  quiet: ReturnType<typeof useQuietFocus>,
) {
  useLayoutEffect(() => {
    const root = document.documentElement;
    const { scrollX: x, scrollY: y } = window;
    root.classList.add("atlas-open");
    return () => {
      root.classList.remove("atlas-open");
      if (window.scrollX !== x || window.scrollY !== y) window.scrollTo(x, y);
    };
  }, []);
  useEffect(() => {
    if (via === "pointer") quiet.onPointerDown();
    dialog.current!.showModal();
    quiet.quiet();
    back.current!.focus();
  }, []);
  useEffect(() => {
    const viewport = window.visualViewport;
    const box = dialog.current!;
    if (!viewport) return;
    const phone = matchMedia("(max-width: 700px)");
    let focused = -Infinity;
    let timer = 0;
    const fit = () => {
      if (phone.matches && Math.abs(viewport.scale - 1) < 0.01) {
        box.style.top = `${Math.max(0, viewport.offsetTop)}px`;
        box.style.height = box.style.maxHeight = `${viewport.height}px`;
      } else box.style.top = box.style.height = box.style.maxHeight = "";
      if (performance.now() - focused > 1000) return;
      clearTimeout(timer);
      timer = window.setTimeout(() => {
        const active = document.activeElement;
        if (!(active instanceof HTMLElement) || !box.contains(active)) return;
        const target = (
          active.closest(".field") ?? active
        ).getBoundingClientRect();
        const frame = box.getBoundingClientRect();
        if (target.top < frame.top + 8)
          box.scrollTop += target.top - frame.top - 8;
        else if (target.bottom > frame.bottom - 8)
          box.scrollTop += target.bottom - frame.bottom + 8;
      }, 150);
    };
    const focus = () => {
      focused = performance.now();
      fit();
    };
    fit();
    viewport.addEventListener("resize", fit);
    viewport.addEventListener("scroll", fit);
    phone.addEventListener("change", fit);
    box.addEventListener("focusin", focus);
    return () => {
      clearTimeout(timer);
      viewport.removeEventListener("resize", fit);
      viewport.removeEventListener("scroll", fit);
      phone.removeEventListener("change", fit);
      box.removeEventListener("focusin", focus);
    };
  }, []);
}

// The grid and variant tabs: the variant tab exists once a cell is selected,
// the grid keeps its scroll position, and focus follows the shown tab.
export function useAtlasTabs(
  dialog: RefObject<HTMLDialogElement | null>,
  selected: boolean,
  quiet: ReturnType<typeof useQuietFocus>,
) {
  const [tab, setTab] = useState<AtlasTab>("grid");
  const gridScroll = useRef(0);
  const buttons = useRef<Partial<Record<AtlasTab, HTMLButtonElement | null>>>(
    {},
  );
  const activate = (next: AtlasTab) => {
    if (next === tab || (next === "variant" && !selected)) return;
    if (tab === "grid") gridScroll.current = dialog.current?.scrollTop ?? 0;
    setTab(next);
  };
  // Selecting a cell shows its variant from wherever the grid was scrolled.
  const showVariant = () => {
    gridScroll.current = dialog.current?.scrollTop ?? 0;
    setTab("variant");
  };
  useLayoutEffect(() => {
    if (tab === "variant" && !selected) {
      gridScroll.current = 0;
      setTab("grid");
    }
  }, [tab, selected]);
  useLayoutEffect(() => {
    quiet.quiet();
    buttons.current[tab]?.focus({ preventScroll: true });
    if (dialog.current)
      dialog.current.scrollTop = tab === "grid" ? gridScroll.current : 0;
  }, [tab]);
  return { tab, activate, showVariant, buttons };
}

export function AtlasTabs({
  id,
  tab,
  selected,
  buttons,
  activate,
}: {
  id: string;
  tab: AtlasTab;
  selected: boolean;
  buttons: ReturnType<typeof useAtlasTabs>["buttons"];
  activate: (tab: AtlasTab) => void;
}) {
  return (
    <div className="atlas-tabs" role="tablist" aria-label="Atlas views">
      {(["grid", "variant"] as const).map((key) => (
        <button
          key={key}
          ref={(button) => {
            buttons.current[key] = button;
          }}
          type="button"
          role="tab"
          id={`${id}-${key}-tab`}
          aria-controls={`${id}-${key}-panel`}
          aria-selected={tab === key}
          tabIndex={tab === key ? 0 : -1}
          disabled={key === "variant" && !selected}
          onClick={() => activate(key)}
          onKeyDown={(event) => {
            const keys: AtlasTab[] = selected ? ["grid", "variant"] : ["grid"];
            const index = keys.indexOf(key);
            const target =
              event.key === "Home"
                ? 0
                : event.key === "End"
                  ? keys.length - 1
                  : event.key === "ArrowRight"
                    ? (index + 1) % keys.length
                    : event.key === "ArrowLeft"
                      ? (index + keys.length - 1) % keys.length
                      : null;
            if (target === null) return;
            event.preventDefault();
            activate(keys[target]);
          }}
        >
          {key === "grid" ? "Atlas grid" : "Selected variant"}
        </button>
      ))}
    </div>
  );
}

// Arrow keys move between valid cells, Home and End to the first and last.
export function atlasCellKeyDown(
  event: KeyboardEvent<HTMLButtonElement>,
  index: number,
  size: number,
) {
  const step =
    event.key === "ArrowRight"
      ? 1
      : event.key === "ArrowLeft"
        ? -1
        : event.key === "ArrowDown"
          ? size
          : event.key === "ArrowUp"
            ? -size
            : 0;
  if (!step && event.key !== "Home" && event.key !== "End") return;
  event.preventDefault();
  const buttons = event.currentTarget
    .closest(".atlas-grid")!
    .querySelectorAll<HTMLButtonElement>(".atlas-cell > button");
  let target =
    event.key === "Home"
      ? 0
      : event.key === "End"
        ? buttons.length - 1
        : index + step;
  const direction = step || (event.key === "Home" ? 1 : -1);
  while (target >= 0 && target < buttons.length) {
    if (!buttons[target].disabled) {
      buttons[target].focus();
      break;
    }
    target += direction;
  }
}

// Range expressions resolve through the atlas's own worker. An edit cancels
// the grid at once and holds Generate for a typing pause.
export function useAtlasRanges(cancel: () => void) {
  const client = useRef<EngineClient | null>(null);
  const generation = useRef(0);
  const [scalars, setScalars] = useState<Record<string, ScalarState>>({});
  const [editing, setEditing] = useState(false);
  const editTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const status = useMemo(
    () => ({
      client,
      generation,
      track: () => {},
      report: (id: string, value: ScalarState | null) =>
        setScalars((previous) => {
          const next = { ...previous };
          if (value) next[id] = value;
          else delete next[id];
          return next;
        }),
    }),
    [],
  );
  useEffect(() => () => clearTimeout(editTimer.current), []);
  const edit = () => {
    cancel();
    setEditing(true);
    clearTimeout(editTimer.current);
    editTimer.current = setTimeout(() => setEditing(false), 300);
  };
  // A pair change drops outstanding evaluations and their drafts.
  const forget = () => {
    generation.current++;
    setScalars({});
  };
  return {
    client,
    generation,
    status,
    editing,
    edit,
    forget,
    pending: Object.values(scalars).some((s) => s.pending),
    invalid: Object.values(scalars).find((s) => s.error),
  };
}

export function AtlasRangeFields({
  pairKey,
  axes,
  ranges,
  setRanges,
  failure,
  scalars,
}: {
  pairKey: string;
  axes: readonly AtlasAxis[];
  ranges: AtlasRanges;
  setRanges: (change: (previous: AtlasRanges) => AtlasRanges) => void;
  failure: { label: string; message: string } | null;
  scalars: ReturnType<typeof useAtlasRanges>;
}) {
  return (
    <ScalarStatus.Provider value={scalars.status}>
      <FieldErrorContext.Provider
        value={{
          ...failure,
          message: failure?.message ?? "",
          claim: () => {},
          touch: () => {},
        }}
      >
        <div
          className="atlas-ranges"
          key={pairKey}
          onChangeCapture={scalars.edit}
        >
          {axes.map(({ key, label, integer }) => (
            <div className="pair" key={key}>
              {([0, 1] as const).map((index) => {
                const name = `${label} ${index === 0 ? "from" : "to"}`;
                return (
                  <Field
                    key={index}
                    label={name}
                    help={
                      index !== 0
                        ? undefined
                        : integer
                          ? atlasWholeRangeHelp
                          : atlasRangeHelp
                    }
                  >
                    <ScalarInput
                      name={name}
                      value={ranges[key][index]}
                      onChange={(value) =>
                        setRanges((previous) => {
                          const pair = [...previous[key]] as [number, number];
                          pair[index] = value;
                          return { ...previous, [key]: pair };
                        })
                      }
                    />
                  </Field>
                );
              })}
            </div>
          ))}
        </div>
      </FieldErrorContext.Provider>
    </ScalarStatus.Provider>
  );
}

// What activating a cell does: open its full-quality variant, or add it to
// a path (../atlas-path.ts). Planning is offered only when the pair's
// parameters are phrase parameters; otherwise the reason shows beneath.
export type AtlasChoice = "inspect" | "path";
export function AtlasChoiceGroup({
  choice,
  setChoice,
  refusal,
}: {
  choice: AtlasChoice;
  setChoice: (choice: AtlasChoice) => void;
  refusal: string | null;
}) {
  const name = useId();
  return (
    <>
      <div
        className="notebook-mode atlas-choice"
        role="radiogroup"
        aria-label="Choosing a cell"
      >
        {(
          [
            ["inspect", "Inspect a variant"],
            ["path", "Plan a path"],
          ] as const
        ).map(([value, label]) => (
          <label key={value}>
            <input
              type="radio"
              name={name}
              aria-label={label}
              checked={choice === value}
              disabled={value === "path" && !!refusal}
              onChange={() => setChoice(value)}
            />
            {label}
          </label>
        ))}
      </div>
      {refusal && <p className="note atlas-choice-note">{refusal}</p>}
    </>
  );
}

// A path's stops beside its grid, until a range, pair or size edit
// regenerates the cells.
export function useAtlasPath() {
  const [choice, setChoice] = useState<AtlasChoice>("inspect");
  const [path, setPath] = useState<AtlasPath>(emptyPath);
  return {
    choice,
    setChoice,
    path,
    setPath,
    clear: () => setPath((p) => (p.stops.length ? { ...p, stops: [] } : p)),
  };
}
// The 1-based stops a cell stands for, for its caption.
export const stopsAt = (path: AtlasPath, index: number) =>
  path.stops.flatMap((stop, i) => (stop === index ? [i + 1] : []));
export const pathCellLabel = (path: AtlasPath, index: number, size: number) => {
  const stops = stopsAt(path, index);
  return `Add row ${Math.floor(index / size) + 1}, column ${(index % size) + 1} to the path${stops.length ? ` (${stops.length === 1 ? "stop" : "stops"} ${stops.join(", ")})` : ""}`;
};
export const atlasPathHelp = {
  seconds: "Each move's duration, 0.1–300 seconds, eased in and out.",
  closed: "Adds a last move back, so a loop closes exactly.",
};

export function AtlasPathPanel({
  path,
  setPath,
  cells,
  axes,
  describe,
  blocked,
  onAnimate,
}: {
  path: AtlasPath;
  setPath: (change: (path: AtlasPath) => AtlasPath) => void;
  cells: readonly { values: [number, number]; frame?: unknown }[];
  axes: readonly AtlasAxis[];
  // A cell's values, as its caption shows them.
  describe: (index: number) => string;
  blocked: boolean;
  onAnimate: () => void;
}) {
  const error = pathError(path, cells);
  const ends = path.stops.length >= 2 && path.stops[0] === path.stops.at(-1);
  const whole = axes.filter((a) => a.integer).map((a) => a.symbol);
  return (
    <section className="atlas-path" aria-label="Path">
      <h3>Path</h3>
      {path.stops.length ? (
        <ol className="atlas-path-stops">
          {path.stops.map((index, i) => (
            <li key={i}>
              <span>
                Stop {i + 1} · {describe(index)}
              </span>
              <button
                type="button"
                aria-label={`Remove stop ${i + 1}`}
                onClick={() => setPath((p) => removeStop(p, i))}
              >
                Remove
              </button>
            </li>
          ))}
        </ol>
      ) : (
        <p className="note">Choose cells in the order to visit them.</p>
      )}
      {path.stops.length >= maxPathStops && (
        <p className="note">A path holds at most {maxPathStops} stops.</p>
      )}
      {whole.length > 0 && (
        <p className="note atlas-path-whole">
          Between stops, {whole.join(" and ")} sweep
          {whole.length === 1 ? "s" : ""} through fractional values: genuine
          curves that generally do not close. Only the stops are whole.
        </p>
      )}
      <CheckSetting
        label="Return to the first stop"
        topic="Return to the first stop"
        help={atlasPathHelp.closed}
        checked={ends || path.closed}
        disabled={ends}
        onChange={(closed) => setPath((p) => ({ ...p, closed }))}
      />
      <Field label="Seconds per step" help={atlasPathHelp.seconds}>
        <input
          type="number"
          min={stepSeconds[0]}
          max={stepSeconds[1]}
          step="any"
          value={Number.isNaN(path.seconds) ? "" : path.seconds}
          onChange={(e) => {
            const seconds = e.target.valueAsNumber;
            setPath((p) => ({ ...p, seconds }));
          }}
        />
      </Field>
      {path.stops.length > 0 && error && (
        <p className="note" role="status">
          {error}
        </p>
      )}
      <div className="atlas-path-actions">
        <button
          type="button"
          disabled={!path.stops.length}
          onClick={() => setPath((p) => ({ ...p, stops: [] }))}
        >
          Clear path
        </button>
        <button type="button" disabled={blocked || !!error} onClick={onAnimate}>
          Animate this path
        </button>
      </div>
    </section>
  );
}

// A cell's place in the path: a badge in its caption's corner, which never
// changes the cell's height. The cell's own name says it to assistive
// technology (pathCellLabel).
export function PathStops({ stops }: { stops: number[] }) {
  if (!stops.length) return null;
  return (
    <span className="atlas-stops" aria-hidden="true">
      {stops.join(", ")}
    </span>
  );
}

// After a path is adopted, playing it is the next step. Focus returns to
// the atlas button as after any adoption, and the notebook's animation
// section opens. Whenever its Play button is enabled (it waits for the
// adopted study's frame, the previous study's can be enabled before that,
// and the adopted study's layout can move it), it takes focus after keyboard
// use, or else comes into view: iOS would ring a focus moved after a tap.
// This stops once the reader taps, types or scrolls, or after ten seconds.
export function focusPlayWhenReady(from: HTMLElement | null, via: JourneyVia) {
  const root = from?.closest(".app");
  if (!from || !root) return;
  // As from the header's Animation button (AnimationButton.tsx).
  const section = root.querySelector<HTMLDetailsElement>(
    ".animation-section > details[id]",
  );
  if (section) section.open = true;
  const play = () =>
    [...root.querySelectorAll<HTMLButtonElement>("button")].find(
      (b) => b.textContent === "Play animation" && b.checkVisibility(),
    );
  const check = () => {
    const button = play();
    if (!button || button.disabled) return;
    if (via === "keyboard") {
      if (document.activeElement !== button) button.focus();
      return;
    }
    // Clear of the phone's sticky notebook navigation, too.
    const { top, bottom } = button.getBoundingClientRect();
    if (top < innerHeight * 0.15 || bottom > innerHeight)
      button.scrollIntoView({ block: "center" });
  };
  const done = () => {
    observer.disconnect();
    clearTimeout(timer);
    for (const type of stops) document.removeEventListener(type, done, true);
  };
  // The reader's own input, including scrolling, ends it.
  const stops = ["pointerdown", "keydown", "wheel", "touchstart"] as const;
  const observer = new MutationObserver(check);
  observer.observe(root, {
    subtree: true,
    childList: true,
    attributes: true,
    attributeFilter: ["disabled"],
  });
  const timer = setTimeout(done, 10_000);
  for (const type of stops) document.addEventListener(type, done, true);
  requestAnimationFrame(check);
}
