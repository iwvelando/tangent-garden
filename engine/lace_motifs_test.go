package engine

import (
	"errors"
	"fmt"
	"math"
	"math/cmplx"
	"reflect"
	"testing"
)

// The motifs beside the star (docs/mathematics.md, Hyperbolic lace,
// Motifs): petals, leaves and rings, each one stroke in the seed's
// fundamental triangle reflected into every tile. As in lace_test.go,
// every expectation here is written from the definitions, and every
// observation comes from the returned geometry: tile centers, corners,
// sides and strokes.

var laceMotifSizes = map[string][]float64{
	"petals": {0, 0.4, 1},
	"leaves": {0, 0.5, 1},
	"rings":  {0.1, 0.6, 1},
}

func motifLace(motif string, size float64, depth int) LaceRequest {
	q := lace(depth, 1000, 0.3)
	q.Motif, q.Size = motif, size
	return q
}

// eachMotif runs a check for every tiling, every motif beside the star
// and each of its tried sizes.
func eachMotif(t *testing.T, check func(t *testing.T, p, q int, motif string, u float64)) {
	eachTiling(t, func(t *testing.T, p, q int) {
		for _, motif := range []string{"petals", "leaves", "rings"} {
			for _, u := range laceMotifSizes[motif] {
				t.Run(fmt.Sprintf("%s %v", motif, u), func(t *testing.T) { check(t, p, q, motif, u) })
			}
		}
	})
}

// toOrigin is the disk isometry carrying o to the origin.
func toOrigin(o complex128) func(complex128) complex128 {
	return func(z complex128) complex128 { return (z - o) / (1 - cmplx.Conj(o)*z) }
}

// strokeMid is the middle of a returned stroke as drawn: the point of
// its minor arc, or chord, equally far from both ends in the disk's
// metric, found by bisection. Isometries carry it to the moved stroke's
// middle, as they would not carry a Euclidean midpoint.
func strokeMid(r LaceResult, a int) complex128 {
	s, e, c := cz(r.ArcStart[a]), cz(r.ArcEnd[a]), cz(r.ArcCenter[a])
	at := func(f float64) complex128 {
		if r.ArcStraight[a] {
			return s + (e-s)*complex(f, 0)
		}
		a0 := cmplx.Phase(s - c)
		turn := math.Remainder(cmplx.Phase(e-c)-a0, 2*math.Pi)
		return c + cmplx.Rect(cmplx.Abs(s-c), a0+turn*f)
	}
	lo, hi := 0.0, 1.0
	for range 80 {
		f := (lo + hi) / 2
		if z := at(f); dist(z, s) < dist(z, e) {
			lo = f
		} else {
			hi = f
		}
	}
	return at((lo + hi) / 2)
}

// The fundamental triangle of stroke 2k or 2k + 1 of tile i: its center
// O, the midpoint M of side k or k + 1, and corner V = k + 1. A point lies
// in it when it lies in the tile and, carried with O to the origin, where
// the triangle's two sides through O are straight, within the angle
// between the rays to M and V.
func inTriangle(r LaceResult, i, s int, z complex128, tol float64) bool {
	p := pOf(r)
	k := s / 2
	o := cz(r.Center[i])
	v := corner(r, i, (k+1)%p)
	side := k + s%2
	m := hyperbolicMidpoint(corner(r, i, side%p), corner(r, i, (side+1)%p))
	if !inside(r, i, z, tol) {
		return false
	}
	to := toOrigin(o)
	w, mm, vv := to(z), to(m), to(v)
	if cmplx.Abs(w) < tol {
		return true
	}
	cross := func(a, b complex128) float64 { return real(a)*imag(b) - imag(a)*real(b) }
	// w lies between the rays to M and V when it is on V's side of OM
	// and M's side of OV, each within the tolerance of the ray.
	scale := cmplx.Abs(w)
	return cross(mm, w)*cross(mm, vv) >= -tol*scale*cmplx.Abs(mm) && cross(vv, w)*cross(vv, mm) >= -tol*scale*cmplx.Abs(vv)
}

