package engine

import (
	"errors"
	"fmt"
	"math"
	"math/cmplx"
	"reflect"
	"testing"
)

// The loop motif (docs/mathematics.md, Hyperbolic lace, Motifs): a closed
// Fourier curve placed in the incircle of the seed's fundamental triangle
// and mirrored into all 2p of them. As in the other lace tests, the
// expectations here are written from the definitions: the incircle is
// found by bisection on distances to the triangle's three geodesics, and
// the curve from its terms, while every observation comes from the
// returned strokes.

// sampleLeafOutline is the excursion's example leaf (web/fourier-fit.ts).
var sampleLeafOutline = []Vec{{-1.9, -1.35}, {-1.65, -0.65}, {-1.7, -0.3}, {-1.35, -0.18}, {-1.4, 0.2}, {-0.98, 0.27}, {-1.02, 0.65}, {-0.57, 0.66}, {-0.55, 1.02}, {-0.12, 0.97}, {0.05, 1.34}, {0.4, 1.19}, {0.74, 1.49}, {1, 1.3}, {1.8, 1.55}, {1.55, 0.8}, {1.69, 0.5}, {1.37, 0.26}, {1.5, -0.05}, {1.12, -0.18}, {1.16, -0.53}, {0.74, -0.53}, {0.65, -0.87}, {0.22, -0.71}, {0.03, -1.03}, {-0.4, -0.81}, {-0.62, -1.07}, {-1.1, -0.85}, {-1.64, -1.48}}

func leafTerms(t testing.TB, count int) []Term {
	t.Helper()
	fit, err := FitFourier(sampleLeafOutline, true)
	if err != nil {
		t.Fatal(err)
	}
	r, err := fit.Select(count)
	if err != nil {
		t.Fatal(err)
	}
	return r.Terms
}

// The loops tried: the leaf at 8 and 16 terms; a circle with one fast
// ripple (f = 64); a deltoid, whose three cusps turn by π; a figure
// eight, x = sin t, y = sin 2t / 2, which crosses itself; and an ellipse,
// x = 2 cos(t + δ), y = sin(t + δ), turned half a sample step (δ = 2π/128)
// so that its farthest points lie between samples, where only its arcs
// reach them.
func testLoops(t testing.TB) map[string][]Term {
	return map[string][]Term{
		"leaf 8":  leafTerms(t, 8),
		"leaf 16": leafTerms(t, 16),
		"ripple":  {{Frequency: 1, Radius: 1}, {Frequency: 64, Radius: 0.02, Phase: 0.3}},
		"deltoid": {{Frequency: 1, Radius: 2}, {Frequency: -2, Radius: 1}},
		"eight": {
			{Frequency: 1, Radius: 0.5, Phase: -math.Pi / 2}, {Frequency: -1, Radius: 0.5, Phase: math.Pi / 2},
			{Frequency: 2, Radius: 0.25}, {Frequency: -2, Radius: 0.25, Phase: math.Pi},
		},
		"ellipse": {{Frequency: 1, Radius: 1.5, Phase: 2 * math.Pi / 128}, {Frequency: -1, Radius: 0.5, Phase: -2 * math.Pi / 128}},
	}
}

func loopLace(terms []Term, size float64, depth int) LaceRequest {
	q := lace(depth, 1000, 0.3)
	q.Motif, q.Size, q.Loop = "loop", size, terms
	return q
}

// eachLoop runs a check for every tiling, loop and size.
func eachLoop(t *testing.T, sizes []float64, check func(t *testing.T, p, q int, terms []Term, u float64)) {
	loops := testLoops(t)
	eachTiling(t, func(t *testing.T, p, q int) {
		for name, terms := range loops {
			for _, u := range sizes {
				t.Run(fmt.Sprintf("%s %v", name, u), func(t *testing.T) { check(t, p, q, terms, u) })
			}
		}
	})
}

