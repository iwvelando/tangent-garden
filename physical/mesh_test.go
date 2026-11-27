package physical

import (
	"math"
	"testing"
)

// cube appends an axis-aligned box with outward triangles.
func cube(m *Mesh, x, y, z, s float64) {
	base := int32(len(m.V) / 3)
	for k := range 8 {
		m.V = append(m.V, x+s*float64(k&1), y+s*float64(k>>1&1), z+s*float64(k>>2&1))
	}
	quads := [][4]int32{{0, 2, 3, 1}, {4, 5, 7, 6}, {0, 1, 5, 4}, {2, 6, 7, 3}, {0, 4, 6, 2}, {1, 3, 7, 5}}
	for _, q := range quads {
		m.T = append(m.T, base+q[0], base+q[1], base+q[2], base+q[0], base+q[2], base+q[3])
	}
}

func TestCheckAcceptsAClosedCube(t *testing.T) {
	var m Mesh
	cube(&m, 1, 2, 3, 2)
	r := Check(&m, DefaultLimits)
	if !r.Closed || !r.Oriented || r.Components != 1 || r.SelfIntersections != 0 || r.Touching != 0 || r.Degenerate != 0 {
		t.Fatalf("%+v", r)
	}
	if math.Abs(r.Volume-8) > 1e-12 || math.Abs(r.Area-24) > 1e-12 {
		t.Errorf("volume %g area %g", r.Volume, r.Area)
	}
	if r.Min != [3]float64{1, 2, 3} || r.Max != [3]float64{3, 4, 5} {
		t.Errorf("bounds %v %v", r.Min, r.Max)
	}
	if up := r.Up[5]; math.Abs(up-4) > 1e-12 {
		t.Errorf("upward area at z = 5: %g", up)
	}
}

func TestCheckFindsFaults(t *testing.T) {
	flipped := func() *Mesh {
		var m Mesh
		cube(&m, 0, 0, 0, 1)
		m.T[0], m.T[1] = m.T[1], m.T[0]
		return &m
	}
	open := func() *Mesh {
		var m Mesh
		cube(&m, 0, 0, 0, 1)
		m.T = m.T[3:]
		return &m
	}
	inverted := func() *Mesh {
		var m Mesh
		cube(&m, 0, 0, 0, 1)
		for k := 0; k < len(m.T); k += 3 {
			m.T[k], m.T[k+1] = m.T[k+1], m.T[k]
		}
		return &m
	}
	overlapping := func() *Mesh {
		var m Mesh
		cube(&m, 0, 0, 0, 1)
		cube(&m, 0.5, 0.25, 0.25, 1)
		return &m
	}
	touching := func() *Mesh {
		var m Mesh
		cube(&m, 0, 0, 0, 1)
		cube(&m, 1, 0.25, 0.25, 0.5)
		return &m
	}
	bowtie := func() *Mesh {
		var m Mesh
		cube(&m, 0, 0, 0, 1)
		cube(&m, 1, 1, 1, 1)
		// Share the corner vertex: the second cube's first vertex is the
		// first cube's last.
		for k := range m.T {
			if m.T[k] == 8 {
				m.T[k] = 7
			}
		}
		return &m
	}
	inside := func() *Mesh {
		var m Mesh
		cube(&m, 0, 0, 0, 3)
		cube(&m, 1, 1, 1, 1)
		return &m
	}
	cases := []struct {
		name string
		m    *Mesh
		bad  func(Report) bool
	}{
		{"flipped", flipped(), func(r Report) bool { return !r.Oriented || !r.Closed }},
		{"open", open(), func(r Report) bool { return !r.Closed && r.Boundary > 0 }},
		{"inverted", inverted(), func(r Report) bool { return !r.Oriented && r.Volume < 0 }},
		{"overlapping", overlapping(), func(r Report) bool { return r.SelfIntersections > 0 }},
		{"touching", touching(), func(r Report) bool { return r.Touching > 0 }},
		{"bowtie", bowtie(), func(r Report) bool { return r.NonmanifoldVertices > 0 }},
		// A closed shell inside another is a void or a stray body: its
		// components are counted and the inner one's nesting reported.
		{"inside", inside(), func(r Report) bool { return r.Components == 2 && r.Nested == 1 }},
	}
	for _, c := range cases {
		r := Check(c.m, DefaultLimits)
		if !c.bad(r) {
			t.Errorf("%s: not detected: %+v", c.name, r)
		}
		if r.Valid() {
			t.Errorf("%s: reported valid", c.name)
		}
	}
}

func TestCheckRefusesPastPairCeiling(t *testing.T) {
	var m Mesh
	for k := range 20 {
		cube(&m, float64(k)*0.01, 0, 0, 1)
	}
	lim := DefaultLimits
	lim.PairTests = 50
	r := Check(&m, lim)
	if !r.Unresolved {
		t.Errorf("the self-intersection check ran past its ceiling: %d tests", r.PairTests)
	}
}

// slab appends an axis-aligned box of sides sx, sy, sz with outward
// triangles.
func slab(m *Mesh, x, y, z, sx, sy, sz float64) {
	base := int32(len(m.V) / 3)
	for k := range 8 {
		m.V = append(m.V, x+sx*float64(k&1), y+sy*float64(k>>1&1), z+sz*float64(k>>2&1))
	}
	quads := [][4]int32{{0, 2, 3, 1}, {4, 5, 7, 6}, {0, 1, 5, 4}, {2, 6, 7, 3}, {0, 4, 6, 2}, {1, 3, 7, 5}}
	for _, q := range quads {
		m.T = append(m.T, base+q[0], base+q[1], base+q[2], base+q[0], base+q[2], base+q[3])
	}
}

// A few triangles far longer than the rest, as a large plaque's plain
// regions have, are still tested against everything their boxes meet:
// the check finishes, finds nothing where nothing crosses, and finds the
// crossing where a long triangle cuts a small one.
func TestCheckTestsLongTriangles(t *testing.T) {
	small := func() *Mesh {
		var m Mesh
		for i := range 20 {
			for j := range 20 {
				cube(&m, 3*float64(i), 3*float64(j), 0, 1)
			}
		}
		return &m
	}
	apart := small()
	slab(apart, -10, -10, 10, 200, 200, 0.5)
	r := Check(apart, DefaultLimits)
	if r.Unresolved || r.SelfIntersections != 0 || r.Touching != 0 || r.Components != 401 || r.PairTests == 0 {
		t.Errorf("apart: %+v", r)
	}
	crossing := small()
	slab(crossing, -10, -10, 0.25, 200, 200, 0.5)
	r = Check(crossing, DefaultLimits)
	if r.Unresolved || r.SelfIntersections == 0 {
		t.Errorf("crossing: unresolved %v, crossings %d", r.Unresolved, r.SelfIntersections)
	}
	// The pair-test ceiling still bounds the long triangles' pass.
	lim := DefaultLimits
	lim.PairTests = 10
	if r := Check(crossing, lim); !r.Unresolved {
		t.Error("past the pair ceiling: resolved")
	}
}