// endAngle is the angle at the stroke's end a between it and the
// geodesic from a to b, read with a carried to the origin, where that
// geodesic is a straight line: the tangent–chord angle at a equals π
// less the angle at the stroke's midpoint x in the triangle a x b.
func endAngle(a, x, b complex128) float64 {
	to := toOrigin(a)
	x, b = to(x), to(b)
	u, w := -x, b-x
	return math.Pi - math.Abs(math.Atan2(real(u)*imag(w)-imag(u)*real(w), real(u)*real(w)+imag(u)*imag(w)))
}

func TestLaceMotifRefusals(t *testing.T) {
	for _, c := range []struct {
		motif string
		size  float64
		field string
	}{
		{"spiral", 0.5, "motif"},
		{"petals", -0.01, "size"},
		{"petals", 1.01, "size"},
		{"leaves", math.NaN(), "size"},
		{"leaves", 1.5, "size"},
		{"rings", 0.09, "size"},
		{"rings", 0, "size"},
		{"rings", math.Inf(1), "size"},
	} {
		_, err := ComputeLace(motifLace(c.motif, c.size, 1))
		var fe *FieldError
		if !errors.As(err, &fe) || fe.Field != c.field {
			t.Errorf("%s at %v: got %v, want a refusal under %s", c.motif, c.size, err, c.field)
		}
	}
	// The star ignores the size, and the empty motif is the star.
	for _, motif := range []string{"", "star"} {
		if _, err := ComputeLace(motifLace(motif, -5, 1)); err != nil {
			t.Errorf("motif %q refused a size it ignores: %v", motif, err)
		}
	}
	// Every motif still checks the star point.
	q := motifLace("rings", 0.5, 1)
	q.StarPoint = 2
	var fe *FieldError
	if _, err := ComputeLace(q); !errors.As(err, &fe) || fe.Field != "starPoint" {
		t.Errorf("an out-of-range star point under rings: %v", err)
	}
}

// The motif never changes the tiles, and "star" is the empty motif's
// patch exactly; another motif changes only the strokes.
func TestLaceMotifKeepsTiles(t *testing.T) {
	eachTiling(t, func(t *testing.T, p, q int) {
		star := mustLace(t, lace(3, 1000, 0.3))
		named := mustLace(t, motifLace("star", 0.7, 3))
		if !reflect.DeepEqual(star, named) {
			t.Error(`"star" differs from the empty motif`)
		}
		for _, motif := range []string{"petals", "leaves", "rings"} {
			r := mustLace(t, motifLace(motif, 0.6, 3))
			if !reflect.DeepEqual(topology(r), topology(star)) || !reflect.DeepEqual(r.Center, star.Center) ||
				!reflect.DeepEqual(r.Vertex, star.Vertex) || !reflect.DeepEqual(r.EdgeCenter, star.EdgeCenter) {
				t.Errorf("%s changed the tiles", motif)
			}
			if len(r.ArcStart) != len(star.ArcStart) || reflect.DeepEqual(r.ArcStart, star.ArcStart) {
				t.Errorf("%s: %d strokes, the same as the star's: %v", motif, len(r.ArcStart), reflect.DeepEqual(r.ArcStart, star.ArcStart))
			}
		}
	})
}

