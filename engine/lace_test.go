package engine

import (
	"errors"
	"math"
	"math/cmplx"
	"reflect"
	"testing"
)

// The checks below derive their expectations independently of the
// generator: hyperbolic distance, inversion and tangent directions are
// written out here from their definitions, and every observation comes
// from the returned geometry.

// The stated numerical budget: hyperbolic lengths and angles within 1e-9.
const laceBudget = 1e-9

func lace(depth, maxTiles int, starPoint float64) LaceRequest {
	return LaceRequest{Tiling: LaceTiling, Depth: depth, MaxTiles: maxTiles, StarPoint: starPoint}
}

func mustLace(t *testing.T, q LaceRequest) LaceResult {
	t.Helper()
	r, err := ComputeLace(q)
	if err != nil {
		t.Fatal(err)
	}
	checkLaceShape(t, r)
	return r
}

func checkLaceShape(t *testing.T, r LaceResult) {
	t.Helper()
	n := len(r.Center)
	for name, length := range map[string]int{
		"depth": len(r.Depth), "parent": len(r.Parent), "via": len(r.Via),
		"reversed": len(r.Reversed), "transform": len(r.Transform),
		"corners": len(r.Corners) / 7, "sides": len(r.Sides) / 7,
		"arcs": len(r.ArcStart) / LaceStrokes,
	} {
		if length != n {
			t.Fatalf("%s has %d per-tile entries, want %d", name, length, n)
		}
	}
	for name, length := range map[string]int{"vertexTiles": len(r.VertexTiles)} {
		if length != len(r.Vertex) {
			t.Fatalf("%s has %d entries, want %d", name, length, len(r.Vertex))
		}
	}
	e := len(r.EdgeA)
	for name, length := range map[string]int{
		"edgeB": len(r.EdgeB), "edgeTiles": len(r.EdgeTiles), "edgeCenter": len(r.EdgeCenter),
		"edgeRadius": len(r.EdgeRadius), "edgeStraight": len(r.EdgeStraight),
	} {
		if length != e {
			t.Fatalf("%s has %d entries, want %d", name, length, e)
		}
	}
	a := len(r.ArcStart)
	for name, length := range map[string]int{
		"arcEnd": len(r.ArcEnd), "arcCenter": len(r.ArcCenter),
		"arcRadius": len(r.ArcRadius), "arcStraight": len(r.ArcStraight),
	} {
		if length != a {
			t.Fatalf("%s has %d entries, want %d", name, length, a)
		}
	}
}

func cz(v Vec) complex128 { return complex(v.X, v.Y) }

// dist is hyperbolic distance in the curvature −1 metric 4|dz|²/(1 − |z|²)²,
// from cosh d = 1 + 2|z − w|²/((1 − |z|²)(1 − |w|²)).
func dist(z, w complex128) float64 {
	d2 := real(z-w)*real(z-w) + imag(z-w)*imag(z-w)
	gz := 1 - real(z)*real(z) - imag(z)*imag(z)
	gw := 1 - real(w)*real(w) - imag(w)*imag(w)
	// 2 asinh(√(x/2)) = acosh(1 + x), stable for small x.
	return 2 * math.Asinh(math.Sqrt(d2/(gz*gw)))
}

// invert reflects z in the circle with center c and radius rho.
func invert(z, c complex128, rho float64) complex128 {
	return c + complex(rho*rho, 0)/cmplx.Conj(z-c)
}

func corner(r LaceResult, tile, k int) complex128 {
	return cz(r.Vertex[int(r.Corners[7*tile+((k%7)+7)%7])])
}

// tangent is the unit direction at p along the geodesic arc of edge e
// toward q: perpendicular to the radius of its circle, or along the
// diameter.
func tangent(r LaceResult, e int, p, q complex128) complex128 {
	var d complex128
	if r.EdgeStraight[e] {
		d = q - p
	} else {
		radial := p - cz(r.EdgeCenter[e])
		d = complex(-imag(radial), real(radial))
		if real(d)*real(q-p)+imag(d)*imag(q-p) < 0 {
			d = -d
		}
	}
	return d / complex(cmplx.Abs(d), 0)
}

// sideOf is the edge joining tile corners k and k + 1.
func sideOf(r LaceResult, tile, k int) int { return int(r.Sides[7*tile+k]) }

