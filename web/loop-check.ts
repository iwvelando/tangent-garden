// Seamless loops in the 2D and 4D notebooks (see timing.ts). A loop joins
// the motion's end to its start, so it is seamless only when the last frame
// is the first. Both notebooks draw each frame as SVG, the same markup that
// playback shows and export rasterizes, so the frames at progress 0 and 1
// are compared as markup: number for number within a hundredth of a pixel,
// and otherwise character for character. Metadata that records the inputs
// (a title, a description, data attributes) is left out, since a parameter
// that has run one period records a different value for the same drawing.
// When the markup differs, both frames are rasterized as export would
// rasterize them and compared pixel for pixel: an engine may return the
// same picture in another order after a whole turn, such as a section's
// segments chained from another vertex, and that is still the same frame.
// See mathematics.md#seamless-loops.

export const loopLead =
  "Repeat can loop only motion that ends where it starts, but";

// Far below a pixel at any export size, and far above the rounding of the
// drawing's coordinates, which are written to three decimals.
const tolerance = 0.01;
const number = /-?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?/gi;
const drawn = (markup: string) =>
  markup
    .replace(/<(title|desc|metadata)\b[^>]*>[\s\S]*?<\/\1>/g, "")
    .replace(/\s(?:data|aria)-[\w-]+="[^"]*"/g, "");

// The largest difference between corresponding numbers of two drawings, in
// the drawing's units (pixels at 1000 × 760), 0 within tolerance; "pieces"
// when anything else differs: an element, a command, a color, or how many
// numbers there are.
export function markupGap(a: string, b: string): number | "pieces" {
  const [p, q] = [drawn(a), drawn(b)];
  const [x, y] = [p.match(number) ?? [], q.match(number) ?? []];
  if (
    x.length !== y.length ||
    p.split(number).join("") !== q.split(number).join("")
  )
    return "pieces";
  let gap = 0;
  for (let i = 0; i < x.length; i++) {
    const d = Math.abs(Number(x[i]) - Number(y[i]));
    if (d > tolerance) gap = Math.max(gap, d);
  }
  return gap;
}

// Why the markup at the end is not the markup at the start, as a sentence
// ending with the advice, or null when they match.
export function markupRefusal(
  start: string,
  end: string,
  advice: string,
): string | null {
  const gap = markupGap(start, end);
  if (gap === "pieces")
    return `${loopLead} the drawing at the end has different pieces from the drawing at the start.${advice}`;
  if (gap > 0)
    return `${loopLead} the drawing at the end lies up to ${gap.toPrecision(2)} pixels from the drawing at the start.${advice}`;
  return null;
}

// Pixels that differ visibly: by more than an eighth of full scale in a
// channel. A whole picture drawn in another order differs only where
// antialiasing rounds differently; a motion that has not returned moves
// whole lines, thousands of pixels at 1000 × 760.
const visible = 32,
  share = 1e-4;

// The share of pixels that differ visibly between two drawings rasterized
// at width × height on white.
export async function rasterDifference(
  a: string,
  b: string,
  width: number,
  height: number,
): Promise<number> {
  const pixels = async (markup: string) => {
    const url = URL.createObjectURL(
      new Blob([markup], { type: "image/svg+xml" }),
    );
    try {
      const image = new Image();
      image.src = url;
      await image.decode();
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const context = canvas.getContext("2d", { alpha: false })!;
      context.fillStyle = "#fff";
      context.fillRect(0, 0, width, height);
      context.drawImage(image, 0, 0, width, height);
      return context.getImageData(0, 0, width, height).data;
    } finally {
      URL.revokeObjectURL(url);
    }
  };
  const [p, q] = [await pixels(a), await pixels(b)];
  let differ = 0;
  for (let i = 0; i < p.length; i += 4)
    if (
      Math.abs(p[i] - q[i]) > visible ||
      Math.abs(p[i + 1] - q[i + 1]) > visible ||
      Math.abs(p[i + 2] - q[i + 2]) > visible
    )
      differ++;
  return differ / (width * height);
}

// Why the frame at the end is not the frame at the start, or null when a
// loop can join them: the markup matches, or else the picture does.
export async function loopRefusal(
  start: string,
  end: string,
  advice: string,
  size: { width: number; height: number },
): Promise<string | null> {
  const refusal = markupRefusal(start, end, advice);
  if (!refusal) return null;
  return (await rasterDifference(start, end, size.width, size.height)) <= share
    ? null
    : refusal;
}