// Every stroke lies in its own fundamental triangle, so in its tile and
// drawn as its minor arc, and strokes 2k and 2k + 1 meet on the mirror
// through corner k + 1. Each motif's strokes are the shapes it defines,
// checked against constructions independent of the engine's.
func TestLaceMotifShapes(t *testing.T) {
	eachMotif(t, func(t *testing.T, p, q int, motif string, u float64) {
		r := mustLace(t, motifLace(motif, u, 4))
		for a := range r.ArcStart {
			i, s := a/(2*p), a%(2*p)
			start, end := cz(r.ArcStart[a]), cz(r.ArcEnd[a])
			if dist(start, end) < 1e-6 {
				t.Fatalf("stroke %d is empty", a)
			}
			if !r.ArcStraight[a] {
				c, rho := cz(r.ArcCenter[a]), r.ArcRadius[a]
				for _, z := range []complex128{start, end} {
					if d := math.Abs(cmplx.Abs(z-c) - rho); d > 1e-12*(1+rho) {
						t.Fatalf("stroke %d's end is %v off its circle", a, d)
					}
				}
			}
			for _, z := range arcPoints(start, end, cz(r.ArcCenter[a]), r.ArcStraight[a], 24) {
				if !inTriangle(r, i, s, z, 1e-9) {
					t.Fatalf("stroke %d (tile %d, stroke %d) leaves its fundamental triangle at %v", a, i, s, z)
				}
			}
			if s%2 == 0 && dist(end, cz(r.ArcStart[a+1])) > 1e-12 {
				t.Errorf("stroke %d does not continue into stroke %d", a, a+1)
			}
		}
		for i := range r.Center {
			o := cz(r.Center[i])
			for s := range 2 * p {
				a := 2*p*i + s
				k := s / 2
				start, end, mid := cz(r.ArcStart[a]), cz(r.ArcEnd[a]), strokeMid(r, a)
				v := corner(r, i, (k+1)%p)
				side := k + s%2
				m := hyperbolicMidpoint(corner(r, i, side%p), corner(r, i, (side+1)%p))
				// The stroke's two ends, in drawing order.
				var from, to complex128
				switch motif {
				case "petals":
					from, to = o, v
				case "leaves":
					from, to = m, o
				}
				if s%2 == 1 {
					from, to = to, from
				}
				switch motif {
				case "petals", "leaves":
					if dist(start, from) > laceBudget || dist(end, to) > laceBudget {
						t.Fatalf("tile %d stroke %d runs %v → %v, want %v → %v", i, s, start, end, from, to)
					}
					limit := math.Pi / float64(p)
					if motif == "petals" {
						limit = math.Min(limit, math.Pi/float64(q))
					}
					want := u * limit
					for _, got := range []float64{endAngle(start, mid, end), endAngle(end, mid, start)} {
						if math.Abs(got-want) > 1e-9 {
							t.Fatalf("tile %d stroke %d meets its chord at %v, want %v", i, s, got, want)
						}
					}
				case "rings":
					radius := u * r.Apothem
					for _, z := range []complex128{start, end, mid} {
						if d := math.Abs(dist(o, z) - radius); d > laceBudget {
							t.Fatalf("tile %d stroke %d is %v off the ring", i, s, d)
						}
					}
					// The hyperbolic circle of radius ρ about w is the Euclidean
					// circle with center w(1 − t²)/(1 − |w|²t²) and radius
					// t(1 − |w|²)/(1 − |w|²t²), t = tanh(ρ/2).
					tt := math.Tanh(radius / 2)
					w2 := real(o)*real(o) + imag(o)*imag(o)
					wantC := o * complex((1-tt*tt)/(1-w2*tt*tt), 0)
					wantR := tt * (1 - w2) / (1 - w2*tt*tt)
					if cmplx.Abs(cz(r.ArcCenter[a])-wantC) > 1e-12 || math.Abs(r.ArcRadius[a]-wantR) > 1e-12 {
						t.Fatalf("tile %d stroke %d lies on (%v, %v), want (%v, %v)", i, s, r.ArcCenter[a], r.ArcRadius[a], wantC, wantR)
					}
					// Each stroke runs from the ray to a side's midpoint to the
					// ray to a corner, or back.
					rayM, rayV := start, end
					if s%2 == 1 {
						rayM, rayV = end, start
					}
					to := toOrigin(o)
					for _, c := range [][2]complex128{{rayM, m}, {rayV, v}} {
						x, y := to(c[0]), to(c[1])
						if d := math.Abs(real(x)*imag(y)-imag(x)*real(y)) / cmplx.Abs(y); d > 1e-9 {
							t.Fatalf("tile %d stroke %d ends %v off its ray", i, s, d)
						}
					}
				}
			}
		}
	})
}