// The expected {7,3} measures, from the hyperbolic law of cosines rather
// than the generator's right triangle: in the triangle of the center and
// two adjacent corners, at circumradius R the side s has
// cosh s = cosh²R − sinh²R·cos(2π/7); and the angle sum of a heptagon with
// angles 2π/3 leaves area 5π − 7·2π/3 = π/3.
func TestLaceSeedHeptagon(t *testing.T) {
	r := mustLace(t, lace(0, 1, 0.3))
	if len(r.Center) != 1 || len(r.Vertex) != 7 || len(r.EdgeA) != 7 || len(r.ArcStart) != LaceStrokes {
		t.Fatalf("depth 0 has %d tiles, %d vertices, %d edges, %d arcs", len(r.Center), len(r.Vertex), len(r.EdgeA), len(r.ArcStart))
	}
	R := 2 * math.Atanh(r.VertexRadius)
	s := math.Acosh(math.Cosh(R)*math.Cosh(R) - math.Sinh(R)*math.Sinh(R)*math.Cos(2*math.Pi/7))
	for k := range 7 {
		v := corner(r, 0, k)
		if math.Abs(cmplx.Abs(v)-r.VertexRadius) > 1e-15 {
			t.Errorf("corner %d at radius %v, want %v", k, cmplx.Abs(v), r.VertexRadius)
		}
		want := math.Pi/2 + 2*math.Pi*float64(k)/7
		if d := math.Remainder(cmplx.Phase(v)-want, 2*math.Pi); math.Abs(d) > 1e-14 {
			t.Errorf("corner %d at angle %v, want %v (counterclockwise from the top)", k, cmplx.Phase(v), want)
		}
		if got := dist(v, corner(r, 0, k+1)); math.Abs(got-s) > 1e-14 {
			t.Errorf("side %d is %v long, want %v", k, got, s)
		}
	}
	if math.Abs(r.SideLength-s) > 1e-14 || math.Abs(r.Circumradius-R) > 1e-14 {
		t.Errorf("reported side %v and circumradius %v, want %v and %v", r.SideLength, r.Circumradius, s, R)
	}
	// The apothem reaches each side's geodesic at its midpoint.
	m := complex(math.Tanh(r.Apothem/2), 0) * cmplx.Rect(1, math.Pi/2+math.Pi/7)
	e := sideOf(r, 0, 0)
	if d := math.Abs(cmplx.Abs(m-cz(r.EdgeCenter[e])) - r.EdgeRadius[e]); d > 1e-15 {
		t.Errorf("the apothem misses side 0's geodesic by %v", d)
	}
	// Angles at 2π/3 give area π/3 (Gauss–Bonnet), and the side length
	// matches the right-triangle formula cosh(s/2) = cos(π/7)/sin(π/3).
	if got := math.Acosh(math.Cos(math.Pi/7) / math.Sin(math.Pi/3)); math.Abs(2*got-s) > 1e-14 {
		t.Errorf("half side %v disagrees with %v", got, s/2)
	}
}

// Every returned tile is a regular heptagon with angles 2π/3: seven equal
// hyperbolic sides and angles measured from the returned edge geodesics.
func TestLaceTilesAreRegular(t *testing.T) {
	for _, q := range []LaceRequest{lace(5, 1000, 0.3), lace(8, 1000, 0.3)} {
		r := mustLace(t, q)
		s := r.SideLength
		worstSide, worstAngle := 0.0, 0.0
		for i := range r.Center {
			for k := range 7 {
				p := corner(r, i, k)
				worstSide = math.Max(worstSide, math.Abs(dist(p, corner(r, i, k+1))-s))
				before, after := sideOf(r, i, (k+6)%7), sideOf(r, i, k)
				a := tangent(r, before, p, corner(r, i, k-1))
				b := tangent(r, after, p, corner(r, i, k+1))
				dot := real(a)*real(b) + imag(a)*imag(b)
				worstAngle = math.Max(worstAngle, math.Abs(math.Acos(math.Max(-1, math.Min(1, dot)))-2*math.Pi/3))
			}
		}
		if worstSide > laceBudget || worstAngle > laceBudget {
			t.Errorf("depth %d: sides within %v and angles within %v of regular, budget %v", q.Depth, worstSide, worstAngle, laceBudget)
		}
		t.Logf("depth %d, %d tiles: sides within %.1e, angles within %.1e", q.Depth, len(r.Center), worstSide, worstAngle)
	}
}

