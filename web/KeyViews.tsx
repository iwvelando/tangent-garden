import {
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  type ReactNode,
} from "react";
import { Field, HelpText, HelpToggle, useHelp } from "./Field";
import type { Help } from "./help";
import {
  defaultEasingFactor,
  easingError,
  easingFactorHelp,
  easingFactorRange,
  keyTimes,
  legHelp,
  legRange,
  maxKeyName,
  maxKeys,
  moveKeys,
  removeKeys,
  transitionHelp,
  type KeyBase,
} from "./key-views";

// A camera path's setting that is on or off, with its help.
export function KeyViewSwitch({
  checked,
  onChange,
  label,
  topic,
  help: text,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: string;
  topic: string;
  help: Help;
}) {
  const help = useHelp();
  return (
    <>
      <div className="probe-switch view-switch">
        <label className="check">
          <input
            type="checkbox"
            checked={checked}
            onChange={(e) => onChange(e.target.checked)}
          />
          {label}
        </label>
        <HelpToggle topic={topic} help={help} />
      </div>
      <HelpText help={help}>{text}</HelpText>
    </>
  );
}

export function KeyViewEasing({
  checked,
  onChange,
  factor = defaultEasingFactor,
  onFactorChange,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  factor?: number;
  onFactorChange: (factor: number) => void;
}) {
  const errorId = useId();
  const problem = easingError({ keys: [], easingFactor: factor });
  return (
    <>
      <KeyViewSwitch
        checked={checked}
        onChange={onChange}
        label="Ease key-view transitions"
        topic="easing key-view transitions"
        help={transitionHelp}
      />
      <Field label="Easing factor" help={easingFactorHelp}>
        <input
          type="number"
          min={easingFactorRange[0]}
          max={easingFactorRange[1]}
          step="0.05"
          disabled={!checked}
          value={Number.isNaN(factor) ? "" : factor}
          aria-invalid={problem ? true : undefined}
          aria-errormessage={problem ? errorId : undefined}
          onChange={(e) => onFactorChange(e.target.valueAsNumber)}
        />
      </Field>
      {problem && (
        <p className="field-error" role="alert" id={errorId}>
          {problem.field} {problem.message}
        </p>
      )}
    </>
  );
}

