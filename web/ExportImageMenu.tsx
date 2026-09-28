import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent,
} from "react";
import { pngFile, saveFile, svgFile } from "./export-image";

// Twice the drawing's 1000 × 760 layout: crisp on high-density screens.
const png = { width: 2000, height: 1520 };

type Props = {
  disabled: boolean;
  kind: string;
  onSave?: (format: "png" | "svg") => Promise<void>;
  svgLabel?: string;
  menuId?: string;
};

export function ExportImageMenu({
  disabled,
  kind,
  onSave,
  svgLabel = kind === "attractor"
    ? "SVG · vectors, density as an embedded PNG"
    : "SVG · vector, scalable",
  menuId = "export-image-menu",
}: Props) {
  const [open, setOpen] = useState(false);
  const [error, setError] = useState("");
  // The menu and error hang below the button's right edge. When the header
  // wraps the button to the start of its row on a narrow screen, that leaves
  // no room to the left, so they align with the button's left edge instead.
  const [alignStart, setAlignStart] = useState(false);
  const popup = useRef<HTMLElement | null>(null);
  const setPopup = (element: HTMLElement | null) => {
    popup.current = element;
  };
  const wrap = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const items = useRef<HTMLButtonElement[]>([]);
  useLayoutEffect(() => {
    if (!open && !error) return setAlignStart(false);
    if (popup.current && popup.current.getBoundingClientRect().left < 0)
      setAlignStart(true);
  }, [open, error]);
  useEffect(() => {
    if (open) items.current[0]?.focus();
  }, [open]);
  useEffect(() => {
    if (!open) return;
    const outside = (e: PointerEvent) => {
      if (!wrap.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", outside);
    return () => document.removeEventListener("pointerdown", outside);
  }, [open]);
  useEffect(() => {
    if (disabled) setOpen(false);
  }, [disabled]);
  function close() {
    setOpen(false);
    button.current?.focus();
  }
  function keys(e: KeyboardEvent) {
    const list = items.current;
    const i = list.indexOf(document.activeElement as HTMLButtonElement);
    const move = { ArrowDown: i + 1, ArrowUp: i - 1, Home: 0, End: -1 }[e.key];
    if (move !== undefined) {
      e.preventDefault();
      list.at(move % list.length)?.focus();
    } else if (e.key === "Escape") {
      e.preventDefault();
      close();
    } else if (e.key === "Tab") setOpen(false);
  }
  async function save(format: "png" | "svg") {
    close();
    setError("");
    if (onSave) {
      try {
        await onSave(format);
      } catch (error) {
        setError(
          error instanceof Error ? error.message : "Image export failed.",
        );
      }
      return;
    }
    const svg = document.getElementById("artwork");
    if (!(svg instanceof SVGSVGElement)) return;
    try {
      const blob =
        format === "svg"
          ? svgFile(svg)
          : await pngFile(svg, png.width, png.height);
      saveFile(blob, `tangent-garden-${kind}.${format}`);
    } catch {
      setError(
        "This browser couldn't save the PNG image. SVG export may still work.",
      );
    }
  }
  const item = (index: number) => (element: HTMLButtonElement | null) => {
    if (element) items.current[index] = element;
  };
  return (
    <div className="export-menu" ref={wrap}>
      <button
        ref={button}
        className="export"
        disabled={disabled}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        onClick={() => {
          setError("");
          setOpen(!open);
        }}
      >
        Export image <span aria-hidden="true">▾</span>
      </button>
      {open && (
        <div
          ref={setPopup}
          className={
            alignStart ? "export-image-options start" : "export-image-options"
          }
          id={menuId}
          role="menu"
          aria-label="Export image"
          onKeyDown={keys}
        >
          <button
            ref={item(0)}
            role="menuitem"
            tabIndex={-1}
            onClick={() => void save("png")}
          >
            PNG image · {png.width} × {png.height}
          </button>
          <button
            ref={item(1)}
            role="menuitem"
            tabIndex={-1}
            onClick={() => void save("svg")}
          >
            {svgLabel}
          </button>
        </div>
      )}
      {error && (
        <p
          ref={setPopup}
          className={
            alignStart ? "export-menu-error start" : "export-menu-error"
          }
          role="alert"
        >
          {error}
        </p>
      )}
    </div>
  );
}
