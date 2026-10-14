// Zooming the drawing's own camera about a point of the page, and the
// geometry drawn there that a lens zooms toward. See
// mathematics.md#the-manual-camera-in-perspective.
import type { Vec3 } from "./types";
import {
  camera,
  cameraFrom,
  clip,
  planeFrom,
  project,
  turntableAngle,
  type Pass,
  type View,
} from "./scene";
import { hiddenBy, isCut, specPlanes, type CutSpec } from "./cut";
import { clippedLine, keptLine, spaceAt } from "./linework";
import { turntableBasis } from "../named-views";

export type PagePoint = { x: number; y: number };
export type Size = { width: number; height: number };
export type Zoomed = Pick<View, "zoom" | "panX" | "panY" | "targetDepth">;

// How near the pointer, in page pixels, a line must be drawn to be zoomed
// toward.
export const zoomReach = 12;
// The zoom's lower limit; the upper one depends on the study.
export const minZoom = 0.2;

// The drawn geometry at a point of the page, in world coordinates: where
// the line of sight through it crosses a shaded sheet, or the point of a
// line drawn within reach of it on the page that is nearest it there. Of
// these, the one drawn nearest the point wins, and of those drawn within a
// pixel of that, the nearest the viewer, so a sheet or line under the
// pointer beats a nearer line beside it. Only what the view draws counts:
// inside its clip volume (so nothing behind the eye), and not hidden by
// the cut. Null when nothing is drawn there.
export function pickAt(
  passes: Pass[],
  view: View,
  size: Size,
  at: PagePoint,
  cut: CutSpec | null = null,
  reach = zoomReach,
): Vec3 | null {
  const k = camera(view, size),
    r = k.rotation;
  // The line of sight through the point, as the camera's own arithmetic
  // draws it: the point it passes at Z toward the viewer from the camera's
  // center, in rotated coordinates (see scene.ts's clip).
  const nx = (2 * at.x) / size.width - 1,
    ny = 1 - (2 * at.y) / size.height;
  const sight = (Z: number) => {
    const w = 1 - Z * k.lens[0];
    const X = (nx * w) / k.framing[0] - k.pan[0],
      Y = (ny * w) / k.framing[1] - k.pan[1];
    return [
      k.center.x + X * r[0] + Y * r[1] + Z * r[2],
      k.center.y + X * r[3] + Y * r[4] + Z * r[5],
      k.center.z + X * r[6] + Y * r[7] + Z * r[8],
    ];
  };
  const near = sight(0),
    far = sight(-1);
  const dir = [far[0] - near[0], far[1] - near[1], far[2] - near[2]];
  const planes = cut ? specPlanes(cut) : [],
    beyond = cut?.beyond ?? "every",
    sides = new Float64Array(planes.length);
  let best: Vec3 | null = null,
    closest = Infinity,
    nearest = Infinity;
  for (const pass of passes) {
    const { data, indices, mode, origin } = pass.batch;
    const o = origin ?? { x: 0, y: 0, z: 0 };
    const kk = cameraFrom(k, origin),
      kept = planes.map((p) => planeFrom(p, origin)),
      cuts = !!cut && isCut(pass, cut.scope);
    // A point of this batch the view draws, gap pixels from the page's
    // point, kept when it wins.
    const consider = (x: number, y: number, z: number, gap: number) => {
      const c = clip(kk, x, y, z);
      if (!(c[3] > 0) || Math.abs(c[2]) > c[3]) return;
      const depth = c[2] / c[3];
      const wins =
        Math.abs(gap - closest) <= 1 ? depth < nearest : gap < closest;
      if (!wins) return;
      if (cuts) {
        kept.forEach((plane, i) => {
          const n = plane.normal;
          sides[i] = n.x * x + n.y * y + n.z * z - plane.offset;
        });
        if (hiddenBy(sides, beyond)) return;
      }
      closest = gap;
      nearest = depth;
      best = { x: x + o.x, y: y + o.y, z: z + o.z };
    };
    const count = indices ? indices.length : data.length / 7;
    const v = (i: number) => 7 * (indices ? indices[i] : i);
    const s = [near[0] - o.x, near[1] - o.y, near[2] - o.z];
    if (mode === "triangles")
      for (let i = 0; i + 2 < count; i += 3) {
        // Where the line of sight crosses the triangle (Möller–Trumbore).
        const a = v(i),
          b = v(i + 1),
          c = v(i + 2);
        const e1x = data[b] - data[a],
          e1y = data[b + 1] - data[a + 1],
          e1z = data[b + 2] - data[a + 2],
          e2x = data[c] - data[a],
          e2y = data[c + 1] - data[a + 1],
          e2z = data[c + 2] - data[a + 2];
        const px = dir[1] * e2z - dir[2] * e2y,
          py = dir[2] * e2x - dir[0] * e2z,
          pz = dir[0] * e2y - dir[1] * e2x;
        const det = e1x * px + e1y * py + e1z * pz;
        if (!det) continue;
        const tx = s[0] - data[a],
          ty = s[1] - data[a + 1],
          tz = s[2] - data[a + 2];
        const u = (tx * px + ty * py + tz * pz) / det;
        if (!(u >= 0 && u <= 1)) continue;
        const qx = ty * e1z - tz * e1y,
          qy = tz * e1x - tx * e1z,
          qz = tx * e1y - ty * e1x;
        const w = (dir[0] * qx + dir[1] * qy + dir[2] * qz) / det;
        if (!(w >= 0 && u + w <= 1)) continue;
        const t = (e2x * qx + e2y * qy + e2z * qz) / det;
        consider(s[0] + t * dir[0], s[1] + t * dir[1], s[2] + t * dir[2], 0);
      }
    else
      for (let i = 0; i + 1 < count; i += 2) {
        const a = v(i),
          b = v(i + 1);
        // The segment's two vertices, as the cut's and clip's rules take
        // them.
        const pair = indices
          ? Float32Array.of(
              ...data.subarray(a, a + 7),
              ...data.subarray(b, b + 7),
            )
          : data;
        const start = indices ? 0 : a;
        const parts = cuts
          ? keptLine(kept, beyond, pair, start)
          : [{ ends: pair.subarray(start, start + 14) }];
        for (const { ends: e } of parts) {
          const piece = clippedLine(
            kk,
            clip(kk, e[0], e[1], e[2]),
            clip(kk, e[7], e[8], e[9]),
          );
          if (!piece) continue;
          const [p0, p1, range, w] = piece;
          // The drawn piece's point nearest the pointer on the page.
          const dx = p1.x - p0.x,
            dy = p1.y - p0.y,
            dd = dx * dx + dy * dy;
          const f =
            dd > 0
              ? Math.min(
                  1,
                  Math.max(0, ((at.x - p0.x) * dx + (at.y - p0.y) * dy) / dd),
                )
              : 0;
          const gap = Math.hypot(p0.x + f * dx - at.x, p0.y + f * dy - at.y);
          if (gap > reach) continue;
          const g = range[0] + spaceAt(w, f) * (range[1] - range[0]);
          consider(
            e[0] + g * (e[7] - e[0]),
            e[1] + g * (e[8] - e[1]),
            e[2] + g * (e[9] - e[2]),
            gap,
          );
        }
      }
  }
  return best;
}

