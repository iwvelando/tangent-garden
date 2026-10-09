package engine3

// CurveMesh is a curve study's surface (a tube, ribbon, developable or
// ruled surface) as indexed triangles, laid out for a transport that skips
// JSON (cmd/wasm/mesh.go). Vertices holds seven float64 per vertex:
// position, normal and phase. Triangles holds three vertex indices per
// triangle, in drawing order, and SampleIndex one sample per triangle: the
// last sample of the interval it spans, by which a reveal keeps or drops
// it. A vertex is shared only by triangles that would give it the same
// position, normal and phase, so the triangles are exactly those of the
// unindexed mesh.
type CurveMesh struct {
	Vertices    []float64 `json:"vertices"`
	Triangles   []int32   `json:"triangles"`
	SampleIndex []int32   `json:"sampleIndex"`
}

// vertex adds a vertex and returns its index.
func (m *CurveMesh) vertex(position, normal Vec3, phase float64) int32 {
	m.Vertices = append(m.Vertices, position.X, position.Y, position.Z, normal.X, normal.Y, normal.Z, phase)
	return int32(len(m.Vertices)/7 - 1)
}

// triangle adds a triangle of three vertices, for sample.
func (m *CurveMesh) triangle(sample int, a, b, c int32) {
	m.Triangles = append(m.Triangles, a, b, c)
	m.SampleIndex = append(m.SampleIndex, int32(sample))
}

// emptyMesh is a mesh with no triangles, whose arrays are present.
func emptyMesh() CurveMesh {
	return CurveMesh{Vertices: []float64{}, Triangles: []int32{}, SampleIndex: []int32{}}
}