// Edges are geodesics: circles orthogonal to the rim (|c|² = 1 + ρ²)
// through both their vertices, never a chord, or diameters. The heptagon's
// mirror through each corner carries the tiling edge that leaves that
// corner outward, so diameters do occur: along each such mirror, every
// edge on it.
func TestLaceEdgesAreGeodesics(t *testing.T) {
	r := mustLace(t, lace(8, 1000, 0.3))
	straight := map[int]bool{}
	for e := range r.EdgeA {
		if r.EdgeStraight[e] {
			a, b := cz(r.Vertex[int(r.EdgeA[e])]), cz(r.Vertex[int(r.EdgeB[e])])
			if d := math.Abs(real(a)*imag(b)-imag(a)*real(b)) / cmplx.Abs(a-b); d > 1e-12 {
				t.Errorf("straight edge %d misses the origin by %v", e, d)
			}
			straight[e] = true
			continue
		}
		c, rho := cz(r.EdgeCenter[e]), r.EdgeRadius[e]
		if d := math.Abs(cmplx.Abs(c)*cmplx.Abs(c)-1-rho*rho) / (1 + rho*rho); d > 1e-12 {
			t.Errorf("edge %d's circle is not orthogonal to the rim (relative %v)", e, d)
		}
		for _, v := range []float64{r.EdgeA[e], r.EdgeB[e]} {
			p := cz(r.Vertex[int(v)])
			if d := math.Abs(cmplx.Abs(p-c) - rho); d > 1e-12*math.Max(1, rho) {
				t.Errorf("edge %d's vertex %v is %v off its circle", e, v, d)
			}
		}
	}
	// The seed's seven outward edges are diameters, and so is every edge
	// collinear with the origin.
	for k := range 7 {
		v := int(r.Corners[k])
		found := false
		for e := range r.EdgeA {
			if straight[e] && (int(r.EdgeA[e]) == v || int(r.EdgeB[e]) == v) {
				found = true
			}
		}
		if !found {
			t.Errorf("no diameter edge leaves the seed's corner %d", k)
		}
	}
}

// Reflection across the crossed edge's returned geodesic carries each
// parent to its child corner by corner, fixing the two corners of that
// side: corner k of a child is the reflection of its parent's corner k. The
// reflection is an involution and an isometry, checked on independent
// interior pairs.
func TestLaceReflectionsAndAdjacency(t *testing.T) {
	r := mustLace(t, lace(8, 1000, 0.3))
	for i := 1; i < len(r.Center); i++ {
		p, j := int(r.Parent[i]), int(r.Via[i])
		if r.Depth[i] != r.Depth[p]+1 || r.Reversed[i] == r.Reversed[p] {
			t.Fatalf("tile %d at depth %v (reversed %v) from parent %d at %v (%v)", i, r.Depth[i], r.Reversed[i], p, r.Depth[p], r.Reversed[p])
		}
		e := sideOf(r, p, j)
		if sideOf(r, i, j) != e {
			t.Errorf("tile %d's side %d is edge %d, its parent's is %d", i, j, sideOf(r, i, j), e)
		}
		c, rho := cz(r.EdgeCenter[e]), r.EdgeRadius[e]
		for k := range 7 {
			got, want := corner(r, i, k), invert(corner(r, p, k), c, rho)
			if d := dist(got, want); d > laceBudget {
				t.Errorf("tile %d corner %d is %v from its parent's reflected corner", i, k, d)
			}
		}
		for _, k := range []int{j, j + 1} {
			v := corner(r, p, k)
			if d := dist(invert(v, c, rho), v); d > laceBudget {
				t.Errorf("edge %d's reflection moves its corner by %v", e, d)
			}
		}
		// Points of the parent and the reflection's own neighborhood: its
		// center, its corners, and a third of the way from each corner to
		// the center along the chord.
		probes := []complex128{cz(r.Center[p])}
		for k := range 7 {
			v := corner(r, p, k)
			probes = append(probes, v, v+(cz(r.Center[p])-v)/3)
		}
		for a, z := range probes {
			if d := dist(invert(invert(z, c, rho), c, rho), z); d > laceBudget {
				t.Errorf("edge %d's reflection is not an involution at %v (%v)", e, z, d)
			}
			for _, w := range probes[a+1:] {
				if d := math.Abs(dist(invert(z, c, rho), invert(w, c, rho)) - dist(z, w)); d > laceBudget {
					t.Errorf("edge %d's reflection changes the distance %v–%v by %v", e, z, w, d)
				}
			}
		}
	}
}

// The generator's own reflections are the same maps: each seed reflection
// is an involution as a matrix, fixes its side's corners and sends the
// seed's center to its neighbor's center at twice the apothem.
func TestLaceGeneratorReflections(t *testing.T) {
	seed := newLaceSeed(0.3)
	for k, s := range seed.reflect {
		id := s.then(s)
		if id.odd || cmplx.Abs(id.b) > 1e-14 || math.Abs(cmplx.Abs(id.a)-1) > 1e-14 {
			t.Errorf("reflection %d twice is %+v, not the identity", k, id)
		}
		if d := real(s.a)*real(s.a) + imag(s.a)*imag(s.a) - real(s.b)*real(s.b) - imag(s.b)*imag(s.b) - 1; math.Abs(d) > 1e-14 {
			t.Errorf("reflection %d has |a|² − |b|² − 1 = %v", k, d)
		}
		for _, v := range []complex128{seed.vertex[k], seed.vertex[(k+1)%7]} {
			if d := cmplx.Abs(s.apply(v) - v); d > 1e-15 {
				t.Errorf("reflection %d moves its corner by %v", k, d)
			}
		}
		if d := dist(0, s.apply(0)); math.Abs(d-2*seed.apothem) > 1e-14 {
			t.Errorf("reflection %d moves the center %v, want %v", k, d, 2*seed.apothem)
		}
	}
}

