// The 4D object descriptor's discrete choice and selected-item controls,
// shared by the notebook and a journey step so both read the same labels,
// options and selection semantics from objects.ts.
import { Field } from "../Field";
import type { Help } from "../help";
import {
  choiceOptions,
  choiceValue,
  objects,
  type ObjectDescriptor,
} from "./objects";

type Choice = NonNullable<ObjectDescriptor["choices"]>[number];
import type { Config } from "./types";

export function ChoiceField({
  choice,
  config,
  help,
  onChoose,
}: {
  choice: Choice;
  config: Config;
  help?: Help<string>;
  onChoose: (value: string) => void;
}) {
  return (
    <Field label={choice.label} help={help}>
      <select
        value={choiceValue(config, choice)}
        onChange={(e) => onChoose(e.target.value)}
      >
        {choiceOptions(config, choice).map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </Field>
  );
}

// A whole number from 1 to the item count. Anything else is not a
// selection, so it is ignored and the field keeps the current one.
export function SelectionField({
  config,
  help,
  onSelect,
}: {
  config: Config;
  help?: Help<string>;
  onSelect: (index: number) => void;
}) {
  const selection = objects[config.object].selection!;
  const count = selection.count(config);
  return (
    <Field label={selection.label} help={help}>
      <input
        type="number"
        min="1"
        max={count}
        step="1"
        value={selection.get(config) + 1}
        onChange={(e) => {
          const n = Number(e.target.value);
          if (!Number.isInteger(n) || n < 1 || n > count) return;
          onSelect(n - 1);
        }}
      />
    </Field>
  );
}
