import { HelpText, HelpToggle, useHelp } from "../Field";
import { tiered } from "../help";
import { spatialPlainZoom, viewZoom } from "../refinement";
import type { Frame, SpatialConfig } from "./types";

export const receiverViewEnabled = (c: SpatialConfig) =>
  c.format === "rays" &&
  c.rays.receiver.plane !== "none" &&
  !!c.rays.receiver.refineView;

// Playback keeps the original window's cost and accounting. A still
// inset is transient geometry, never a field in an animation or link.
export function withoutReceiverInset(frame: Frame): Frame {
  const rays = frame.result.rays;
  if (!rays?.receiver?.inset) return frame;
  const { inset: _, ...receiver } = rays.receiver;
  return { ...frame, result: { ...frame.result, rays: { ...rays, receiver } } };
}

// Each refinement level costs two to two and a half times the one below it,
// so frames calculated while an animation plays spread a receiver refined
// twice or more one level coarser; a pause, scrubbing, the end of a single
// pass, still images and exports keep its own levels. Anything else is
// returned as it is.
export const lowersRefinement = (c: SpatialConfig) =>
  c.format === "rays" &&
  c.rays.receiver.plane !== "none" &&
  (c.rays.receiver.refine ?? 0) >= 2;
export function playbackRefinement(c: SpatialConfig): SpatialConfig {
  if (!lowersRefinement(c)) return c;
  const refine = c.rays.receiver.refine! - 1;
  return {
    ...c,
    rays: { ...c.rays, receiver: { ...c.rays.receiver, refine } },
  };
}

export const fullRefinementHelp = tiered(
  "Plays every frame at the receiver's refinement levels, instead of one level coarser.",
  "Shown for a receiver refined twice or more. Each level costs about twice the time of the one below it. Pausing, scrubbing, the end of a single pass, still images and exports keep every level either way.",
);

export const receiverViewHelp = tiered(
  `Sharpens the visible light after the camera rests, about one bin per device pixel, and zooms to ${viewZoom.toLocaleString("en-US")}×.`,
  `At most 1024 bins each way. Refinement levels also apply to this inset, with a separate 524,288-cell budget. Window shares and peak stay fixed; the brightest shade means at or above that peak. Playback omits the inset; still images refine it to their output size. Without it, zoom stops at ${spatialPlainZoom}×.`,
);

export function ReceiverViewCheck({
  checked,
  onChange,
}: {
  checked: boolean;
  onChange: (on: boolean) => void;
}) {
  const help = useHelp();
  return (
    <>
      <div className="probe-switch">
        <label className="check">
          <input
            type="checkbox"
            checked={checked}
            onChange={(e) => onChange(e.target.checked)}
          />
          Refine the receiver to the view
        </label>
        <HelpToggle topic="refining the receiver to the view" help={help} />
      </div>
      <HelpText help={help}>{receiverViewHelp}</HelpText>
    </>
  );
}
