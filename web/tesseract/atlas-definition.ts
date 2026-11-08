import { plainSheetValue, type SheetValue } from "../atlas-sheet-notes";
// All object-specific words, formulas and active fields come from the same
// descriptor used by the notebook. No parallel switch on object names.
import { modeLabel, objects } from "./objects";
import type { Config } from "./types";

export function tesseractSheetDefinition(
  c: Config,
  format: SheetValue = plainSheetValue,
): string[] {
  const d = objects[c.object];
  const parameters = (d.parameterKey ? c[d.parameterKey] : undefined) as
    Record<string, unknown> | undefined;
  const fields = (d.numericFields ?? [])
    .filter((f) => !f.endpoint && (!f.visible || f.visible(c)))
    .map((f) => {
      const raw = parameters?.[f.key];
      const value =
        f.index === undefined ? raw : (raw as unknown as number[])?.[f.index];
      return `${f.label} = ${format([...(d.parameterKey ? [d.parameterKey] : []), f.key, ...(f.index === undefined ? [] : [f.index])], (value ?? f.fallback ?? 0) as number)}`;
    });
  return [
    `${d.name} · ${modeLabel(c.object, c.mode)}`,
    d.explanation(c)[2],
    `4D angles (radians): ${["xy", "xz", "yz", "xw", "yw", "zw"].map((name, i) => `${name} = ${format(["angles", i], c.angles[i])}`).join("; ")}`,
    ...fields,
    ...(d.choices ?? [])
      .filter((f) => !f.visible || f.visible(c))
      .map((f) => {
        const value = parameters?.[f.key];
        return `${f.label}: ${f.values.find((v) => v.value === value)?.label ?? String(value)}`;
      }),
    ...d.radiusFields.map((f) => `${f.label} = ${c[f.key]}`),
    ...(d.countFields?.(c) ?? []).map((f) => `${f.label} = ${c[f.key]}`),
    ...(c.mode === "perspective"
      ? [`4D eye distance = ${format(["distance"], c.distance)}`]
      : []),
    ...(c.mode === "stereo" ||
    (c.mode === "paired" && d.pairedModes?.includes("stereo"))
      ? [`Projection window = ${format(["clip"], c.clip)}`]
      : []),
  ];
}