// The {7,3} tiles at each depth n ≥ 1 number 7·F(2n), with F the
// Fibonacci numbers: 7, 21, 56, 147, 385, 1008. Depth d's omissions are the
// next layer, each tile counted once however many tiles reach it.
func TestLaceLayers(t *testing.T) {
	fib := []int{0, 1}
	for len(fib) < 13 {
		fib = append(fib, fib[len(fib)-1]+fib[len(fib)-2])
	}
	layer := []int{1}
	for n := 1; n <= 6; n++ {
		layer = append(layer, 7*fib[2*n])
	}
	for d := 0; d <= 5; d++ {
		r := mustLace(t, lace(d, 1000, 0.3))
		count := make([]int, d+1)
		for _, v := range r.Depth {
			count[int(v)]++
		}
		if !reflect.DeepEqual(count, layer[:d+1]) {
			t.Errorf("depth %d has layers %v, want %v", d, count, layer[:d+1])
		}
		if r.Omitted.Depth != layer[d+1] || r.Omitted.Precision != 0 || r.Stopped != "" {
			t.Errorf("depth %d omits %+v, stopped %q; want %d beyond depth", d, r.Omitted, r.Stopped, layer[d+1])
		}
	}
}

// Within a complete patch, a vertex of any tile short of the last layer is
// complete: three tiles around it, and two along each of that tile's
// sides. Only the last layer's outer vertices and sides have fewer, the
// patch's finite boundary. No vertex has more than three tiles.
func TestLaceVertexCompleteness(t *testing.T) {
	r := mustLace(t, lace(5, 1000, 0.3))
	for i := range r.Center {
		for k := range 7 {
			v := int(r.Corners[7*i+k])
			e := sideOf(r, i, k)
			if r.Depth[i] < 5 && (r.VertexTiles[v] != 3 || r.EdgeTiles[e] != 2) {
				t.Errorf("tile %d at depth %v: corner %d has %v tiles, side %d has %v", i, r.Depth[i], k, r.VertexTiles[v], k, r.EdgeTiles[e])
			}
		}
	}
	boundary := 0
	for v, n := range r.VertexTiles {
		if n < 1 || n > 3 {
			t.Errorf("vertex %d has %v tiles", v, n)
		}
		if n < 3 {
			boundary++
		}
	}
	if boundary == 0 {
		t.Error("a finite patch has no boundary vertices")
	}
	for e, n := range r.EdgeTiles {
		if n < 1 || n > 2 {
			t.Errorf("edge %d has %v tiles", e, n)
		}
	}
}

// Nothing is repeated: tile centers are at least 2h apart and vertices at
// least a side apart, hyperbolically; each edge joins a distinct pair.
func TestLaceNoDuplicates(t *testing.T) {
	r := mustLace(t, lace(8, 1000, 0.3))
	for i := range r.Center {
		for j := range i {
			if d := dist(cz(r.Center[i]), cz(r.Center[j])); d < 2*r.Apothem-laceBudget {
				t.Fatalf("tiles %d and %d are %v apart", i, j, d)
			}
		}
	}
	for i := range r.Vertex {
		for j := range i {
			if d := dist(cz(r.Vertex[i]), cz(r.Vertex[j])); d < r.SideLength-laceBudget {
				t.Fatalf("vertices %d and %d are %v apart", i, j, d)
			}
		}
	}
	pairs := map[[2]float64]bool{}
	for e := range r.EdgeA {
		p := [2]float64{math.Min(r.EdgeA[e], r.EdgeB[e]), math.Max(r.EdgeA[e], r.EdgeB[e])}
		if pairs[p] || p[0] == p[1] {
			t.Fatalf("edge %d repeats %v", e, p)
		}
		pairs[p] = true
	}
	if r.Duplicates == 0 {
		t.Error("no candidate was recognized as a duplicate, so deduplication was not exercised")
	}
}

