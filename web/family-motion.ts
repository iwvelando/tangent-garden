import { tiered } from "./help";
import type { AnimationView, Viewport } from "./animation";
import type { Frame } from "./types";
import type { FamilySettings } from "./planar-family";
import { progressAt, type Pace } from "./timing";
import type { FamilyMember } from "./planar-family";

export type FamilyMotion = {
  mode: "reveal" | "window";
  width: number;
  progress: number;
};

// Slice the frozen slots, including unavailable ones. The returned references
// share the prepared geometry; neither seek nor playback makes engine requests.
export function familyMotionMembers(
  members: readonly FamilyMember[],
  motion: FamilyMotion,
) {
  const n = members.length;
  const p = Math.max(0, Math.min(1, motion.progress));
  if (motion.mode === "reveal")
    return members.slice(0, Math.min(n, 1 + Math.floor(p * (n - 1))));
  const width = Math.max(1, Math.min(n, motion.width));
  const start =
    p === 1 ? n - width : Math.min(n - width, Math.floor(p * (n - width + 1)));
  return members.slice(start, start + width);
}

export type FamilyAnimation = {
  mode: FamilyMotion["mode"];
  width: number;
  duration: number;
  repeat: "once" | "back-and-forth";
  pace: Pace;
  camera: "hold" | "current";
};
export const defaultFamilyAnimation: FamilyAnimation = {
  mode: "reveal",
  width: 3,
  duration: 8,
  repeat: "once",
  pace: "steady",
  camera: "hold",
};
export type FamilyComposition = {
  settings: FamilySettings;
  members: readonly FamilyMember[];
  motion?: FamilyMotion;
};
export type PreparedFamily = FamilyComposition & {
  setup: FamilyAnimation;
  view: Viewport;
};
// Reserve a visible rest at the far endpoint. The rest and both travel legs
// fit inside the declared duration, independent of rendering or seeking history.
export function familyProgressAt(
  time: number,
  setup: Pick<FamilyAnimation, "duration" | "repeat" | "pace">,
) {
  if (setup.repeat === "once") return progressAt(time, "once", setup.pace);
  const rest = Math.min(1 / setup.duration, 0.25);
  const travel = Math.min(
    1,
    progressAt(time, "back-and-forth", "steady") / (1 - rest),
  );
  return progressAt(travel, "once", setup.pace);
}
export function sampleFamily(
  family: PreparedFamily,
  frame: Frame,
  time: number,
  length: number,
  stop: boolean,
  owner: string,
): AnimationView {
  const progress = familyProgressAt(time, family.setup);
  return {
    frame,
    final: frame,
    mode: "reveal",
    camera: "current",
    heldView: family.view,
    progress,
    time,
    length,
    stop,
    owner,
    complete: family.setup.repeat === "once" && time === 1,
    family: {
      settings: family.settings,
      members: family.members,
      motion: { mode: family.setup.mode, width: family.setup.width, progress },
    },
  };
}

const motionDetails =
  "Members are prepared once. A reveal starts with the first member; a band starts with its first window. Unavailable members keep their slots. Back and forth rests at the end for one second, or a quarter of shorter durations.";
export const familyMotionHelp = {
  reveal: tiered(
    "Reveal the finite family one member at a time.",
    motionDetails,
  ),
  window: tiered(
    "Move a fixed-width band through the finite family.",
    motionDetails,
  ),
  width: "Show 1–32 consecutive members, up to the family size.",
  construction: tiered(
    "Apply enabled construction layers to every visible member.",
    "Otherwise, only the fixed selected member shows its construction while visible. This includes incident rays, backward extensions, and source or pole markers. The layer toggles still choose what is drawn.",
  ),
};
