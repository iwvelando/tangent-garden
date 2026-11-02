package engine

import (
	"errors"
	"math"
	"math/cmplx"
	"math/rand"
	"reflect"
	"testing"
)

// The disk isometry and its closed path (docs/mathematics.md, Moving the
// lace). Expectations are written out here from the definition
// T(z) = e^{iθ}(z − a)/(1 − āz), with a = offset·e^{i·direction}, rather
// than taken from the engine's matrices; observations come from the
// returned geometry.

func isoT(iso LaceIsometry) func(complex128) complex128 {
	a := cmplx.Rect(iso.Offset, iso.Direction)
	turn := cmplx.Rect(1, iso.Rotation)
	return func(z complex128) complex128 {
		return turn * (z - a) / (1 - cmplx.Conj(a)*z)
	}
}

func moved(t *testing.T, q LaceRequest, iso LaceIsometry) LaceResult {
	t.Helper()
	q.Isometry = &iso
	return mustLace(t, q)
}

// topology is everything an isometry must leave alone: identity, order,
// incidence and orientation.
func topology(r LaceResult) []any {
	return []any{r.Tiling, r.Depth, r.Parent, r.Via, r.Reversed, r.Corners, r.Sides,
		r.VertexTiles, r.EdgeA, r.EdgeB, r.EdgeTiles, r.Omitted, r.Stopped, r.Pending,
		r.Processed, r.Duplicates, r.VertexRadius, r.Circumradius, r.Apothem, r.SideLength}
}

// checkGeodesics checks every edge and stroke of a result against its
// returned circle: orthogonal to the rim and through its ends, or a
// diameter through the origin; and every point of it inside the disk.
func checkGeodesics(t *testing.T, r LaceResult) {
	t.Helper()
	check := func(what string, i int, a, b, c complex128, rho float64, straight bool) {
		if straight {
			if d := math.Abs(real(a)*imag(b)-imag(a)*real(b)) / cmplx.Abs(a-b); d > 1e-12 {
				t.Errorf("straight %s %d misses the origin by %v", what, i, d)
			}
		} else {
			if d := math.Abs(cmplx.Abs(c)*cmplx.Abs(c)-1-rho*rho) / (1 + rho*rho); d > 1e-12 {
				t.Errorf("%s %d's circle is not orthogonal to the rim (relative %v)", what, i, d)
			}
			for _, p := range []complex128{a, b} {
				if d := math.Abs(cmplx.Abs(p-c) - rho); d > 1e-12*math.Max(1, rho) {
					t.Errorf("%s %d's end %v is %v off its circle", what, i, p, d)
				}
			}
		}
		for _, p := range arcPoints(a, b, c, straight, 8) {
			if cmplx.Abs(p) >= 1 {
				t.Errorf("%s %d reaches the rim at %v", what, i, p)
			}
		}
	}
	for e := range r.EdgeA {
		check("edge", e, cz(r.Vertex[int(r.EdgeA[e])]), cz(r.Vertex[int(r.EdgeB[e])]),
			cz(r.EdgeCenter[e]), r.EdgeRadius[e], r.EdgeStraight[e])
	}
	for s := range r.ArcStart {
		check("stroke", s, cz(r.ArcStart[s]), cz(r.ArcEnd[s]), cz(r.ArcCenter[s]), r.ArcRadius[s], r.ArcStraight[s])
	}
}

