import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent,
} from "react";
import {
  defaultStill,
  drawingPage,
  pngFile,
  saveFile,
  StillLimit,
  stillScales,
  stillSize,
  svgFile,
  type Still,
} from "./export-image";

type Props = {
  disabled: boolean;
  kind: string;
  onSave?: (format: string, still: Still) => Promise<void>;
  // The drawing's own page, which every size is a multiple of.
  base?: { width: number; height: number };
  // What the size applies to: the PNG alone where the other formats are
  // vectors, or every format of a page drawn by WebGL.
  sizeLabel?: string;
  svgLabel?: string;
  // Further formats a notebook saves itself, listed after SVG.
  extraItems?: { format: string; label: string }[];
  menuId?: string;
};

export function ExportImageMenu({
  disabled,
  kind,
  onSave,
  svgLabel = kind === "attractor"
    ? "SVG · vectors, density as an embedded PNG"
    : "SVG · vector, scalable",
  extraItems = [],
  menuId = "export-image-menu",
  base = drawingPage,
  sizeLabel = "PNG size",
}: Props) {
  const [open, setOpen] = useState(false);
  // Settings, kept between exports. The menu stays open while they change.
  const [still, setStill] = useState<Still>(defaultStill);
  const png = stillSize(still, base);
  const [error, setError] = useState("");
  // Keep the right-edge anchor where it fits, and clamp wider popups to the
  // viewport when a compact header leaves too little room on either side.
  const [offset, setOffset] = useState(0);
  const popup = useRef<HTMLElement | null>(null);
  const setPopup = (element: HTMLElement | null) => {
    popup.current = element;
  };
  const wrap = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const items = useRef<HTMLButtonElement[]>([]);
  useLayoutEffect(() => {
    if (!open && !error) return setOffset(0);
    const position = () => {
      if (!popup.current || !wrap.current) return;
      const width = popup.current.getBoundingClientRect().width;
      const left = wrap.current.getBoundingClientRect().right - width;
      setOffset(
        Math.max(
          0,
          Math.min(left, document.documentElement.clientWidth - width),
        ) - left,
      );
    };
    position();
    window.addEventListener("resize", position);
    return () => window.removeEventListener("resize", position);
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
  async function save(format: string) {
    close();
    setError("");
    if (onSave) {
      try {
        await onSave(format, still);
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
          ? svgFile(svg, still.transparent)
          : await pngFile(svg, png.width, png.height, still.transparent);
      saveFile(blob, `tangent-garden-${kind}.${format}`);
    } catch (error) {
      setError(
        error instanceof StillLimit
          ? error.message
          : "This browser couldn't save the PNG image. SVG export may still work.",
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
          className="export-image-options"
          style={{ transform: `translateX(${offset}px)` }}
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
            {still.transparent ? ", transparent" : ""}
          </button>
          <button
            ref={item(1)}
            role="menuitem"
            tabIndex={-1}
            onClick={() => void save("svg")}
          >
            {svgLabel}
          </button>
          {extraItems.map((extra, i) => (
            <button
              key={extra.format}
              ref={item(2 + i)}
              role="menuitem"
              tabIndex={-1}
              onClick={() => void save(extra.format)}
            >
              {extra.label}
            </button>
          ))}
          <div role="separator" />
          <div role="group" aria-label={sizeLabel}>
            <div className="export-menu-heading" aria-hidden="true">
              {sizeLabel}
            </div>
            {stillScales.map((scale, i) => {
              const size = stillSize({ ...still, scale }, base);
              return (
                <button
                  key={scale}
                  ref={item(2 + extraItems.length + i)}
                  role="menuitemradio"
                  aria-checked={still.scale === scale}
                  tabIndex={-1}
                  onClick={() => setStill((s) => ({ ...s, scale }))}
                >
                  {size.width} × {size.height}
                </button>
              );
            })}
          </div>
          <div role="separator" />
          <button
            ref={item(2 + extraItems.length + stillScales.length)}
            role="menuitemcheckbox"
            aria-checked={still.transparent}
            tabIndex={-1}
            onClick={() =>
              setStill((s) => ({ ...s, transparent: !s.transparent }))
            }
          >
            Transparent background
          </button>
        </div>
      )}
      {error && (
        <p
          ref={setPopup}
          className="export-menu-error"
          style={{ transform: `translateX(${offset}px)` }}
          role="alert"
        >
          {error}
        </p>
      )}
    </div>
  );
}