// A reversed tile's transformation reflects an odd number of times, so its
// corners run clockwise, and so does its motif's star traversal (each
// stroke from an edge midpoint to a turning point and on to the next).
func TestLaceOrientation(t *testing.T) {
	r := mustLace(t, lace(5, 1000, 0.3))
	signed := func(points []complex128) float64 {
		a := 0.0
		for k, p := range points {
			q := points[(k+1)%len(points)]
			a += real(p)*imag(q) - imag(p)*real(q)
		}
		return a
	}
	for i := range r.Center {
		want := 1.0
		if r.Reversed[i] {
			want = -1
		}
		if r.Reversed[i] != (int(r.Depth[i])%2 == 1) {
			t.Errorf("tile %d at depth %v has reversed %v", i, r.Depth[i], r.Reversed[i])
		}
		var corners, star []complex128
		for k := range 7 {
			corners = append(corners, corner(r, i, k))
		}
		for s := range LaceStrokes {
			star = append(star, cz(r.ArcStart[LaceStrokes*i+s]))
		}
		if math.Signbit(signed(corners)) != math.Signbit(want) || math.Signbit(signed(star)) != math.Signbit(want) {
			t.Errorf("tile %d (reversed %v) winds corners %v and motif %v", i, r.Reversed[i], signed(corners), signed(star))
		}
	}
}

// arcPoints samples a returned geodesic arc: its minor arc on a circle, or
// the segment of a diameter.
func arcPoints(start, end, c complex128, straight bool, n int) []complex128 {
	out := make([]complex128, 0, n+1)
	if straight {
		for i := 0; i <= n; i++ {
			out = append(out, start+(end-start)*complex(float64(i)/float64(n), 0))
		}
		return out
	}
	a0, a1 := cmplx.Phase(start-c), cmplx.Phase(end-c)
	turn := math.Remainder(a1-a0, 2*math.Pi)
	rho := cmplx.Abs(start - c)
	for i := 0; i <= n; i++ {
		out = append(out, c+cmplx.Rect(rho, a0+turn*float64(i)/float64(n)))
	}
	return out
}

// inside reports whether z lies in tile i, within tol of its boundary:
// on the same side of each side's geodesic as the tile's center.
func inside(r LaceResult, i int, z complex128, tol float64) bool {
	center := cz(r.Center[i])
	for k := range 7 {
		e := sideOf(r, i, k)
		c, rho := cz(r.EdgeCenter[e]), r.EdgeRadius[e]
		here := cmplx.Abs(z-c) - rho
		if math.Abs(here) <= tol*rho {
			continue
		}
		if (here < 0) != (cmplx.Abs(center-c) < rho) {
			return false
		}
	}
	return true
}

// The motif is nonempty, every stroke is a geodesic arc inside its own
// tile, and strokes of neighboring tiles meet at their shared side's
// midpoint: across an interior edge, exactly four stroke ends there.
func TestLaceMotif(t *testing.T) {
	for _, u := range []float64{0, 0.3, 0.7, 1} {
		r := mustLace(t, lace(4, 1000, u))
		straight := 0
		for a := range r.ArcStart {
			i := a / LaceStrokes
			s, e, c := cz(r.ArcStart[a]), cz(r.ArcEnd[a]), cz(r.ArcCenter[a])
			if s == e {
				t.Fatalf("star %v: stroke %d is empty", u, a)
			}
			if r.ArcStraight[a] {
				straight++
				// A straight geodesic is a diameter: through the origin.
				if d := math.Abs(real(s)*imag(e)-imag(s)*real(e)) / cmplx.Abs(s-e); d > 1e-12 {
					t.Errorf("star %v: straight stroke %d misses the origin by %v", u, a, d)
				}
			} else if d := math.Abs(cmplx.Abs(c)*cmplx.Abs(c) - 1 - r.ArcRadius[a]*r.ArcRadius[a]); d > 1e-9*(1+r.ArcRadius[a]*r.ArcRadius[a]) {
				t.Errorf("star %v: stroke %d is not a geodesic (%v)", u, a, d)
			}
			for _, z := range arcPoints(s, e, c, r.ArcStraight[a], 16) {
				if !inside(r, i, z, 1e-9) {
					t.Fatalf("star %v: stroke %d leaves tile %d at %v", u, a, i, z)
				}
			}
		}
		// The seed's strokes run from side k's midpoint, at the apothem on
		// its bisector, to a turning point on the ray to corner k + 1 at
		// u·R from the center, and on to side k + 1's midpoint.
		for k := range 7 {
			turn := cz(r.ArcEnd[2*k])
			if d := math.Abs(dist(0, turn) - u*r.Circumradius); d > 1e-14 {
				t.Errorf("star %v: turning point %d is %v off u·R", u, k, d)
			}
			if u > 0 {
				ray := corner(r, 0, k+1)
				if d := math.Abs(real(turn)*imag(ray) - imag(turn)*real(ray)); d > 1e-15 {
					t.Errorf("star %v: turning point %d is off the ray to corner %d by %v", u, k, k+1, d)
				}
			}
			for _, m := range []complex128{cz(r.ArcStart[2*k]), cz(r.ArcEnd[2*k+1])} {
				if d := math.Abs(dist(0, m) - r.Apothem); d > 1e-14 {
					t.Errorf("star %v: stroke end %v is not at the apothem", u, m)
				}
			}
			if cz(r.ArcStart[2*k+1]) != turn {
				t.Errorf("star %v: stroke %d does not continue from the turning point", u, 2*k+1)
			}
		}
		// At star point 0 the seed's strokes, from its center to its
		// sides' midpoints, are radii, and only then.
		for s := range LaceStrokes {
			if r.ArcStraight[s] != (u == 0) {
				t.Errorf("star %v: the seed's stroke %d has straight %v", u, s, r.ArcStraight[s])
			}
		}
		if u == 0 && straight == LaceStrokes {
			t.Errorf("star 0: only the seed's strokes are straight; their continuations should be too")
		}
		for e := range r.EdgeA {
			if r.EdgeTiles[e] != 2 {
				continue
			}
			a, b := cz(r.Vertex[int(r.EdgeA[e])]), cz(r.Vertex[int(r.EdgeB[e])])
			// The hyperbolic midpoint lies on the geodesic, half a side
			// from each end.
			m := hyperbolicMidpoint(a, b)
			ends := 0
			for k := range r.ArcStart {
				for _, p := range []Vec{r.ArcStart[k], r.ArcEnd[k]} {
					if dist(cz(p), m) < laceBudget {
						ends++
					}
				}
			}
			if ends != 4 {
				t.Errorf("star %v: %d stroke ends at edge %d's midpoint, want 4", u, ends, e)
			}
		}
	}
}