// The isometry as the engine builds it: a normalized disk automorphism
// that agrees with the definition, fixes nothing it should move, has the
// stated inverse, and preserves hyperbolic distance on independent
// interior pairs, including pairs near the rim and offsets at the bound.
func TestLaceIsometryMap(t *testing.T) {
	rng := rand.New(rand.NewSource(7))
	point := func(maxR float64) complex128 {
		return cmplx.Rect(maxR*math.Sqrt(rng.Float64()), 2*math.Pi*rng.Float64())
	}
	for _, iso := range []LaceIsometry{
		{}, {Offset: 0.3, Direction: 1}, {Offset: 0.8, Direction: -2.5, Rotation: 4},
		{Offset: 0.8, Direction: math.Pi / 2}, {Rotation: 2 * math.Pi / 7}, {Offset: 1e-9, Direction: 3},
	} {
		m := isometry(iso)
		if m.odd {
			t.Fatalf("%v reverses orientation", iso)
		}
		if n := real(m.a)*real(m.a) + imag(m.a)*imag(m.a) - real(m.b)*real(m.b) - imag(m.b)*imag(m.b); math.Abs(n-1) > 1e-14 {
			t.Errorf("%v is not normalized: |a|² − |b|² = %v", iso, n)
		}
		want := isoT(iso)
		a := cmplx.Rect(iso.Offset, iso.Direction)
		if z := m.apply(a); cmplx.Abs(z) > 1e-15 {
			t.Errorf("%v does not bring a to the center: %v", iso, z)
		}
		inv := m.inverse()
		for range 200 {
			z, w := point(0.999), point(0.999)
			if d := cmplx.Abs(m.apply(z) - want(z)); d > 1e-13 {
				t.Errorf("%v at %v: %v, want %v", iso, z, m.apply(z), want(z))
			}
			if d := cmplx.Abs(inv.apply(m.apply(z)) - z); d > 1e-12 {
				t.Errorf("%v's inverse misses %v by %v", iso, z, d)
			}
			before, after := dist(z, w), dist(m.apply(z), m.apply(w))
			if math.Abs(after-before) > 1e-9*math.Max(1, before) {
				t.Errorf("%v changes the distance of %v and %v from %v to %v", iso, z, w, before, after)
			}
			// The rim is carried to itself.
			if r := cmplx.Abs(m.apply(cmplx.Rect(1, 2*math.Pi*rng.Float64()))); math.Abs(r-1) > 1e-14 {
				t.Errorf("%v moves the rim to radius %v", iso, r)
			}
		}
	}
	// Rotation alone turns every point about the center.
	m := isometry(LaceIsometry{Rotation: 1.25})
	for range 50 {
		z := point(0.99)
		if d := cmplx.Abs(m.apply(z) - z*cmplx.Rect(1, 1.25)); d > 1e-15 {
			t.Errorf("rotation alone moves %v by %v from its turn", z, d)
		}
	}
}

// A moved patch is the same patch: every tile, vertex, edge and stroke is
// the image of the unmoved one under T, within the hyperbolic budget; the
// topology and identity are untouched; and every edge and stroke is still
// a geodesic inside the disk. At the identity the result is the unmoved
// one exactly.
func TestLaceMovedPatchIsTheImage(t *testing.T) {
	q := lace(8, 1000, 0.3)
	src := mustLace(t, q)
	ident := moved(t, q, LaceIsometry{})
	if !reflect.DeepEqual(ident, src) {
		t.Fatal("the identity isometry changes the patch")
	}
	for _, iso := range []LaceIsometry{
		{Offset: 0.5, Direction: 0.4}, {Offset: 0.8, Direction: math.Pi}, {Offset: 0.8, Direction: -1, Rotation: 2},
		{Rotation: 0.7},
	} {
		r := moved(t, q, iso)
		if !reflect.DeepEqual(topology(r), topology(src)) {
			t.Fatalf("%v changes the patch's tiles or incidence", iso)
		}
		if r.Isometry != iso {
			t.Errorf("result records %v, want %v", r.Isometry, iso)
		}
		T := isoT(iso)
		near := func(what string, i int, got Vec, z complex128) {
			if d := dist(cz(got), T(z)); d > laceBudget {
				t.Errorf("%v: %s %d lies %v from its image", iso, what, i, d)
			}
		}
		for i := range src.Center {
			near("center", i, r.Center[i], cz(src.Center[i]))
		}
		for i := range src.Vertex {
			near("vertex", i, r.Vertex[i], cz(src.Vertex[i]))
		}
		for i := range src.ArcStart {
			near("stroke start", i, r.ArcStart[i], cz(src.ArcStart[i]))
			near("stroke end", i, r.ArcEnd[i], cz(src.ArcEnd[i]))
		}
		checkGeodesics(t, r)
		// Hyperbolic distances between returned vertices are preserved:
		// each tile's side and its distance to the center tile.
		for i := range src.Center {
			for k := range 7 {
				before := dist(corner(src, i, k), corner(src, i, k+1))
				after := dist(corner(r, i, k), corner(r, i, k+1))
				if math.Abs(after-before) > laceBudget {
					t.Errorf("%v: tile %d side %d is %v long, was %v", iso, i, k, after, before)
				}
			}
			before := dist(cz(src.Center[0]), cz(src.Center[i]))
			after := dist(cz(r.Center[0]), cz(r.Center[i]))
			if math.Abs(after-before) > laceBudget*math.Max(1, before) {
				t.Errorf("%v: tile %d lies %v from the center tile, was %v", iso, i, after, before)
			}
			// The motif stays in its own tile.
			for s := range LaceStrokes {
				a := LaceStrokes*i + s
				for _, p := range arcPoints(cz(r.ArcStart[a]), cz(r.ArcEnd[a]), cz(r.ArcCenter[a]), r.ArcStraight[a], 6) {
					if !inside(r, i, p, 1e-9) {
						t.Fatalf("%v: tile %d's stroke %d leaves it at %v", iso, i, s, p)
					}
				}
			}
		}
		// Corners still wind by orientation: an isometry that keeps
		// orientation keeps each tile's winding.
		for i := range src.Center {
			if sgn(winding(r, i)) != sgn(winding(src, i)) {
				t.Errorf("%v: tile %d's corners change their winding", iso, i)
			}
		}
	}
}

