package lift

import (
	"encoding/json"
	"fmt"
	"math"
	"os"
	"reflect"
	"strings"
	"testing"

	"tangentgarden/engine3"
	"tangentgarden/engine4"
)

// restore puts the lifted arrays back into a decoded JSON value, as the
// page does (web/lifted.ts), so that the result can be compared with the
// JSON the engine's result encodes to without lifting.
func restore(t *testing.T, text []byte, floats []float64, places []Place) any {
	t.Helper()
	var root any
	if err := json.Unmarshal(text, &root); err != nil {
		t.Fatal(err)
	}
	item := func(kind string, at int) (any, int) {
		switch kind {
		case "point", "vector":
			x, y, z := floats[at], floats[at+1], floats[at+2]
			if kind == "point" && math.IsNaN(x) {
				return nil, at + 3
			}
			return map[string]any{"x": x, "y": y, "z": z}, at + 3
		case "triple":
			return []any{floats[at], floats[at+1], floats[at+2]}, at + 3
		case "quad":
			return []any{floats[at], floats[at+1], floats[at+2], floats[at+3]}, at + 4
		case "maybe":
			if math.IsNaN(floats[at]) {
				return nil, at + 1
			}
			return floats[at], at + 1
		case "number":
			return floats[at], at + 1
		}
		t.Fatalf("unknown kind %q", kind)
		return nil, at
	}
	row := func(kind string, at, n int) ([]any, int) {
		out := make([]any, n)
		for k := range out {
			out[k], at = item(kind, at)
		}
		return out, at
	}
	for _, p := range places {
		var value any
		at := p.Offset
		if p.Rows == nil {
			value, at = row(p.Kind, at, p.Count)
		} else {
			rows := make([]any, len(p.Rows))
			for r, n := range p.Rows {
				if n >= 0 {
					rows[r], at = row(p.Kind, at, n)
				}
			}
			value = rows
		}
		parent := root
		for _, key := range p.Path[:len(p.Path)-1] {
			parent = step(t, parent, key)
		}
		switch last := p.Path[len(p.Path)-1].(type) {
		case string:
			object := parent.(map[string]any)
			// A field left out when empty loses its key.
			if v, ok := object[last]; ok && v != nil {
				t.Fatalf("%v: the JSON holds %v in the lifted array's place", p.Path, v)
			}
			object[last] = value
		case int:
			array := parent.([]any)
			if array[last] != nil {
				t.Fatalf("%v: the JSON holds a value in the lifted array's place", p.Path)
			}
			array[last] = value
		}
	}
	return root
}

func step(t *testing.T, v any, key any) any {
	t.Helper()
	switch k := key.(type) {
	case string:
		return v.(map[string]any)[k]
	case int:
		return v.([]any)[k]
	}
	t.Fatalf("path key %v", key)
	return nil
}

// same compares two decoded JSON values, numbers bit for bit, so that 0
// and −0 differ.
func same(a, b any, at string) error {
	switch x := a.(type) {
	case map[string]any:
		y, ok := b.(map[string]any)
		if !ok || len(x) != len(y) {
			return fmt.Errorf("%s: %v against %v", at, a, b)
		}
		for k := range x {
			if err := same(x[k], y[k], at+"."+k); err != nil {
				return err
			}
		}
	case []any:
		y, ok := b.([]any)
		if !ok || len(x) != len(y) {
			return fmt.Errorf("%s: arrays of different lengths", at)
		}
		for k := range x {
			if err := same(x[k], y[k], fmt.Sprintf("%s[%d]", at, k)); err != nil {
				return err
			}
		}
	case float64:
		y, ok := b.(float64)
		if !ok || math.Float64bits(x) != math.Float64bits(y) {
			return fmt.Errorf("%s: %v against %v", at, a, b)
		}
	default:
		if !reflect.DeepEqual(a, b) {
			return fmt.Errorf("%s: %v against %v", at, a, b)
		}
	}
	return nil
}

// roundTrip lifts result's arrays, checks that the JSON left, with them put
// back, decodes to what the whole result's JSON decodes to, and returns the
// lifted places and the two JSON sizes.
func roundTrip(t *testing.T, result any) ([]Place, int, int) {
	t.Helper()
	whole, err := json.Marshal(result)
	if err != nil {
		t.Fatal(err)
	}
	floats, places, err := Lift(result)
	if err != nil {
		t.Fatal(err)
	}
	rest, err := json.Marshal(result)
	if err != nil {
		t.Fatal(err)
	}
	// Each place's floats follow the last's, with none left over.
	end := 0
	for _, p := range places {
		if p.Offset != end {
			t.Fatalf("%v starts at %d, not %d", p.Path, p.Offset, end)
		}
		end += size(p)
	}
	if end != len(floats) {
		t.Fatalf("places cover %d of %d floats", end, len(floats))
	}
	var want any
	if err := json.Unmarshal(whole, &want); err != nil {
		t.Fatal(err)
	}
	if err := same(restore(t, rest, floats, places), want, "result"); err != nil {
		t.Fatal(err)
	}
	return places, len(whole), len(rest)
}

