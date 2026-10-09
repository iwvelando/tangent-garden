package engine3

import (
	"encoding/json"
	"math"
	"testing"
)

// Vertex is one corner of a curve mesh's triangle, with the triangle's
// sample.
type Vertex struct {
	SampleIndex int
	Position    Vec3
	Normal      Vec3
	Phase       float64
}

// corners lists every triangle's three corners in order, as the mesh was
// listed before it was indexed: every three are one triangle.
func corners(m CurveMesh) []Vertex {
	out := make([]Vertex, 0, len(m.Triangles))
	for k, v := range m.Triangles {
		x := m.Vertices[7*v : 7*v+7]
		out = append(out, Vertex{int(m.SampleIndex[k/3]), Vec3{x[0], x[1], x[2]}, Vec3{x[3], x[4], x[5]}, x[6]})
	}
	return out
}

// curveMeshes are curve studies of every kind that makes a mesh, with a
// canal broken by a gap and a ribbon of width 0, which makes none.
func curveMeshes() map[string]Request {
	gap := canalled(custom("t^3", "0", "0", -1, 1), 0.2, "1", 2)
	flat := framedCustom("cos(t)", "sin(t)", "t/3", 0, 6)
	flat.Frame.Width = 0
	return map[string]Request{
		"developable": study(),
		"torus":       canalled(circle(), 0.5, "1", 6),
		"canal gap":   gap,
		"ribbon":      framedCustom("cos(t)", "sin(t)", "t/3", 0, 6),
		"no ribbon":   flat,
		"ruled":       threaded(ring(0), "cos(t)", "sin(t)", "1", 1, 0.5),
		"cone":        threaded(ring(0), "0", "0", "2", 1, 0),
	}
}

// Every array is whole: seven numbers per vertex, three in-range vertices
// and one sample per triangle, and no vertex that no triangle uses. A
// tube, developable or ruled surface shares its rings or grid points
// between the triangles beside them.
func TestCurveMeshIsIndexed(t *testing.T) {
	for name, c := range curveMeshes() {
		r, err := Compute(c)
		if err != nil {
			t.Fatalf("%s: %v", name, err)
		}
		m := r.Mesh
		count := len(m.Vertices) / 7
		if len(m.Vertices) != 7*count || len(m.Triangles) != 3*len(m.SampleIndex) {
			t.Fatalf("%s: %d numbers, %d indices, %d samples", name, len(m.Vertices), len(m.Triangles), len(m.SampleIndex))
		}
		used := make([]bool, count)
		for _, v := range m.Triangles {
			if v < 0 || int(v) >= count {
				t.Fatalf("%s: index %d of %d vertices", name, v, count)
			}
			used[v] = true
		}
		for v, u := range used {
			if !u {
				t.Fatalf("%s: vertex %d is unused", name, v)
			}
		}
		// Phases count samples, and a triangle spans one interval, ending
		// at its sample.
		n := float64(len(r.Base) - 1)
		stride := math.Ceil(n / canalRings)
		for k, s := range m.SampleIndex {
			for _, v := range m.Triangles[3*k : 3*k+3] {
				row := m.Vertices[7*v+6] * n
				if !(row <= float64(s)+1e-9) || !(row >= float64(s)-stride-1e-9) {
					t.Fatalf("%s: triangle %d of sample %d has a corner at %v", name, k, s, row)
				}
			}
		}
		switch name {
		case "no ribbon":
			if len(m.Triangles) != 0 || count != 0 {
				t.Fatalf("a ribbon of width 0 has %d triangles, %d vertices", len(m.SampleIndex), count)
			}
		case "ribbon":
			// Each triangle has its own face normal, so none shares.
			if count != len(m.Triangles) || len(m.Triangles) == 0 {
				t.Fatalf("ribbon: %d vertices for %d corners", count, len(m.Triangles))
			}
		default:
			if r.Omitted == 0 && name == "canal gap" || len(m.Triangles) == 0 {
				t.Fatalf("%s: %d triangles, %d omitted", name, len(m.SampleIndex), r.Omitted)
			}
			// A strip's vertices are each shared by three to six triangles.
			if 2*count > len(m.Triangles) {
				t.Fatalf("%s: %d vertices for %d corners", name, count, len(m.Triangles))
			}
		}
	}
}

// A tube's mesh holds each drawn ring once, its 24 segments with the
// closing point: 481 rings round a closed torus, where the seam ring is
// listed at both ends.
func TestCanalMeshSharesRings(t *testing.T) {
	r := canal(t, canalled(circle(), 0.5, "1", 6))
	if got := len(r.Mesh.Vertices) / 7; got != 481*(canalSegments+1) {
		t.Fatalf("%d vertices, want %d", got, 481*(canalSegments+1))
	}
	if len(r.Mesh.SampleIndex) != 480*canalSegments*2 {
		t.Fatalf("%d triangles", len(r.Mesh.SampleIndex))
	}
}

// The mesh survives JSON as the numbers it holds, bit for bit.
func TestCurveMeshJSON(t *testing.T) {
	r, err := Compute(canalled(circle(), 0.5, "1", 6))
	if err != nil {
		t.Fatal(err)
	}
	text, err := json.Marshal(r)
	if err != nil {
		t.Fatal(err)
	}
	var decoded struct{ Mesh CurveMesh }
	if err := json.Unmarshal(text, &decoded); err != nil {
		t.Fatal(err)
	}
	if len(decoded.Mesh.Vertices) != len(r.Mesh.Vertices) || len(decoded.Mesh.Triangles) != len(r.Mesh.Triangles) || len(decoded.Mesh.SampleIndex) != len(r.Mesh.SampleIndex) {
		t.Fatal("the JSON mesh has different lengths")
	}
	for k, v := range r.Mesh.Vertices {
		if math.Float64bits(decoded.Mesh.Vertices[k]) != math.Float64bits(v) {
			t.Fatalf("value %d is %v, JSON gives %v", k, v, decoded.Mesh.Vertices[k])
		}
	}
}