func sgn(v float64) int {
	if v < 0 {
		return -1
	}
	return 1
}

// winding is the signed area of a tile's corner polygon.
func winding(r LaceResult, i int) float64 {
	area := 0.0
	for k := range 7 {
		a, b := corner(r, i, k), corner(r, i, k+1)
		area += real(a)*imag(b) - imag(a)*real(b)
	}
	return area
}

// Rotation by a seventh of a turn maps the complete patch onto itself as a
// set, though each tile and vertex moves to another's place.
func TestLaceRotationSymmetry(t *testing.T) {
	q := lace(5, 1000, 0.3)
	src := mustLace(t, q)
	r := moved(t, q, LaceIsometry{Rotation: 2 * math.Pi / 7})
	grid := newDiskGrid()
	for i, v := range src.Vertex {
		grid.add(cz(v), i)
	}
	at := func(i int) complex128 { return cz(src.Vertex[i]) }
	hit := map[int]bool{}
	for i, v := range r.Vertex {
		j, d := grid.near(cz(v), 1e-6, at)
		if j < 0 || d > laceBudget {
			t.Fatalf("rotated vertex %d matches no vertex of the patch", i)
		}
		hit[j] = true
		if j == i && cmplx.Abs(cz(v)) > 1e-12 {
			t.Errorf("vertex %d is fixed by a seventh of a turn", i)
		}
	}
	if len(hit) != len(src.Vertex) {
		t.Errorf("rotation reaches %d of %d vertices", len(hit), len(src.Vertex))
	}
}

// Offsets at the bound carry the deepest admitted corners nearer the rim,
// but no nearer than the documented bound
// 1 − |T z|² ≥ (1 − |z|²)(1 − |a|)/(1 + |a|), so far above the floor; and a
// patch's set and order never change with the isometry.
func TestLaceMovedNearTheRim(t *testing.T) {
	q := lace(8, 1000, 0.3)
	src := mustLace(t, q)
	srcGap := math.Inf(1)
	for _, v := range src.Vertex {
		srcGap = math.Min(srcGap, rimGap(cz(v)))
	}
	bound := srcGap * (1 - 0.8) / (1 + 0.8)
	worst := math.Inf(1)
	for k := range 16 {
		r := moved(t, q, LaceIsometry{Offset: 0.8, Direction: 2 * math.Pi * float64(k) / 16})
		for i, v := range r.Vertex {
			g := rimGap(cz(v))
			worst = math.Min(worst, g)
			if g < rimGap(cz(src.Vertex[i]))*(1-0.8)/(1+0.8)*(1-1e-9) {
				t.Errorf("vertex %d's rim gap %v is below its bound", i, g)
			}
		}
	}
	if worst < bound || worst < 1e3*lacePolicy.floor {
		t.Errorf("moved rim gap %v, bound %v, floor %v", worst, bound, lacePolicy.floor)
	}
	t.Logf("unmoved rim gap %.3g; at offset 0.8 the worst is %.3g (bound %.3g)", srcGap, worst, bound)
}