// size is the number of floats a place holds.
func size(p Place) int {
	per := width(p.Kind)
	if p.Rows == nil {
		return per * p.Count
	}
	n := 0
	for _, r := range p.Rows {
		n += per * max(r, 0)
	}
	return n
}

func preset(t *testing.T, name string) engine3.Request {
	t.Helper()
	b, err := os.ReadFile("testdata/presets.json")
	if err != nil {
		t.Fatal(err)
	}
	var all map[string]json.RawMessage
	if err := json.Unmarshal(b, &all); err != nil {
		t.Fatal(err)
	}
	var q engine3.Request
	if err := json.Unmarshal(all[name], &q); err != nil {
		t.Fatalf("%s: %v", name, err)
	}
	return q
}

func paths(places []Place) map[string]Place {
	out := map[string]Place{}
	for _, p := range places {
		keys := make([]string, len(p.Path))
		for k, key := range p.Path {
			keys[k] = fmt.Sprint(key)
		}
		out[strings.Join(keys, ".")] = p
	}
	return out
}

// Every spatial study's large arrays leave the JSON and come back exactly:
// curves with breaks, refined paths, canal circles and meridians, a frame's
// edges, surface and focal grids, the surface probe, ray grids, trajectories
// and pursuits.
func TestSpatialPresetsRoundTrip(t *testing.T) {
	cases := []struct {
		preset string
		lifted []string // places that must be lifted, by path
		shrink float64  // the JSON left is at most this share of the whole
	}{
		{"A cord twisted round a spring", []string{"base", "adaptive.base.points", "adaptive.base.at", "adaptive.meridians.0.points", "canal.circles.0.points", "canal.meridians"}, 0.2},
		{"A coiled cord round a trefoil", []string{"base", "composition.curve", "canal.circles.0.points"}, 0.2},
		{"A band around the trefoil", []string{"base", "minus", "plus"}, 0.6},
		{"The whole focal surface of an ellipsoid", []string{"surface.surface.points", "surface.surface.normals", "surface.focal.0.points"}, 0.2},
		{"Riding a ray through coma", nil, 0.3},
		{"A row of seeds wound up by a vortex", []string{"field.paths"}, 0.3},
		{"Four pursuers on a tetrahedron", []string{"pursuit.paths"}, 0.3},
		{"A trefoil's string, unwound", nil, 0.5},
		{"The curvature of an ellipsoid's focal sheet", []string{"surfaceDiagnostics.points", "surfaceDiagnostics.curvature.0", "surfaceDiagnostics.u"}, 0.2},
	}
	for _, c := range cases {
		t.Run(c.preset, func(t *testing.T) {
			result, err := engine3.Compute(preset(t, c.preset))
			if err != nil {
				t.Fatal(err)
			}
			// The mesh has its own transport (cmd/wasm/mesh.go).
			result.Mesh = engine3.CurveMesh{}
			places, whole, rest := roundTrip(t, &result)
			got := paths(places)
			for _, p := range c.lifted {
				if _, ok := got[p]; !ok {
					t.Errorf("%s was not lifted; lifted %v", p, keys(got))
				}
			}
			if share := float64(rest) / float64(whole); share > c.shrink {
				t.Errorf("the JSON left is %.0f%% of %d bytes", 100*share, whole)
			}
		})
	}
}

func keys(m map[string]Place) []string {
	out := []string{}
	for k := range m {
		out = append(out, k)
	}
	return out
}

// A canal's meridians are null where there is no real circle, and a broken
// curve's points are null across its gap: each comes back null, beside
// points that come back exactly.
func TestNullsComeBack(t *testing.T) {
	result, err := engine3.Compute(preset(t, "A cord twisted round a spring"))
	if err != nil {
		t.Fatal(err)
	}
	result.Mesh = engine3.CurveMesh{}
	nulls := 0
	for _, p := range result.Adaptive.Base.Points {
		if p == nil {
			nulls++
		}
	}
	// Force a gap, and a null row, where the preset has none.
	result.Base[3], result.Base[4] = nil, nil
	result.Canal.Meridians = append(result.Canal.Meridians, nil, []*engine3.Vec3{})
	places, _, _ := roundTrip(t, &result)
	m := paths(places)["canal.meridians"]
	if n := len(m.Rows); m.Kind != "point" || m.Rows[n-2] != -1 || m.Rows[n-1] != 0 {
		t.Errorf("meridians: kind %q, rows %v", m.Kind, m.Rows)
	}
}

