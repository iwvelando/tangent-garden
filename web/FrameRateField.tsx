import { Field } from "./Field";
import type { ExportFormat } from "./export-formats";

// The export frame rate, shared by every notebook. Animated WebP stores
// every frame whole, so 60 fps is an opt-in that roughly doubles a WebP's
// size; MP4 encodes the differences between frames.
export function FrameRateField({
  format,
  fps,
  onChange,
}: {
  format: ExportFormat;
  fps: number;
  onChange: (fps: number) => void;
}) {
  return (
    <>
      <Field label="Export frame rate">
        <select value={fps} onChange={(e) => onChange(+e.target.value)}>
          <option value={60}>
            {format === "webp"
              ? "60 fps · larger file"
              : "60 fps · smoothest motion"}
          </option>
          <option value={30}>30 fps · smoother motion</option>
          <option value={15}>15 fps · smaller file</option>
        </select>
      </Field>
      {format === "webp" && fps === 60 && (
        <p className="hint">
          WebP stores every frame whole, so 60 fps makes files about twice as
          large as 30 fps; long or high-resolution exports may reach the 256 MiB
          limit.
        </p>
      )}
    </>
  );
}
