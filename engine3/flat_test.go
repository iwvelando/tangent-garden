package engine3

import (
	"encoding/json"
	"math"
	"testing"
)

// The flat mesh holds exactly the values a JSON reply delivers: every float
// bit for bit, in the order the mesh lists its vertices.
func TestFlatMeshMatchesJSON(t *testing.T) {
	gap := canalled(custom("t^3", "0", "0", -1, 1), 0.2, "1", 2)
	flat := framedCustom("cos(t)", "sin(t)", "t/3", 0, 6)
	flat.Frame.Width = 0
	studies := map[string]Request{
		"developable": study(),
		"torus":       canalled(circle(), 0.5, "1", 6),
		"canal gap":   gap,
		"ribbon":      framedCustom("cos(t)", "sin(t)", "t/3", 0, 6),
		"no ribbon":   flat,
		"ruled":       threaded(ring(0), "cos(t)", "sin(t)", "1", 1, 0.5),
	}
	for name, c := range studies {
		r, err := Compute(c)
		if err != nil {
			t.Fatalf("%s: %v", name, err)
		}
		text, err := json.Marshal(r)
		if err != nil {
			t.Fatalf("%s: %v", name, err)
		}
		var decoded struct{ Mesh []Vertex }
		if err := json.Unmarshal(text, &decoded); err != nil {
			t.Fatalf("%s: %v", name, err)
		}
		vertices, samples := FlatMesh(r.Mesh)
		if len(vertices) != 7*len(decoded.Mesh) || len(samples) != len(decoded.Mesh) {
			t.Fatalf("%s: %d floats and %d samples for %d vertices", name, len(vertices), len(samples), len(decoded.Mesh))
		}
		for k, v := range decoded.Mesh {
			want := []float64{v.Position.X, v.Position.Y, v.Position.Z, v.Normal.X, v.Normal.Y, v.Normal.Z, v.Phase}
			for j, w := range want {
				if math.Float64bits(vertices[7*k+j]) != math.Float64bits(w) {
					t.Fatalf("%s: vertex %d value %d is %v, JSON gives %v", name, k, j, vertices[7*k+j], w)
				}
			}
			if int(samples[k]) != v.SampleIndex {
				t.Fatalf("%s: vertex %d sample %d, JSON gives %d", name, k, samples[k], v.SampleIndex)
			}
		}
		switch name {
		case "no ribbon":
			if len(r.Mesh) != 0 {
				t.Fatalf("a ribbon of width 0 has %d vertices", len(r.Mesh))
			}
		case "canal gap":
			if r.Omitted == 0 || len(r.Mesh) == 0 {
				t.Fatalf("the gap study omits %d intervals of %d vertices", r.Omitted, len(r.Mesh))
			}
		default:
			if len(r.Mesh) == 0 {
				t.Fatalf("%s: no mesh", name)
			}
		}
	}
}
