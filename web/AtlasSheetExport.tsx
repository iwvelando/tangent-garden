import { useLayoutEffect, useRef, useState } from "react";
import type { AtlasAxis, AtlasCell, AtlasSize } from "./atlas-queue";
import {
  atlasSheet,
  sheetReady,
  sheetLayout,
  sheetWebPAvailable,
  type SheetFormat,
  type SheetPainter,
} from "./atlas-sheet";
import type { ColorScheme } from "./color-schemes";
import { saveFile } from "./export-image";
import { Field } from "./Field";
import { sheetValueForAxes, type SheetValue } from "./atlas-sheet-notes";

export function AtlasSheetExport<F>({
  cells,
  size,
  paired = false,
  disabled,
  notebook,
  source,
  preview,
  axes,
  framing,
  dark,
  scheme,
  painter,
  definition,
}: {
  cells: readonly AtlasCell<F>[];
  size: AtlasSize;
  paired?: boolean;
  disabled: boolean;
  notebook: "2d" | "3d" | "4d";
  source: object;
  preview: object;
  axes: readonly AtlasAxis[];
  framing: string;
  dark: boolean;
  scheme: ColorScheme;
  painter: () => SheetPainter<F>;
  definition: (format: SheetValue) => string[];
}) {
  const [webp] = useState(sheetWebPAvailable);
  const [format, setFormat] = useState<SheetFormat>("png");
  const [teaching, setTeaching] = useState(false);
  const flight = useRef<AbortController | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const cancel = () => {
    const active = flight.current;
    if (!active) return;
    active.abort();
    setMessage("Sheet canceled.");
  };
  // Grid changes and appearance edits retire an output before it can save.
  // Inspection changes don't change cells, so inspecting remains usable.
  useLayoutEffect(() => {
    cancel();
    setError("");
  }, [cells, size, paired, disabled, framing, dark, scheme, format, teaching]);
  useLayoutEffect(
    () => () => {
      flight.current?.abort();
    },
    [],
  );
  const ready = !disabled && sheetReady(cells, size);
  const page = sheetLayout(size, paired);
  const start = async () => {
    if (!ready || flight.current) return;
    const active = new AbortController();
    flight.current = active;
    setBusy(true);
    setError("");
    setMessage("Preparing preview sheet…");
    try {
      const output = await atlasSheet({
        cells,
        size,
        paired,
        dark,
        scheme,
        format,
        signal: active.signal,
        metadata: { notebook, source, preview, axes, framing },
        ...(teaching && {
          header: {
            title: `Parameter atlas · ${notebook.toUpperCase()} · ${size} × ${size} · Preview geometry`,
            definition: [
              ...definition(sheetValueForAxes(axes)),
              `Columns: ${axes[0].label}. Rows: ${axes[1].label}. ${framing === "shared" ? "Shared framing." : "Independent framing."}`,
            ],
          },
          notes: cells.map((cell) => ({
            parameters: axes.map(
              (axis, k) => `${axis.label} = ${cell.values[k]}`,
            ),
            ...(!cell.frame && { reason: cell.error }),
          })),
        }),
        painter,
        progress: (done, total) => {
          if (flight.current === active)
            setMessage(`Rendering preview sheet: ${done} of ${total}.`);
        },
      });
      if (flight.current !== active || active.signal.aborted) return;
      saveFile(output.blob, `atlas-${notebook}-preview.${output.format}`);
      setMessage(
        `Preview sheet saved as ${output.format === "webp" ? "WebP" : "PNG"}.`,
      );
    } catch (e) {
      if (flight.current === active && !active.signal.aborted) {
        setMessage("");
        setError(
          `The preview sheet could not be exported: ${(e as Error).message}`,
        );
      }
    } finally {
      if (flight.current === active) {
        flight.current = null;
        setBusy(false);
      }
    }
  };
  return (
    <details className="atlas-sheet-export">
      <summary>Export atlas sheet</summary>
      <p className="note">
        {teaching ? (
          "Preview geometry, 2400 pixels wide. One definition subheader; entries show values and unavailable reasons in their grid positions."
        ) : (
          <>
            Preview geometry, {page.width} × {page.height} pixels. Unavailable
            variants leave blank cells; parameters and quality are in file
            metadata.
          </>
        )}
      </p>
      <Field label="Sheet format">
        <select
          aria-label="Sheet format"
          value={format}
          onChange={(e) => setFormat(e.target.value as SheetFormat)}
        >
          <option value="png">PNG · lossless</option>
          {webp && <option value="webp">WebP · smaller file</option>}
        </select>
      </Field>
      {!webp && (
        <p className="note">
          This browser exports PNG; WebP encoding is unavailable.
        </p>
      )}
      <label className="check">
        <input
          type="checkbox"
          checked={teaching}
          onChange={(e) => setTeaching(e.target.checked)}
        />
        Include definitions and parameters
      </label>
      <p className="note">
        Adds one definition subheader, with values and refusal reasons above
        each drawing.
      </p>
      <div className="atlas-entry-actions">
        <button
          type="button"
          disabled={!ready || busy}
          onClick={() => void start()}
        >
          Export preview sheet
        </button>
        {busy && (
          <button type="button" onClick={cancel}>
            Cancel sheet
          </button>
        )}
      </div>
      <p className="atlas-feedback" role="status">
        {message}
      </p>
      {error && (
        <p className="field-error" role="alert">
          {error}
        </p>
      )}
    </details>
  );
}