// The camera zoomed by factor about a point of the page, within the zoom
// limits. The plane through its target is drawn at the orthographic scale,
// which pan moves in world units, so the point of that plane under the
// page's point stays there. Through a lens, a picked point (see pickAt)
// first becomes the target's depth: the eye stays put, so nothing moves,
// and the zoom becomes the scale the point is drawn at. Zoom then moves
// the eye toward the picked point, which it never reaches, rather than
// toward the plane through the study's center, and about where the point
// is drawn, which may be a line's within reach of the page's point, so it
// stays there. The depth stops where the zoom limits would; without a lens
// there is no depth to move.
export function zoomAbout(
  view: View,
  size: Size,
  at: PagePoint,
  factor: number,
  limit: number,
  picked: Vec3 | null = null,
): Zoomed {
  let { zoom: from, targetDepth } = view;
  const fov = turntableAngle(view);
  if (picked && fov && !view.framedTarget) {
    const tan = Math.tan((fov * Math.PI) / 360),
      reach = 1.16 * view.radius;
    const back = turntableBasis(view.yaw, view.pitch).back,
      depth = targetDepth ?? 0,
      d = reach / (view.zoom * tan);
    // How far the point stands ahead of the eye, along the line of sight.
    const ahead =
      back[0] * (view.center.x - picked.x) +
      back[1] * (view.center.y - picked.y) +
      back[2] * (view.center.z - picked.z) +
      depth +
      d;
    if (ahead > 0) {
      from = Math.min(limit, Math.max(minZoom, reach / (ahead * tan)));
      targetDepth = depth + d - reach / (from * tan);
      at = project(camera(view, size), picked);
    }
  }
  const zoom = Math.max(minZoom, Math.min(limit, from * factor));
  const unit = (2 * view.radius * 1.16) / Math.min(size.width, size.height);
  const u = at.x - size.width / 2,
    w = at.y - size.height / 2;
  return {
    zoom,
    panX: view.panX - u * unit * (1 / from - 1 / zoom),
    panY: view.panY + w * unit * (1 / from - 1 / zoom),
    ...(targetDepth !== undefined && { targetDepth }),
  };
}
