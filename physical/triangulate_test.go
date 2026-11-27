package physical

import (
	"math"
	"math/cmplx"
	"testing"
)

// checkFill requires triangles that tile the polygons: every one
// counterclockwise, their areas summing to the region's, each boundary
// edge used once in its own direction, every other edge twice in
// opposite directions, and no two overlapping.
func checkFill(t *testing.T, pts []complex128, polys []Polygon, tris [][3]int32) {
	t.Helper()
	want := 0.0
	boundary := map[[2]int32]bool{}
	for _, p := range polys {
		for _, l := range append([][]int32{p.Outer}, p.Holes...) {
			want += Area(pts, l)
			for k := range l {
				boundary[[2]int32{l[k], l[(k+1)%len(l)]}] = true
			}
		}
	}
	got := 0.0
	directed := map[[2]int32]int{}
	for _, tr := range tris {
		a := cross(pts[tr[1]]-pts[tr[0]], pts[tr[2]]-pts[tr[0]]) / 2
		if !(a > 0) {
			t.Fatalf("triangle %v %v has area %g", tr, []complex128{pts[tr[0]], pts[tr[1]], pts[tr[2]]}, a)
		}
		got += a
		for k := range 3 {
			directed[[2]int32{tr[k], tr[(k+1)%3]}]++
		}
	}
	if math.Abs(got-want) > 1e-9*math.Max(1, want) {
		t.Fatalf("triangles cover %.12g, region %.12g", got, want)
	}
	for e, n := range directed {
		if n != 1 {
			t.Fatalf("edge %v used %d times in one direction", e, n)
		}
		if boundary[e] {
			continue
		}
		if directed[[2]int32{e[1], e[0]}] != 1 {
			t.Fatalf("inner edge %v has no opposite", e)
		}
	}
	for e := range boundary {
		if directed[e] != 1 {
			t.Fatalf("boundary edge %v not used", e)
		}
	}
	if len(tris) <= 3000 {
		for i := range tris {
			for j := i + 1; j < len(tris); j++ {
				if trianglesOverlap(pts, tris[i], tris[j]) {
					t.Fatalf("triangles %v %v and %v %v overlap", tris[i], []complex128{pts[tris[i][0]], pts[tris[i][1]], pts[tris[i][2]]}, tris[j], []complex128{pts[tris[j][0]], pts[tris[j][1]], pts[tris[j][2]]})
				}
			}
		}
	}
}

func TestTriangulateSquareWithHole(t *testing.T) {
	pts := []complex128{0, 10, 10 + 10i, 10i, 3 + 3i, 3 + 6i, 6 + 6i, 6 + 3i}
	polys := []Polygon{{Outer: []int32{0, 1, 2, 3}, Holes: [][]int32{{4, 5, 6, 7}}}}
	tris, err := Triangulate(pts, polys[0])
	if err != nil {
		t.Fatal(err)
	}
	if len(tris) != 8 {
		t.Errorf("%d triangles, want n + 2·holes − 2 = 8", len(tris))
	}
	checkFill(t, pts, polys, tris)
}

// A plate with many round holes and a concave outline, from loops
// written directly.
func TestTriangulateManyHoles(t *testing.T) {
	var pts []complex128
	ring := func(c complex128, r float64, n int, cw bool) []int32 {
		var l []int32
		for k := range n {
			a := 2 * math.Pi * float64(k) / float64(n)
			if cw {
				a = -a
			}
			// A wavy radius makes the outline concave.
			rr := r * (1 + 0.15*math.Sin(5*a))
			if cw {
				rr = r
			}
			pts = append(pts, c+cmplx.Rect(rr, a))
			l = append(l, int32(len(pts)-1))
		}
		return l
	}
	p := Polygon{Outer: ring(0, 50, 400, false)}
	for i := -3; i <= 3; i++ {
		for j := -3; j <= 3; j++ {
			c := complex(float64(i)*10, float64(j)*10)
			if cmplx.Abs(c) > 34 {
				continue
			}
			p.Holes = append(p.Holes, ring(c, 3, 24, true))
		}
	}
	tris, err := Triangulate(pts, p)
	if err != nil {
		t.Fatal(err)
	}
	n := len(p.Outer)
	for _, h := range p.Holes {
		n += len(h)
	}
	if want := n + 2*len(p.Holes) - 2; len(tris) != want {
		t.Errorf("%d triangles, want %d", len(tris), want)
	}
	checkFill(t, pts, []Polygon{p}, tris)
}

