import { refinementReadout, type RefinedPath } from "./refinement";

// The control that refines a study's drawn curves between their samples,
// with a readout of what refinement did, in the 2D and 3D notebooks.
export function RefineBetweenSamples({
  checked,
  onChange,
  refined,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  // The refined curves of the drawing shown, once refinement has run.
  refined?: (RefinedPath<unknown> | undefined)[];
}) {
  return (
    <>
      <label className="check">
        <input
          type="checkbox"
          checked={checked}
          onChange={(e) => onChange(e.target.checked)}
        />
        Refine between samples
      </label>
      {checked && refined && (
        <p className="refinement-readout">{refinementReadout(refined)}</p>
      )}
    </>
  );
}
