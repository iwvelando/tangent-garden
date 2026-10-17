import { useEffect, useRef, useState } from "react";
import { colorSchemes, schemeInks, type ColorScheme } from "./color-schemes";

export function ColorSchemeMenu({
  scheme,
  dark,
  onChange,
}: {
  scheme: ColorScheme;
  dark: boolean;
  onChange: (scheme: ColorScheme) => void;
}) {
  const [open, setOpen] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const close = () => {
    setOpen(false);
    trigger.current?.focus();
  };
  useEffect(() => {
    if (!open) return;
    menu.current?.querySelector<HTMLElement>('[aria-checked="true"]')?.focus();
    const outside = (event: PointerEvent) => {
      if (!wrap.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", outside);
    return () => document.removeEventListener("pointerdown", outside);
  }, [open]);
  const current = colorSchemes.find((s) => s.id === scheme)!;
  const inks = schemeInks(scheme, dark);
  return (
    <div
      className="scheme-picker"
      ref={wrap}
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget)) setOpen(false);
      }}
    >
      <button
        ref={trigger}
        type="button"
        className="scheme-trigger"
        aria-label="Color scheme"
        aria-haspopup="menu"
        aria-expanded={open}
        data-scheme={scheme}
        title={`Color scheme: ${current.label}`}
        onClick={() => setOpen(!open)}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown" || e.key === "ArrowUp") {
            e.preventDefault();
            setOpen(true);
          }
        }}
      >
        <svg viewBox="0 0 24 24" width="21" height="21" aria-hidden="true">
          <path
            d="M12 3a9 9 0 1 0 0 18h1.1a2.2 2.2 0 0 0 1.7-3.6 1.7 1.7 0 0 1 1.3-2.8H18a3 3 0 0 0 3-3C21 6.6 17 3 12 3Z"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinejoin="round"
          />
          <circle cx="7.5" cy="10" r="1.5" fill={inks[0]} />
          <circle cx="11.5" cy="7.5" r="1.5" fill={inks[1]} />
          <circle cx="16" cy="9" r="1.5" fill={inks[3]} />
        </svg>
      </button>
      {open && (
        <div
          ref={menu}
          role="menu"
          aria-label="Color scheme"
          className="scheme-menu"
          onKeyDown={(e) => {
            const items = Array.from(
              menu.current!.querySelectorAll<HTMLButtonElement>(
                '[role="menuitemradio"]',
              ),
            );
            const index = items.indexOf(
              document.activeElement as HTMLButtonElement,
            );
            let next: number;
            switch (e.key) {
              case "Escape":
                e.preventDefault();
                e.stopPropagation();
                close();
                return;
              case "ArrowDown":
                next = (index + 1) % items.length;
                break;
              case "ArrowUp":
                next = (index + items.length - 1) % items.length;
                break;
              case "Home":
                next = 0;
                break;
              case "End":
                next = items.length - 1;
                break;
              default:
                return;
            }
            e.preventDefault();
            items[next].focus();
          }}
        >
          <span className="scheme-menu-heading">Drawing colors</span>
          {colorSchemes.map((s) => (
            <button
              key={s.id}
              type="button"
              role="menuitemradio"
              aria-checked={scheme === s.id}
              data-scheme={s.id}
              tabIndex={-1}
              onClick={() => {
                onChange(s.id);
                close();
              }}
            >
              <span className="scheme-swatches" aria-hidden="true">
                {schemeInks(s.id, dark)
                  .slice(0, 2)
                  .map((ink) => (
                    <i key={ink} style={{ background: ink }} />
                  ))}
              </span>
              <span>
                {s.label}
                {s.id === "default" && <small>Default</small>}
              </span>
              <span className="scheme-check" aria-hidden="true">
                {scheme === s.id ? "✓" : ""}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