// The key views of a camera path, in the 2D and 3D notebooks: each view's
// name, the fields a notebook adds (3D: turns), its leg time, where it is
// reached, and buttons to move, show, set and remove it; then buttons to add
// the drawing's view and, in a loop, to return to the first.
export function KeyViews<K extends KeyBase>({
  keys,
  onChange,
  asFirst,
  describe,
  fields,
  drawn,
  keep,
  onShow,
  help,
  loop,
}: {
  keys: K[];
  // Applied to the latest keys, as a functional update.
  onChange: (change: (keys: K[]) => K[]) => void;
  // A view that becomes the first, by moving or removal, loses its leg.
  asFirst: (key: K) => K;
  // The view's camera in words, for its hint.
  describe: (key: K) => string;
  // A notebook's own fields for a view after the first, paired with its
  // leg time; change applies to that view.
  fields?: (key: K, k: number, change: (c: (key: K) => K) => void) => ReactNode;
  // The drawing's view as a key view, or null while there is none.
  drawn: () => K | null;
  // What a view set to the drawing keeps of its own, besides its name and
  // leg time.
  keep?: (old: K, view: K) => K;
  onShow: (key: K) => void;
  help: Help;
  loop: boolean;
}) {
  const keysHelp = useHelp();
  const change = (k: number, c: (key: K) => K) =>
    onChange((keys) => keys.map((key, j) => (j === k ? c(key) : key)));
  // Focus follows a moved view to its new place, onto the same way's button
  // while it can move further, else the other's.
  const viewsBox = useRef<HTMLDivElement>(null);
  // The way is kept with the move, since Safari leaves a pressed button
  // unfocused.
  const moved = useRef<{ to: number; way: "up" | "down" } | null>(null);
  useLayoutEffect(() => {
    if (!moved.current) return;
    const { to: k, way } = moved.current;
    moved.current = null;
    const box = viewsBox.current;
    for (const w of way === "down" ? ["down", "up"] : ["up", "down"]) {
      const b = box?.querySelector<HTMLButtonElement>(
        `button[aria-label="Move view ${k + 1} ${w}"]`,
      );
      if (b && !b.disabled) return b.focus();
    }
  }, [keys]);
  // How far through the flight each view is reached, while every leg's time
  // is valid.
  const reached =
    keys.length >= 2 &&
    keys.every(
      (key, k) =>
        k === 0 ||
        ((key.leg ?? 1) >= legRange[0] && (key.leg ?? 1) <= legRange[1]),
    )
      ? keyTimes({ keys })
      : null;
  const percent = (x: number) => `${Math.round(x * 100)}%`;
  return (
    <div
      className="field path-views"
      role="group"
      aria-label="Key views"
      ref={viewsBox}
    >
      <div className="field-label">
        <span>Key views</span>
        <HelpToggle topic="key views" help={keysHelp} />
      </div>
      <HelpText help={keysHelp}>{help}</HelpText>
      {keys.map((key, k) => {
        const leg = (
          <Field
            label="Leg time"
            help={k === 1 ? legHelp : undefined}
            topic={`view ${k + 1} leg time`}
          >
            <input
              aria-label={`View ${k + 1} leg time`}
              type="number"
              min={legRange[0]}
              max={legRange[1]}
              step="0.1"
              value={Number.isNaN(key.leg) ? "" : (key.leg ?? 1)}
              onChange={(e) => {
                const leg = e.target.valueAsNumber;
                change(k, (old) => ({ ...old, leg }));
              }}
            />
          </Field>
        );
        return (
          <div className="animation-track path-view" key={k}>
            <Field label="Name">
              <ViewName
                aria-label={`View ${k + 1} name`}
                placeholder={`View ${k + 1}`}
                value={key.name}
                onChange={(name) => change(k, (old) => ({ ...old, name }))}
              />
            </Field>
            {k > 0 &&
              (fields ? (
                <div className="pair">
                  {fields(key, k, (c) => change(k, c))}
                  {leg}
                </div>
              ) : (
                leg
              ))}
            <p className="hint">
              {describe(key)}
              {reached && ` · reached ${percent(reached[k])} of the way`}
            </p>
            <div className="path-view-buttons">
              {(["up", "down"] as const).map((way) => {
                const to = way === "up" ? k - 1 : k + 1;
                return (
                  <button
                    key={way}
                    className="text-button"
                    aria-label={`Move view ${k + 1} ${way}`}
                    disabled={to < 0 || to >= keys.length}
                    onClick={() => {
                      onChange((keys) => moveKeys(keys, k, to, asFirst));
                      moved.current = { to, way };
                    }}
                  >
                    {way === "up" ? "Move up" : "Move down"}
                  </button>
                );
              })}
              <button
                className="text-button"
                aria-label={`Show view ${k + 1}`}
                onClick={() => onShow(key)}
              >
                Show
              </button>
              <button
                className="text-button"
                aria-label={`Set view ${k + 1} to the drawing's view`}
                onClick={() => {
                  const view = drawn();
                  if (view)
                    change(k, (old) => ({
                      ...(keep ? keep(old, view) : view),
                      name: old.name,
                      ...(old.leg !== undefined && { leg: old.leg }),
                    }));
                }}
              >
                Set to drawing
              </button>
              <button
                className="text-button"
                aria-label={`Remove view ${k + 1}`}
                onClick={() => onChange((keys) => removeKeys(keys, k, asFirst))}
              >
                Remove
              </button>
            </div>
          </div>
        );
      })}
      <button
        disabled={keys.length >= maxKeys}
        onClick={() => {
          const view = drawn();
          if (view)
            onChange((keys) =>
              keys.length >= maxKeys ? keys : [...keys, view],
            );
        }}
      >
        + Add the drawing's view
      </button>
      {loop && (
        <button
          disabled={keys.length < 2 || keys.length >= maxKeys}
          onClick={() =>
            onChange((keys) =>
              keys.length < 2 || keys.length >= maxKeys
                ? keys
                : [...keys, asFirst(keys[0])],
            )
          }
        >
          + Return to view 1
        </button>
      )}
    </div>
  );
}

// A view's name wraps onto as many lines as it needs, so a long one stays
// whole in a narrow sidebar. It is still one line of text: Enter and pasted
// line breaks add none.
function ViewName({
  value,
  onChange,
  ...rest
}: {
  value: string;
  onChange: (name: string) => void;
  "aria-label": string;
  placeholder: string;
  // From the Field around it.
  id?: string;
  "aria-describedby"?: string;
  "aria-invalid"?: boolean;
}) {
  const box = useRef<HTMLTextAreaElement>(null);
  const fit = () => {
    const e = box.current;
    if (!e) return;
    e.style.height = "auto";
    e.style.height = `${e.scrollHeight + e.offsetHeight - e.clientHeight}px`;
  };
  useLayoutEffect(fit, [value]);
  // A narrower sidebar wraps it onto more lines.
  useEffect(() => {
    const parent = box.current?.parentElement;
    if (!parent) return;
    let width = parent.clientWidth;
    const watch = new ResizeObserver(() => {
      if (parent.clientWidth === width) return;
      width = parent.clientWidth;
      fit();
    });
    watch.observe(parent);
    return () => watch.disconnect();
  }, []);
  return (
    <textarea
      {...rest}
      ref={box}
      className="view-name"
      rows={1}
      maxLength={maxKeyName}
      value={value}
      onKeyDown={(e) => {
        if (e.key === "Enter") e.preventDefault();
      }}
      onChange={(e) => onChange(e.target.value.replace(/[\r\n]+/g, " "))}
      spellCheck={false}
    />
  );
}
