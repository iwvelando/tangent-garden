package engine4

import (
	"encoding/json"
	"math"
	"testing"
)

func request() Request {
	return Request{Mode: "orthographic", Distance: 4, Count: 1, Samples: 64, Clip: 4}
}
func compute(t *testing.T, q Request) Result {
	t.Helper()
	r, e := Compute(q)
	if e != nil {
		t.Fatal(e)
	}
	if _, e = json.Marshal(r); e != nil {
		t.Fatal(e)
	}
	return r
}
func near(t *testing.T, a, b float64) {
	t.Helper()
	if math.Abs(a-b) > 1e-9 {
		t.Fatalf("%g != %g", a, b)
	}
}
func TestTopologyAndRotations(t *testing.T) {
	q := request()
	r := compute(t, q)
	if len(r.Paths) != 32 {
		t.Fatal(len(r.Paths))
	}
	degree := [16]int{}
	edges := 0
	for i := 0; i < 16; i++ {
		for k := 0; k < 4; k++ {
			if i&(1<<k) == 0 {
				degree[i]++
				degree[i|(1<<k)]++
				edges++
			}
		}
	}
	if edges != 32 {
		t.Fatal(edges)
	}
	for _, d := range degree {
		if d != 4 {
			t.Fatal(degree)
		}
	}
	q.Angles = [6]float64{.31, .54, -.13, .81, .75, -.23}
	for i := 0; i < 16; i++ {
		a := rotate(vertex(i), q.Angles)
		near(t, norm(a), 2)
		for k := 0; k < 4; k++ {
			b := rotate(vertex(i^(1<<k)), q.Angles)
			d := a
			for j := range d {
				d[j] -= b[j]
			}
			near(t, norm(d), 2)
		}
	}
	q.Grid = 3
	r = compute(t, q)
	if len(r.Paths) != 32+48*3 {
		t.Fatal(len(r.Paths))
	}
	// A full turn in each plane is the identity, independently.
	for j := 0; j < 6; j++ {
		a := [6]float64{}
		a[j] = 2 * math.Pi
		v := rotate(Vec4{1, 2, 3, 4}, a)
		for k, x := range v {
			near(t, x, float64(k+1))
		}
	}
}
func TestPerspective(t *testing.T) {
	q := request()
	q.Mode = "perspective"
	r := compute(t, q)
	for i, path := range r.Paths {
		for _, v := range path.Points {
			a := math.Abs(v[0])
			if math.Abs(a-4./3) > 1e-10 && math.Abs(a-.8) > 1e-10 {
				t.Fatal(i, v)
			}
		}
	}
	for n := 0; n < 40; n++ {
		q.Angles = [6]float64{float64(n), .53, .82, .39, -.4, .92}
		r = compute(t, q)
		for _, p := range r.Paths {
			for _, v := range p.Points {
				if math.Sqrt(dot(v, v)) > r.Radius+1e-10 {
					t.Fatal("outside framing sphere")
				}
			}
		}
	}
}
func TestSections(t *testing.T) {
	q := request()
	q.Mode = "section"
	for _, level := range []float64{0, .4, 1, -1} {
		q.Slice = level
		r := compute(t, q)
		s := r.Sections[0]
		if s.Vertices != 8 || s.Edges != 12 || s.Faces != 6 || s.Dimension != 3 {
			t.Fatal(level, s)
		}
	}
	q.Slice = 1.1
	r := compute(t, q)
	if r.Sections[0].Dimension != -1 || len(r.Paths) != 0 {
		t.Fatal(r)
	}
	// Last row becomes (1,1,1,1)/2: the central section is an octahedron.
	q.Slice = 0
	q.Angles = [6]float64{0, 0, 0, math.Pi / 4, math.Asin(1 / math.Sqrt(3)), math.Pi / 6}
	r = compute(t, q)
	s := r.Sections[0]
	if s.Vertices != 6 || s.Edges != 12 || s.Faces != 8 {
		t.Fatal(s)
	}
	for _, p := range r.Paths {
		near(t, dot(sub(p.Points[0], p.Points[1]), sub(p.Points[0], p.Points[1])), 8)
	}
	q.Slice = 1.5
	r = compute(t, q)
	s = r.Sections[0]
	if s.Vertices != 4 || s.Edges != 6 || s.Faces != 4 {
		t.Fatal(s)
	}
	q.Slice = 2
	r = compute(t, q)
	if r.Sections[0].Dimension != 0 || len(r.Points) != 1 {
		t.Fatal(r)
	}
	q.Slice = 0
	q.Count = 9
	q.Spread = 4
	r = compute(t, q)
	if len(r.Sections) != 9 || len(r.Faces) != 0 {
		t.Fatal(r)
	}
	for _, s := range r.Sections {
		if s.Dimension == 3 && s.Vertices-s.Edges+s.Faces != 2 {
			t.Fatal(s)
		}
	}
	// Generic sections: each returned vertex lies in the rotated cube and at w=h.
	q.Count = 1
	q.Slice = .27
	q.Angles = [6]float64{.21, .43, .61, .73, .89, 1.1}
	r = compute(t, q)
	for _, p := range r.Paths {
		for _, v := range p.Points {
			a := Vec4{v[0], v[1], v[2], q.Slice}
			for k := 5; k >= 0; k-- {
				i, j := planes[k][0], planes[k][1]
				s, c := math.Sincos(-q.Angles[k])
				a[i], a[j] = c*a[i]-s*a[j], s*a[i]+c*a[j]
			}
			for _, x := range a {
				if math.Abs(x) > 1+1e-9 {
					t.Fatal(a)
				}
			}
		}
	}
	s = r.Sections[0]
	if s.Vertices-s.Edges+s.Faces != 2 {
		t.Fatal(s)
	}
}
func TestStereographic(t *testing.T) {
	q := request()
	q.Mode = "stereo"
	r := compute(t, q)
	for _, path := range r.Paths {
		for _, v := range path.Points {
			// Inverse projection is on S³; unrotated edge points have three equal |coordinates|.
			rr := dot(v, v)
			p := Vec4{2 * v[0] / (rr + 1), 2 * v[1] / (rr + 1), 2 * v[2] / (rr + 1), (rr - 1) / (rr + 1)}
			near(t, norm(p), 1)
			equal := false
			for k := 0; k < 4; k++ {
				xs := []float64{}
				for j := 0; j < 4; j++ {
					if j != k {
						xs = append(xs, math.Abs(p[j]))
					}
				}
				if math.Abs(xs[0]-xs[1]) < 1e-9 && math.Abs(xs[1]-xs[2]) < 1e-9 {
					equal = true
				}
			}
			if !equal {
				t.Fatal(p)
			}
		}
	}
	// A pole strictly BETWEEN samples must split, never bridge the two branches.
	a, b := Vec4{-1, 0, 0, 1}, Vec4{1, 0, 0, 1}
	paths, clipped := stereo(a, b, 4, 9)
	if !clipped || len(paths) != 2 {
		t.Fatal(paths, clipped)
	}
	for _, p := range paths {
		for _, v := range p {
			if dot(v, v) > 16+1e-8 {
				t.Fatal(v)
			}
		}
	}
	near(t, math.Abs(paths[0][len(paths[0])-1][0]), 4)
	near(t, paths[1][0][0], 4)
	// Arc chord error falls quadratically as the sampling doubles.
	errorAt := func(n int) float64 {
		p, _ := stereo(Vec4{-1, 1, 1, 1}, Vec4{1, 1, 1, 1}, 4, n)
		max := 0.
		for i := 1; i < len(p[0]); i++ {
			t0 := (float64(i) - .5) / float64(n)
			v := mix(Vec4{-1, 1, 1, 1}, Vec4{1, 1, 1, 1}, t0)
			d := norm(v) - v[3]
			exact := Vec3{v[0] / d, v[1] / d, v[2] / d}
			mid := Vec3{}
			for k := range mid {
				mid[k] = (p[0][i-1][k] + p[0][i][k]) / 2
			}
			diff := sub(exact, mid)
			max = math.Max(max, math.Sqrt(dot(diff, diff)))
		}
		return max
	}
	if errorAt(16)/errorAt(32) < 3.5 || errorAt(32)/errorAt(64) < 3.5 {
		t.Fatal("arc convergence")
	}
	q.Grid = 12
	q.Samples = 256
	q.Angles = [6]float64{.1, .2, .3, .4, .5, .6}
	r = compute(t, q)
	if len(r.Paths) > 2*(32+48*12) {
		t.Fatal("unbounded paths")
	}
	for _, p := range r.Paths {
		for _, v := range p.Points {
			if dot(v, v) > 16+1e-8 {
				t.Fatal("clipping", v)
			}
		}
	}
}
func TestRefusals(t *testing.T) {
	tests := []func(*Request){func(q *Request) { q.Mode = "bad" }, func(q *Request) { q.Mode = "perspective"; q.Distance = 2 }, func(q *Request) { q.Angles[2] = math.NaN() }, func(q *Request) { q.Mode = "stereo"; q.Clip = math.Inf(1) }, func(q *Request) { q.Mode = "section"; q.Slice = 4 }, func(q *Request) { q.Mode = "section"; q.Spread = -1 }, func(q *Request) { q.Mode = "section"; q.Count = 26 }, func(q *Request) { q.Grid = 13 }, func(q *Request) { q.Mode = "stereo"; q.Samples = 257 }}
	for _, f := range tests {
		q := request()
		f(&q)
		if _, e := Compute(q); e == nil {
			t.Fatal(q)
		}
	}
}

