import type { KeyboardEvent, PointerEvent } from "react";

// Keys that move a range input.
const moving = new Set([
  "Home",
  "End",
  "ArrowLeft",
  "ArrowRight",
  "ArrowUp",
  "ArrowDown",
  "PageUp",
  "PageDown",
]);

// Every notebook's animation progress slider. It snaps to steps of 0.001,
// so a frame between steps, such as one paused just after the start, shows
// as the nearest step, and choosing that same step (Home at 0.0004, already
// reading 0) fires no change. Releasing a moving key or the pointer
// therefore also seeks to the slider's value whenever it differs from the
// progress shown. Field passes the id and description through.
export function ProgressSlider({
  progress,
  disabled,
  onSeek,
  ...field
}: {
  progress: number;
  disabled: boolean;
  onSeek: (progress: number) => void;
  id?: string;
  "aria-describedby"?: string;
}) {
  const settle = (e: KeyboardEvent | PointerEvent) => {
    const value = (e.currentTarget as HTMLInputElement).valueAsNumber;
    if (value !== progress) onSeek(value);
  };
  return (
    <input
      {...field}
      aria-label="Animation progress"
      type="range"
      min="0"
      max="1"
      step=".001"
      value={progress}
      disabled={disabled}
      onChange={(e) => onSeek(+e.target.value)}
      onKeyUp={(e) => moving.has(e.key) && settle(e)}
      onPointerUp={settle}
    />
  );
}
