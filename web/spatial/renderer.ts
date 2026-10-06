import type { SpatialResult } from "./types";
import {
  buildScene,
  camera,
  sceneLayers,
  scenePasses,
  type Batch,
  type Layers,
  type Scene,
  type View,
} from "./scene";
import { glsl, palette, vec3 } from "./palette";
import { cutEdges, isCut, maxCutPlanes, specPlanes, type CutSpec } from "./cut";
import {
  arcLengths,
  dashOn,
  dashedOpacity,
  dashesPerUnit,
  defaultSight,
  faintOpacity,
  isPlain,
  sheetOffset,
  strokeJoins,
  strokeWidth,
  type Sight,
} from "./sight";

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
// Length along a line in space, for dashes (see sight.ts).
attribute float arc;
uniform float dashes;
uniform mat3 rotation;
uniform vec3 framing;
// Perspective (see scene.ts's camera); zero for the orthographic camera,
// whose w is then exactly 1.
uniform vec3 lens;
uniform vec3 center;
uniform vec2 pan;
uniform vec4 cut[6];
varying vec3 N;
varying vec3 P;
varying float U;
varying vec3 C;
varying vec3 E;
varying highp float D;
// Each cut plane's (n̂·p − d) / radius, positive beyond it: planes 1–3 and
// 4–6, computed at the vertex stage's precision and linear across every
// primitive. A plane the cut lacks is a constant that never decides.
vec3 lowSides(vec3 p) {
  vec3 q = p - center;
  return vec3(dot(cut[0].xyz, q) - cut[0].w, dot(cut[1].xyz, q) - cut[1].w, dot(cut[2].xyz, q) - cut[2].w);
}
vec3 highSides(vec3 p) {
  vec3 q = p - center;
  return vec3(dot(cut[3].xyz, q) - cut[3].w, dot(cut[4].xyz, q) - cut[4].w, dot(cut[5].xyz, q) - cut[5].w);
}
void main() {
  D = arc * dashes;
  P = rotation * (position - center);
  N = rotation * normal;
  U = phase;
  C = lowSides(position);
  E = highSides(position);
  float w = 1.0 - P.z * lens.x;
  gl_Position = vec4((P.x + pan.x) * framing.x, (P.y + pan.y) * framing.y, -P.z * framing.z + lens.y * w + lens.z, w);
}`;
// Strokes: each line segment as a quad two pixels longer and wider than its
// stroke on the page, one instance per segment of a line batch's pairs.
// corner.x picks the segment's start or end, corner.y its side. The segment
// is clipped to the near plane before projection, so a line passing behind
// a perspective eye keeps its visible part. S carries the page position
// across and along the segment in pixels, times w with w itself, so the
// fragment stage can undo perspective interpolation: these are page
// distances, linear on the page.
const strokeVertexSource = `
attribute vec2 corner;
attribute vec3 from;
attribute vec3 to;
attribute float phase;
attribute float arcFrom;
attribute float arcTo;
// The neighbors across each end's joint, with 1, or 0 where the polyline
// starts or ends (see sight.ts's strokeJoins).
attribute vec4 before;
attribute vec4 after;
uniform float dashes;
uniform mat3 rotation;
uniform vec3 framing;
uniform vec3 lens;
uniform vec3 center;
uniform vec2 pan;
uniform vec4 cut[6];
uniform vec2 viewport;
uniform float halfWidth;
uniform float caps;
varying float U;
varying vec3 C;
varying vec3 E;
varying highp float D;
varying highp vec3 S;
varying highp float L;
// Whether the start and the end are mitred joints rather than ends.
varying vec2 O;
// Each cut plane's (n̂·p − d) / radius, positive beyond it: planes 1–3 and
// 4–6, computed at the vertex stage's precision and linear across every
// primitive. A plane the cut lacks is a constant that never decides.
vec3 lowSides(vec3 p) {
  vec3 q = p - center;
  return vec3(dot(cut[0].xyz, q) - cut[0].w, dot(cut[1].xyz, q) - cut[1].w, dot(cut[2].xyz, q) - cut[2].w);
}
vec3 highSides(vec3 p) {
  vec3 q = p - center;
  return vec3(dot(cut[3].xyz, q) - cut[3].w, dot(cut[4].xyz, q) - cut[4].w, dot(cut[5].xyz, q) - cut[5].w);
}
vec4 clipOf(vec3 p) {
  vec3 q = rotation * (p - center);
  float w = 1.0 - q.z * lens.x;
  return vec4((q.x + pan.x) * framing.x, (q.y + pan.y) * framing.y, -q.z * framing.z + lens.y * w + lens.z, w);
}
// Whether an end at page point p is a mitred joint with its neighbor: the
// neighbor is ahead of the near plane, both segments have length, and the
// polyline turns there by less than 120°. turn is the neighbor's segment's
// direction on the page, along the polyline.
float joint(vec4 neighbor, float flag, vec2 p, bool atEnd, vec2 dir, float len, vec2 scale, out vec2 turn) {
  turn = dir;
  if (flag < 0.5 || len <= 1e-4) return 0.0;
  vec4 n = clipOf(neighbor.xyz);
  if (n.z + n.w < 0.0 || n.w <= 1e-6) return 0.0;
  vec2 q = n.xy / n.w * scale;
  vec2 side = atEnd ? q - p : p - q;
  float l = length(side);
  if (l <= 1e-4) return 0.0;
  turn = side / l;
  return dot(turn, dir) < -0.5 ? 0.0 : 1.0;
}
void main() {
  vec4 a = clipOf(from), b = clipOf(to);
  vec3 ca = lowSides(from), cb = lowSides(to),
    ea = highSides(from), eb = highSides(to);
  float sa = arcFrom, sb = arcTo;
  U = phase;
  // Clip space keeps z ≥ −w: the near plane.
  float na = a.z + a.w, nb = b.z + b.w;
  if (na < 0.0 && nb < 0.0) {
    C = vec3(0.0); E = vec3(0.0); D = 0.0; S = vec3(0.0, 0.0, 1.0); L = 0.0; O = vec2(0.0);
    gl_Position = vec4(0.0, 0.0, 2.0, 1.0);
    return;
  }
  // A clipped end is an end, not a joint.
  float joinA = before.w, joinB = after.w;
  if (na < 0.0) {
    float t = na / (na - nb);
    a = mix(a, b, t); ca = mix(ca, cb, t); ea = mix(ea, eb, t); sa = mix(sa, sb, t);
    joinA = 0.0;
  } else if (nb < 0.0) {
    float t = nb / (nb - na);
    b = mix(b, a, t); cb = mix(cb, ca, t); eb = mix(eb, ea, t); sb = mix(sb, sa, t);
    joinB = 0.0;
  }
  vec2 scale = 0.5 * viewport;
  vec2 pa = a.xy / a.w * scale, pb = b.xy / b.w * scale;
  vec2 d = pb - pa;
  float len = length(d);
  vec2 dir = len > 1e-4 ? d / len : vec2(1.0, 0.0);
  vec2 across = vec2(-dir.y, dir.x);
  float reach = halfWidth + 1.0;
  bool end = corner.x > 0.5;
  // Both joints, at every corner, so the quad agrees on them.
  vec2 turnA, turnB;
  float atA = joint(before, joinA, pa, false, dir, len, scale, turnA),
    atB = joint(after, joinB, pb, true, dir, len, scale, turnB);
  float joined = end ? atB : atA;
  vec2 turn = end ? turnB : turnA;
  vec4 e = end ? b : a;
  vec2 shift;
  float along;
  if (joined > 0.5) {
    // The bisector of the two segments' normals: both segments put this
    // corner at the same point, reach from either centerline.
    vec2 m = normalize(across + vec2(-turn.y, turn.x));
    shift = m * corner.y * (reach / max(dot(m, across), 0.25));
    along = (end ? len : 0.0) + dot(shift, dir);
  } else {
    // Round ends reach past the segment; butt ends only to their fringe.
    float ext = caps > 0.5 ? reach : 0.5;
    shift = dir * (end ? ext : -ext) + across * corner.y * reach;
    along = end ? len + ext : -ext;
  }
  gl_Position = vec4(e.xy + shift / scale * e.w, e.z, e.w);
  S = vec3(along, corner.y * reach, 1.0) * e.w;
  L = len;
  O = vec2(atA, atB);
  C = end ? cb : ca;
  E = end ? eb : ea;
  D = (end ? sb : sa) * dashes;
}`;
// The drawing's colors, for sheets and hairlines, and for strokes with
// STROKE defined, where coverage of the stroke becomes alpha.
const fragmentBody = `
precision mediump float;
#ifndef STROKE
varying vec3 N;
varying vec3 P;
#else
#ifdef GL_FRAGMENT_PRECISION_HIGH
varying highp vec3 S;
varying highp float L;
#else
varying mediump vec3 S;
varying mediump float L;
#endif
// The vertex stage's half width and ends, under their own names: a uniform
// in both stages would need one precision in both.
uniform float coverHalf;
uniform float coverCaps;
uniform float fade;
varying vec2 O;
#endif
varying float U;
varying vec3 C;
varying vec3 E;
#ifdef GL_FRAGMENT_PRECISION_HIGH
varying highp float D;
#else
varying mediump float D;
#endif
uniform float ink;
uniform float dark;
uniform float cutting;
// 1 when hidden beyond every plane, 0 beyond any.
uniform float cutEvery;
// 1 while gathering see-through sheets; 1 or 2 while drawing lines behind
// sheets, faint or dashed.
uniform float gather;
uniform float behind;
void main() {
  if (cutting > 0.5) {
    float far = max(max(max(C.x, C.y), max(C.z, E.x)), max(E.y, E.z)),
      near = min(min(min(C.x, C.y), min(C.z, E.x)), min(E.y, E.z));
    if ((cutEvery > 0.5 ? near : far) > 0.0) discard;
  }
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
  }
