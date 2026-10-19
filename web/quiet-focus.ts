import { useRef, type RefObject } from "react";

// A menu that moves focus by script, into its items as it opens and back to
// its button as it closes. iOS Safari rings such focus after a tap, as if
// the reader used the keyboard, so the menu's wrapper is marked data-quiet
// (styled without a ring) when a pointer opened or closed it, until the
// reader uses the keyboard or focus leaves the menu. NotebookMode does the
// same for its picker.
export function useQuietFocus(wrap: RefObject<HTMLElement | null>) {
  const via = useRef<"keyboard" | "pointer">("keyboard");
  const ring = () => wrap.current?.removeAttribute("data-quiet");
  return {
    // Called just before moving focus by script.
    quiet: () =>
      wrap.current?.toggleAttribute("data-quiet", via.current === "pointer"),
    ring,
    // For the wrapper: capture, so a key an item handles still counts.
    onPointerDown: () => {
      via.current = "pointer";
    },
    onKeyDownCapture: () => {
      via.current = "keyboard";
      ring();
    },
  };
}
