import {
  createContext,
  useContext,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
type Dimension = "2d" | "3d" | "4d";
const notebooks: { value: Dimension; label: string }[] = [
  { value: "2d", label: "2D curves" },
  { value: "3d", label: "3D curves" },
  { value: "4d", label: "4D shapes" },
];
export const NotebookContext = createContext<{
  mode: Dimension;
  choose: (mode: Dimension) => void;
  focusRequest: { current: boolean };
}>({ mode: "2d", choose: () => {}, focusRequest: { current: false } });
export function NotebookMode() {
  const { mode, choose, focusRequest } = useContext(NotebookContext);
  const [open, setOpen] = useState(false);
  const id = useId();
  const wrap = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const items = useRef<(HTMLButtonElement | null)[]>([]);
  // Lazy notebooks restore focus when their header mounts, after loading.
  useLayoutEffect(() => {
    if (focusRequest.current && button.current?.getClientRects().length) {
      focusRequest.current = false;
      button.current.focus();
    }
  });
  const close = () => {
    setOpen(false);
    button.current?.focus();
  };
  useEffect(() => {
    if (!open) return;
    items.current[notebooks.findIndex((n) => n.value === mode)]?.focus();
    const outside = (e: PointerEvent) => {
      if (!wrap.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", outside);
    return () => document.removeEventListener("pointerdown", outside);
  }, [open, mode]);
  return (
    <div className="notebook-mode export-menu" ref={wrap}>
      <button
        ref={button}
        data-notebook-trigger
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? id : undefined}
        onClick={() => setOpen(!open)}
        onKeyDown={(e) => {
          if (["ArrowDown", "ArrowUp"].includes(e.key)) {
            e.preventDefault();
            setOpen(true);
          }
        }}
      >
        {notebooks.find((n) => n.value === mode)!.label}{" "}
        <span aria-hidden="true">▾</span>
      </button>
      {open && (
        <div
          id={id}
          role="menu"
          aria-label="Study dimension"
          className="export-image-options start"
          onKeyDown={(e) => {
            const i = items.current.indexOf(
              document.activeElement as HTMLButtonElement,
            );
            const next =
              e.key === "ArrowDown"
                ? (i + 1) % 3
                : e.key === "ArrowUp"
                  ? (i + 2) % 3
                  : e.key === "Home"
                    ? 0
                    : e.key === "End"
                      ? 2
                      : -1;
            if (next >= 0) {
              e.preventDefault();
              items.current[next]?.focus();
            }
            if (e.key === "Escape") {
              e.preventDefault();
              close();
            }
            if (e.key === "Tab") setOpen(false);
          }}
        >
          {notebooks.map((n, i) => (
            <button
              key={n.value}
              ref={(el) => {
                items.current[i] = el;
              }}
              role="menuitemradio"
              aria-checked={mode === n.value}
              tabIndex={-1}
              onClick={() => {
                close();
                choose(n.value);
              }}
            >
              {n.label}
              <span aria-hidden="true">{mode === n.value ? "✓" : ""}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