// loopArcs is tile i's strokes: their first index and the count per copy.
func loopArcs(t *testing.T, r LaceResult, i int) (first, perCopy int) {
	t.Helper()
	p := pOf(r)
	if len(r.ArcFirst) != len(r.Center)+1 {
		t.Fatalf("arcFirst has %d entries for %d tiles", len(r.ArcFirst), len(r.Center))
	}
	first, end := int(r.ArcFirst[i]), int(r.ArcFirst[i+1])
	if (end-first)%(2*p) != 0 {
		t.Fatalf("tile %d has %d strokes, not a multiple of %d", i, end-first, 2*p)
	}
	return first, (end - first) / (2 * p)
}

// incircle is the incenter I of fundamental triangle 0, (O, M_0, V_1),
// and its inradius: the point of the bisector at O equally far from the
// line O M_0 and side 0's geodesic, by bisection. Distances from z: to a
// diameter at angle φ, sinh d = 2|Im(z e^{−iφ})|/(1 − |z|²); to the
// geodesic circle (c, ρ), sinh d = ||z − c|² − ρ²|/(ρ(1 − |z|²)).
func incircle(r LaceResult) (complex128, float64) {
	p := float64(pOf(r))
	v0, v1 := corner(r, 0, 0), corner(r, 0, 1)
	side := sideOf(r, 0, 0)
	c, rho := cz(r.EdgeCenter[side]), r.EdgeRadius[side]
	m := hyperbolicMidpoint(v0, v1)
	phi := cmplx.Phase(m)
	bisector := math.Pi/2 + 1.5*math.Pi/p
	gap := func(z complex128) float64 { return 1 - real(z)*real(z) - imag(z)*imag(z) }
	toLine := func(z complex128) float64 {
		return math.Asinh(2 * math.Abs(imag(z*cmplx.Rect(1, -phi))) / gap(z))
	}
	toSide := func(z complex128) float64 {
		d := cmplx.Abs(z - c)
		return math.Asinh(math.Abs(d*d-rho*rho) / (rho * gap(z)))
	}
	lo, hi := 0.0, cmplx.Abs(m)
	for range 200 {
		mid := (lo + hi) / 2
		if z := cmplx.Rect(mid, bisector); toLine(z) < toSide(z) {
			lo = mid
		} else {
			hi = mid
		}
	}
	z := cmplx.Rect(lo, bisector)
	return z, toLine(z)
}

// tileMap is tile i's transformation from its returned [Re a, Im a, Re b,
// Im b] and orientation, and the Euclidean scale |T'(0)| = 1/|a|².
func tileMap(r LaceResult, i int) (func(complex128) complex128, float64) {
	tr := r.Transform[i]
	a, b := complex(tr[0], tr[1]), complex(tr[2], tr[3])
	odd := r.Reversed[i]
	return func(z complex128) complex128 {
		if odd {
			z = cmplx.Conj(z)
		}
		return (a*z + b) / (cmplx.Conj(b)*z + cmplx.Conj(a))
	}, 1 / (tr[0]*tr[0] + tr[1]*tr[1])
}

func nextPow2(x float64) int {
	n := 1
	for float64(n) < x {
		n *= 2
	}
	return n
}

// loopTop is the most arcs a copy may have: 8 per turn of the fastest
// moving term, as a power of two from 32 to 512.
func loopTop(terms []Term) int {
	f := 0.0
	for _, term := range terms {
		if term.Radius > 0 {
			f = math.Max(f, math.Abs(term.Frequency))
		}
	}
	return min(512, max(32, nextPow2(8*f)))
}

