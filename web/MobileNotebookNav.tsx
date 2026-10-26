import {
  createContext,
  useContext,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useMediaQuery } from "./useMediaQuery";

const DrawingTouch = createContext(true);
export const useDrawingTouch = () => useContext(DrawingTouch);

const editable =
  'input:not([type="checkbox"]):not([type="radio"]):not([type="range"]), select, textarea';

// How far the screen begins below the top of the layout viewport. iOS opens
// its keyboard without shrinking the layout viewport: it pans the visual one
// down inside it, and can leave it panned after the keyboard closes. Pinch
// zoom keeps the browser's own behavior.
function screenTop() {
  const viewport = window.visualViewport;
  return viewport && Math.abs(viewport.scale - 1) < 0.01
    ? Math.max(0, viewport.offsetTop)
    : 0;
}

// The bottom of the screen in layout-viewport coordinates, above a keyboard.
function screenBottom() {
  const viewport = window.visualViewport;
  return viewport ? viewport.offsetTop + viewport.height : window.innerHeight;
}

// The mobile notebook is one long page. Keep its drawing a tap away without
// losing the reader's place in the controls or mounting a second renderer.
export function NotebookMain({
  children,
  inert,
}: {
  children: ReactNode;
  inert?: boolean;
}) {
  const nav = useRef<HTMLElement>(null);
  const controlOffset = useRef(0);
  // Whether the screen's offset comes from the keyboard: from focusing a
  // field until the offset next returns to zero. Any other offset is the
  // page bouncing past its end, which the navigation rides with the page.
  const keyboard = useRef(false);
  const navTop = () => (keyboard.current ? screenTop() : 0);
  const [inControls, setInControls] = useState(false);
  const [adjusting, setAdjusting] = useState(false);
  const narrow = useMediaQuery("(max-width: 700px)");

  useLayoutEffect(() => {
    // The content's scroll margin, so the browser's own scrolling into view
    // leaves room for the navigation. A hidden notebook's empty bar leaves
    // the shown one's height in place.
    const bar = nav.current!;
    const measure = () => {
      if (bar.offsetHeight)
        document.documentElement.style.setProperty(
          "--mobile-nav-height",
          `${bar.offsetHeight}px`,
        );
    };
    const observer = new ResizeObserver(measure);
    observer.observe(bar);
    measure();
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!narrow) return;
    const viewport = window.visualViewport;
    const update = () => {
      const bar = nav.current;
      if (!bar?.getClientRects().length) return;
      const field = document.activeElement;
      if (field instanceof Element && field.matches(editable))
        keyboard.current = true;
      else if (!screenTop()) keyboard.current = false;
      // Stick to the top of the screen rather than of the layout viewport.
      const top = navTop();
      bar.style.top = top ? `${top}px` : "";
      const aside = bar.parentElement?.querySelector("aside");
      if (aside)
        setInControls(
          aside.getBoundingClientRect().top <= top + bar.offsetHeight + 1,
        );
    };
    update();
    window.addEventListener("scroll", update, { passive: true });
    window.addEventListener("resize", update);
    viewport?.addEventListener("scroll", update);
    viewport?.addEventListener("resize", update);
    return () => {
      window.removeEventListener("scroll", update);
      window.removeEventListener("resize", update);
      viewport?.removeEventListener("scroll", update);
      viewport?.removeEventListener("resize", update);
      if (nav.current) nav.current.style.top = "";
    };
  }, [narrow]);

  // iOS scrolls a focused field into the layout viewport, which can leave it
  // under the keyboard or the navigation. Once the keyboard settles, bring
  // the field and its label into the space between them. Only the moments
  // after focus count, so a reader who then scrolls away is left there.
  useEffect(() => {
    if (!narrow) return;
    const viewport = window.visualViewport;
    let focusedAt = -Infinity;
    let timer = 0;
    const reveal = () => {
      const bar = nav.current;
      const field = document.activeElement;
      if (
        !bar?.getClientRects().length ||
        !(field instanceof HTMLElement) ||
        !field.matches(editable) ||
        !bar.parentElement?.contains(field)
      )
        return;
      const top = navTop() + bar.offsetHeight + 8;
      const bottom = screenBottom() - 8;
      const labeled = field.closest(".field")?.getBoundingClientRect();
      const box =
        labeled && labeled.height <= bottom - top
          ? labeled
          : field.getBoundingClientRect();
      if (box.top < top) window.scrollBy(0, box.top - top);
      else if (box.bottom > bottom)
        window.scrollBy(0, Math.min(box.bottom - bottom, box.top - top));
    };
    const settle = () => {
      if (performance.now() - focusedAt > 1000) return;
      clearTimeout(timer);
      timer = window.setTimeout(reveal, 150);
    };
    const focus = (e: FocusEvent) => {
      if (!(e.target instanceof Element) || !e.target.matches(editable)) return;
      focusedAt = performance.now();
      settle();
    };
    document.addEventListener("focusin", focus);
    viewport?.addEventListener("resize", settle);
    viewport?.addEventListener("scroll", settle);
    return () => {
      clearTimeout(timer);
      document.removeEventListener("focusin", focus);
      viewport?.removeEventListener("resize", settle);
      viewport?.removeEventListener("scroll", settle);
    };
  }, [narrow]);

  const jump = (controls: boolean) => {
    const bar = nav.current;
    const main = bar?.parentElement;
    const aside = main?.querySelector("aside");
    const drawing = main?.querySelector("article");
    if (!bar || !aside || !drawing) return;
    if (controls) setAdjusting(false);
    const top = navTop();
    const offset = window.scrollY - top;
    const controlsTop = aside.getBoundingClientRect().top + offset;
    const height = bar.offsetHeight;
    // How far the controls have scrolled up under the navigation.
    const under = top + height - aside.getBoundingClientRect().top;
    const reading = under >= -1;
    if (!controls && reading) controlOffset.current = Math.max(0, under);
    // Clicking the current section does not move an editor back to its top.
    if (controls && reading) return;
    const frame = main?.querySelector(".plot-wrap");
    // Keep the heading when it fits; a short phone needs that room for art.
    const picture =
      frame &&
      frame.getBoundingClientRect().bottom -
        drawing.getBoundingClientRect().top >
        screenBottom() - top - height
        ? frame
        : drawing;
    window.scrollTo({
      top: controls
        ? controlsTop - height + controlOffset.current
        : picture.getBoundingClientRect().top + offset - height,
      behavior: "instant",
    });
    setInControls(controls);
  };

  return (
    <DrawingTouch.Provider value={!narrow || adjusting}>
      <main inert={inert} aria-hidden={inert || undefined}>
        <nav
          ref={nav}
          className="mobile-notebook-nav"
          aria-label="Notebook sections"
        >
          <button
            type="button"
            aria-current={!inControls ? "location" : undefined}
            onClick={() => jump(false)}
          >
            Drawing
          </button>
          <button
            type="button"
            aria-current={inControls ? "location" : undefined}
            onClick={() => jump(true)}
          >
            Controls
          </button>
          <button
            type="button"
            aria-pressed={adjusting}
            aria-label={adjusting ? "Done adjusting view" : "Adjust view"}
            onClick={() => {
              if (!adjusting) jump(false);
              setAdjusting((value) => !value);
            }}
          >
            {adjusting ? "Done" : "Adjust view"}
          </button>
          <span className="mobile-nav-hint">
            {adjusting
              ? "Drag or pinch to adjust. Tap Done to scroll."
              : "Swipe to scroll. Adjust view to pan or zoom."}
          </span>
        </nav>
        {children}
      </main>
    </DrawingTouch.Provider>
  );
}
