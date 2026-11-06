// The 4D object descriptor's discrete choice and selected-item controls,
// shared by the notebook and a journey step so both read the same labels,
// options and selection semantics from objects.ts.
import { Field } from "../Field";
import type { Help } from "../help";
import { objects, type ObjectDescriptor } from "./objects";
import type { Config } from "./types";

type Choice = NonNullable<ObjectDescriptor["choices"]>[number];

// The choice's current option: the study's value, or the first option for
// a study that has never set it.
export function choiceValue(config: Config, choice: Choice): string {
  const key = objects[config.object].parameterKey!;
  return (
    (config[key] as unknown as Record<string, string | undefined>)[
      choice.key
    ] ?? choice.values[0].value
  );
}

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
        {choice.values.map((option) => (
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
