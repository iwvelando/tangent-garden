// A phase's layer events, shared by the phrase editors: the layers it shows
// or hides from its start, among those the study offers. Any other a link
// names stays as it is.
import { HelpText, HelpToggle, useHelp } from "./Field";
import type { Help } from "./help";

type LayerChoice = "keep" | "show" | "hide";
// The layers a phase shows or hides, among those the study offers; any
// other a link names stays as it is.
export function PhaseLayers<K extends string>({
  phase,
  index,
  offered,
  onChange,
  help: text,
}: {
  phase: { layers?: Partial<Record<K, boolean>> };
  index: number;
  offered: readonly (readonly [K, string])[];
  onChange: (layers: Partial<Record<K, boolean>> | undefined) => void;
  help: Help<string>;
}) {
  const help = useHelp();
  if (!offered.length) return null;
  const events: Partial<Record<K, boolean>> = phase.layers ?? {};
  const named = offered.filter(([key]) => events[key] !== undefined);
  const summary = named.length
    ? named
        .map(([key, label]) => `${events[key] ? "show" : "hide"} ${label}`)
        .join("; ")
    : "keep";
  return (
    <div className="field">
      <div className="field-label">
        <span id={`${help.id}-label`}>Layers</span>
        {index === 0 && (
          <HelpToggle topic={`Phase ${index + 1} layers`} help={help} />
        )}
      </div>
      <details className="phrase-layers">
        <summary aria-label={`Phase ${index + 1} layers: ${summary}`}>
          {summary}
        </summary>
        {offered.map(([key, label]) => (
          <label className="phrase-layer" key={key}>
            <span>{label}</span>
            <select
              aria-label={`Phase ${index + 1} ${label}`}
              value={
                events[key] === undefined
                  ? "keep"
                  : events[key]
                    ? "show"
                    : "hide"
              }
              onChange={(e) => {
                const choice = e.target.value as LayerChoice;
                const next: Partial<Record<K, boolean>> = { ...events };
                if (choice === "keep") delete next[key];
                else next[key] = choice === "show";
                onChange(Object.keys(next).length ? next : undefined);
              }}
            >
              <option value="keep">Keep</option>
              <option value="show">Show</option>
              <option value="hide">Hide</option>
            </select>
          </label>
        ))}
      </details>
      {index === 0 && <HelpText help={help}>{text}</HelpText>}
    </div>
  );
}
