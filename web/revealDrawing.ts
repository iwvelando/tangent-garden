// On narrow screens the controls sit below the drawing, so playback started
// from them would otherwise run out of sight. The jump is instant so no
// opening frames are missed, and only happens when the drawing is not already
// fully visible; wide layouts keep the drawing in view and are left untouched.
export function revealDrawing(
  drawing: HTMLElement | null,
  playback: HTMLElement | null,
) {
  if (!drawing) return;
  // A docked playback bar covers the bottom of the screen.
  const limit =
    playback && getComputedStyle(playback).position === "fixed"
      ? playback.getBoundingClientRect().top
      : window.innerHeight;
  const { top, bottom } = drawing.getBoundingClientRect();
  if (top >= 0 && bottom <= limit) return;
  drawing.scrollIntoView({ block: "start", behavior: "instant" });
}
