package engine3

// FlatMesh lays a curve study's mesh out for a transport that skips JSON:
// seven float64 per vertex (position, normal, phase) and each vertex's
// sample index, in the mesh's own order. Every three vertices are one
// triangle, as in Mesh.
func FlatMesh(mesh []Vertex) (vertices []float64, sampleIndex []int32) {
	vertices = make([]float64, 0, 7*len(mesh))
	sampleIndex = make([]int32, len(mesh))
	for k, v := range mesh {
		vertices = append(vertices, v.Position.X, v.Position.Y, v.Position.Z, v.Normal.X, v.Normal.Y, v.Normal.Z, v.Phase)
		sampleIndex[k] = int32(v.SampleIndex)
	}
	return vertices, sampleIndex
}