// The tiled radius about the window's center is where the patch's own
// boundary comes nearest: every point nearer lies in a tile, and some point
// just beyond lies in none. It is zero when the center itself lies outside
// the patch, and it is not the outermost corner's radius.
func TestLaceCoverage(t *testing.T) {
	// z lies in tile i when it is on the tile center's side of each side's
	// geodesic: inside its circle or not, or for a diameter, on the same
	// side of the line through the origin and the side's far end.
	in := func(r LaceResult, i int, z complex128) bool {
		center := cz(r.Center[i])
		for k := range 7 {
			e := sideOf(r, i, k)
			if r.EdgeStraight[e] {
				u := cz(r.Vertex[int(r.EdgeA[e])])
				if w := cz(r.Vertex[int(r.EdgeB[e])]); cmplx.Abs(w) > cmplx.Abs(u) {
					u = w
				}
				cross := func(p complex128) float64 { return real(u)*imag(p) - imag(u)*real(p) }
				if cross(z)*cross(center) < 0 {
					return false
				}
				continue
			}
			c, rho := cz(r.EdgeCenter[e]), r.EdgeRadius[e]
			if (cmplx.Abs(z-c) < rho) != (cmplx.Abs(center-c) < rho) {
				return false
			}
		}
		return true
	}
	covered := func(r LaceResult, z complex128) bool {
		for i := range r.Center {
			if in(r, i, z) {
				return true
			}
		}
		return false
	}
	for _, c := range []struct {
		q   LaceRequest
		iso LaceIsometry
	}{
		{lace(5, 1000, 0.3), LaceIsometry{}},
		{lace(5, 1000, 0.3), LaceIsometry{Offset: 0.8, Direction: 1}},
		{lace(8, 1000, 0.3), LaceIsometry{Offset: 0.6, Direction: -2}},
		{lace(2, 1000, 0.3), LaceIsometry{Offset: 0.4}},
		{lace(8, 40, 0.3), LaceIsometry{Offset: 0.2, Direction: 0.5}},
		// A lone tile's boundary comes nearest at its sides' midpoints.
		{lace(0, 1, 0.3), LaceIsometry{}},
		{lace(0, 1, 0.3), LaceIsometry{Offset: 0.1, Direction: 0.3}},
	} {
		r := moved(t, c.q, c.iso)
		R := r.Coverage.Radius
		if R <= 0 || R >= 1 {
			t.Fatalf("%v %v: tiled radius %v", c.q, c.iso, R)
		}
		if d := r.Coverage.Distance - 2*math.Atanh(R); math.Abs(d) > 1e-12 {
			t.Errorf("hyperbolic radius %v for Euclidean %v", r.Coverage.Distance, R)
		}
		outer := 0.0
		for _, v := range r.Vertex {
			outer = math.Max(outer, cmplx.Abs(cz(v)))
		}
		if R >= outer {
			t.Errorf("%v %v: tiled radius %v reaches the outermost corner %v", c.q, c.iso, R, outer)
		}
		// The radius is the nearest point of the patch's boundary, its
		// edges with one tile, sampled densely along each arc: no sample
		// nearer, and the nearest within the sampling's reach of it.
		nearest := math.Inf(1)
		for e := range r.EdgeA {
			if r.EdgeTiles[e] != 1 {
				continue
			}
			for _, p := range arcPoints(cz(r.Vertex[int(r.EdgeA[e])]), cz(r.Vertex[int(r.EdgeB[e])]),
				cz(r.EdgeCenter[e]), r.EdgeStraight[e], 256) {
				nearest = math.Min(nearest, cmplx.Abs(p))
			}
		}
		if nearest < R*(1-1e-12) || nearest > R*(1+1e-5) {
			t.Errorf("%v %v: tiled radius %v, nearest boundary sample %v", c.q, c.iso, R, nearest)
		}
		missing := false
		for k := range 720 {
			dir := cmplx.Rect(1, 2*math.Pi*float64(k)/720)
			for _, f := range []float64{0, 0.3, 0.7, 0.99, 0.999} {
				if z := dir * complex(R*f, 0); !covered(r, z) {
					t.Fatalf("%v %v: %v, inside the tiled radius, is in no tile", c.q, c.iso, z)
				}
			}
			if !covered(r, dir*complex(R*1.01, 0)) {
				missing = true
			}
		}
		if !missing {
			t.Errorf("%v %v: nothing just beyond the tiled radius %v is missing", c.q, c.iso, R)
		}
	}
	// Unmoved, the lone tile is complete to its apothem h, at Euclidean
	// radius tanh(h/2) (cosh h = cos(π/3)/sin(π/7)).
	h := math.Acosh(math.Cos(math.Pi/3) / math.Sin(math.Pi/7))
	if r := mustLace(t, lace(0, 1, 0.3)); math.Abs(r.Coverage.Radius-math.Tanh(h/2)) > 1e-15 {
		t.Errorf("the lone tile is tiled to %v, want its apothem's radius %v", r.Coverage.Radius, math.Tanh(h/2))
	}
	// Placement refuses, rather than clamps, a vertex beyond the precision
	// floor. Validation keeps every supported offset far from it, so the
	// check bypasses validation with an offset of 1 − 10⁻⁹.
	src, err := NewLaceSource(lace(8, 1000, 0.3))
	if err != nil {
		t.Fatal(err)
	}
	if _, err := src.result(LaceIsometry{Offset: 1 - 1e-9}); err == nil {
		t.Error("a vertex beyond the precision floor was placed")
	}
	// One tile moved off the window's center leaves the center uncovered.
	r := moved(t, lace(0, 1, 0.3), LaceIsometry{Offset: 0.5})
	if r.Coverage.Radius != 0 || r.Coverage.Distance != 0 {
		t.Errorf("the center lies beyond the patch, but coverage is %+v", r.Coverage)
	}
}