// hyperbolicMidpoint carries a to the origin, halves the distance to b
// along the diameter there, and carries it back.
func hyperbolicMidpoint(a, b complex128) complex128 {
	to := func(z complex128) complex128 { return (z - a) / (1 - cmplx.Conj(a)*z) }
	from := func(z complex128) complex128 { return (z + a) / (1 + cmplx.Conj(a)*z) }
	w := to(b)
	half := math.Tanh(math.Atanh(cmplx.Abs(w)) / 2)
	return from(w / complex(cmplx.Abs(w), 0) * complex(half, 0))
}

// The motif has the heptagon's seven mirror symmetries, so a tile's copy
// is the same whichever transformation reaches it: across every interior
// edge, including those between tiles that are not parent and child, the
// neighbor's strokes are the reflection of the tile's, as a set.
func TestLaceMotifIsSeamless(t *testing.T) {
	r := mustLace(t, lace(4, 1000, 0.3))
	tilesOf := map[int][]int{}
	for i := range r.Center {
		for k := range 7 {
			tilesOf[sideOf(r, i, k)] = append(tilesOf[sideOf(r, i, k)], i)
		}
	}
	crossTree := 0
	for e, tiles := range tilesOf {
		if len(tiles) != 2 {
			continue
		}
		i, j := tiles[0], tiles[1]
		if int(r.Parent[j]) != i && int(r.Parent[i]) != j {
			crossTree++
		}
		c, rho := cz(r.EdgeCenter[e]), r.EdgeRadius[e]
		reflected := func(z Vec) complex128 {
			if r.EdgeStraight[e] {
				// A diameter through the origin reflects z to (u/ū)·z̄.
				u := cz(r.Vertex[int(r.EdgeA[e])])
				if cmplx.Abs(u) < cmplx.Abs(cz(r.Vertex[int(r.EdgeB[e])])) {
					u = cz(r.Vertex[int(r.EdgeB[e])])
				}
				return u / cmplx.Conj(u) * cmplx.Conj(cz(z))
			}
			return invert(cz(z), c, rho)
		}
		used := make([]bool, LaceStrokes)
		for s := range LaceStrokes {
			a := LaceStrokes*i + s
			p, q := reflected(r.ArcStart[a]), reflected(r.ArcEnd[a])
			match := -1
			for m := range LaceStrokes {
				b := LaceStrokes*j + m
				x, y := cz(r.ArcStart[b]), cz(r.ArcEnd[b])
				if !used[m] && ((dist(p, x) < laceBudget && dist(q, y) < laceBudget) || (dist(p, y) < laceBudget && dist(q, x) < laceBudget)) {
					match = m
					break
				}
			}
			if match < 0 {
				t.Fatalf("edge %d: tile %d's stroke %d reflected is none of tile %d's", e, i, s, j)
			}
			used[match] = true
		}
	}
	if crossTree == 0 {
		t.Error("no edge joins tiles that are not parent and child")
	}
}

