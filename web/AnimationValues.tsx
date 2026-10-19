// The widest number a playback readout gives, in characters: six
// significant digits with a sign, a decimal point and leading zeros or an
// exponent, as −0.000123457 and −1.11022e-16 are.
const valueWidth = 12;

// Every notebook's playback readout, such as "Probe at u = 0.1052, v = 0" or
// "a = 1.5 · Probe at t = 2". Its values change length from frame to frame,
// so each segment ending in ", " or " · " holds a value's widest width after
// its "= ", in the readout's monospace characters: what follows stays in
// place, and the line wraps at the same segments in every frame. A longer
// value still shows in full. The text is unchanged.
export function AnimationValues({ text }: { text: string }) {
  const segments = text.split(/(?<=, | · )/);
  return (
    <output className="animation-values">
      {segments.map((segment, k) => {
        const equals = segment.lastIndexOf("= ");
        const separator = segment.endsWith(" · ") ? 3 : 2;
        return k < segments.length - 1 && equals >= 0 ? (
          <span
            key={k}
            className="animation-value"
            style={{ minWidth: `${equals + 2 + valueWidth + separator}ch` }}
          >
            {segment}
          </span>
        ) : (
          segment
        );
      })}
    </output>
  );
}
