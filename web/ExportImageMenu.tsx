import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { pngFile, saveFile, svgFile } from "./export-image";

// Twice the drawing's 1000 × 760 layout: crisp on high-density screens.
const png = { width: 2000, height: 1520 };

type Props = { disabled: boolean; kind: string };

export function ExportImageMenu({ disabled, kind }: Props) {
  const [open, setOpen] = useState(false);
  const [error, setError] = useState("");
  const wrap = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const items = useRef<HTMLButtonElement[]>([]);
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
        aria-controls={open ? "export-image-menu" : undefined}
        onClick={() => {
          setError("");
          setOpen(!open);
        }}
      >
        Export image <span aria-hidden="true">▾</span>
      </button>
      {open && (
        <div
          id="export-image-menu"
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
            SVG · vector, scalable
          </button>
        </div>
      )}
      {error && (
        <p className="export-menu-error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