#ifndef STROKE
  else {
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
  if (gather > 0.5) gl_FragColor = vec4(color,1.0);
  else if (behind > 1.5) {
    if (fract(D) >= ${dashOn.toFixed(4)}) discard;
    gl_FragColor = vec4(color,${dashedOpacity.toFixed(4)});
  } else if (behind > 0.5) gl_FragColor = vec4(color,${faintOpacity.toFixed(4)});
  else gl_FragColor = vec4(color,1.0);
#else
  // The share of the pixel inside the stroke: its distance from the
  // centerline, and at a polyline's own ends a round cap or a butt end
  // with a one-pixel fringe. A stroke narrower than a pixel is drawn a
  // pixel wide, faded by its width.
  vec2 s = S.xy / S.z;
  float cover;
  // Past a mitred joint the neighbor's quad takes over at their shared
  // edge, so the stroke runs on; only a polyline's own ends are capped.
  float before = O.x > 0.5 ? 1e6 : s.x, after = O.y > 0.5 ? 1e6 : L - s.x;
  if (coverCaps > 0.5) {
    float beyond = max(max(-before, -after), 0.0);
    cover = clamp(coverHalf + 0.5 - length(vec2(beyond, s.y)), 0.0, 1.0);
  } else
    cover = clamp(coverHalf + 0.5 - abs(s.y), 0.0, 1.0) * clamp(before + 0.5, 0.0, 1.0) * clamp(after + 0.5, 0.0, 1.0);
  cover *= fade;
  if (cover < 0.004) discard;
  if (behind > 1.5) {
    if (fract(D) >= ${dashOn.toFixed(4)}) discard;
    gl_FragColor = vec4(color,${dashedOpacity.toFixed(4)}*cover);
  } else if (behind > 0.5) gl_FragColor = vec4(color,${faintOpacity.toFixed(4)}*cover);
  else gl_FragColor = vec4(color,cover);
#endif
}`;
const fragmentSource = fragmentBody,
  strokeFragmentSource = "#define STROKE\n" + fragmentBody;
// See-through sheets: every layer's shaded color and a count were summed at
// each pixel, so the mean color covers the background by 1 − (1 − α)ⁿ.
const coverVertex = `
attribute vec2 corner;
void main() { gl_Position = vec4(corner, 0.0, 1.0); }`;
const coverFragment = `
precision highp float;
uniform sampler2D layers;
uniform vec2 size;
uniform vec3 background;
uniform float alpha;
void main() {
  vec4 sum = texture2D(layers, gl_FragCoord.xy / size);
  if (sum.a < 0.5) {
    gl_FragColor = vec4(background,1.0);
    return;
  }
  float cover = 1.0 - pow(1.0 - alpha, sum.a);
  gl_FragColor = vec4(mix(background, sum.rgb / sum.a, cover),1.0);
}`;

// Rendering only: all curve samples, analytic normals and mesh topology come
// from Go. The camera is orthographic with identical scale on all three axes,
// or a perspective camera while riding a ray (see scene.ts).
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
  const shader = (program: WebGLProgram, type: number, source: string) => {
    const s = gl.createShader(type)!;
    shaders.push(s);
    gl.shaderSource(s, source);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS))
      throw new Error("The 3D shader could not compile.");
    gl.attachShader(program, s);
  };
  const link = (vertex: string, fragment: string, names: string[]) => {
    const program = gl.createProgram()!;
    shader(program, gl.VERTEX_SHADER, vertex);
    shader(program, gl.FRAGMENT_SHADER, fragment);
    names.forEach((n, i) => gl.bindAttribLocation(program, i, n));
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS))
      throw new Error("The 3D renderer could not start.");
    return program;
  };
  const program = link(vertexSource, fragmentSource, [
    "position",
    "normal",
    "phase",
    "arc",
  ]);
  const attributes = ["position", "normal", "phase"].map((n) =>
    gl.getAttribLocation(program, n),
  );
  const arcAttribute = gl.getAttribLocation(program, "arc");
  const uniforms = Object.fromEntries(
    [
      "rotation",
      "framing",
      "lens",
      "center",
      "pan",
      "ink",
      "dark",
      "cut",
      "cutting",
      "cutEvery",
      "gather",
      "behind",
      "dashes",
    ].map((n) => [n, gl.getUniformLocation(program, n)]),
  );
  // Strokes need instancing (ANGLE_instanced_arrays, near universal in
  // WebGL 1); without it every weight is drawn as hairlines. They read each
  // line batch's own buffer, two vertices an instance.
  const instancing = gl.getExtension("ANGLE_instanced_arrays");
  const strokes = (() => {
    if (!instancing) return null;
    try {
      const stroke = link(strokeVertexSource, strokeFragmentSource, [
        "corner",
        "from",
        "to",
        "phase",
        "arcFrom",
        "arcTo",
        "before",
        "after",
      ]);
      const corners = gl.createBuffer()!;
      gl.bindBuffer(gl.ARRAY_BUFFER, corners);
      gl.bufferData(
        gl.ARRAY_BUFFER,
        new Float32Array([0, -1, 1, -1, 1, 1, 0, -1, 1, 1, 0, 1]),
        gl.STATIC_DRAW,
      );
      return {
        program: stroke,
        corners,
        uniforms: Object.fromEntries(
          [
            "rotation",
            "framing",
            "lens",
            "center",
            "pan",
            "ink",
            "dark",
            "cut",
            "cutting",
            "cutEvery",
            "behind",
            "dashes",
            "viewport",
            "halfWidth",
            "caps",
            "coverHalf",
            "coverCaps",
            "fade",
          ].map((n) => [n, gl.getUniformLocation(stroke, n)]),
        ),
      };
    } catch {
      return null;
    }
  })();
  // With samples, a stroke's coverage becomes sample coverage, so segments
  // overlapping where they meet never double; without, coverage blends.
  const sampled = (gl.getParameter(gl.SAMPLES) as number) > 0;
  // The largest page this device can draw on, a side.
  const largest = () =>
    Math.min(
      gl.getParameter(gl.MAX_RENDERBUFFER_SIZE) as number,
      ...(gl.getParameter(gl.MAX_VIEWPORT_DIMS) as Int32Array),
    );
  // See-through sheets, made when first drawn: their program, a triangle
  // covering the page, and a half-float (or float) target summing layers.
  // Null when the device cannot render to one.
  let see:
    | {
        program: WebGLProgram;
        corner: WebGLBuffer;
        texture: WebGLTexture;
        framebuffer: WebGLFramebuffer;
        type: number;
        width: number;
        height: number;
        uniforms: Record<string, WebGLUniformLocation | null>;
      }
    | null
    | undefined;
  function seeing() {
    if (see !== undefined) return see;
    const half = gl!.getExtension("OES_texture_half_float");
    gl!.getExtension("EXT_color_buffer_half_float");
    const full = gl!.getExtension("OES_texture_float");
    gl!.getExtension("WEBGL_color_buffer_float");
    const texture = gl!.createTexture()!,
      framebuffer = gl!.createFramebuffer()!;
    gl!.bindTexture(gl!.TEXTURE_2D, texture);
    for (const p of [gl!.TEXTURE_MIN_FILTER, gl!.TEXTURE_MAG_FILTER])
      gl!.texParameteri(gl!.TEXTURE_2D, p, gl!.NEAREST);
    for (const p of [gl!.TEXTURE_WRAP_S, gl!.TEXTURE_WRAP_T])
      gl!.texParameteri(gl!.TEXTURE_2D, p, gl!.CLAMP_TO_EDGE);
    gl!.bindFramebuffer(gl!.FRAMEBUFFER, framebuffer);
    let type = 0;
    for (const t of [half?.HALF_FLOAT_OES, full && gl!.FLOAT]) {
      if (!t) continue;
      gl!.texImage2D(gl!.TEXTURE_2D, 0, gl!.RGBA, 1, 1, 0, gl!.RGBA, t, null);
      gl!.framebufferTexture2D(
        gl!.FRAMEBUFFER,
        gl!.COLOR_ATTACHMENT0,
        gl!.TEXTURE_2D,
        texture,
        0,
      );
      if (
        gl!.checkFramebufferStatus(gl!.FRAMEBUFFER) === gl!.FRAMEBUFFER_COMPLETE
      ) {
        type = t;
        break;
      }
    }
    gl!.bindFramebuffer(gl!.FRAMEBUFFER, null);
    if (!type) {
      gl!.deleteTexture(texture);
      gl!.deleteFramebuffer(framebuffer);
      return (see = null);
    }
    const cover = link(coverVertex, coverFragment, ["corner"]);
    const corner = gl!.createBuffer()!;
    gl!.bindBuffer(gl!.ARRAY_BUFFER, corner);
    gl!.bufferData(
      gl!.ARRAY_BUFFER,
      new Float32Array([-1, -1, 3, -1, -1, 3]),
      gl!.STATIC_DRAW,
    );
    return (see = {
      program: cover,
      corner,
      texture,
      framebuffer,
      type,
      width: 1,
      height: 1,
      uniforms: Object.fromEntries(
        ["layers", "size", "background", "alpha"].map((n) => [
          n,
          gl!.getUniformLocation(cover, n),
        ]),
      ),
    });
  }
  let sight: Sight = defaultSight;
  const wideIndices = !!gl.getExtension("OES_element_index_uint");
  // Each batch's buffers, remade with every upload.
  type Uploaded = {
    batch: Batch;
    buffer: WebGLBuffer;
    count: number;
    elements?: WebGLBuffer;
    // A line batch's arc lengths, made when first dashed.
    arcs?: WebGLBuffer;
    // A line batch's joints, made when first stroked.
    joins?: WebGLBuffer;
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
  function setSight(spec: Sight) {
    sight = spec;
  }
  function cutEdge(layers: Layers) {
    if (!scene || !cut?.edge) return null;
    const key = [scene, layers, cut];
    if (edge && edge.key.every((k, i) => k === key[i])) return edge.batch;
    edgeBuffers.splice(0).forEach((b) => gl!.deleteBuffer(b));
    if (edge?.batch) uploaded.delete(edge.batch);
    const batch = cutEdges(
      scenePasses(scene, layers),
      cut.plane,
      cut.scope,
      cut.others,
      cut.beyond,
    );
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
  // An export can draw on another background than the theme's: a
  // transparent still is drawn over black and over white (see matte in
  // export.ts).
  function draw(
    view: View,
    layers: Layers,
    dark: boolean,
    size?: { width: number; height: number },
    background: readonly number[] = palette.background[dark ? 1 : 0],
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
    // An export's page is drawn whole or not at all: a device that cannot
    // hold it says so rather than saving a smaller or blank image.
    if (size && Math.max(width, height) > largest())
      throw new Error(
        `This device draws 3D images at most ${largest()} pixels a side. Choose a smaller size.`,
      );
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
    }
    if (
      size &&
      (gl!.drawingBufferWidth !== width || gl!.drawingBufferHeight !== height)
    )
      throw new Error(
        `This device could draw only ${gl!.drawingBufferWidth} × ${gl!.drawingBufferHeight} of the ${width} × ${height} 3D image. Choose a smaller size.`,
      );
    gl!.viewport(0, 0, width, height);
    gl!.clearColor(background[0], background[1], background[2], 1);
    gl!.clear(gl!.COLOR_BUFFER_BIT | gl!.DEPTH_BUFFER_BIT);
    if (!scene) return;
    gl!.enable(gl!.DEPTH_TEST);
    gl!.depthFunc(gl!.LEQUAL);
    const k = camera(view, { width, height });
    const stroked = !!strokes && sight.weight !== "hairline";
    // The camera, theme, cut and dashes, for either program.
    const place = (u: Record<string, WebGLUniformLocation | null>) => {
      gl!.uniformMatrix3fv(u.rotation, false, new Float32Array(k.rotation));
      gl!.uniform3f(u.center, k.center.x, k.center.y, k.center.z);
      gl!.uniform2f(u.pan, k.pan[0], k.pan[1]);
      gl!.uniform3f(u.framing, ...k.framing);
      gl!.uniform3f(u.lens, ...k.lens);
      gl!.uniform1f(u.dark, dark ? 1 : 0);
      gl!.uniform1f(u.dashes, dashesPerUnit(view));
      // The planes relative to the view center, scaled by the radius. A
      // missing plane is +1 everywhere when hidden beyond every plane and
      // −1 beyond any, so it never decides.
      if (cut) {
        const c = k.center,
          r = view.radius,
          every = (cut.beyond ?? "every") === "every",
          planes = specPlanes(cut),
          values = new Float32Array(4 * maxCutPlanes);
        for (let i = 0; i < maxCutPlanes; i++) {
          const p = planes[i];
          if (!p) {
            values[4 * i + 3] = every ? -1 : 1;
            continue;
          }
          const n = p.normal;
          values.set(
            [
              n.x / r,
              n.y / r,
              n.z / r,
              (p.offset - (n.x * c.x + n.y * c.y + n.z * c.z)) / r,
            ],
            4 * i,
          );
        }
        gl!.uniform4fv(u.cut, values);
        gl!.uniform1f(u.cutEvery, every ? 1 : 0);
      }
    };
    if (stroked) {
      gl!.useProgram(strokes!.program);
      place(strokes!.uniforms);
      gl!.uniform2f(strokes!.uniforms.viewport, width, height);
    }
    gl!.useProgram(program);
    place(uniforms);
    let using = program;
    const use = (p: WebGLProgram) => {
      if (using !== p) gl!.useProgram((using = p));
    };
    // A line batch's arc lengths, made when first dashed.
    const arcsOf = (v: Uploaded) => {
      if (!v.arcs) {
        v.arcs = gl!.createBuffer()!;
        (probe.includes(v.batch)
          ? probeBuffers
          : edge?.batch === v.batch
            ? edgeBuffers
            : buffers
        ).push(v.arcs);
        gl!.bindBuffer(gl!.ARRAY_BUFFER, v.arcs);
        gl!.bufferData(
          gl!.ARRAY_BUFFER,
          Float32Array.from(arcLengths(v.batch.data)),
          gl!.STATIC_DRAW,
        );
        uploaded.get(v.batch)!.arcs = v.arcs;
      }
      return v.arcs;
    };
    // A line batch's joints, made when first stroked.
    const joinsOf = (v: Uploaded) => {
      if (!v.joins) {
        v.joins = gl!.createBuffer()!;
        (probe.includes(v.batch)
          ? probeBuffers
          : edge?.batch === v.batch
            ? edgeBuffers
            : buffers
        ).push(v.joins);
        gl!.bindBuffer(gl!.ARRAY_BUFFER, v.joins);
        gl!.bufferData(
          gl!.ARRAY_BUFFER,
          strokeJoins(v.batch.data),
          gl!.STATIC_DRAW,
        );
        uploaded.get(v.batch)!.joins = v.joins;
      }
      return v.joins;
    };
    // Each stroke's width in device pixels.
    const widthOf = (v: Uploaded) =>
      strokeWidth(v.batch, sight.weight, { width, height })!;
    // A line batch as strokes: drawn with round ends and its coverage as
    // sample coverage (or blended), or, thinner than two pixels or behind
    // sheets, with butt ends, blended (behind, at the faint or dashed
    // opacity).
    const stroke = (
      v: Uploaded & { cut: boolean },
      how: { behind?: number } = {},
    ) => {
      const t = strokes!,
        u = t.uniforms,
        ext = instancing!;
      use(t.program);
      // Sample coverage counts whole samples, too coarse for a stroke under
      // two pixels, whose every pixel is edge: those blend, with butt ends;
      // their mitred joints neither overlap nor part.
      const w = widthOf(v),
        half = Math.max(w, 1) / 2,
        thin = w < 2,
        caps = how.behind || thin ? 0 : 1;
      gl!.uniform1f(u.halfWidth, half);
      gl!.uniform1f(u.coverHalf, half);
      gl!.uniform1f(u.caps, caps);
      gl!.uniform1f(u.coverCaps, caps);
      gl!.uniform1f(u.fade, Math.min(1, w));
      gl!.uniform1f(u.ink, v.batch.ink);
      gl!.uniform1f(u.cutting, v.cut ? 1 : 0);
      gl!.uniform1f(u.behind, how.behind ?? 0);
      gl!.bindBuffer(gl!.ARRAY_BUFFER, t.corners);
      gl!.enableVertexAttribArray(0);
      gl!.vertexAttribPointer(0, 2, gl!.FLOAT, false, 0, 0);
      gl!.bindBuffer(gl!.ARRAY_BUFFER, v.buffer);
      for (const [loc, size, offset] of [
        [1, 3, 0],
        [2, 3, 28],
        [3, 1, 24],
      ]) {
        gl!.enableVertexAttribArray(loc);
        gl!.vertexAttribPointer(loc, size, gl!.FLOAT, false, 56, offset);
        ext.vertexAttribDivisorANGLE(loc, 1);
      }
      if (how.behind === 2) {
        gl!.bindBuffer(gl!.ARRAY_BUFFER, arcsOf(v));
        for (const [loc, offset] of [
          [4, 0],
          [5, 4],
        ]) {
          gl!.enableVertexAttribArray(loc);
          gl!.vertexAttribPointer(loc, 1, gl!.FLOAT, false, 8, offset);
          ext.vertexAttribDivisorANGLE(loc, 1);
        }
      } else
        for (const loc of [4, 5]) {
          gl!.disableVertexAttribArray(loc);
          gl!.vertexAttrib1f(loc, 0);
        }
      gl!.bindBuffer(gl!.ARRAY_BUFFER, joinsOf(v));
      for (const [loc, offset] of [
        [6, 0],
        [7, 16],
      ]) {
        gl!.enableVertexAttribArray(loc);
        gl!.vertexAttribPointer(loc, 4, gl!.FLOAT, false, 32, offset);
        ext.vertexAttribDivisorANGLE(loc, 1);
      }
      const opaque = !how.behind;
      if (opaque && sampled && !thin) gl!.enable(gl!.SAMPLE_ALPHA_TO_COVERAGE);
      else if (opaque) {
        gl!.enable(gl!.BLEND);
        gl!.blendFunc(gl!.SRC_ALPHA, gl!.ONE_MINUS_SRC_ALPHA);
        // A blended stroke's faint fringe must not hide what is drawn
        // behind it later: thin strokes write no depth (see inOrder).
        if (thin) gl!.depthMask(false);
      }
      ext.drawArraysInstancedANGLE(gl!.TRIANGLES, 0, 6, v.count / 2);
      if (opaque) {
        gl!.disable(gl!.SAMPLE_ALPHA_TO_COVERAGE);
        gl!.disable(gl!.BLEND);
        gl!.depthMask(true);
      }
      // The other programs read these locations without instancing.
      for (const loc of [1, 2, 3, 4, 5, 6, 7])
        ext.vertexAttribDivisorANGLE(loc, 0);
      for (const loc of [4, 5, 6, 7]) gl!.disableVertexAttribArray(loc);
    };
    const render = (
      v: Uploaded & { cut: boolean },
      how: { gather?: boolean; behind?: number } = {},
    ) => {
      use(program);
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
      gl!.uniform1f(uniforms.gather, how.gather ? 1 : 0);
      gl!.uniform1f(uniforms.behind, how.behind ?? 0);
      if (how.behind === 2) {
        gl!.bindBuffer(gl!.ARRAY_BUFFER, arcsOf(v));
        gl!.enableVertexAttribArray(arcAttribute);
        gl!.vertexAttribPointer(arcAttribute, 1, gl!.FLOAT, false, 4, 0);
      } else {
        gl!.disableVertexAttribArray(arcAttribute);
        gl!.vertexAttrib1f(arcAttribute, 0);
      }
      const mode = v.batch.mode === "lines" ? gl!.LINES : gl!.TRIANGLES;
      if (v.elements) {
        gl!.bindBuffer(gl!.ELEMENT_ARRAY_BUFFER, v.elements);
        gl!.drawElements(mode, v.count, gl!.UNSIGNED_INT, 0);
      } else gl!.drawArrays(mode, 0, v.count);
    };
    const passes = scenePasses(scene, layers, probe, cutEdge(layers)).map(
      (pass) => ({
        ...uploaded.get(pass.batch)!,
        cut: !!cut && isCut(pass, cut.scope),
        sheet: pass.sheet,
      }),
    );
    // Sheets are pushed back so strokes lying on them stay whole.
    const offset = sheetOffset(
      passes.filter((v) => !v.sheet).map((v) => v.batch),
      stroked ? sight.weight : "hairline",
      { width, height },
    );
    const sheet = (v: (typeof passes)[number]) => {
      gl!.enable(gl!.POLYGON_OFFSET_FILL);
      gl!.polygonOffset(offset, 1);
      render(v);
      gl!.disable(gl!.POLYGON_OFFSET_FILL);
    };
    const line = stroked ? stroke : render;
    // Strokes are drawn after every sheet: those two pixels wide or more
    // first, writing depth where they cover, then thinner ones, which write
    // none, so a thin stroke is hidden by sheets and wide strokes in front
    // of it but hides nothing itself.
    const inOrder = (lines: typeof passes) =>
      stroked
        ? [
            ...lines.filter((v) => widthOf(v) >= 2),
            ...lines.filter((v) => widthOf(v) < 2),
          ]
        : lines;
    // The plain drawing, in the passes' own order, or with strokes, sheets
    // first.
    if (isPlain(sight)) {
      if (!stroked) {
        for (const v of passes) (v.sheet ? sheet : line)(v);
        return;
      }
      passes.filter((v) => v.sheet).forEach(sheet);
      inOrder(passes.filter((v) => !v.sheet)).forEach((v) => line(v));
      return;
    }
    // Otherwise sheets first, alone in the depth buffer, so lines behind
    // them are tested against sheets only, then the lines.
    const sheets = passes.filter((v) => v.sheet),
      lines = passes.filter((v) => !v.sheet);
    const target = sight.sheets === "through" && sheets.length && seeing();
    if (target && size) {
      const most = gl!.getParameter(gl!.MAX_TEXTURE_SIZE) as number;
      if (Math.max(width, height) > most)
        throw new Error(
          `This device draws see-through 3D images at most ${most} pixels a side. Choose a smaller size.`,
        );
    }
    if (target) {
      gather(target, sheets, width, height, render);
      cover(target, width, height, background, sight.opacity);
      gl!.useProgram((using = program));
      gl!.colorMask(false, false, false, false);
      sheets.forEach(sheet);
      gl!.colorMask(true, true, true, true);
    } else sheets.forEach(sheet);
    if (sight.hidden !== "hide") {
      gl!.depthFunc(gl!.GREATER);
      gl!.depthMask(false);
      gl!.enable(gl!.BLEND);
      gl!.blendFunc(gl!.SRC_ALPHA, gl!.ONE_MINUS_SRC_ALPHA);
      const behind = sight.hidden === "dashed" ? 2 : 1;
      lines.forEach((v) => line(v, { behind }));
      gl!.disable(gl!.BLEND);
      gl!.depthMask(true);
      gl!.depthFunc(gl!.LEQUAL);
    }
    inOrder(lines).forEach((v) => line(v));
  }
  // Every sheet layer's shaded color and a count of one, summed at each
  // pixel of the target without depth testing, so no order matters.
  function gather(
    t: NonNullable<typeof see>,
    sheets: (Uploaded & { cut: boolean })[],
    width: number,
    height: number,
    render: (v: Uploaded & { cut: boolean }, how: { gather?: boolean }) => void,
  ) {
    gl!.bindTexture(gl!.TEXTURE_2D, t.texture);
    if (t.width !== width || t.height !== height) {
      gl!.texImage2D(
        gl!.TEXTURE_2D,
        0,
        gl!.RGBA,
        width,
        height,
        0,
        gl!.RGBA,
        t.type,
        null,
      );
      t.width = width;
      t.height = height;
    }
    gl!.bindFramebuffer(gl!.FRAMEBUFFER, t.framebuffer);
    gl!.framebufferTexture2D(
      gl!.FRAMEBUFFER,
      gl!.COLOR_ATTACHMENT0,
      gl!.TEXTURE_2D,
      t.texture,
      0,
    );
    gl!.clearColor(0, 0, 0, 0);
    gl!.clear(gl!.COLOR_BUFFER_BIT);
    gl!.disable(gl!.DEPTH_TEST);
    gl!.enable(gl!.BLEND);
    gl!.blendFunc(gl!.ONE, gl!.ONE);
    sheets.forEach((v) => render(v, { gather: true }));
    gl!.disable(gl!.BLEND);
    gl!.bindFramebuffer(gl!.FRAMEBUFFER, null);
    gl!.enable(gl!.DEPTH_TEST);
  }
  // The gathered layers over the background, across the whole page.
  function cover(
    t: NonNullable<typeof see>,
    width: number,
    height: number,
    background: readonly number[],
    alpha: number,
  ) {
    gl!.useProgram(t.program);
    gl!.disable(gl!.DEPTH_TEST);
    gl!.activeTexture(gl!.TEXTURE0);
    gl!.bindTexture(gl!.TEXTURE_2D, t.texture);
    gl!.uniform1i(t.uniforms.layers, 0);
    gl!.uniform2f(t.uniforms.size, width, height);
    gl!.uniform3f(
      t.uniforms.background,
      background[0],
      background[1],
      background[2],
    );
    gl!.uniform1f(t.uniforms.alpha, alpha);
    gl!.bindBuffer(gl!.ARRAY_BUFFER, t.corner);
    for (let i = 1; i < 8; i++) gl!.disableVertexAttribArray(i);
    gl!.enableVertexAttribArray(0);
    gl!.vertexAttribPointer(0, 2, gl!.FLOAT, false, 0, 0);
    gl!.drawArrays(gl!.TRIANGLES, 0, 3);
    gl!.enable(gl!.DEPTH_TEST);
  }
  return {
    upload,
    setProbe,
    setCut,
    setSight,
    // Whether this device can draw see-through sheets.
    seeThrough: () => !!seeing(),
    // Whether this device can draw strokes rather than hairlines.
    strokes: () => !!strokes,
    // The layers the uploaded scene has something to draw for.
    layers: () => (scene ? sceneLayers(scene) : null),
    draw,
    // The drawn page's pixels, top row first, as RGBA.
    pixels: () => {
      const width = gl.drawingBufferWidth,
        height = gl.drawingBufferHeight,
        rows = new Uint8Array(width * height * 4),
        out = new Uint8Array(rows.length),
        stride = width * 4;
      gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, rows);
      for (let y = 0; y < height; y++)
        out.set(
          rows.subarray((height - 1 - y) * stride, (height - y) * stride),
          y * stride,
        );
      return out;
    },
    dispose: () => {
      buffers.forEach((b) => gl.deleteBuffer(b));
      probeBuffers.forEach((b) => gl.deleteBuffer(b));
      edgeBuffers.forEach((b) => gl.deleteBuffer(b));
      if (see) {
        gl.deleteBuffer(see.corner);
        gl.deleteTexture(see.texture);
        gl.deleteFramebuffer(see.framebuffer);
        gl.deleteProgram(see.program);
      }
      if (strokes) {
        gl.deleteBuffer(strokes.corners);
        gl.deleteProgram(strokes.program);
      }
      shaders.forEach((s) => gl.deleteShader(s));
      gl.deleteProgram(program);
    },
  };
}
