import type { SpatialResult } from "./types";
import {
  buildScene,
  camera,
  scenePasses,
  type Batch,
  type Layers,
  type Scene,
  type View,
} from "./scene";
import { glsl, palette, vec3 } from "./palette";
import { cutEdges, isCut, type CutSpec } from "./cut";

export {
  defaultLayers,
  implicitMesh,
  initialView,
  receiverShade,
  type Layers,
  type View,
} from "./scene";
const vertexSource = `
attribute vec3 position;
attribute vec3 normal;
attribute float phase;
uniform mat3 rotation;
uniform vec3 framing;
uniform vec3 center;
uniform vec2 pan;
uniform vec4 cut;
varying vec3 N;
varying vec3 P;
varying float U;
varying float C;
void main() {
  P = rotation * (position - center);
  N = rotation * normal;
  U = phase;
  // (n̂·p − d) / radius, positive beyond the cut plane: computed here, at
  // the vertex stage's precision, and linear across every primitive.
  C = dot(cut.xyz, position - center) - cut.w;
  gl_Position = vec4((P.x + pan.x) * framing.x, (P.y + pan.y) * framing.y, -P.z * framing.z, 1.0);
}`;
const fragmentSource = `
precision mediump float;
varying vec3 N;
varying vec3 P;
varying float U;
varying float C;
uniform float ink;
uniform float dark;
uniform float cutting;
void main() {
  if (cutting > 0.5 && C > 0.0) discard;
  float blend = 0.5 + 0.5 * cos(6.2831853 * U);
  vec3 teal = ${glsl(palette.teal)};
  vec3 gold = ${glsl(palette.gold)};
  vec3 color = mix(teal,gold,blend);
  // A surface's focal sheets: rust for the first, slate for the second.
  vec3 rust = ${glsl(palette.rust)};
  vec3 slate = ${glsl(palette.slate)};
  if (ink > 11.5) {
    // The cut's edge.
    color = ${glsl(palette.cut)};
  } else if (ink > 7.5) {
    // The parameter probe: its point, circle and construction, then T, N, B.
    if (ink > 10.5) color = ${glsl(palette.probeBinormal)};
    else if (ink > 9.5) color = ${glsl(palette.probeNormal)};
    else if (ink > 8.5) color = ${glsl(palette.probeTangent)};
    else color = ${glsl(palette.probe)};
  } else if (ink > 6.5) {
    // A receiver's irradiance on a logarithmic ramp, unshaded and without
    // hue, since it is a measured quantity: ink on paper, or light on the
    // dark theme. U < 0 marks a bin no light reaches.
    vec3 empty = ${glsl(palette.empty)};
    vec3 faint = ${glsl(palette.faint)};
    vec3 full = ${glsl(palette.full)};
    color = U < 0.0 ? empty : mix(faint,full,U);
  } else if (ink > 5.5) {
    color = slate;
  } else if (ink > 4.5) {
    color = rust;
  } else if (ink > 3.5) {
    // Unwinding strings recede toward the background behind the filaments.
    color = ${glsl(palette.recede)};
  } else if (ink > 2.5) {
    // Involute filaments: deep teal drifting toward gold across a family by
    // member position (decorative, not a measured quantity).
    vec3 deep = mix(${vec3(palette.familyLast[0])},gold,dark);
    color = mix(${glsl(palette.familyFirst)},deep,0.7*U);
  } else if (ink > 0.5) {
    if (ink < 1.5) color = ${glsl(palette.construction)};
    else color = ${glsl(palette.curve)};
  } else {
    // Shaded sheets: a surface's offset in sage, its focal sheets in rust
    // and slate, anything else in the decorative teal and gold.
    if (ink < -2.5) color = slate;
    else if (ink < -1.5) color = rust;
    else if (ink < -0.5) color = ${glsl(palette.offset)};
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
    [
      "rotation",
      "framing",
      "center",
      "pan",
      "ink",
      "dark",
      "cut",
      "cutting",
    ].map((n) => [n, gl.getUniformLocation(program, n)]),
  );
  const wideIndices = !!gl.getExtension("OES_element_index_uint");
  // Each batch's buffers, remade with every upload.
  type Uploaded = {
    batch: Batch;
    buffer: WebGLBuffer;
    count: number;
    elements?: WebGLBuffer;
  };
  let scene: Scene | undefined;
  // The parameter probe's few batches have their own buffers, so moving it
  // never re-uploads the scene.
  let probe: Batch[] = [];
  const probeBuffers: WebGLBuffer[] = [];
  // The cut plane and its edge, remade when the plane, the scene or the
  // layers change.
  let cut: CutSpec | null = null;
  let edge: { key: unknown[]; batch: Batch | null } | undefined;
  const edgeBuffers: WebGLBuffer[] = [];
  const uploaded = new Map<Batch, Uploaded>();
  function put(batch: Batch, into = buffers) {
    // Indices past 65,535 need 32-bit elements, universal in practice;
    // without them a mesh is drawn corner by corner.
    let data = batch.data,
      indices = batch.indices;
    if (indices && !wideIndices) {
      const corners = new Float32Array(7 * indices.length);
      indices.forEach((v, i) =>
        corners.set(data.subarray(7 * v, 7 * v + 7), 7 * i),
      );
      data = corners;
      indices = undefined;
    }
    const buffer = gl!.createBuffer()!;
    into.push(buffer);
    gl!.bindBuffer(gl!.ARRAY_BUFFER, buffer);
    gl!.bufferData(gl!.ARRAY_BUFFER, data, gl!.STATIC_DRAW);
    const drawn: Uploaded = { batch, buffer, count: data.length / 7 };
    if (indices) {
      const elements = gl!.createBuffer()!;
      into.push(elements);
      gl!.bindBuffer(gl!.ELEMENT_ARRAY_BUFFER, elements);
      gl!.bufferData(gl!.ELEMENT_ARRAY_BUFFER, indices, gl!.STATIC_DRAW);
      drawn.count = indices.length;
      drawn.elements = elements;
    }
    uploaded.set(batch, drawn);
  }
  // Replaces the probe's batches (none to hide it).
  function setProbe(batches: Batch[]) {
    probeBuffers.splice(0).forEach((b) => gl!.deleteBuffer(b));
    probe.forEach((b) => uploaded.delete(b));
    probe = batches;
    probe.forEach((b) => put(b, probeBuffers));
  }
  function setCut(spec: CutSpec | null) {
    cut = spec;
  }
  function cutEdge(layers: Layers) {
    if (!scene || !cut?.edge) return null;
    const key = [scene, layers, cut];
    if (edge && edge.key.every((k, i) => k === key[i])) return edge.batch;
    edgeBuffers.splice(0).forEach((b) => gl!.deleteBuffer(b));
    if (edge?.batch) uploaded.delete(edge.batch);
    const batch = cutEdges(scenePasses(scene, layers), cut.plane, cut.scope);
    if (batch) put(batch, edgeBuffers);
    edge = { key, batch };
    return batch;
  }
  // A new result drops the probe, whose batches belong to the old one.
  function upload(result: SpatialResult) {
    setProbe([]);
    buffers.splice(0).forEach((b) => gl!.deleteBuffer(b));
    uploaded.clear();
    scene = buildScene(result);
    for (const value of Object.values(scene))
      (Array.isArray(value) ? value : [value]).forEach((b) => put(b));
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
    const background = palette.background[dark ? 1 : 0];
    gl!.clearColor(background[0], background[1], background[2], 1);
    gl!.clear(gl!.COLOR_BUFFER_BIT | gl!.DEPTH_BUFFER_BIT);
    if (!scene) return;
    gl!.useProgram(program);
    gl!.enable(gl!.DEPTH_TEST);
    gl!.depthFunc(gl!.LEQUAL);
    const k = camera(view, { width, height });
    gl!.uniformMatrix3fv(
      uniforms.rotation,
      false,
      new Float32Array(k.rotation),
    );
    gl!.uniform3f(uniforms.center, k.center.x, k.center.y, k.center.z);
    gl!.uniform2f(uniforms.pan, k.pan[0], k.pan[1]);
    gl!.uniform3f(uniforms.framing, ...k.framing);
    gl!.uniform1f(uniforms.dark, dark ? 1 : 0);
    // The plane relative to the view center, scaled by the radius.
    if (cut) {
      const n = cut.plane.normal,
        c = k.center,
        r = view.radius;
      gl!.uniform4f(
        uniforms.cut,
        n.x / r,
        n.y / r,
        n.z / r,
        (cut.plane.offset - (n.x * c.x + n.y * c.y + n.z * c.z)) / r,
      );
    }
    const render = (v: Uploaded & { cut: boolean }) => {
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
      gl!.uniform1f(uniforms.ink, v.batch.ink);
      gl!.uniform1f(uniforms.cutting, v.cut ? 1 : 0);
      const mode = v.batch.mode === "lines" ? gl!.LINES : gl!.TRIANGLES;
      if (v.elements) {
        gl!.bindBuffer(gl!.ELEMENT_ARRAY_BUFFER, v.elements);
        gl!.drawElements(mode, v.count, gl!.UNSIGNED_INT, 0);
      } else gl!.drawArrays(mode, 0, v.count);
    };
    for (const pass of scenePasses(scene, layers, probe, cutEdge(layers))) {
      const v = {
        ...uploaded.get(pass.batch)!,
        cut: !!cut && isCut(pass, cut.scope),
      };
      if (!pass.sheet) {
        render(v);
        continue;
      }
      gl!.enable(gl!.POLYGON_OFFSET_FILL);
      gl!.polygonOffset(1, 1);
      render(v);
      gl!.disable(gl!.POLYGON_OFFSET_FILL);
    }
  }
  return {
    upload,
    setProbe,
    setCut,
    draw,
    dispose: () => {
      buffers.forEach((b) => gl.deleteBuffer(b));
      probeBuffers.forEach((b) => gl.deleteBuffer(b));
      edgeBuffers.forEach((b) => gl.deleteBuffer(b));
      shaders.forEach((s) => gl.deleteShader(s));
      gl.deleteProgram(program);
    },
  };
}