// The authored path: a(p) = r(p)·e^{iφ(p)}, r(p) = (1 − s)·r₀ + s·r₁ with
// s = (1 − cos 2πp)/2, φ(p) = φ₀ + 2π·orbits·p, θ(p) = θ₀ + 2π·turns·p,
// the angles returned within half a turn of their start. It starts and
// ends at the static isometry exactly, reaches the farthest offset exactly
// halfway, and never leaves the larger of the two offsets.
func TestLacePath(t *testing.T) {
	start := LaceIsometry{Offset: 0.2, Direction: 0.3, Rotation: -0.4}
	m := LaceMotion{Offset: 0.7, Orbits: 1, Turns: -2}
	for _, p := range []float64{0, 1} {
		if got := LacePathAt(start, m, p); got != start {
			t.Errorf("at %v the path is %+v, want the start %+v exactly", p, got, start)
		}
	}
	// Halfway is the farthest offset exactly, including offsets for which
	// r₀ + (r₁ − r₀) rounds away from r₁, such as 0.03 and 0.3.
	for _, c := range [][2]float64{{start.Offset, m.Offset}, {0.03, 0.3}, {0.03, 0.01}} {
		if got := LacePathAt(LaceIsometry{Offset: c[0]}, LaceMotion{Offset: c[1]}, 0.5); got.Offset != c[1] {
			t.Errorf("from %v, halfway the offset is %v, want %v exactly", c[0], got.Offset, c[1])
		}
	}
	// Equal as angles, and within half a turn of the start.
	angle := func(got, want, from float64) bool {
		return math.Abs(math.Remainder(got-want, 2*math.Pi)) <= 1e-14 && math.Abs(got-from) <= math.Pi+1e-14
	}
	for i := 0; i <= 1000; i++ {
		p := float64(i) / 1000
		got := LacePathAt(start, m, p)
		s := (1 - math.Cos(2*math.Pi*p)) / 2
		want := LaceIsometry{
			Offset:    (1-s)*start.Offset + s*m.Offset,
			Direction: start.Direction + 2*math.Pi*p,
			Rotation:  start.Rotation - 4*math.Pi*p,
		}
		if math.Abs(got.Offset-want.Offset) > 1e-15 || !angle(got.Direction, want.Direction, start.Direction) ||
			!angle(got.Rotation, want.Rotation, start.Rotation) {
			t.Fatalf("at %v the path is %+v, want %+v", p, got, want)
		}
		if got.Offset > math.Max(start.Offset, m.Offset) || got.Offset < math.Min(start.Offset, m.Offset) {
			t.Fatalf("at %v the offset %v leaves [%v, %v]", p, got.Offset, start.Offset, m.Offset)
		}
	}
}

