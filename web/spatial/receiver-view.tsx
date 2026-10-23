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
