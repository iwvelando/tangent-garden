import { meshStride, type CurveMesh, type Vec3 } from "../web/spatial/types";

// One corner of a curve study's mesh triangle, with the triangle's sample.
export type MeshVertex = {
  position: Vec3;
  normal: Vec3;
  phase: number;
  sampleIndex: number;
};

// Lays corners out as the engine sends a curve study's mesh
// (engine3.CurveMesh), every three one triangle, each corner its own
// vertex, for results built by hand.
export function curveMesh(corners: MeshVertex[] = []): CurveMesh {
  const out = {
    vertices: new Float64Array(meshStride * corners.length),
    triangles: Int32Array.from(corners, (_, k) => k),
    sampleIndex: new Int32Array(corners.length / 3),
  };
  corners.forEach(({ position: p, normal: n, phase, sampleIndex }, k) => {
    out.vertices.set([p.x, p.y, p.z, n.x, n.y, n.z, phase], meshStride * k);
    out.sampleIndex[Math.floor(k / 3)] = sampleIndex;
  });
  return out;
}

// A mesh's triangles corner by corner, in order, as curveMesh takes them.
export function meshCorners({
  vertices,
  triangles,
  sampleIndex,
}: CurveMesh): MeshVertex[] {
  return Array.from(triangles, (v, k) => {
    const [x, y, z, nx, ny, nz, phase] = vertices.subarray(
      meshStride * v,
      meshStride * v + meshStride,
    );
    return {
      position: { x, y, z },
      normal: { x: nx, y: ny, z: nz },
      phase,
      sampleIndex: sampleIndex[Math.floor(k / 3)],
    };
  });
}
