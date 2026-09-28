import type { SpatialResult, Vec3, Bounds3 } from "./types";

export type View = Bounds3 & {
  yaw: number;
  pitch: number;
  zoom: number;
  panX: number;
  panY: number;
};
export const initialView = { yaw: 0.3, pitch: 0.75, zoom: 1, panX: 0, panY: 0 };
// Surface, rulings, and edges belong to the tangent developable; filaments
// and strings to the involute. The base curve is always drawn.
export type Layers = {
  surface: boolean;
  rulings: boolean;
  edges: boolean;
  filaments: boolean;
  strings: boolean;
};
export const defaultLayers: Layers = {
  surface: true,
  rulings: true,
  edges: true,
  filaments: true,
  strings: true,
};
const vertexSource = `
attribute vec3 position;
attribute vec3 normal;
attribute float phase;
uniform mat3 rotation;
uniform vec3 framing;
uniform vec3 center;
uniform vec2 pan;
varying vec3 N;
varying vec3 P;
varying float U;
void main() {
  P = rotation * (position - center);
  N = rotation * normal;
  U = phase;
  gl_Position = vec4((P.x + pan.x) * framing.x, (P.y + pan.y) * framing.y, -P.z * framing.z, 1.0);
}`;
const fragmentSource = `
precision mediump float;
varying vec3 N;
varying vec3 P;
varying float U;
uniform float ink;
uniform float dark;
void main() {
  float blend = 0.5 + 0.5 * cos(6.2831853 * U);
  vec3 teal = mix(vec3(0.30,0.62,0.56),vec3(0.23,0.70,0.67),dark);
  vec3 gold = mix(vec3(0.90,0.66,0.36),vec3(0.94,0.65,0.31),dark);
  vec3 color = mix(teal,gold,blend);
  if (ink > 3.5) {
    // Unwinding strings recede toward the background behind the filaments.
    color = mix(vec3(0.58,0.66,0.63),vec3(0.24,0.37,0.37),dark);
  } else if (ink > 2.5) {
    // Involute filaments: deep teal drifting toward gold across a family by
    // member position (decorative, not a measured quantity).
    vec3 deep = mix(vec3(0.66,0.40,0.12),gold,dark);
    color = mix(mix(vec3(0.04,0.38,0.36),vec3(0.40,0.88,0.80),dark),deep,0.7*U);
  } else if (ink > 0.5) {
    if (ink < 1.5) color = mix(vec3(0.10,0.30,0.29),vec3(0.63,0.89,0.83),dark);
    else color = mix(vec3(0.50,0.25,0.09),vec3(1.0,0.87,0.58),dark);
  } else {
    vec3 n = normalize(N);
    if (!gl_FrontFacing) n = -n;
    float key = abs(dot(n,normalize(vec3(-0.4,0.7,1.0))));
    float sheen = pow(abs(dot(n,normalize(vec3(0.2,0.8,1.4)))),24.0);
    color = color * (mix(0.58,0.38,dark) + mix(0.42,0.62,dark)*key) + vec3(0.23,0.25,0.22)*sheen;
  }
  gl_FragColor = vec4(color,1.0);
}`;

