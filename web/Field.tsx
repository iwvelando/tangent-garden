import {
  cloneElement,
  createContext,
  useContext,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type ReactElement,
  type ReactNode,
} from "react";

// The error a notebook shows under one of its fields: the field whose
// control has this id, or else whose label (topic) is this label. The
// field claims it while it can show it, and the notebook then shows it
// nowhere else. Touch reports the field whose control the reader changed,
// for errors that name no field.
export type FieldErrorTarget = {
  id?: string;
  label?: string;
  message: string;
  claim: (key: string, on: boolean) => void;
  touch: (label: string) => void;
};
export const FieldErrorContext = createContext<FieldErrorTarget | null>(null);

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
  children: ReactElement<{
    id?: string;
    "aria-describedby"?: string;
    "aria-invalid"?: boolean;
  }>;
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
  const target = useContext(FieldErrorContext);
  const name = topic ?? (typeof label === "string" ? label : "");
  const own =
    !!target &&
    (target.id !== undefined
      ? target.id === id
      : !!name && target.label === name);
  const box = useRef<HTMLDivElement>(null);
  const [shown, setShown] = useState(false);
  const claim = target?.claim;
  // Before paint, so the notebook never shows the error twice. A field
  // folded away in a closed section opens it to show the error.
  useLayoutEffect(() => {
    setShown(own);
    if (!own || !claim) return;
    for (
      let folded = box.current?.closest("details:not([open])");
      folded;
      folded = folded.parentElement?.closest("details:not([open])")
    )
      (folded as HTMLDetailsElement).open = true;
    claim(id, true);
    return () => claim(id, false);
  }, [own, claim, id]);
  const error = own && shown ? target!.message : "";
  // An error just below a control at the edge of the screen, as one typed
  // into on a phone, is brought into view; one already in view stays put.
  const errorBox = useRef<HTMLParagraphElement>(null);
  useLayoutEffect(() => {
    if (error) errorBox.current?.scrollIntoView({ block: "nearest" });
  }, [error]);
  const described = [
    help && state.open ? state.id : "",
    error ? `${id}-error` : "",
  ].filter(Boolean);
  return (
    <div
      ref={box}
      className={className ? `field ${className}` : "field"}
      onChangeCapture={() => name && target?.touch(name)}
    >
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
        "aria-describedby": described.length ? described.join(" ") : undefined,
        ...(error && { "aria-invalid": true }),
      })}
      {error && (
        <p
          className="field-error"
          id={`${id}-error`}
          role="alert"
          ref={errorBox}
        >
          {error}
        </p>
      )}
      {help && <HelpText help={state}>{help}</HelpText>}
    </div>
  );
}