// Every stroke lies in its own fundamental triangle, unmoved and at the
// largest offset, and each copy is a closed chain: every arc starts where
// the one before it ends, exactly, and the last ends where the first
// starts.
func TestLaceLoopContainment(t *testing.T) {
	eachLoop(t, []float64{0.1, 0.5, 1}, func(t *testing.T, p, q int, terms []Term, u float64) {
		req := loopLace(terms, u, 3)
		seed := mustLace(t, req)
		in, rho := incircle(seed)
		for _, iso := range []LaceIsometry{{}, {Offset: LaceMaxOffset, Direction: 2, Rotation: 0.4}} {
			r := moved(t, req, iso)
			checkLaceShape(t, r)
			for i := range r.Center {
				first, m := loopArcs(t, r, i)
				T, _ := tileMap(r, i)
				if m < 2 {
					t.Fatalf("tile %d's copies have %d arcs", i, m)
				}
				for c := range 2 * p {
					for k := range m {
						a := first + c*m + k
						next := first + c*m + (k+1)%m
						if r.ArcEnd[a] != r.ArcStart[next] {
							t.Fatalf("tile %d copy %d: arc %d ends at %v, the next starts at %v", i, c, k, r.ArcEnd[a], r.ArcStart[next])
						}
						// Inside its triangle, and inside the triangle's incircle
						// of radius u·ρ, carried by the tile's transformation.
						disk := T(rotate(in, c, p, seed))
						for _, z := range arcPoints(cz(r.ArcStart[a]), cz(r.ArcEnd[a]), cz(r.ArcCenter[a]), r.ArcStraight[a], 6) {
							if !inTriangle(r, i, c, z, 1e-9) {
								t.Fatalf("offset %v: tile %d copy %d arc %d leaves its triangle at %v", iso.Offset, i, c, k, z)
							}
							if d := dist(z, disk); d > u*rho+1e-9 {
								t.Fatalf("offset %v: tile %d copy %d arc %d is %v from its incenter, beyond %v", iso.Offset, i, c, k, d, u*rho)
							}
						}
					}
				}
			}
		}
	})
}