// Ceilings: the tile count stops generation with the last generation
// incomplete and the breadth-first prefix kept; the candidate ceiling
// does the same. Each reports the tiles left unexpanded.
func TestLaceCeilings(t *testing.T) {
	full := mustLace(t, lace(8, 1000, 0.3))
	if full.Stopped != "count" || len(full.Center) != 1000 || full.Pending == 0 {
		t.Fatalf("depth 8 stopped %q at %d tiles with %d pending", full.Stopped, len(full.Center), full.Pending)
	}
	for _, n := range []int{1, 8, 100, 617} {
		r := mustLace(t, lace(8, n, 0.3))
		if len(r.Center) != n || r.Stopped != "count" || r.Pending == 0 {
			t.Errorf("limit %d: %d tiles, stopped %q, pending %d", n, len(r.Center), r.Stopped, r.Pending)
		}
		if !reflect.DeepEqual(r.Center, full.Center[:n]) || !reflect.DeepEqual(r.ArcStart, full.ArcStart[:n*LaceStrokes]) {
			t.Errorf("limit %d is not the breadth-first prefix", n)
		}
	}
	// 617 tiles is depth 5 complete: the limit is met by the last tile,
	// and nothing more is generated at depth 5.
	if r := mustLace(t, lace(5, 617, 0.3)); r.Stopped != "" || r.Omitted.Depth != 1008 {
		t.Errorf("depth 5 with exactly its 617 tiles stopped %q, omitting %+v", r.Stopped, r.Omitted)
	}
	r := computeLace(lace(8, 1000, 0.3), laceLimits{8, 300, lacePolicy})
	if r.Stopped != "candidates" || r.Processed != 300 || r.Pending == 0 {
		t.Errorf("candidate ceiling: stopped %q after %d with %d pending", r.Stopped, r.Processed, r.Pending)
	}
	// With the production ceilings, the tile count binds first: each
	// admitted tile examines at most seven neighbors.
	if full.Processed > 7*LaceMaxTiles || full.Processed >= LaceMaxCandidates {
		t.Errorf("1,000 tiles examined %d candidates", full.Processed)
	}
}

// Generation is deterministic, and a shallower or smaller patch is the
// breadth-first prefix of a deeper one, so a tile's number and address
// are stable across cutoffs.
func TestLaceDeterministicPrefix(t *testing.T) {
	a, b := mustLace(t, lace(8, 1000, 0.3)), mustLace(t, lace(8, 1000, 0.3))
	if !reflect.DeepEqual(a, b) {
		t.Fatal("two identical requests differ")
	}
	for d := 0; d < 5; d++ {
		small := mustLace(t, lace(d, 1000, 0.3))
		n := len(small.Center)
		if !reflect.DeepEqual(small.Center, a.Center[:n]) || !reflect.DeepEqual(small.Parent, a.Parent[:n]) || !reflect.DeepEqual(small.Via, a.Via[:n]) {
			t.Errorf("depth %d is not a prefix of depth 8", d)
		}
	}
	// The star point changes only the motif.
	other := mustLace(t, lace(8, 1000, 0.6))
	if !reflect.DeepEqual(other.Center, a.Center) || !reflect.DeepEqual(other.Vertex, a.Vertex) || reflect.DeepEqual(other.ArcStart, a.ArcStart) {
		t.Error("the star point changed the tiles, or left the motif unchanged")
	}
}

// Near the admitted rim the stored geometry is still resolved: each tile's
// corners recomputed from its transformation agree with the stored
// vertices within the budget, and transformations stay normalized. The
// largest patch's deepest corners lie well inside the floor.
func TestLacePrecisionNearTheAdmittedRim(t *testing.T) {
	r := mustLace(t, lace(8, 1000, 0.3))
	seed := newLaceSeed(0.3)
	worst, gap := 0.0, 1.0
	for i, m := range r.Transform {
		g := mobius{a: complex(m[0], m[1]), b: complex(m[2], m[3]), odd: r.Reversed[i]}
		if d := m[0]*m[0] + m[1]*m[1] - m[2]*m[2] - m[3]*m[3] - 1; math.Abs(d) > 1e-12 {
			t.Errorf("tile %d's transformation has |a|² − |b|² − 1 = %v", i, d)
		}
		if d := dist(g.apply(0), cz(r.Center[i])); d > laceBudget {
			t.Errorf("tile %d's center is %v from its transformation's", i, d)
		}
		for k := range 7 {
			z := corner(r, i, k)
			worst = math.Max(worst, dist(g.apply(seed.vertex[k]), z))
			gap = math.Min(gap, 1-real(z)*real(z)-imag(z)*imag(z))
		}
	}
	if worst > lacePolicy.agreement || gap < 100*lacePolicy.floor {
		t.Errorf("corners agree within %v (agreement %v); smallest 1 − |z|² is %v (floor %v)", worst, lacePolicy.agreement, gap, lacePolicy.floor)
	}
	t.Logf("1,000 tiles: corners agree within %.1e; smallest 1 − |z|² %.2e", worst, gap)
}