// Frames of a frozen source: the frame at progress 0 and at 1 is the static
// moved patch exactly, so a loop's ends and a playback's start match the
// drawing bit for bit; intermediate frames are the static patch moved by
// the path's isometry there; and frames neither alter the source nor share
// storage with each other.
func TestLaceFrames(t *testing.T) {
	q := lace(6, 800, 0.4)
	q.Isometry = &LaceIsometry{Offset: 0.25, Direction: 2, Rotation: 0.5}
	m := LaceMotion{Offset: 0.75, Orbits: 1, Turns: 1}
	src, err := NewLaceSource(q)
	if err != nil {
		t.Fatal(err)
	}
	static := mustLace(t, q)
	geometry := func(f LaceFrame) []any {
		return []any{f.Center, f.Transform, f.Vertex, f.EdgeCenter, f.EdgeRadius, f.EdgeStraight,
			f.ArcStart, f.ArcEnd, f.ArcCenter, f.ArcRadius, f.ArcStraight, f.Coverage}
	}
	staticGeometry := []any{static.Center, static.Transform, static.Vertex, static.EdgeCenter, static.EdgeRadius,
		static.EdgeStraight, static.ArcStart, static.ArcEnd, static.ArcCenter, static.ArcRadius, static.ArcStraight, static.Coverage}
	frame := func(p float64) LaceFrame {
		f, err := src.Frame(LaceFrameRequest{Lace: q, Motion: m, Progress: p})
		if err != nil {
			t.Fatal(err)
		}
		return f
	}
	for _, p := range []float64{0, 1} {
		if f := frame(p); !reflect.DeepEqual(geometry(f), staticGeometry) {
			t.Errorf("the frame at %v is not the static drawing", p)
		}
	}
	for _, p := range []float64{0.1, 0.37, 0.5, 0.82} {
		f := frame(p)
		iso := LacePathAt(*q.Isometry, m, p)
		if f.Isometry != iso || f.Progress != p {
			t.Errorf("frame at %v records %+v at %v", p, f.Isometry, f.Progress)
		}
		qp := q
		qp.Isometry = &iso
		want := mustLace(t, qp)
		if !reflect.DeepEqual(geometry(f), []any{want.Center, want.Transform, want.Vertex, want.EdgeCenter,
			want.EdgeRadius, want.EdgeStraight, want.ArcStart, want.ArcEnd, want.ArcCenter, want.ArcRadius,
			want.ArcStraight, want.Coverage}) {
			t.Errorf("the frame at %v differs from the patch moved by its isometry", p)
		}
		if reflect.DeepEqual(f.Vertex, static.Vertex) {
			t.Errorf("the frame at %v has not moved", p)
		}
	}
	// Scribbling over one frame changes neither the source nor the next.
	a := frame(0.3)
	for i := range a.Vertex {
		a.Vertex[i] = Vec{}
	}
	for i := range a.Transform {
		a.Transform[i] = [4]float64{}
	}
	if b := frame(0.3); b.Vertex[0] == (Vec{}) || b.Transform[0] == ([4]float64{}) {
		t.Error("frames share storage")
	}
	if f := frame(0); !reflect.DeepEqual(geometry(f), staticGeometry) {
		t.Error("an earlier frame altered the source")
	}
	// A frame for other generation settings is refused, never drawn from
	// the frozen tiles.
	other := q
	other.Depth = 5
	if _, err := src.Frame(LaceFrameRequest{Lace: other, Motion: m, Progress: 0.5}); err == nil {
		t.Error("a frozen source drew another patch's frame")
	}
}

