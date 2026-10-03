// The header's way to the animation section, which otherwise sits at the end
// of the controls. It opens the section, remembered like a summary click,
// then scrolls it to the top: within the sidebar on wide layouts, so the
// drawing stays put, and down the page on narrow ones.
export function AnimationButton({ section }: { section: string }) {
  return (
    <button
      className="export animation-jump"
      onClick={() => {
        const details = document.getElementById(section);
        if (!(details instanceof HTMLDetailsElement)) return;
        details.open = true;
        const summary = details.querySelector("summary")!;
        summary.focus({ preventScroll: true });
        summary.scrollIntoView({
          block: "start",
          behavior: matchMedia("(prefers-reduced-motion: reduce)").matches
            ? "instant"
            : "smooth",
        });
      }}
    >
      Animation <span aria-hidden="true">↓</span>
    </button>
  );
}
