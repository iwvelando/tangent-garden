import {
  createContext,
  useContext,
  useEffect,
  useId,
  useRef,
  useState,
  type ChangeEvent,
} from "react";
import { boundText, type EngineClient } from "./engine-client";

// A field's resolution state: pending while Go evaluates its text, with the
// parser's message when the text is not a finite constant.
// control is the id of the input whose text failed, so the error can be
// shown under it.
export type ScalarState = {
  name: string;
  pending: boolean;
  error?: string;
  control?: string;
};
export const ScalarStatus = createContext<{
  client: { current: EngineClient | null };
  track: (job: Promise<void>) => void;
  // Advanced when the whole configuration is replaced, as by a preset, so
  // evaluations begun before it are dropped rather than applied to it.
  generation: { current: number };
  report: (id: string, state: ScalarState | null) => void;
} | null>(null);

// A numeric parameter entered as a constant expression, such as pi/2, -1/phi,
// or 2*e. The Go parser evaluates the text, exactly as for domain bounds, and
// only its finite value reaches the configuration; the field keeps showing
// the text. A value changed elsewhere, such as by a preset, replaces it.
// Empty text is NaN, which the worker reports as an unfilled field.
export function ScalarInput({
  name,
  value,
  onChange,
  id,
  ...rest
}: {
  name: string;
  value: number;
  onChange: (value: number) => void;
  id?: string;
  "aria-describedby"?: string;
}) {
  const status = useContext(ScalarStatus)!;
  const key = useId();
  // The entered text and the value it resolved to (undefined while pending).
  const [draft, setDraft] = useState<{ text: string; value?: number } | null>(
    null,
  );
  const latest = useRef(0);
  const report = (state: ScalarState | null) => status.report(key, state);
  useEffect(() => () => report(null), []);
  // A different value arriving from elsewhere supersedes the entry.
  const superseded =
    draft?.value !== undefined && !Object.is(draft.value, value);
  useEffect(() => {
    if (!superseded) return;
    latest.current++;
    setDraft(null);
    report(null);
  }, [superseded]);
  const change = (e: ChangeEvent<HTMLInputElement>) => {
    const text = e.target.value;
    const request = ++latest.current;
    if (!text.trim()) {
      setDraft({ text, value: NaN });
      report(null);
      onChange(NaN);
      return;
    }
    setDraft({ text });
    report({ name, pending: true });
    const generation = status.generation.current;
    const current = () => {
      if (request !== latest.current) return false;
      if (generation === status.generation.current) return true;
      setDraft(null);
      report(null);
      return false;
    };
    const job = status.client
      .current!.scalars([text])
      .then(([resolved]) => {
        if (!current()) return;
        setDraft({ text, value: resolved });
        report(null);
        onChange(resolved);
      })
      .catch((error: Error) => {
        if (!current()) return;
        setDraft({ text, value: NaN });
        report({ name, pending: false, error: error.message, control: id });
        onChange(NaN);
      });
    status.track(job);
  };
  return (
    <input
      {...rest}
      id={id}
      type="text"
      inputMode="text"
      autoComplete="off"
      spellCheck={false}
      value={
        draft && !superseded
          ? draft.text
          : Number.isNaN(value)
            ? ""
            : boundText(value)
      }
      onChange={change}
    />
  );
}