// Rendering only: all curve samples, analytic normals and mesh topology come
// from Go. The camera is orthographic with identical scale on all three axes.
export function createRenderer(canvas: HTMLCanvasElement) {
  const gl = canvas.getContext("webgl", {
    antialias: true,
    alpha: false,
    preserveDrawingBuffer: true,
  });
  if (!gl)
    throw new Error(
      "This 3D study needs WebGL. The 2D notebook is still available.",
    );
  const shaders: WebGLShader[] = [];
  const buffers: WebGLBuffer[] = [];
  const program = gl.createProgram()!;
  const shader = (type: number, source: string) => {
    const s = gl.createShader(type)!;
    shaders.push(s);
    gl.shaderSource(s, source);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS))
      throw new Error("The 3D shader could not compile.");
    gl.attachShader(program, s);
  };
  shader(gl.VERTEX_SHADER, vertexSource);
  shader(gl.FRAGMENT_SHADER, fragmentSource);
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS))
    throw new Error("The 3D renderer could not start.");
  const attributes = ["position", "normal", "phase"].map((n) =>
    gl.getAttribLocation(program, n),
  );
  const uniforms = Object.fromEntries(
    ["rotation", "framing", "center", "pan", "ink", "dark"].map((n) => [
      n,
      gl.getUniformLocation(program, n),
    ]),
  );
  type Batch = {
    buffer: WebGLBuffer;
    count: number;
    mode: number;
    ink: number;
  };
  let mesh: Batch,
    base: Batch,
    minus: Batch,
    plus: Batch,
    rulings: Batch,
    filaments: Batch,
    strings: Batch;

  function batch(data: number[], mode: number, ink: number): Batch {
    const buffer = gl!.createBuffer()!;
    buffers.push(buffer);
    gl!.bindBuffer(gl!.ARRAY_BUFFER, buffer);
    gl!.bufferData(gl!.ARRAY_BUFFER, new Float32Array(data), gl!.STATIC_DRAW);
    return { buffer, count: data.length / 7, mode, ink };
  }
  function pairs(points: (Vec3 | null)[], breaks: boolean[]) {
    const out: Vec3[] = [];
    for (let i = 1; i < points.length; i++)
      if (points[i - 1] && points[i] && !breaks[i])
        out.push(points[i - 1]!, points[i]!);
    return out;
  }
  const vertices = (points: Vec3[], phase = 0) =>
    points.flatMap((p) => [p.x, p.y, p.z, 0, 0, 1, phase]);
  function path(points: (Vec3 | null)[], breaks: boolean[], ink: number) {
    return batch(vertices(pairs(points, breaks)), gl!.LINES, ink);
  }
  // Every member shares the base's breaks: arc length never crosses one, so
  // a member has no points beyond it. A collapsed member (a line's involute)
  // is one point, marked by a small three-axis cross sized to the study.
  function filamentBatch(result: SpatialResult) {
    const members = result.involute?.members ?? [];
    const arm = result.bounds.radius * 0.025;
    const data = members.flatMap((m, k) => {
      const phase = members.length > 1 ? k / (members.length - 1) : 0;
      const at = m.points.find((p) => p);
      if (m.collapsed && at)
        return vertices(
          (["x", "y", "z"] as const).flatMap((axis) => [
            { ...at, [axis]: at[axis] - arm },
            { ...at, [axis]: at[axis] + arm },
          ]),
          phase,
        );
      return vertices(pairs(m.points, result.breaks), phase);
    });
    return batch(data, gl!.LINES, 3);
  }
  function upload(result: SpatialResult) {
    buffers.splice(0).forEach((b) => gl!.deleteBuffer(b));
    mesh = batch(
      result.mesh.flatMap((v) => [
        v.position.x,
        v.position.y,
        v.position.z,
        v.normal.x,
        v.normal.y,
        v.normal.z,
        v.phase,
      ]),
      gl!.TRIANGLES,
      0,
    );
    base = path(result.base, result.breaks, 2);
    minus = path(result.minus, result.breaks, 2);
    plus = path(result.plus, result.breaks, 2);
    rulings = batch(
      result.rulings
        .flatMap((r) => [r.from, r.to])
        .flatMap((p) => [p.x, p.y, p.z, 0, 0, 1, 0]),
      gl!.LINES,
      1,
    );
    filaments = filamentBatch(result);
    strings = batch(
      vertices((result.involute?.strings ?? []).flatMap((r) => [r.from, r.to])),
      gl!.LINES,
      4,
    );
  }
  function draw(
    view: View,
    layers: Layers,
    dark: boolean,
    size?: { width: number; height: number },
  ) {
    const ratio = Math.min(devicePixelRatio || 1, 2);
    const width = Math.max(
        1,
        size?.width ?? Math.round(canvas.clientWidth * ratio),
      ),
      height = Math.max(
        1,
        size?.height ?? Math.round(canvas.clientHeight * ratio),
      );
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
    }
    gl!.viewport(0, 0, width, height);
    const background = (dark ? [11, 21, 23] : [243, 241, 234]).map(
      (c) => c / 255,
    );
    gl!.clearColor(background[0], background[1], background[2], 1);
    gl!.clear(gl!.COLOR_BUFFER_BIT | gl!.DEPTH_BUFFER_BIT);
    if (!mesh) return;
    gl!.useProgram(program);
    gl!.enable(gl!.DEPTH_TEST);
    gl!.depthFunc(gl!.LEQUAL);
    const c = Math.cos(view.yaw),
      s = Math.sin(view.yaw),
      a = Math.cos(view.pitch),
      b = Math.sin(view.pitch);
    gl!.uniformMatrix3fv(
      uniforms.rotation,
      false,
      new Float32Array([c, b * s, -a * s, 0, a, b, s, -b * c, a * c]),
    );
    const radius = view.radius;
    gl!.uniform3f(uniforms.center, view.center.x, view.center.y, view.center.z);
    gl!.uniform2f(uniforms.pan, view.panX, view.panY);
    const scale = view.zoom / (radius * 1.16),
      aspect = width / height;
    gl!.uniform3f(
      uniforms.framing,
      scale / Math.max(1, aspect),
      scale * Math.min(1, aspect),
      1 / (radius * 4),
    );
    gl!.uniform1f(uniforms.dark, dark ? 1 : 0);
    const render = (v: Batch) => {
      gl!.bindBuffer(gl!.ARRAY_BUFFER, v.buffer);
      attributes.forEach((loc, i) => {
        gl!.enableVertexAttribArray(loc);
        gl!.vertexAttribPointer(
          loc,
          i === 2 ? 1 : 3,
          gl!.FLOAT,
          false,
          28,
          i === 0 ? 0 : i === 1 ? 12 : 24,
        );
      });
      gl!.uniform1f(uniforms.ink, v.ink);
      gl!.drawArrays(v.mode, 0, v.count);
    };
    if (layers.surface) {
      gl!.enable(gl!.POLYGON_OFFSET_FILL);
      gl!.polygonOffset(1, 1);
      render(mesh);
      gl!.disable(gl!.POLYGON_OFFSET_FILL);
    }
    if (layers.rulings) render(rulings);
    if (layers.edges) {
      render(minus);
      render(plus);
    }
    if (layers.strings) render(strings);
    if (layers.filaments) render(filaments);
    render(base);
  }
  return {
    upload,
    draw,
    dispose: () => {
      buffers.forEach((b) => gl.deleteBuffer(b));
      shaders.forEach((s) => gl.deleteShader(s));
      gl.deleteProgram(program);
    },
  };
}