// Ends meet where the construction says: petals at every center (2p)
// and interior corner (2q), leaves at every center (2p) and interior
// side's midpoint (four), rings at full size at every interior side's
// midpoint (four), and nowhere smaller.
func TestLaceMotifMeetings(t *testing.T) {
	eachMotif(t, func(t *testing.T, p, q int, motif string, u float64) {
		r := mustLace(t, motifLace(motif, u, 3))
		endsAt := func(z complex128) int {
			n := 0
			for a := range r.ArcStart {
				for _, e := range []Vec{r.ArcStart[a], r.ArcEnd[a]} {
					if dist(cz(e), z) < laceBudget {
						n++
					}
				}
			}
			return n
		}
		atCenter, atCorner, atMid := map[string]int{"petals": 2 * p, "leaves": 2 * p}[motif], map[string]int{"petals": 2 * q}[motif], map[string]int{"leaves": 4}[motif]
		if motif == "rings" && u == 1 {
			atMid = 4
		}
		for i := range r.Center {
			if n := endsAt(cz(r.Center[i])); n != atCenter {
				t.Fatalf("%d stroke ends at tile %d's center, want %d", n, i, atCenter)
			}
		}
		for v := range r.Vertex {
			if int(r.VertexTiles[v]) != q {
				continue
			}
			if n := endsAt(cz(r.Vertex[v])); n != atCorner {
				t.Fatalf("%d stroke ends at vertex %d, want %d", n, v, atCorner)
			}
		}
		for e := range r.EdgeA {
			if r.EdgeTiles[e] != 2 {
				continue
			}
			m := hyperbolicMidpoint(cz(r.Vertex[int(r.EdgeA[e])]), cz(r.Vertex[int(r.EdgeB[e])]))
			if n := endsAt(m); n != atMid {
				t.Fatalf("%d stroke ends at edge %d's midpoint, want %d", n, e, atMid)
			}
		}
	})
}