// The precision policy leaves out unresolved candidates, counted once
// apart from depth, rather than clamping them toward the rim. A raised
// floor leaves out tiles with a corner nearer the rim; a tightened
// agreement leaves out tiles whose shared corners drift. Admitted tiles
// always satisfy the policy, and are never expanded through an omission.
func TestLacePrecisionCutoff(t *testing.T) {
	full := mustLace(t, lace(5, 1000, 0.3))
	for _, p := range []lacePrecision{{floor: 0.05, agreement: 1e-9}, {floor: 1e-7, agreement: 3e-14}} {
		r := computeLace(lace(5, 1000, 0.3), laceLimits{5, LaceMaxCandidates, p})
		checkLaceShape(t, r)
		if r.Omitted.Precision == 0 {
			t.Fatalf("%+v: nothing was left out for precision", p)
		}
		for i := range r.Center {
			for k := range 7 {
				z := corner(r, i, k)
				if 1-real(z)*real(z)-imag(z)*imag(z) < p.floor {
					t.Errorf("%+v: tile %d corner %d lies past the floor", p, i, k)
				}
			}
		}
		if len(r.Center) >= len(full.Center) {
			t.Errorf("%+v: %d tiles, no fewer than the unlimited %d", p, len(r.Center), len(full.Center))
		}
		t.Logf("%+v: %d tiles, omitted %+v", p, len(r.Center), r.Omitted)
	}
	// With the production policy, the whole patch to depth 8, beyond the
	// 1,000-tile limit, is resolved without any omission: the policy binds
	// only beyond the supported limits.
	// It holds exactly 1 + 7·(F(2) + F(4) + … + F(16)) = 11,173 tiles: its
	// outer corners have drifted by about 10⁻¹¹, so deduplication must
	// still recognize them.
	r := computeLace(lace(8, 1<<20, 0.3), laceLimits{8, 1 << 20, lacePolicy})
	if r.Omitted.Precision != 0 || len(r.Center) != 11173 {
		t.Errorf("depth 8 unlimited: %d tiles, %d left out for precision", len(r.Center), r.Omitted.Precision)
	}
}

// The grid finds every stored point within the hyperbolic distance asked,
// in every direction and out to the rim, where the hyperbolic disk is a
// small Euclidean disk shifted toward the origin; and none beyond it.
func TestDiskGridNear(t *testing.T) {
	const d = 0.5
	for _, z := range []complex128{0, 0.3 - 0.2i, 0.7i, -0.9 + 0.1i, 0.99, 0.6 + 0.79i} {
		// w at hyperbolic distance δ from z in direction θ: carry the point
		// at Euclidean radius tanh(δ/2) from the origin to z.
		at := func(delta, theta float64) complex128 {
			u := cmplx.Rect(math.Tanh(delta/2), theta)
			return (u + z) / (1 + cmplx.Conj(z)*u)
		}
		for k := range 32 {
			theta := 2 * math.Pi * float64(k) / 32
			for _, c := range []struct {
				delta float64
				found bool
			}{{0.99 * d, true}, {1.01 * d, false}} {
				g := newDiskGrid()
				w := at(c.delta, theta)
				g.add(w, 0)
				i, _ := g.near(z, d, func(int) complex128 { return w })
				if (i == 0) != c.found {
					t.Errorf("from %v at %v·d in direction %v: found %v", z, c.delta/d, theta, i == 0)
				}
			}
		}
	}
}

func TestLaceRefusals(t *testing.T) {
	for _, c := range []struct {
		field string
		q     LaceRequest
	}{
		{"tiling", LaceRequest{Tiling: "8,3", Depth: 2, MaxTiles: 10}},
		{"depth", lace(-1, 10, 0.3)},
		{"depth", lace(9, 10, 0.3)},
		{"maxTiles", lace(2, 0, 0.3)},
		{"maxTiles", lace(2, 1001, 0.3)},
		{"starPoint", lace(2, 10, -0.01)},
		{"starPoint", lace(2, 10, 1.01)},
		{"starPoint", lace(2, 10, math.NaN())},
		{"starPoint", lace(2, 10, math.Inf(1))},
	} {
		_, err := ComputeLace(c.q)
		var fe *FieldError
		if !errors.As(err, &fe) || fe.Field != c.field {
			t.Errorf("%+v: got %v, want a %s error", c.q, err, c.field)
		}
	}
	for _, q := range []LaceRequest{lace(0, 1, 0), lace(8, 1000, 1)} {
		if _, err := ComputeLace(q); err != nil {
			t.Errorf("%+v refused: %v", q, err)
		}
	}
}
