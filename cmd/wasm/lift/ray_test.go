package lift

import (
	"encoding/json"
	"fmt"
	"math"
	"os"
	"reflect"
	"testing"

	"tangentgarden/engine3"
)

func BenchmarkRayTransport(b *testing.B) {
	data, err := os.ReadFile("../../../engine3/testdata/presets.json")
	if err != nil {
		b.Fatal(err)
	}
	var presets map[string]engine3.Request
	if err := json.Unmarshal(data, &presets); err != nil {
		b.Fatal(err)
	}
	q := presets["Riding a ray through coma"]
	q.Surface.Curves = 48
	result, err := engine3.Compute(q)
	if err != nil {
		b.Fatal(err)
	}
	lines := result.Rays.Lines
	b.Logf("representative rays: %d", len(lines))
	b.ReportAllocs()
	b.ResetTimer()
	for n := 0; n < b.N; n++ {
		reply := struct {
			Lines []engine3.Ray `json:"lines"`
		}{lines}
		floats, places, err := Lift(&reply)
		if err != nil {
			b.Fatal(err)
		}
		text, err := json.Marshal(struct {
			Result any     `json:"result"`
			Places []Place `json:"places"`
		}{reply, places})
		if err != nil {
			b.Fatal(err)
		}
		b.ReportMetric(float64(len(text)), "json-B/op")
		b.ReportMetric(float64(len(text)+8*len(floats)), "reply-B/op")
	}
}

func rayFixture(n int) []engine3.Ray {
	rays := make([]engine3.Ray, n)
	for i := range rays {
		rays[i] = engine3.Ray{
			I: i * 3, J: 240 - i,
			Start:   engine3.Vec3{X: float64(i) + 0.125, Y: -2.75, Z: 1e-200},
			Point:   engine3.Vec3{X: -3.125, Y: 1e100, Z: math.Copysign(0, -1)},
			End:     engine3.Vec3{X: 7.5, Y: -8.25, Z: 9.125},
			Back:    engine3.Vec3{X: -10.5, Y: 11.25, Z: -12.125},
			Virtual: i&1 != 0, Total: i&2 != 0,
		}
	}
	return rays
}

func TestRayTransport(t *testing.T) {
	for _, n := range []int{0, 1, 2, 3, 4, 49} {
		t.Run(fmt.Sprint(n), func(t *testing.T) {
			lines := rayFixture(n)
			held := append([]engine3.Ray{}, lines...)
			reply := struct {
				Lines []engine3.Ray   `json:"lines,omitempty"`
				Grid  [][]engine3.Ray `json:"grid"`
				After []float64       `json:"after"`
			}{lines, [][]engine3.Ray{lines, nil, {}, lines}, make([]float64, 32)}
			places, _, rest := roundTrip(t, &reply)
			got := paths(places)
			if n >= 2 && (got["lines"].Kind != "ray" || got["grid"].Kind != "ray") {
				t.Fatalf("rays stayed in JSON (%d bytes): %v", rest, got)
			}
			if n < 2 && got["lines"].Kind != "" {
				t.Fatal("short ray array lifted")
			}
			if !reflect.DeepEqual(lines, held) {
				t.Fatal("lifting changed source rays")
			}
		})
	}
}

func TestRayNonFiniteRefused(t *testing.T) {
	for field := 0; field < 12; field++ {
		for _, bad := range []float64{math.NaN(), math.Inf(1), math.Inf(-1)} {
			rays := rayFixture(4)
			points := []*engine3.Vec3{&rays[3].Start, &rays[3].Point, &rays[3].End, &rays[3].Back}
			p := points[field/3]
			switch field % 3 {
			case 0:
				p.X = bad
			case 1:
				p.Y = bad
			case 2:
				p.Z = bad
			}
			if _, _, err := Lift(&struct {
				Lines []engine3.Ray `json:"lines"`
			}{rays}); err == nil {
				t.Errorf("accepted field %d = %v", field, bad)
			}
		}
	}
}

func TestRayPresetsRoundTrip(t *testing.T) {
	for _, name := range []string{"Riding a ray through coma", "A spherical bowl's cusped caustic", "A glass dome's ring of light"} {
		t.Run(name, func(t *testing.T) {
			q := presetIn(t, "../../../engine3/testdata/presets.json", name)
			for _, refine := range []bool{false, true} {
				q.Adaptive = refine
				result, err := engine3.Compute(q)
				if err != nil {
					t.Fatal(err)
				}
				result.Mesh = engine3.CurveMesh{}
				places, _, _ := roundTrip(t, &result)
				if paths(places)["rays.lines"].Kind != "ray" {
					t.Fatal("representative rays stayed in JSON")
				}
			}
		})
	}
}