func TestSectionSweepAndDegenerateContacts(t *testing.T) {
	q := request()
	q.Mode = "section"
	// Normals in a coordinate two-plane and three-plane touch an edge and square.
	q.Angles[3] = math.Pi / 4
	q.Slice = math.Sqrt(2)
	r := compute(t, q)
	if r.Sections[0].Dimension != 2 || r.Sections[0].Vertices != 4 || r.Sections[0].Edges != 4 || r.Sections[0].Faces != 1 {
		t.Fatal(r.Sections)
	}
	q.Angles[4] = math.Asin(1 / math.Sqrt(3))
	q.Slice = math.Sqrt(3)
	r = compute(t, q)
	if r.Sections[0].Dimension != 1 || r.Sections[0].Edges != 1 {
		t.Fatal(r.Sections)
	}
	for i := 0; i < 40; i++ {
		q.Angles = [6]float64{.13, .25, .41, float64(i) * .137, .32, .54}
		q.Count = 25
		q.Spread = 4
		q.Slice = 0
		r = compute(t, q)
		for _, s := range r.Sections {
			if s.Dimension == 3 && s.Vertices-s.Edges+s.Faces != 2 {
				t.Fatal(i, s)
			}
		}
		// Reflected section has the same topology by central symmetry of the cube.
		for j := 0; j < 12; j++ {
			a, b := r.Sections[j], r.Sections[24-j]
			if a.Vertices != b.Vertices || a.Edges != b.Edges || a.Faces != b.Faces {
				t.Fatal(a, b)
			}
		}
	}
}
