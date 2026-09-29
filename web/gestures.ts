// Pointer gestures shared by every drawing: one pointer drags (pan in the
// plane, orbit in space), two pinch to zoom and move together to pan. Only
// the event fields are read, so a gesture can be exercised without a DOM.
export type GesturePointer = {
  pointerId: number;
  clientX: number;
  clientY: number;
  pointerType?: string;
  shiftKey?: boolean;
};
export type Motion =
  | { kind: "drag"; dx: number; dy: number; shift: boolean }
  // scale is the ratio of the fingers' distances since the last move, dx and
  // dy the movement of their midpoint, and mid where it now is.
  | {
      kind: "pinch";
      scale: number;
      dx: number;
      dy: number;
      mid: { x: number; y: number };
    };

export function createGesture() {
  const at = new Map<number, { x: number; y: number }>();
  return {
    // A third finger is ignored, so a pinch never changes partners.
    down(e: GesturePointer) {
      if (at.size < 2) at.set(e.pointerId, { x: e.clientX, y: e.clientY });
    },
    up(e: GesturePointer) {
      at.delete(e.pointerId);
    },
    get count() {
      return at.size;
    },
    // Each motion is measured from the pointers' last positions, so a finger
    // landing or lifting starts afresh from where the others are.
    move(e: GesturePointer): Motion | null {
      const before = at.get(e.pointerId);
      if (!before) return null;
      const after = { x: e.clientX, y: e.clientY };
      at.set(e.pointerId, after);
      if (at.size === 1)
        return {
          kind: "drag",
          dx: after.x - before.x,
          dy: after.y - before.y,
          shift: !!e.shiftKey,
        };
      const other = [...at].find(([id]) => id !== e.pointerId)![1];
      const span = (p: { x: number; y: number }) =>
        Math.hypot(p.x - other.x, p.y - other.y);
      const from = span(before),
        to = span(after);
      return {
        kind: "pinch",
        scale: from > 0 && to > 0 ? to / from : 1,
        dx: (after.x - before.x) / 2,
        dy: (after.y - before.y) / 2,
        mid: { x: (after.x + other.x) / 2, y: (after.y + other.y) / 2 },
      };
    },
  };
}