// The seed's copy 0 is the loop itself, moved by a similarity and the
// isometry from 0 to the incenter: carried back by that isometry, its
// arcs' ends and the curve's points between them are one similar image of
// the curve's samples, and at size u the loop reaches u times the
// inradius from I and no farther. A window about the center at the least
// minimum radius draws the seed at the finest level, the loop's top.
func TestLaceLoopShape(t *testing.T) {
	eachLoop(t, []float64{0.3, 1}, func(t *testing.T, p, q int, terms []Term, u float64) {
		r := mustLace(t, laceWindowed(loopLace(terms, u, 1), LaceWindow{-0.1, 0.1, -0.1, 0.1}, LaceMinRadius))
		in, rho := incircle(r)
		_, m := loopArcs(t, r, 0)
		if m != loopTop(terms) {
			t.Fatalf("the seed's copies have %d arcs, want the top %d", m, loopTop(terms))
		}
		back := toOrigin(in)
		// Ends k of copy 0 are the curve at t = 2πk/m.
		want := make([]complex128, m)
		got := make([]complex128, m)
		for k := range m {
			v := fourierAt(terms, 2*math.Pi*float64(k)/float64(m))
			want[k] = complex(v.X, v.Y)
			got[k] = back(cz(r.ArcStart[k]))
		}
		// The similarity w = s·z + c from the two farthest-apart samples.
		far, i0, i1 := 0.0, 0, 0
		for i := range want {
			for j := range i {
				if d := cmplx.Abs(want[i] - want[j]); d > far {
					far, i0, i1 = d, i, j
				}
			}
		}
		s := (got[i0] - got[i1]) / (want[i0] - want[i1])
		c := got[i0] - s*want[i0]
		size := cmplx.Abs(s) * far
		// The curve's +y points outward along the bisector at O, at angle
		// π/2 + 3π/(2p): the similarity turns by 3π/(2p).
		if d := math.Remainder(cmplx.Phase(s)-1.5*math.Pi/float64(p), 2*math.Pi); math.Abs(d) > 1e-9 {
			t.Fatalf("the loop is turned %v from its bisector", d)
		}
		for k := range m {
			if d := cmplx.Abs(s*want[k] + c - got[k]); d > 1e-9*size {
				t.Fatalf("end %d is %v from the curve's similar image (size %v)", k, d, size)
			}
		}
		// At the finest level, each arc is the circle through its ends and
		// the curve at the middle of its span, unless that arc turns π/3 or
		// more in the curve's own plane, 2(π − ∠) for the angle at the
		// middle, as at a cusp: then it is the geodesic between its ends,
		// the circle through them and the inverse 1/z̄ of an end. That
		// inverse lies on the geodesic's major arc, so the minor arc's
		// curvature is the opposite. Arcs are compared by signed curvature,
		// 2·cross(b − a, m − a)/(|b − a||m − a||b − m|) through three points,
		// within a sagitta of 10⁻⁹ times the copy's size.
		curvature := func(a, m, b complex128) float64 {
			cross := real(b-a)*imag(m-a) - imag(b-a)*real(m-a)
			return 2 * cross / (cmplx.Abs(b-a) * cmplx.Abs(m-a) * cmplx.Abs(b-m))
		}
		at := func(f float64) complex128 {
			v := fourierAt(terms, 2*math.Pi*f/float64(m))
			return complex(v.X, v.Y)
		}
		through := 0
		for k := range m {
			a, b := cz(r.ArcStart[k]), cz(r.ArcEnd[k])
			chord := cmplx.Abs(b - a)
			got := 0.0
			if !r.ArcStraight[k] {
				// The returned arc's middle: its circle's point beyond the
				// chord's midpoint on the side away from its center, the minor arc.
				cc := cz(r.ArcCenter[k])
				d := (a+b)/2 - cc
				got = curvature(a, cc+d*complex(r.ArcRadius[k]/cmplx.Abs(d), 0), b)
			}
			wa, wm, wb := at(float64(k)), at(float64(k)+0.5), at(float64(k)+1)
			bent := 2*(math.Pi-math.Abs(cmplx.Phase((wb-wm)/(wa-wm)))) >= math.Pi/3
			mid := toOrigin(-in)(s*wm + c)
			inverse := 1 / cmplx.Conj(a)
			if cmplx.Abs(a) < 1e-9 {
				inverse = 1 / cmplx.Conj(b)
			}
			want := curvature(a, mid, b)
			if bent {
				want = -curvature(a, inverse, b)
			} else {
				through++
			}
			if math.Abs(got-want)*chord*chord > 8e-9*size {
				t.Fatalf("arc %d (bent %v) has curvature %v, want %v", k, bent, got, want)
			}
		}
		if through < m/2 {
			t.Errorf("only %d of %d arcs follow the curve", through, m)
		}
		// It fills the disk of radius u·ρ about I: no arc reaches beyond
		// it, and some point comes within a hundredth of its edge.
		reach := 0.0
		for a := range 2 * p * m {
			for _, z := range arcPoints(cz(r.ArcStart[a]), cz(r.ArcEnd[a]), cz(r.ArcCenter[a]), r.ArcStraight[a], 16) {
				reach = math.Max(reach, dist(z, rotate(in, a/m, p, r)))
			}
		}
		if reach > u*rho*(1+1e-9) || reach < 0.99*u*rho {
			t.Errorf("the copies reach %v from their incenters, want up to %v", reach, u*rho)
		}
	})
}

// rotate is the incenter of triangle c of the seed: I turned by 2πk/p for
// c = 2k, and mirrored in the line O V_{k+1} for c = 2k + 1.
func rotate(in complex128, c, p int, r LaceResult) complex128 {
	k := c / 2
	z := in * cmplx.Rect(1, 2*math.Pi*float64(k)/float64(p))
	if c%2 == 1 {
		v := corner(r, 0, k+1)
		e := v / complex(cmplx.Abs(v), 0)
		z = e * e * cmplx.Conj(z)
	}
	return z
}

