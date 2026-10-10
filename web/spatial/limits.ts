import { canvasFits, type Fits } from "../export-image";

// The largest page a WebGL context draws on, a side, and the largest
// texture: see-through sheets sum their layers in one of the page's size.
export function pageLimits(gl: WebGLRenderingContext) {
  return {
    side: Math.min(
      gl.getParameter(gl.MAX_RENDERBUFFER_SIZE) as number,
      ...(gl.getParameter(gl.MAX_VIEWPORT_DIMS) as Int32Array),
    ),
    texture: gl.getParameter(gl.MAX_TEXTURE_SIZE) as number,
  };
}

// This device's limits, read once from a context made for the purpose.
// Null without WebGL, where nothing is drawn to export.
let device: ReturnType<typeof pageLimits> | null | undefined;
export function deviceLimits() {
  if (device === undefined) {
    const gl = document.createElement("canvas").getContext("webgl");
    device = gl ? pageLimits(gl) : null;
    gl?.getExtension("WEBGL_lose_context")?.loseContext();
  }
  return device;
}

// Whether a 3D page fits: its WebGL limits, the see-through target's when
// sheets are seen through, and for a transparent still the canvas its
// matte is composed on. A page the drawing buffer cannot hold is still
// refused when drawn (see renderer.ts).
export const spatialFits =
  (through: boolean): Fits =>
  (size, transparent) => {
    const limits = deviceLimits();
    if (!limits) return true;
    const side = Math.max(size.width, size.height);
    return (
      side <= limits.side &&
      (!through || side <= limits.texture) &&
      (!transparent || canvasFits(size))
    );
  };