// Across every interior side, the neighbor's strokes are the tile's
// reflected, as a set, matched by their ends and their middles, so arcs
// that share their ends but bulge differently do not pass.
func TestLaceMotifReflectsAcrossSides(t *testing.T) {
	eachMotif(t, func(t *testing.T, p, q int, motif string, u float64) {
		r := mustLace(t, motifLace(motif, u, 4))
		tilesOf := map[int][]int{}
		for i := range r.Center {
			for k := range p {
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
			reflected := func(z complex128) complex128 { return reflectAcross(r, e, z) }
			used := make([]bool, 2*p)
			for s := range 2 * p {
				a := 2*p*i + s
				x, y, mid := reflected(cz(r.ArcStart[a])), reflected(cz(r.ArcEnd[a])), reflected(strokeMid(r, a))
				match := -1
				for n := range 2 * p {
					b := 2*p*j + n
					bs, be := cz(r.ArcStart[b]), cz(r.ArcEnd[b])
					ends := (dist(x, bs) < laceBudget && dist(y, be) < laceBudget) || (dist(x, be) < laceBudget && dist(y, bs) < laceBudget)
					if !used[n] && ends && dist(mid, strokeMid(r, b)) < laceBudget {
						match = n
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
	})
}

// A tile's strokes, by their middles, wind about its center the way its
// corners do: counterclockwise, or clockwise when it is reversed.
func TestLaceMotifOrientation(t *testing.T) {
	eachMotif(t, func(t *testing.T, p, q int, motif string, u float64) {
		r := mustLace(t, motifLace(motif, u, 3))
		for i := range r.Center {
			to := toOrigin(cz(r.Center[i]))
			turn := 0.0
			for s := range 2 * p {
				a, b := to(strokeMid(r, 2*p*i+s)), to(strokeMid(r, 2*p*i+(s+1)%(2*p)))
				turn += cmplx.Phase(b / a)
			}
			want := 2 * math.Pi
			if r.Reversed[i] {
				want = -want
			}
			if math.Abs(turn-want) > 1e-9 {
				t.Fatalf("tile %d (reversed %v): the motif turns %v", i, r.Reversed[i], turn)
			}
		}
	})
}

// Moved by any supported isometry, every stroke is the unmoved one
// carried by the isometry, ends and middle, and still lies in its
// fundamental triangle: the minor arc drawn is the stroke. The bound
// (1 + |κ|)·L on a stroke's Euclidean turning, from its geodesic
// curvature and hyperbolic length, both kept by isometries, stays below π.
func TestLaceMotifMoved(t *testing.T) {
	eachTiling(t, func(t *testing.T, p, q int) {
		for _, motif := range []string{"petals", "leaves", "rings"} {
			u := laceMotifSizes[motif][len(laceMotifSizes[motif])-1]
			req := motifLace(motif, u, deepest[laceID])
			still := mustLace(t, req)
			for d := range 8 {
				iso := LaceIsometry{Offset: LaceMaxOffset, Direction: 2 * math.Pi * float64(d) / 8, Rotation: 0.3}
				r := moved(t, req, iso)
				move := isoT(iso)
				for a := range r.ArcStart {
					for _, c := range [][2]complex128{
						{cz(r.ArcStart[a]), move(cz(still.ArcStart[a]))},
						{cz(r.ArcEnd[a]), move(cz(still.ArcEnd[a]))},
						{strokeMid(r, a), move(strokeMid(still, a))},
					} {
						if dist(c[0], c[1]) > laceBudget {
							t.Fatalf("%s at %v: stroke %d is %v from the moved stroke", motif, iso.Direction, a, dist(c[0], c[1]))
						}
					}
					if a%16 == 0 {
						for _, z := range arcPoints(cz(r.ArcStart[a]), cz(r.ArcEnd[a]), cz(r.ArcCenter[a]), r.ArcStraight[a], 8) {
							if !inTriangle(r, a/(2*p), a%(2*p), z, 1e-7) {
								t.Fatalf("%s at %v: moved stroke %d leaves its triangle", motif, iso.Direction, a)
							}
						}
					}
				}
			}
			// The bound, on the seed's first stroke: L from its samples, κ
			// for a Euclidean circle |z − c| = ρ being (1 + ρ² − |c|²)/(2ρ).
			pts := arcPoints(cz(still.ArcStart[0]), cz(still.ArcEnd[0]), cz(still.ArcCenter[0]), still.ArcStraight[0], 2000)
			length := 0.0
			for n := 1; n < len(pts); n++ {
				length += dist(pts[n-1], pts[n])
			}
			kappa := 0.0
			if !still.ArcStraight[0] {
				c, rho := cz(still.ArcCenter[0]), still.ArcRadius[0]
				kappa = math.Abs(1+rho*rho-real(c)*real(c)-imag(c)*imag(c)) / (2 * rho)
			}
			if b := (1 + kappa) * length; b >= math.Pi {
				t.Errorf("%s: (1 + |κ|)·L = %v reaches π", motif, b)
			}
		}
	})
}

// Frames carry the motif: a frame moves the frozen patch's own strokes,
// and a frame for another motif or size is refused.
func TestLaceMotifFrames(t *testing.T) {
	q := motifLace("petals", 0.8, 3)
	src, err := NewLaceSource(q)
	if err != nil {
		t.Fatal(err)
	}
	m := LaceMotion{Offset: 0.5}
	f, err := src.Frame(LaceFrameRequest{Lace: q, Motion: m, Progress: 0.5})
	if err != nil {
		t.Fatal(err)
	}
	want := moved(t, q, LacePathAt(LaceIsometry{}, m, 0.5))
	if !reflect.DeepEqual(f.ArcStart, want.ArcStart) || !reflect.DeepEqual(f.ArcCenter, want.ArcCenter) {
		t.Error("a petals frame differs from the moved patch")
	}
	for _, other := range []LaceRequest{motifLace("leaves", 0.8, 3), motifLace("petals", 0.7, 3), lace(3, 1000, 0.3)} {
		if _, err := src.Frame(LaceFrameRequest{Lace: other, Motion: m, Progress: 0.5}); err == nil {
			t.Errorf("a frame for %q %v was not refused", other.Motif, other.Size)
		}
	}
}