// The invariant bound (1 + |κ|)·L on each arc's Euclidean turning stays
// below π/2, so the minor arc drawn is the arc wherever an isometry
// carries it; a circle |z − c| = ρ has κ = (1 + ρ² − |c|²)/(2ρ).
func TestLaceLoopArcsStayMinor(t *testing.T) {
	eachLoop(t, []float64{0.1, 1}, func(t *testing.T, p, q int, terms []Term, u float64) {
		r := mustLace(t, loopLace(terms, u, 0))
		for a := range r.ArcStart {
			pts := arcPoints(cz(r.ArcStart[a]), cz(r.ArcEnd[a]), cz(r.ArcCenter[a]), r.ArcStraight[a], 64)
			length := 0.0
			for n := 1; n < len(pts); n++ {
				length += dist(pts[n-1], pts[n])
			}
			kappa := 0.0
			if !r.ArcStraight[a] {
				c, rho := cz(r.ArcCenter[a]), r.ArcRadius[a]
				kappa = math.Abs(1+rho*rho-real(c)*real(c)-imag(c)*imag(c)) / (2 * rho)
			}
			if b := (1 + kappa) * length; b >= math.Pi/2 {
				t.Fatalf("arc %d: (1 + |κ|)·L = %v", a, b)
			}
		}
	})
}

// Every tile's strokes are the seed's carried by its transformation, at
// a level of detail its drawn size decides; levels nest, so a coarser
// copy's ends are some of a finer one's. Across every interior side,
// the coarser tile's ends reflected are ends of the finer's copy.
func TestLaceLoopTilesAndSides(t *testing.T) {
	eachTiling(t, func(t *testing.T, p, q int) {
		terms := leafTerms(t, 12)
		r := mustLace(t, loopLace(terms, 0.8, 3))
		_, top := loopArcs(t, r, 0)
		seedEnd := func(c, k, m int) complex128 { return cz(r.ArcStart[c*top+k*(top/m)]) }
		for i := range r.Center {
			first, m := loopArcs(t, r, i)
			if top%m != 0 {
				t.Fatalf("tile %d has %d arcs, not a level of the seed's %d", i, m, top)
			}
			T, _ := tileMap(r, i)
			for c := range 2 * p {
				for k := range m {
					found := false
					for d := range 2 * p {
						if dist(cz(r.ArcStart[first+c*m+k]), T(seedEnd(d, k, m))) < laceBudget {
							found = true
							break
						}
					}
					if !found {
						t.Fatalf("tile %d copy %d end %d is no seed end carried by its transformation", i, c, k)
					}
				}
			}
		}
		ends := func(i int) []complex128 {
			first, m := loopArcs(t, r, i)
			out := make([]complex128, 0, 2*p*m)
			for a := first; a < first+2*p*m; a++ {
				out = append(out, cz(r.ArcStart[a]))
			}
			return out
		}
		tilesOf := map[int][]int{}
		for i := range r.Center {
			for k := range p {
				tilesOf[sideOf(r, i, k)] = append(tilesOf[sideOf(r, i, k)], i)
			}
		}
		levelsDiffer := 0
		for e, tiles := range tilesOf {
			if len(tiles) != 2 {
				continue
			}
			coarse, fine := ends(tiles[0]), ends(tiles[1])
			if len(coarse) > len(fine) {
				coarse, fine = fine, coarse
			}
			if len(coarse) != len(fine) {
				levelsDiffer++
			}
			for _, z := range coarse {
				x := reflectAcross(r, e, z)
				ok := false
				for _, w := range fine {
					if dist(x, w) < laceBudget {
						ok = true
						break
					}
				}
				if !ok {
					t.Fatalf("edge %d: an end reflected is none of the neighbor's", e)
				}
			}
		}
		if levelsDiffer == 0 {
			t.Error("no side joins tiles drawn at different levels")
		}
	})
}

