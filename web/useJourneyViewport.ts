import { useEffect, useLayoutEffect, type RefObject } from "react";

// Both compact journey kinds own a modal; an inner layout may provide its
// anchor so the native workspace keeps owning that same dialog.
export function useJourneyViewport(anchor: RefObject<HTMLElement | null>) {
  // iOS opens its keyboard by shortening the visual viewport and panning it
  // down the layout viewport, which a modal fills: the page behind showed
  // below the journey, and the focused field could stay under the keyboard.
  // On a phone the journey fits the visual viewport instead, and once the
  // keyboard settles brings a focused field and its label into view. Only
  // the moments after focus count, so a reader who then scrolls away is left
  // there. Pinch zoom keeps the browser's own behavior.
  useEffect(() => {
    const viewport = window.visualViewport;
    const box = anchor.current!.closest("dialog")!;
    if (!viewport) return;
    const phone = matchMedia("(max-width: 700px)");
    let timer = 0;
    let focusedAt = -Infinity;
    // Only the dialog scrolls: scrolling the page as well, as scrollIntoView
    // does, pans iOS's viewport again mid-keyboard and moves the dialog
    // under the field it was revealing.
    const reveal = () => {
      const field = document.activeElement;
      if (!(field instanceof HTMLElement) || !box.contains(field)) return;
      const target = (field.closest(".field") ?? field).getBoundingClientRect();
      const frame = box.getBoundingClientRect();
      const above = target.top - (frame.top + 8);
      const below = target.bottom - (frame.bottom - 8);
      if (above < 0) box.scrollTop += above;
      else if (below > 0) box.scrollTop += Math.min(below, above);
    };
    const fit = () => {
      if (phone.matches && Math.abs(viewport.scale - 1) < 0.01) {
        box.style.top = `${Math.max(0, viewport.offsetTop)}px`;
        box.style.height = box.style.maxHeight = `${viewport.height}px`;
      } else box.style.top = box.style.height = box.style.maxHeight = "";
      if (performance.now() - focusedAt > 1000) return;
      clearTimeout(timer);
      timer = window.setTimeout(reveal, 150);
    };
    const focus = () => {
      focusedAt = performance.now();
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
  // On a phone the study behind stays where the reader left it: swipes past
  // the journey's end, or over it once iOS's keyboard has panned the page,
  // must not scroll it. A scroll the keyboard left behind is undone.
  useLayoutEffect(() => {
    const root = document.documentElement;
    const { scrollX: x, scrollY: y } = window;
    root.classList.add("journey-open");
    return () => {
      root.classList.remove("journey-open");
      if (window.scrollX !== x || window.scrollY !== y) window.scrollTo(x, y);
    };
  }, []);
}
