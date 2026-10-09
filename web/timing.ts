import { tiered, type Help } from "./help";

// How an animation spends its duration, shared by playback and export. The
// time is where the clock and the timeline stand, from 0 at the start to 1
// at the end of the duration; the progress is how far the motion has gone,
// the value an animation's frame is drawn at. Steady and once, the default,
// they are the same, so existing animations keep their timing.
//
// A loop plays the motion again and again, its end joining its start: it
// is seamless only when the motion's last frame is its first (the notebook
// checks this before playing). Back and forth plays the motion out and back
// within the duration, so any motion repeats without a jump. Easing follows
// a half cosine, at rest at each end of the motion. See
// mathematics.md#seamless-loops.
export type Repeat = "once" | "loop" | "back-and-forth";
export type Pace = "steady" | "ease";

// The motion's progress at a time, both in [0, 1]. Every repeat starts at
// progress 0; once and a loop reach 1 at time 1, and back and forth reaches
// 1 at time ½ and returns to 0 at time 1, all exactly.
export function progressAt(time: number, repeat: Repeat, pace: Pace) {
  const t = Math.max(0, Math.min(1, time));
  const x = repeat === "back-and-forth" ? 1 - Math.abs(1 - 2 * t) : t;
  return pace === "ease" ? (1 - Math.cos(Math.PI * x)) / 2 : x;
}

// Whether playback wraps from the end to the start, and an export leaves
// out its last frame, which would be its first again.
export const cycles = (repeat: Repeat) => repeat !== "once";

// The choices and the words every notebook shows for them. Each notebook
// says itself which of its motions can loop.
export const repeatChoices: { value: Repeat; label: string }[] = [
  { value: "once", label: "Once" },
  { value: "loop", label: "Loop" },
  { value: "back-and-forth", label: "Back and forth" },
];
export const paceChoices: { value: Pace; label: string }[] = [
  { value: "steady", label: "Steady" },
  { value: "ease", label: "Ease in and out" },
];
export const onceHelp = "Plays from the start to the end, then stops.";
export const backAndForthHelp = tiered(
  "Plays to the end and back, again and again.",
  "Out and back both fit in the duration, so it repeats without a jump. Exports loop forever.",
);
// Fitted and following cameras' framing, in every notebook that offers them.
export const asymptoteHelp =
  "Framing ignores isolated points near asymptotes; use Hold current view to explore distant branches.";
export const paceHelp: Record<Pace, Help<string>> = {
  steady: "Moves at a constant rate.",
  ease: tiered(
    "Starts and ends slowly.",
    "It follows a half cosine; back and forth also rests at each turn.",
  ),
};