// Integer arrays, booleans, fixed-size arrays and short arrays stay in the
// JSON. An array a field leaves out when empty (omitempty) is lifted, and
// its key comes back with it.
func TestWhatStays(t *testing.T) {
	type inner struct {
		Points []engine3.Vec3 `json:"points"`
	}
	type study struct {
		Short    []engine3.Vec3   `json:"short"`
		Long     []engine3.Vec3   `json:"long"`
		Optional []float64        `json:"optional,omitempty"`
		Flags    []bool           `json:"flags"`
		Indices  []int            `json:"indices"`
		Fixed    [40]float64      `json:"fixed"`
		Nested   []inner          `json:"nested"`
		Pointer  *inner           `json:"pointer"`
		Skipped  []float64        `json:"-"`
		Embedded                  // fields at this level
		Empty    []*engine3.Vec3  `json:"empty"`
		Absent   []*engine3.Vec3  `json:"absent"`
		Grid     [][]engine3.Vec3 `json:"grid"`
	}
	long := make([]engine3.Vec3, 40)
	for k := range long {
		long[k] = engine3.Vec3{X: float64(k), Y: -0.0 * float64(k), Z: 1e-300}
	}
	long[1].Y = math.Copysign(0, -1)
	s := study{
		Short:    long[:3],
		Long:     long,
		Optional: make([]float64, 100),
		Flags:    make([]bool, 100),
		Indices:  make([]int, 100),
		Nested:   []inner{{long}, {long[:2]}},
		Pointer:  &inner{long},
		Skipped:  make([]float64, 100),
		Embedded: Embedded{Values: make([]float64, 100)},
		Empty:    []*engine3.Vec3{},
		Grid:     [][]engine3.Vec3{long[:20], nil, long[:20]},
	}
	places, _, _ := roundTrip(t, &s)
	got := paths(places)
	want := []string{"long", "optional", "nested.0.points", "pointer.points", "values", "grid"}
	if len(got) != len(want) {
		t.Errorf("lifted %v, want %v", keys(got), want)
	}
	for _, p := range want {
		if _, ok := got[p]; !ok {
			t.Errorf("%s was not lifted; lifted %v", p, keys(got))
		}
	}
	if got["long"].Kind != "vector" || got["values"].Kind != "number" || got["grid"].Rows[1] != -1 {
		t.Errorf("kinds: %+v", got)
	}
}

type Embedded struct {
	Values []float64 `json:"values"`
}

// JSON cannot carry a NaN or an infinity, and the whole result's encoding
// refuses one: lifting refuses it too rather than sending a NaN, which
// would read back as a missing point, or an infinity.
func TestNonFiniteRefused(t *testing.T) {
	type study struct {
		Points  []*engine3.Vec3 `json:"points"`
		Numbers []float64       `json:"numbers"`
	}
	for _, bad := range []float64{math.NaN(), math.Inf(1), math.Inf(-1)} {
		points := make([]*engine3.Vec3, 40)
		for k := range points {
			points[k] = &engine3.Vec3{X: 1, Y: 2, Z: 3}
		}
		points[7] = &engine3.Vec3{X: 1, Y: bad, Z: 3}
		if _, _, err := Lift(&study{Points: points}); err == nil {
			t.Errorf("a point with %v was lifted", bad)
		}
		numbers := make([]float64, 100)
		numbers[50] = bad
		if _, _, err := Lift(&study{Numbers: numbers}); err == nil {
			t.Errorf("a number %v was lifted", bad)
		}
	}
}

// The 4D notebook's paths, faces and points are arrays of [x, y, z].
func TestTesseractRoundTrip(t *testing.T) {
	cases := []struct {
		name    string
		request engine4.Request
		lifted  string
	}{
		{"weave", engine4.Request{Object: "weave", Mode: "stereo", Count: 8, Curves: 12, Samples: 64, Clip: 12,
			Weave: &engine4.WeaveParameters{Family: "tori", Alpha: 0.6, Spread: 1, AlphaFrom: 0.6, AlphaTo: 0.6}}, "paths.0.points"},
		{"stereographic tesseract", engine4.Request{Mode: "stereo", Grid: 8, Samples: 64, Clip: 12, Angles: [6]float64{0.3, 0, 0, 0.4, 0, 0}}, "paths.0.points"},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			result, err := engine4.Compute(c.request)
			if err != nil {
				t.Fatal(err)
			}
			places, whole, rest := roundTrip(t, &result)
			p, ok := paths(places)[c.lifted]
			if !ok || p.Kind != "triple" {
				t.Errorf("%s: %+v", c.lifted, p)
			}
			if rest > whole/2 {
				t.Errorf("the JSON left is %d of %d bytes", rest, whole)
			}
			// A weave's paths also carry their 4D points and parameters,
			// which a field leaves out when empty.
			if c.name == "weave" {
				got := paths(places)
				if p := got["paths.0.fourPoints"]; p.Kind != "quad" {
					t.Errorf("fourPoints: %+v", p)
				}
				if p := got["paths.0.parameters"]; p.Kind != "number" {
					t.Errorf("parameters: %+v", p)
				}
			}
		})
	}
}