// The level of detail: tile i, drawn at scale σ = |T'(0)|, has
// M = 2^⌈log₂(4σρ₀/m)⌉ arcs per copy within 2 and the loop's top, where
// ρ₀ is the seed copy's Euclidean radius and m the window's minimum
// radius, or 1/128. Frames decide it under their own isometry, and at
// the static isometry a frame is the static patch exactly.
func TestLaceLoopLevelOfDetail(t *testing.T) {
	eachTiling(t, func(t *testing.T, p, q int) {
		terms := leafTerms(t, 8)
		u := 0.9
		req := loopLace(terms, u, top())
		in, rho := incircle(mustLace(t, req))
		_, rho0 := viewDisk(in, u*rho)
		check := func(t *testing.T, r LaceResult, least float64) {
			total := 0
			for i := range r.Center {
				_, m := loopArcs(t, r, i)
				_, sigma := tileMap(r, i)
				want := min(loopTop(terms), max(2, nextPow2(4*sigma*rho0/least)))
				if m != want {
					t.Fatalf("tile %d at scale %v has %d arcs, want %d", i, sigma, m, want)
				}
				total += 2 * p * m
			}
			if total != len(r.ArcStart) || total > LaceMaxLoopStrokes {
				t.Fatalf("%d strokes, %d returned, cap %d", total, len(r.ArcStart), LaceMaxLoopStrokes)
			}
		}
		check(t, mustLace(t, req), 1.0/128)
		iso := LaceIsometry{Offset: 0.7, Direction: 1}
		check(t, moved(t, req, iso), 1.0/128)
		w, least := lacePageWindow(0.4, 8, 3)
		check(t, mustLace(t, laceWindowed(loopLace(terms, u, 4), w, least)), least)
		src, err := NewLaceSource(req)
		if err != nil {
			t.Fatal(err)
		}
		f, err := src.Frame(LaceFrameRequest{Lace: req, Motion: LaceMotion{Offset: 0.7}, Progress: 0})
		if err != nil {
			t.Fatal(err)
		}
		static := mustLace(t, req)
		if !reflect.DeepEqual(f.ArcFirst, static.ArcFirst) || !reflect.DeepEqual(f.ArcStart, static.ArcStart) || !reflect.DeepEqual(f.ArcCenter, static.ArcCenter) {
			t.Error("the frame at the static isometry differs from the static patch")
		}
		half, err := src.Frame(LaceFrameRequest{Lace: req, Motion: LaceMotion{Offset: 0.7}, Progress: 0.5})
		if err != nil {
			t.Fatal(err)
		}
		want := moved(t, req, LacePathAt(LaceIsometry{}, LaceMotion{Offset: 0.7}, 0.5))
		if !reflect.DeepEqual(half.ArcFirst, want.ArcFirst) || !reflect.DeepEqual(half.ArcEnd, want.ArcEnd) {
			t.Error("the frame halfway differs from the moved patch")
		}
	})
}

// Over the cap, every count above two halves until the strokes fit.
func TestLaceLoopStrokeCap(t *testing.T) {
	defer func(c int) { laceLoopStrokes = c }(laceLoopStrokes)
	terms := leafTerms(t, 8)
	req := loopLace(terms, 1, 5)
	free := mustLace(t, req)
	p := pOf(free)
	floor := 2 * 2 * p * len(free.Center)
	laceLoopStrokes = (len(free.ArcStart) + floor) / 2
	capped := mustLace(t, req)
	for h := 1; ; h++ {
		total := 0
		for i := range free.Center {
			_, m := loopArcs(t, free, i)
			total += 2 * p * max(2, m>>h)
		}
		if total > laceLoopStrokes {
			continue
		}
		for i := range free.Center {
			_, m := loopArcs(t, free, i)
			if _, got := loopArcs(t, capped, i); got != max(2, m>>h) {
				t.Fatalf("tile %d: %d arcs under the cap, want %d", i, got, max(2, m>>h))
			}
		}
		if len(capped.ArcStart) != total {
			t.Fatalf("%d strokes, want %d", len(capped.ArcStart), total)
		}
		break
	}
	// The strokes stay bounded at the window's tile limit.
	laceLoopStrokes = LaceMaxLoopStrokes
	eachTiling(t, func(t *testing.T, p, q int) {
		w, least := lacePageWindow(0.93, 40, 3)
		r := mustLace(t, laceWindowed(loopLace(terms, 1, top()), w, least))
		if len(r.ArcStart) > LaceMaxLoopStrokes {
			t.Fatalf("%d strokes for %d tiles", len(r.ArcStart), len(r.Center))
		}
	})
}

