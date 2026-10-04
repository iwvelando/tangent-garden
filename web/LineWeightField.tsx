import { Field } from "./Field";
import { lineWeights, svgWeightHelp, type LineWeight } from "./line-weight";

// The line weight's control, in every notebook (line-weight.ts).
export function LineWeightField({
  value,
  onChange,
  label = "Line weight",
  help = svgWeightHelp,
}: {
  value: LineWeight;
  onChange: (weight: LineWeight) => void;
  label?: string;
  help?: string;
}) {
  return (
    <Field label={label} help={help}>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value as LineWeight)}
      >
        {lineWeights.map((w) => (
          <option key={w.value} value={w.value}>
            {w.label}
          </option>
        ))}
      </select>
    </Field>
  );
}
