import {
  createContext,
  useContext,
  useId,
  useLayoutEffect,
  useRef,
} from "react";
type Dimension = "2d" | "3d" | "4d";
const notebooks: { value: Dimension; label: string }[] = [
  { value: "2d", label: "2D" },
  { value: "3d", label: "3D" },
  { value: "4d", label: "4D" },
];
// How the reader chose the notebook whose picker should take focus.
export type FocusRequest = false | "keyboard" | "pointer";
export const NotebookContext = createContext<{
  mode: Dimension;
  choose: (mode: Dimension, via: "keyboard" | "pointer") => void;
  focusRequest: { current: FocusRequest };
}>({ mode: "2d", choose: () => {}, focusRequest: { current: false } });
// Each notebook shows the picker above its examples, so the dimension and the
// example are chosen in one place. Radio buttons give arrow-key switching.
export function NotebookMode() {
  const { mode, choose, focusRequest } = useContext(NotebookContext);
  const name = useId();
  const checked = useRef<HTMLInputElement>(null);
  const group = useRef<HTMLDivElement>(null);
  // Assistive technology may choose without a pointer or key; it counts as
  // the keyboard, so the ring shows.
  const via = useRef<"keyboard" | "pointer">("keyboard");
  // The notebook switched to restores focus once its picker shows, including
  // after a lazy notebook loads. After a tap or click the ring stays hidden
  // until the reader uses the keyboard or leaves the picker.
  useLayoutEffect(() => {
    const request = focusRequest.current;
    if (request && checked.current?.getClientRects().length) {
      focusRequest.current = false;
      group.current!.toggleAttribute("data-quiet", request === "pointer");
      checked.current.focus();
    }
  });
  const ring = () => group.current?.removeAttribute("data-quiet");
  return (
    <div
      ref={group}
      className="notebook-mode"
      role="radiogroup"
      aria-label="Study dimension"
      onPointerDown={() => (via.current = "pointer")}
      onKeyDown={() => {
        via.current = "keyboard";
        ring();
      }}
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget)) ring();
      }}
    >
      {notebooks.map((n) => (
        <label key={n.value}>
          <input
            ref={mode === n.value ? checked : undefined}
            type="radio"
            name={name}
            aria-label={`${n.label} studies`}
            checked={mode === n.value}
            onChange={() => {
              choose(n.value, via.current);
              via.current = "keyboard";
            }}
          />
          {n.label}
        </label>
      ))}
    </div>
  );
}