// Every refusal names its field, including offsets just past the bound,
// nonfinite and out-of-range angles, motion counts and progress.
func TestLaceMotionRefusals(t *testing.T) {
	base := lace(3, 100, 0.3)
	for _, c := range []struct {
		iso   LaceIsometry
		field string
	}{
		{LaceIsometry{Offset: math.Nextafter(0.8, 1)}, "isometry.offset"},
		{LaceIsometry{Offset: -1e-12}, "isometry.offset"},
		{LaceIsometry{Offset: math.NaN()}, "isometry.offset"},
		{LaceIsometry{Direction: math.Inf(1)}, "isometry.direction"},
		{LaceIsometry{Direction: 100.5}, "isometry.direction"},
		{LaceIsometry{Rotation: math.NaN()}, "isometry.rotation"},
		{LaceIsometry{Rotation: -101}, "isometry.rotation"},
	} {
		q := base
		q.Isometry = &c.iso
		_, err := ComputeLace(q)
		var fe *FieldError
		if !errors.As(err, &fe) || fe.Field != c.field {
			t.Errorf("%+v: %v, want a %s field error", c.iso, err, c.field)
		}
	}
	// The bounds themselves are accepted.
	for _, iso := range []LaceIsometry{{Offset: 0.8, Direction: 100, Rotation: -100}, {Offset: 0}} {
		q := base
		q.Isometry = &iso
		if _, err := ComputeLace(q); err != nil {
			t.Errorf("%+v refused: %v", iso, err)
		}
	}
	src, err := NewLaceSource(base)
	if err != nil {
		t.Fatal(err)
	}
	for _, c := range []struct {
		m     LaceMotion
		p     float64
		field string
	}{
		{LaceMotion{Offset: 0.81}, 0, "motion.offset"},
		{LaceMotion{Offset: math.NaN()}, 0, "motion.offset"},
		{LaceMotion{Orbits: 4}, 0, "motion.orbits"},
		{LaceMotion{Turns: -4}, 0, "motion.turns"},
		{LaceMotion{}, -0.01, "progress"},
		{LaceMotion{}, math.NaN(), "progress"},
		{LaceMotion{}, 1.5, "progress"},
	} {
		_, err := src.Frame(LaceFrameRequest{Lace: base, Motion: c.m, Progress: c.p})
		var fe *FieldError
		if !errors.As(err, &fe) || fe.Field != c.field {
			t.Errorf("%+v at %v: %v, want a %s field error", c.m, c.p, err, c.field)
		}
	}
	for _, m := range []LaceMotion{{Offset: 0.8, Orbits: 3, Turns: -3}, {Orbits: -3, Turns: 3}} {
		if _, err := src.Frame(LaceFrameRequest{Lace: base, Motion: m, Progress: 1}); err != nil {
			t.Errorf("%+v refused: %v", m, err)
		}
	}
}

// A frame moves the frozen patch without regenerating it: it allocates its
// output arrays and nothing per tile, the same number of allocations for
// 29 tiles as for 1,000, where generation's grows with the patch.
func TestLaceFrameWorkIsGenerationIndependent(t *testing.T) {
	allocs := func(q LaceRequest) (frame, generate float64) {
		src, err := NewLaceSource(q)
		if err != nil {
			t.Fatal(err)
		}
		f := LaceFrameRequest{Lace: q, Motion: LaceMotion{Offset: 0.6, Orbits: 1, Turns: 1}, Progress: 0.3}
		frame = testing.AllocsPerRun(5, func() {
			if _, err := src.Frame(f); err != nil {
				t.Fatal(err)
			}
		})
		generate = testing.AllocsPerRun(2, func() {
			if _, err := NewLaceSource(q); err != nil {
				t.Fatal(err)
			}
		})
		return frame, generate
	}
	smallFrame, smallGenerate := allocs(lace(2, 1000, 0.3))
	largeFrame, largeGenerate := allocs(lace(8, 1000, 0.3))
	if smallFrame != largeFrame {
		t.Errorf("a frame allocates %v times for 29 tiles and %v for 1,000", smallFrame, largeFrame)
	}
	if largeGenerate < 10*largeFrame || largeGenerate <= smallGenerate {
		t.Errorf("generation allocates %v (29 tiles) and %v (1,000); a frame %v", smallGenerate, largeGenerate, largeFrame)
	}
	t.Logf("allocations per frame %v; per generation %v (29 tiles), %v (1,000 tiles)", largeFrame, smallGenerate, largeGenerate)
}