// Contoured lace-like bands: islands inside holes, nested by Nest, and
// the complement nested from the reversed loops.
func TestNestAndTriangulateContours(t *testing.T) {
	strokes := append(Circle(0, 20, 1.5), Circle(0, 8, 1)...)
	for k := range 6 {
		a := cmplx.Rect(1, math.Pi*float64(k)/3)
		strokes = append(strokes, Stroke{A: 8 * a, B: 20 * a, Straight: true, Half: 0.8})
		strokes = append(strokes, Circle(14*a*cmplx.Rect(1, math.Pi/6), 2.5, 0.6)...)
	}
	g, err := Sample(Plan{Strokes: strokes, Outer: 30}, 0.2, 5, DefaultLimits)
	if err != nil {
		t.Fatal(err)
	}
	cs, err := g.Contour(DefaultLimits)
	if err != nil {
		t.Fatal(err)
	}
	polys, orphans := Nest(cs.Points, cs.Loops)
	if len(orphans) != 0 {
		t.Fatalf("orphan holes %v", orphans)
	}
	// The web is one piece; each small ring's band is another, inside a
	// hole of the web.
	if len(polys) != 1+6 {
		t.Errorf("%d pieces, want 7", len(polys))
	}
	var all [][3]int32
	for _, p := range polys {
		tris, err := Triangulate(cs.Points, p)
		if err != nil {
			t.Fatal(err)
		}
		all = append(all, tris...)
	}
	checkFill(t, cs.Points, polys, all)
	// The complement inside a plaque circle.
	pts := append([]complex128(nil), cs.Points...)
	var loops [][]int32
	for _, l := range cs.Loops {
		r := make([]int32, len(l))
		for k := range l {
			r[k] = l[len(l)-1-k]
		}
		loops = append(loops, r)
	}
	var plaque []int32
	for k := range 600 {
		pts = append(pts, cmplx.Rect(28, 2*math.Pi*float64(k)/600))
		plaque = append(plaque, int32(len(pts)-1))
	}
	loops = append(loops, plaque)
	rest, orphans := Nest(pts, loops)
	if len(orphans) != 0 {
		t.Fatalf("orphan holes in the complement %v", orphans)
	}
	all = all[:0]
	for _, p := range rest {
		tris, err := Triangulate(pts, p)
		if err != nil {
			t.Fatal(err)
		}
		all = append(all, tris...)
	}
	checkFill(t, pts, rest, all)
}

// trianglesOverlap reports interiors that meet: an edge of one properly
// crossing an edge of the other, or a vertex of one strictly inside the
// other, or identical triangles.
func trianglesOverlap(pts []complex128, a, b [3]int32) bool {
	for i := range 3 {
		for j := range 3 {
			p, q := pts[a[i]], pts[a[(i+1)%3]]
			r, s := pts[b[j]], pts[b[(j+1)%3]]
			if segmentsCross(p, q, r, s) {
				return true
			}
		}
	}
	inside := func(x complex128, t [3]int32) bool {
		for k := range 3 {
			if cross(pts[t[(k+1)%3]]-pts[t[k]], x-pts[t[k]]) <= 0 {
				return false
			}
		}
		return true
	}
	for i := range 3 {
		if inside(pts[a[i]], b) || inside(pts[b[i]], a) {
			return true
		}
	}
	ca := (pts[a[0]] + pts[a[1]] + pts[a[2]]) / 3
	return inside(ca, b)
}

// After flipping, every inner edge is locally Delaunay: neither opposite
// vertex lies inside the other triangle's circumcircle beyond rounding.
func TestTriangulateIsLocallyDelaunay(t *testing.T) {
	var pts []complex128
	p := Polygon{}
	for k := range 300 {
		a := 2 * math.Pi * float64(k) / 300
		pts = append(pts, cmplx.Rect(40*(1+0.2*math.Sin(7*a)), a))
		p.Outer = append(p.Outer, int32(k))
	}
	for i := -2; i <= 2; i++ {
		var hole []int32
		for k := range 40 {
			a := -2 * math.Pi * float64(k) / 40
			pts = append(pts, complex(float64(i)*12, 0)+cmplx.Rect(3, a))
			hole = append(hole, int32(len(pts)-1))
		}
		p.Holes = append(p.Holes, hole)
	}
	tris, err := Triangulate(pts, p)
	if err != nil {
		t.Fatal(err)
	}
	checkFill(t, pts, []Polygon{p}, tris)
	edge := map[[2]int32]int{}
	for i, tr := range tris {
		for k := range 3 {
			edge[[2]int32{tr[k], tr[(k+1)%3]}] = i
		}
	}
	bad := 0
	for i, tr := range tris {
		for k := range 3 {
			a, b := tr[k], tr[(k+1)%3]
			j, ok := edge[[2]int32{b, a}]
			if !ok {
				continue
			}
			c := tr[(k+2)%3]
			var d int32
			for _, v := range tris[j] {
				if v != a && v != b {
					d = v
				}
			}
			if incircle(pts[a], pts[b], pts[c], pts[d]) > 1e-9 {
				bad++
				_ = i
			}
		}
	}
	if bad > 0 {
		t.Errorf("%d inner edges are not locally Delaunay", bad)
	}
}
