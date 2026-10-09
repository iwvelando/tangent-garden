import { meshStride, type CurveMesh, type Vec3 } from "../web/spatial/types";

// A curve study's mesh vertex, as the engine lists it (engine3.Vertex).
export type MeshVertex = {
  position: Vec3;
  normal: Vec3;
  phase: number;
  sampleIndex: number;
};

// Lays vertices out as the engine sends a curve study's mesh
// (engine3.FlatMesh), for results built by hand.
export function curveMesh(vertices: MeshVertex[] = []): CurveMesh {
  const out = {
    vertices: new Float64Array(meshStride * vertices.length),
    sampleIndex: new Int32Array(vertices.length),
  };
  vertices.forEach(({ position: p, normal: n, phase, sampleIndex }, k) => {
    out.vertices.set([p.x, p.y, p.z, n.x, n.y, n.z, phase], meshStride * k);
    out.sampleIndex[k] = sampleIndex;
  });
  return out;
}
