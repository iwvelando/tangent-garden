import {
  cloneElement,
  useId,
  useState,
  type ReactElement,
  type ReactNode,
} from "react";

// Explanations stay out of the way until requested. A toggle, unlike a title
// tooltip, works on touch screens and keeps the text open while reading.
export function useHelp() {
  const id = `${useId()}-help`;
  const [open, setOpen] = useState(false);
  return { id, open, toggle: () => setOpen(!open) };
}

export function HelpToggle({
  topic,
  help,
}: {
  topic: string;
  help: ReturnType<typeof useHelp>;
}) {
  return (
    <button
      type="button"
      className="help-toggle"
      aria-label={`About ${topic}`}
      aria-expanded={help.open}
      aria-controls={help.id}
      onClick={help.toggle}
    >
      i
    </button>
  );
}

export function HelpText({
  help,
  children,
}: {
  help: ReturnType<typeof useHelp>;
  children: ReactNode;
}) {
  return (
    <p className="hint" id={help.id} hidden={!help.open}>
      {children}
    </p>
  );
}

type FieldProps = {
  label: ReactNode;
  // Shown at the end of the label row, such as a slider's current value.
  value?: ReactNode;
  help?: ReactNode;
  // Names the help toggle when the label is not plain text.
  topic?: string;
  className?: string;
  children: ReactElement<{ id?: string; "aria-describedby"?: string }>;
};

export function Field({
  label,
  value,
  help,
  topic,
  className,
  children,
}: FieldProps) {
  const id = useId();
  const state = useHelp();
  return (
    <div className={className ? `field ${className}` : "field"}>
      <div className="field-label">
        <label htmlFor={id}>{label}</label>
        {help && (
          <HelpToggle
            topic={topic ?? (typeof label === "string" ? label : "")}
            help={state}
          />
        )}
        {value !== undefined && <b>{value}</b>}
      </div>
      {cloneElement(children, {
        id,
        "aria-describedby": help && state.open ? state.id : undefined,
      })}
      {help && <HelpText help={state}>{help}</HelpText>}
    </div>
  );
}
