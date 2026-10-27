import { fitFrame, viewRect } from "./Plot";
import type { AtlasCell } from "./atlas";

// Fit each member through the ordinary robust production path first. Union
// its padded view, never pool samples and fence away a small distant member.
// A common scalar scale keeps both axes equal. Invalid cells contribute nothing.
export function atlasSharedFrame(cells: readonly AtlasCell[]) {
  const frames = cells.flatMap((c) =>
    c.frame ? [fitFrame(c.frame.result, c.frame.config)] : [],
  );
  if (!frames.length) return undefined;
  let x0 = Infinity,
    x1 = -Infinity,
    y0 = Infinity,
    y1 = -Infinity;
  for (const frame of frames) {
    const w = viewRect(frame);
    x0 = Math.min(x0, w.x0);
    x1 = Math.max(x1, w.x1);
    y0 = Math.min(y0, w.y0);
    y1 = Math.max(y1, w.y1);
  }
  return {
    cx: x0 / 2 + x1 / 2,
    cy: y0 / 2 + y1 / 2,
    scale: Math.min(1000 / (x1 - x0), 760 / (y1 - y0)),
    span: Math.max(...frames.map((f) => f.span), x1 - x0, y1 - y0),
  };
}