// Only the loop carries arcFirst; the loop never changes the tiles.
func TestLaceLoopKeepsTiles(t *testing.T) {
	eachTiling(t, func(t *testing.T, p, q int) {
		star := mustLace(t, lace(3, 1000, 0.3))
		r := mustLace(t, loopLace(leafTerms(t, 8), 1, 3))
		if star.ArcFirst != nil {
			t.Error("the star returns arcFirst")
		}
		if !reflect.DeepEqual(topology(r), topology(star)) || !reflect.DeepEqual(r.Center, star.Center) || !reflect.DeepEqual(r.EdgeCenter, star.EdgeCenter) {
			t.Error("the loop changed the tiles")
		}
		// The star ignores a loop it is sent.
		withLoop := lace(3, 1000, 0.3)
		withLoop.Loop = leafTerms(t, 8)
		if !reflect.DeepEqual(mustLace(t, withLoop), star) {
			t.Error("a loop changed the star")
		}
	})
}

// Frames for another loop or size are refused; the same loop is matched.
func TestLaceLoopFrames(t *testing.T) {
	terms := leafTerms(t, 8)
	q := loopLace(terms, 0.8, 3)
	src, err := NewLaceSource(q)
	if err != nil {
		t.Fatal(err)
	}
	same := loopLace(append([]Term(nil), terms...), 0.8, 3)
	if !src.Matches(same) {
		t.Error("an equal loop is not matched")
	}
	other := append([]Term(nil), terms...)
	other[2].Phase += 0.1
	for _, o := range []LaceRequest{loopLace(other, 0.8, 3), loopLace(terms, 0.7, 3), loopLace(terms[:5], 0.8, 3), lace(3, 1000, 0.3)} {
		if _, err := src.Frame(LaceFrameRequest{Lace: o, Motion: LaceMotion{Offset: 0.5}, Progress: 0.5}); err == nil {
			t.Error("a frame for another loop was not refused")
		}
	}
}

func TestLaceLoopRefusals(t *testing.T) {
	leaf := leafTerms(t, 4)
	with := func(k int, change func(*Term)) []Term {
		out := append([]Term(nil), leaf...)
		change(&out[k])
		return out
	}
	many := make([]Term, 17)
	for k := range many {
		many[k] = Term{Frequency: float64(k), Radius: 1}
	}
	for _, c := range []struct {
		name  string
		terms []Term
		size  float64
		field string
	}{
		{"no terms", nil, 1, "loop"},
		{"17 terms", many, 1, "loop"},
		{"fractional frequency", with(1, func(t *Term) { t.Frequency = 1.5 }), 1, "loop.1.frequency"},
		{"fast frequency", with(2, func(t *Term) { t.Frequency = 65 }), 1, "loop.2.frequency"},
		{"negative radius", with(1, func(t *Term) { t.Radius = -1 }), 1, "loop.1.radius"},
		{"huge radius", with(3, func(t *Term) { t.Radius = 1e6 }), 1, "loop.3.radius"},
		{"nonfinite phase", with(0, func(t *Term) { t.Phase = math.NaN() }), 1, "loop.0.phase"},
		{"huge phase", with(1, func(t *Term) { t.Phase = 2e6 }), 1, "loop.1.phase"},
		{"still", []Term{{Frequency: 0, Radius: 3}, {Frequency: 2, Radius: 0}}, 1, "loop"},
		{"cancelling", []Term{{Frequency: 1, Radius: 1}, {Frequency: 1, Radius: 1, Phase: math.Pi}}, 1, "loop"},
		{"small", leaf, 0.09, "size"},
		{"large", leaf, 1.01, "size"},
	} {
		_, err := ComputeLace(loopLace(c.terms, c.size, 1))
		var fe *FieldError
		if !errors.As(err, &fe) || fe.Field != c.field {
			t.Errorf("%s: got %v, want a refusal under %s", c.name, err, c.field)
		}
	}
}
