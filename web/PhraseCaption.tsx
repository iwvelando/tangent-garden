import { liveReadout } from "./number-format";
import { targetLabel, type AnimationView } from "./animation";
import type { PlotPalette } from "./palette";
import { captionBand } from "./export-quality";

type Presentation = NonNullable<AnimationView["phrase"]>;
const readout = (track: {
  target: Presentation["target"];
  value: number;
  range?: readonly [number, number];
}) =>
  `${targetLabel(track.target)} = ${liveReadout(track.value, track.range ?? [track.value, track.value])}`;
// The stage, and one readout per parameter: the phrase's own first.
export const phraseCaptionText = (phrase: Presentation) => ({
  stage: phrase.phase,
  parameter: readout(phrase),
  parameters: [phrase, ...(phrase.also ?? [])].map(readout),
});

// Ordinary, non-announcing UI remains accessible when the optional visual
// caption moves into the SVG. Keep the stage and counter on distinct rows.
export function PhraseCaption({ phrase }: { phrase: Presentation }) {
  const text = phraseCaptionText(phrase);
  return (
    <div
      role="group"
      aria-label="Animation stage"
      className={`phrase-caption${phrase.inDrawing ? " in-drawing" : ""}`}
    >
      <span className="phrase-caption-stage">{text.stage}</span>
      {text.parameters.map((parameter, k) => (
        <span className="phrase-caption-value" key={k}>
          {parameter}
        </span>
      ))}
    </div>
  );
}

// Character budgets are conservative even for full-width glyphs. Hard-split
// unspaced names too, so linked names cannot overflow the rendered page.
function wrapped(text: string, limit: number) {
  const lines: string[] = [];
  let line = "";
  // Keep the figure spaces that reserve numeric columns through zero.
  for (const word of text.split(/[^\S\u2007]+/).filter(Boolean)) {
    const letters = Array.from(word);
    if (line && Array.from(line).length + 1 + letters.length > limit) {
      lines.push(line);
      line = "";
    }
    while (letters.length > limit) {
      if (line) {
        lines.push(line);
        line = "";
      }
      lines.push(letters.splice(0, limit).join(""));
    }
    const remainder = letters.join("");
    if (remainder) line = line ? `${line} ${remainder}` : remainder;
  }
  if (line) lines.push(line);
  return lines;
}

export function SvgPhraseCaption({
  phrase,
  palette,
  dark,
}: {
  phrase: Presentation;
  palette: PlotPalette;
  dark: boolean;
}) {
  const text = phraseCaptionText(phrase);
  // Match the face-on grid's export captions: regular page type at 55% of
  // its 40-unit band, with the surrounding UI's muted ink in either theme.
  const fontSize = Math.round(captionBand * 0.55);
  const lines = [
    ...wrapped(text.stage, 42),
    ...text.parameters.flatMap((parameter) => wrapped(parameter, 42)),
  ];
  return (
    <g data-phrase-caption="true" aria-hidden="true" pointerEvents="none">
      {lines.map((line, i) => (
        <text
          key={i}
          x={captionBand * 0.4}
          y={736 - (lines.length - 1 - i) * 28}
          fontFamily="Inter, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif"
          fontSize={fontSize}
          fontWeight="400"
          style={{ fontVariantNumeric: "tabular-nums", whiteSpace: "pre" }}
          fill={dark ? "#91a4a9" : "#5f6d69"}
          stroke={palette.bg}
          strokeWidth="3"
          strokeLinejoin="round"
          paintOrder="stroke"
        >
          {line}
        </text>
      ))}
    </g>
  );
}
