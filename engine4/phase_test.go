package engine4

import (
	"encoding/json"
	"fmt"
	"math"
	"math/cmplx"
	"reflect"
	"strings"
	"testing"
)

// A marked point carried along the moving fiber (docs/tesseracts.md,
// "Phase along a moving fiber"). Expectations come from the documented
// definitions written out here: horizontality Im⟨q, q′⟩ = 0, the north
// chart's starting representative, the latitude's closed form and the
// signed area of the base path, computed from points on S² alone, never
// from the engine's quadrature.

func withTransport(q Request, phase float64) Request {
	w := *q.Weave
	w.Transport, w.Phase = true, phase
	q.Weave = &w
	return q
}

// pair is q as (z₁, z₂) = (x + iy, z + iw).
func pair(q Vec4) (complex128, complex128) {
	return complex(q[0], q[1]), complex(q[2], q[3])
}

// inner is ⟨a, b⟩ = conj(a₁)b₁ + conj(a₂)b₂.
func inner(a, b Vec4) complex128 {
	a1, a2 := pair(a)
	b1, b2 := pair(b)
	return cmplx.Conj(a1)*b1 + cmplx.Conj(a2)*b2
}

// turned is e^{iθ}q.
func turned(q Vec4, theta float64) Vec4 {
	e := cmplx.Exp(complex(0, theta))
	z1, z2 := pair(q)
	z1, z2 = e*z1, e*z2
	return Vec4{real(z1), imag(z1), real(z2), imag(z2)}
}

func dist4(a, b Vec4) float64 {
	return norm4(Vec4{a[0] - b[0], a[1] - b[1], a[2] - b[2], a[3] - b[3]})
}

// wrapAngle reduces x into (−π, π].
func wrapAngle(x float64) float64 {
	x = math.Mod(x, 2*math.Pi)
	if x > math.Pi {
		x -= 2 * math.Pi
	} else if x <= -math.Pi {
		x += 2 * math.Pi
	}
	return x
}

// The documented starting point: e^{iφ₀} times the north chart's
// representative (z₁ real and positive), or e^{iφ₀}(0, 0, 1, 0) at the
// south pole.
func expectedStart(p Vec3, phase float64) Vec4 {
	if p == (Vec3{0, 0, -1}) {
		return turned(Vec4{0, 0, 1, 0}, phase)
	}
	z1 := math.Sqrt((1 + p[2]) / 2)
	q := Vec4{z1, 0, p[0] / (2 * z1), -p[1] / (2 * z1)}
	n := norm4(q)
	for i := range q {
		q[i] /= n
	}
	return turned(q, phase)
}

// signedArea is the area to the left of a closed geodesic polygon on the
// unit sphere, counted with winding: the sum of the signed triangles from a
// reference direction c to each side, by Van Oosterom and Strackee's
// tan(E/2) = c·(a × b)/(1 + c·a + a·b + b·c). c is the one of 26 directions
// farthest from every vertex's antipode. The result is unwrapped.
func signedArea(ps []Vec3) float64 {
	best, c := -1., Vec3{}
	for i := -1; i <= 1; i++ {
		for j := -1; j <= 1; j++ {
			for k := -1; k <= 1; k++ {
				if i == 0 && j == 0 && k == 0 {
					continue
				}
				l := math.Sqrt(float64(i*i + j*j + k*k))
				d := Vec3{float64(i) / l, float64(j) / l, float64(k) / l}
				near := math.Inf(1)
				for _, p := range ps {
					near = math.Min(near, dist3(d, Vec3{-p[0], -p[1], -p[2]}))
				}
				if near > best {
					best, c = near, d
				}
			}
		}
	}
	sum := 0.
	for i, a := range ps {
		b := ps[(i+1)%len(ps)]
		sum += 2 * math.Atan2(dot(c, cross(a, b)), 1+dot(c, a)+dot(a, b)+dot(b, c))
	}
	return sum
}

// smoothArea is a smooth closed path's signed area: inscribed geodesic
// polygons of m and 2m points, extrapolated (the error is O(m⁻²)).
func smoothArea(period float64, at func(float64) Vec3, m int) float64 {
	poly := func(k int) float64 {
		ps := make([]Vec3, k)
		for i := range ps {
			ps[i] = at(period * float64(i) / float64(k))
		}
		return signedArea(ps)
	}
	a, b := poly(m), poly(2*m)
	b = a + wrapAngle(b-a) // the same branch modulo 4π... within rounding
	return (4*b - a) / 3
}

type transportCase struct {
	name   string
	q      Request
	period float64
	at     func(float64) Vec3
	area   float64 // the signed area to the path's left, independent
}

func transportCases() []transportCase {
	lat := pairedRequest(math.Pi/6, 12, 3)
	flower := pairedRequest(math.Pi/4, 16, 5)
	k := 5
	flower.Weave.Path, flower.Weave.Amplitude, flower.Weave.Petals = "flower", math.Pi/8, &k
	flowerAt := func(t float64) Vec3 {
		a := math.Pi/4 + math.Pi/8*math.Cos(5*t)
		return expectedBasePoint(a, t)
	}
	// A flower touching both poles: α₀ = π/4, A = π/4.
	poles := pairedRequest(math.Pi/4, 16, 0)
	two := 2
	poles.Weave.Path, poles.Weave.Amplitude, poles.Weave.Petals = "flower", math.Pi/4, &two
	polesAt := func(t float64) Vec3 { return expectedBasePoint(math.Pi/4+math.Pi/4*math.Cos(2*t), t) }
	cases := []transportCase{
		{"latitude", lat, 2 * math.Pi, func(t float64) Vec3 { return expectedBasePoint(math.Pi/6, t) },
			2 * math.Pi * (1 - math.Cos(math.Pi/3))},
		{"flower", flower, 2 * math.Pi, flowerAt, smoothArea(2*math.Pi, flowerAt, 4096)},
		{"flower through both poles", poles, 2 * math.Pi, polesAt, smoothArea(2*math.Pi, polesAt, 4096)},
		{"great circle", greatCircleRequest(3*math.Pi/4, 28, 5), 2 * math.Pi,
			func(t float64) Vec3 { return greatCirclePoint(3*math.Pi/4, t) }, 2 * math.Pi},
		{"meridian", greatCircleRequest(math.Pi/2, 8, 1), 2 * math.Pi,
			func(t float64) Vec3 { return greatCirclePoint(math.Pi/2, t) }, 2 * math.Pi},
	}
	for _, m := range [][2]int{{2, 1}, {1, 1}, {1, 2}, {8, 7}, {3, 6}} {
		m1, m2 := m[0], m[1]
		period := 2 * math.Pi / float64(gcd(m1, m2))
		at := func(t float64) Vec3 { return lissajousPoint(m1, m2, t) }
		cases = append(cases, transportCase{fmt.Sprintf("lissajous %v", m), lissajousRequest(m1, m2, 32, 11),
			period, at, smoothArea(period, at, 8192)})
	}
	// A closing side of 0.005 radians puts the last corner inside the last
	// equal piece of the period.
	shortClose := []PolygonVertex{{0, 0}, {math.Pi / 2, 0}, {0, math.Pi / 2}, {-.004, .003}}
	for name, vs := range map[string][]PolygonVertex{"octant": octantTriangle, "south quad": southQuad,
		"star": star, "antipodal quad": antipodalQuad, "bowtie": bowtie, "short closing side": shortClose} {
		e := newExpectedPolygon(vs)
		cases = append(cases, transportCase{"polygon " + name, polygonRequest(vs, 30, 7), e.length, e.at, signedArea(e.ps)})
	}
	return cases
}

func insideAt(q Vec4, angles [6]float64, k float64) bool {
	return rotate(q, angles)[3] <= k
}

func transportOf(t *testing.T, name string, r Result) *TransportDiagnostics {
	t.Helper()
	c := r.Weave.Correspondence
	if c == nil || c.Transport == nil || r.Companion.Weave.Correspondence.Transport != c.Transport {
		t.Fatalf("%s: missing or unshared transport diagnostics", name)
	}
	return c.Transport
}

func TestMarkedPointLiesOnTheMovingFiber(t *testing.T) {
	angles := [6]float64{.3, -.7, .2, 1.1, -.4, .6}
	for _, tc := range transportCases() {
		for _, trace := range []float64{0, .13, .5, .999, 1, 1.37, -.4, -2.25} {
			q := withTransport(tc.q, .8)
			q.Angles, q.Weave.Trace = angles, trace
			r, err := Compute(q)
			if err != nil {
				t.Fatalf("%s at %v: %v", tc.name, trace, err)
			}
			name := fmt.Sprintf("%s at trace %v", tc.name, trace)
			tr := transportOf(t, name, r)
			c := r.Weave.Correspondence
			if math.Abs(norm4(tr.Point)-1) > 1e-15 || dist3(hopfMap(tr.Point), c.Base) > 4e-15 {
				t.Fatalf("%s: marked point %v is not on the moving fiber over %v", name, tr.Point, c.Base)
			}
			start := tc.at(tc.period * float64(q.Weave.Selected) / float64(q.Curves))
			if math.Abs(norm4(tr.Start)-1) > 1e-15 || dist3(hopfMap(tr.Start), snapped(start)) > 4e-15 {
				t.Fatalf("%s: start %v is not on the selected fiber", name, tr.Start)
			}
			k := windowLevel(q.Clip)
			for id, want := range map[string]Vec4{"weave/marked": tr.Point, "weave/marked/start": tr.Start} {
				m := markerByID(r, id)
				inside := rotate(want, angles)[3] <= k+weaveTolerance
				if (m != nil) != inside {
					t.Fatalf("%s: marker %s present %v, inside the window %v", name, id, m != nil, inside)
				}
				if m == nil {
					continue
				}
				v := rotate(want, angles)
				if dist4(m.FourPoint, v) > 1e-15 {
					t.Fatalf("%s: %s is %v, want the rotated point %v", name, id, m.FourPoint, v)
				}
				if dist3(m.Point, Vec3{v[0] / (1 - v[3]), v[1] / (1 - v[3]), v[2] / (1 - v[3])}) > 1e-12 {
					t.Fatalf("%s: %s is not the stereographic image of its point", name, id)
				}
			}
			if tr.Inside != (markerByID(r, "weave/marked") != nil) || tr.StartInside != (markerByID(r, "weave/marked/start") != nil) {
				t.Fatalf("%s: inside flags disagree with the drawn markers", name)
			}
		}
	}
}

func TestMarkedPointStartsAtTheEnteredPhase(t *testing.T) {
	for _, phase := range []float64{0, 1.3, -7, 2 * math.Pi} {
		for _, tc := range transportCases() {
			q := withTransport(tc.q, phase)
			r, err := Compute(q)
			if err != nil {
				t.Fatalf("%s: %v", tc.name, err)
			}
			tr := transportOf(t, tc.name, r)
			p := snapped(tc.at(tc.period * float64(q.Weave.Selected) / float64(q.Curves)))
			want := expectedStart(p, phase)
			if dist4(tr.Start, want) > 2e-15 || tr.Point != tr.Start {
				t.Fatalf("%s at φ₀ = %v: start %v, point %v, want %v", tc.name, phase, tr.Start, tr.Point, want)
			}
		}
	}
	// A start at the south pole, where z₁ = 0: a polygon's first vertex.
	q := withTransport(polygonRequest([]PolygonVertex{{2.5, -math.Pi / 2}, {.3, .4}, {1.9, .1}}, 4, 0), .5)
	r, _ := Compute(q)
	if tr := transportOf(t, "south pole", r); dist4(tr.Start, turned(Vec4{0, 0, 1, 0}, .5)) > 1e-15 {
		t.Fatalf("south pole start %v", tr.Start)
	}
}

func TestHolonomyIsHalfTheEnclosedArea(t *testing.T) {
	for _, tc := range transportCases() {
		q := withTransport(tc.q, .4)
		r, err := Compute(q)
		if err != nil {
			t.Fatalf("%s: %v", tc.name, err)
		}
		tr := transportOf(t, tc.name, r)
		if tr.Holonomy <= -math.Pi || tr.Holonomy > math.Pi {
			t.Fatalf("%s: holonomy %v outside (−π, π]", tc.name, tr.Holonomy)
		}
		tol := 1e-12
		if strings.HasPrefix(tc.name, "flower") || strings.HasPrefix(tc.name, "lissajous") {
			tol = 1e-9 // the reference area is extrapolated, not exact
		}
		if d := wrapAngle(tr.Holonomy - tc.area/2); math.Abs(d) > tol {
			t.Fatalf("%s: holonomy %v, half the signed area %v (difference %v)", tc.name, tr.Holonomy, tc.area/2, d)
		}
		// Whole turns, forward and back, measured on the returned points.
		for _, turns := range []float64{1, 2, 3, -1, -2} {
			q.Weave.Trace = turns
			r, _ := Compute(q)
			got := transportOf(t, tc.name, r)
			if got.Start != tr.Start {
				t.Fatalf("%s: the start moved after %v turns", tc.name, turns)
			}
			phase := cmplx.Phase(inner(got.Start, got.Point))
			if d := wrapAngle(phase - turns*tc.area/2); math.Abs(d) > 4*tol || math.Abs(cmplx.Abs(inner(got.Start, got.Point))-1) > 1e-14 {
				t.Fatalf("%s: after %v turns the point is turned %v, want %v", tc.name, turns, phase, turns*tc.area/2)
			}
		}
	}
}

func TestReversedPolygonNegatesTheHolonomy(t *testing.T) {
	for name, vs := range map[string][]PolygonVertex{"octant": octantTriangle, "south quad": southQuad, "star": star} {
		back := make([]PolygonVertex, len(vs))
		for i, v := range vs {
			back[len(vs)-1-i] = v
		}
		a, _ := Compute(withTransport(polygonRequest(vs, 6, 0), 0))
		b, _ := Compute(withTransport(polygonRequest(back, 6, 0), 0))
		if d := wrapAngle(transportOf(t, name, a).Holonomy + transportOf(t, name, b).Holonomy); math.Abs(d) > 1e-12 {
			t.Fatalf("%s: reversed holonomy %v, forward %v", name, transportOf(t, name, b).Holonomy, transportOf(t, name, a).Holonomy)
		}
	}
}

// The exact geodesic lift: along a great-circle arc the horizontal lift is
// a great circle of S³ at half the speed, so its end is the point of the
// next fiber with ⟨q_a, q_b⟩ real and positive.
func TestPolygonLiftIsTheGeodesicLift(t *testing.T) {
	for name, vs := range map[string][]PolygonVertex{"octant": octantTriangle, "south quad": southQuad, "star": star, "bowtie": bowtie} {
		e := newExpectedPolygon(vs)
		q := withTransport(polygonRequest(vs, 9, 0), .9)
		pointAt := func(t0 float64) Vec4 {
			q.Weave.Trace = t0 / e.length
			return transportOf(t, name, mustCompute(t, q)).Point
		}
		from := pointAt(0)
		for i := range e.ps {
			end := e.length
			if i+1 < len(e.ps) {
				end = e.corners[i+1]
			}
			// Midway along side i and at its end, the lift is the point of
			// that fiber with ⟨lift at the side's start, ·⟩ real and positive.
			for _, s := range []float64{.5, 1} {
				target := e.corners[i] + s*(end-e.corners[i])
				base := expectedStart(snapped(e.at(math.Mod(target, e.length))), 0)
				exact := turned(base, -cmplx.Phase(inner(from, base)))
				if got := pointAt(target); dist4(got, exact) > 1e-12 {
					t.Fatalf("%s: lift %v along side %d is %v, want %v", name, s, i+1, got, exact)
				}
			}
			from = pointAt(end)
		}
	}
}

func mustCompute(t *testing.T, q Request) Result {
	t.Helper()
	r, err := Compute(q)
	if err != nil {
		t.Fatal(err)
	}
	return r
}

// Horizontality and continuity, observed on returned points only: a short
// step of the trace moves the point orthogonally to its fiber, half as far
// as the base point moves, across the chart seam and through both poles.
func TestMarkedPointIsHorizontalAcrossChartsAndPoles(t *testing.T) {
	for _, tc := range transportCases() {
		q := withTransport(tc.q, -1.1)
		charts := map[string]bool{}
		const steps = 1500
		var prev *TransportDiagnostics
		var prevBase Vec3
		for i := 0; i <= steps; i++ {
			q.Weave.Trace = float64(i) / steps
			r := mustCompute(t, q)
			tr := transportOf(t, tc.name, r)
			c := r.Weave.Correspondence
			charts[c.Chart] = true
			if prev != nil {
				step := dist4(tr.Point, prev.Point)
				moved := dist3(c.Base, prevBase)
				// |Δq| = |Δp|/2 to second order for a horizontal step.
				if math.Abs(step-moved/2) > 1e-3*moved+1e-12 {
					t.Fatalf("%s: step %d moved the point %v for a base step %v", tc.name, i, step, moved)
				}
				// No component along the fiber direction iq: Im⟨q, q′⟩ = 0
				// and Im⟨q, q″⟩ = 0, so a step leaves only a third-order
				// residue, a vertical fraction of order step². Following a
				// chart's representative instead leaves a fraction (1 ∓ p_z)/2.
				if v := imag(inner(prev.Point, tr.Point)); math.Abs(v) > 1e-3*step+1e-13 {
					t.Fatalf("%s: step %d has a vertical component %v (step %v)", tc.name, i, v, step)
				}
			}
			prev, prevBase = tr, c.Base
		}
		// A path that visits both hemispheres crosses the chart seam.
		hemispheres := map[bool]bool{}
		for i := 0; i < 400; i++ {
			hemispheres[tc.at(tc.period * float64(i) / 400)[2] >= 0] = true
		}
		if len(hemispheres) == 2 && !(charts["north"] && charts["south"]) {
			t.Fatalf("%s: the trace never changed chart: %v", tc.name, charts)
		}
	}
}

// The holonomy does not depend on where the point starts: the selected
// sample, or the starting phase.
func TestHolonomyIsIndependentOfTheStart(t *testing.T) {
	for _, tc := range transportCases() {
		var first float64
		for i, sel := range []int{0, 1, tc.q.Curves - 1} {
			for _, phase := range []float64{0, 2.5} {
				q := withTransport(tc.q, phase)
				q.Weave.Selected = sel
				h := transportOf(t, tc.name, mustCompute(t, q)).Holonomy
				if i == 0 && phase == 0 {
					first = h
				} else if math.Abs(wrapAngle(h-first)) > 1e-12 {
					t.Fatalf("%s: holonomy %v from sample %d at φ₀ %v, %v from sample 0", tc.name, h, sel, phase, first)
				}
			}
		}
	}
}

func TestLiftTrailFollowsTheMarkedPoint(t *testing.T) {
	angles := [6]float64{.3, -.7, .2, 1.1, -.4, .6}
	whole, clipped := 0, 0
	for _, tc := range transportCases() {
		for _, clip := range []float64{12, 2.5} {
			for _, trace := range []float64{0, .3, 1, 1.75, -.6, -1.5} {
				q := withTransport(tc.q, .8)
				q.Angles, q.Weave.Trace, q.Clip = angles, trace, clip
				r := mustCompute(t, q)
				name := fmt.Sprintf("%s at trace %v, C = %v", tc.name, trace, clip)
				tr := transportOf(t, name, r)
				k := windowLevel(clip)
				// The trail covers the whole turn behind the point, in
				// unwrapped parameters, whichever way the trace runs. A turn
				// earlier the point was on the same fiber, turned back by γ.
				u0 := tc.period * float64(q.Weave.Selected) / float64(q.Curves)
				now := u0 + trace*tc.period
				lo, hi := now-tc.period, now
				ends := map[float64]Vec4{hi: tr.Point, lo: turned(tr.Point, -tr.Holonomy)}
				prevU := math.Inf(-1)
				trail := weavePaths(r, "lift")
				for _, p := range trail {
					if p.Source != "weave/lift" || p.SectionID != "weave/latitude/0" || len(p.Points) < 2 {
						t.Fatalf("%s: bad trail arc %s with %d points", name, p.Source, len(p.Points))
					}
					for i, v := range p.FourPoints {
						u := p.Parameters[i]
						if v[3] > k+weaveTolerance || u < lo-1e-12*tc.period || u > hi+1e-12*tc.period || u <= prevU {
							t.Fatalf("%s: trail point %d at %v outside the window or [%v, %v], or out of order", name, i, u, lo, hi)
						}
						prevU = u
						w := undoRotation(v, angles)
						// Samples at most 1/8 apart on S², 1/16 on S³, so no
						// projection pole hides between two kept samples.
						if i > 0 && dist4(w, undoRotation(p.FourPoints[i-1], angles)) > 1./16+1e-9 {
							t.Fatalf("%s: trail samples %d and %d are %v apart on S³", name, i-1, i, dist4(w, undoRotation(p.FourPoints[i-1], angles)))
						}
						base := snapped(tc.at(reduced(u, tc.period)))
						if math.Abs(norm4(w)-1) > 1e-14 || dist3(hopfMap(w), base) > 1e-13 {
							t.Fatalf("%s: trail point %d off the fiber over its base point", name, i)
						}
						if i != 0 && i != len(p.FourPoints)-1 {
							continue
						}
						// Each arc ends at an end of the span, at that end's
						// point, or on the window.
						matched := false
						for at, want := range ends {
							if math.Abs(u-at) <= 1e-12*tc.period {
								if dist4(w, want) > 1e-12 {
									t.Fatalf("%s: the trail's end at %v is %v, want %v", name, u, w, want)
								}
								// It ends exactly at the drawn point.
								if at == hi && v != rotate(tr.Point, angles) {
									t.Fatalf("%s: the trail ends at %v, not exactly at the point %v", name, v, rotate(tr.Point, angles))
								}
								matched = true
							}
						}
						if !matched && math.Abs(v[3]-k) > 1e-12 {
							t.Fatalf("%s: an arc ends at %v, neither an end of the trail nor on the window (q_w = %v)", name, u, v[3])
						}
					}
				}
				// The gap: the moving fiber's arc from where the trail lands,
				// e^{−iγ} times the point, to the point, clipped by the window.
				gap := weavePaths(r, "holonomy")
				lowS, highS := math.Min(-tr.Holonomy, 0), math.Max(-tr.Holonomy, 0)
				for _, p := range gap {
					if p.Source != "weave/holonomy" || p.SectionID != "weave/latitude/0" || len(p.Points) < 2 {
						t.Fatalf("%s: bad gap arc %s with %d points", name, p.Source, len(p.Points))
					}
					for i, v := range p.FourPoints {
						s := p.Parameters[i]
						if v[3] > k+weaveTolerance || s < lowS-1e-12 || s > highS+1e-12 || (i > 0 && s <= p.Parameters[i-1]) {
							t.Fatalf("%s: gap point %d at %v outside the window or [%v, %v], or out of order", name, i, s, lowS, highS)
						}
						if w := undoRotation(v, angles); dist4(w, turned(tr.Point, s)) > 1e-14 {
							t.Fatalf("%s: gap point %d is %v, want e^{i%v} times the point", name, i, w, s)
						}
						if (i == 0 || i == len(p.Points)-1) && math.Abs(s-lowS) > 1e-12 && math.Abs(s-highS) > 1e-12 && math.Abs(v[3]-k) > 1e-12 {
							t.Fatalf("%s: a gap arc ends at %v, neither an end nor on the window", name, s)
						}
					}
				}
				if math.Abs(tr.Holonomy) > 1e-9 && len(gap) == 0 && tr.Inside && insideAt(turned(tr.Point, -tr.Holonomy/2), angles, k) {
					t.Fatalf("%s: no gap drawn for holonomy %v", name, tr.Holonomy)
				}
				if ps := trail; len(ps) == 1 && math.Abs(ps[0].Parameters[0]-lo) <= 1e-12*tc.period &&
					math.Abs(ps[0].Parameters[len(ps[0].Parameters)-1]-hi) <= 1e-12*tc.period {
					whole++
				} else {
					clipped++
				}
			}
		}
	}
	if whole < 40 || clipped < 20 {
		t.Fatalf("only %d whole and %d clipped trails", whole, clipped)
	}
}

// Transport adds only its own geometry: every other path, marker and
// diagnostic is the result without it, bit for bit, and the field is
// neither read nor checked when it is off.
func TestTransportLeavesTheStudyUnchanged(t *testing.T) {
	for _, tc := range transportCases() {
		for _, hood := range []bool{false, true} {
			for _, trace := range []float64{0, .37, 1} {
				q := tc.q
				if hood {
					q = withNeighborhood(q, .2, 7)
				}
				q.Weave.Trace = trace
				off := mustCompute(t, q)
				// Off, the phase is ignored, even out of range.
				ignored := q
				w := *q.Weave
				w.Phase = 1e9
				ignored.Weave = &w
				if b := mustCompute(t, ignored); !reflect.DeepEqual(b, off) {
					t.Fatalf("%s: an inactive phase changed the result", tc.name)
				}
				on := mustCompute(t, withTransport(q, .3))
				strip := func(r Result) Result {
					paths := []Path{}
					for _, p := range r.Paths {
						if p.Role != "lift" && p.Role != "holonomy" {
							paths = append(paths, p)
						}
					}
					markers := []Marker{}
					for _, m := range r.Markers {
						if m.Role != "marked" && m.Role != "marked-start" {
							markers = append(markers, m)
						}
					}
					if len(markers) == 0 {
						markers = nil
					}
					r.Paths, r.Markers = paths, markers
					c := *r.Weave.Correspondence
					c.Transport = nil
					w := *r.Weave
					w.Correspondence = &c
					r.Weave = &w
					base := *r.Companion
					bw := *base.Weave
					bw.Correspondence = &c
					base.Weave = &bw
					r.Companion = &base
					r.Evaluations, r.EmittedPoints = off.Evaluations, off.EmittedPoints
					return r
				}
				a, _ := json.Marshal(strip(on))
				b, _ := json.Marshal(off)
				if string(a) != string(b) {
					i := 0
					for i < len(a) && i < len(b) && a[i] == b[i] {
						i++
					}
					lo := max(0, i-200)
					t.Fatalf("%s (neighborhood %v, trace %v): transport changed the rest of the result at\n%s\nvs\n%s", tc.name, hood, trace, a[lo:min(len(a), i+200)], b[lo:min(len(b), i+200)])
				}
			}
		}
	}
}

func TestTransportCollapsedLatitude(t *testing.T) {
	for _, alpha := range []float64{0, math.Pi / 2} {
		for _, trace := range []float64{0, .4, 3} {
			q := withTransport(pairedRequest(alpha, 6, 2), 1.2)
			q.Weave.Trace = trace
			r := mustCompute(t, q)
			tr := transportOf(t, "collapsed", r)
			pole := Vec3{0, 0, math.Cos(2 * alpha)}
			if tr.Holonomy != 0 || tr.Point != tr.Start || dist4(tr.Start, expectedStart(pole, 1.2)) > 1e-15 {
				t.Fatalf("α = %v at %v: %+v", alpha, trace, tr)
			}
			if len(weavePaths(r, "lift")) != 0 {
				t.Fatalf("α = %v: a constant path draws no trail", alpha)
			}
		}
	}
}

func TestTransportValidation(t *testing.T) {
	for _, phase := range []float64{math.Inf(1), math.NaN(), 1e5 + 1, -1e5 - 1} {
		_, err := Compute(withTransport(pairedRequest(math.Pi/6, 6, 0), phase))
		if fe, ok := err.(*FieldError); !ok || fe.Field != "weave.phase" {
			t.Fatalf("phase %v: error %v, want one naming weave.phase", phase, err)
		}
	}
	for _, phase := range []float64{1e5, -1e5} {
		if _, err := Compute(withTransport(pairedRequest(math.Pi/6, 6, 0), phase)); err != nil {
			t.Fatalf("phase %v refused: %v", phase, err)
		}
	}
}

func TestTransportLargestStudyWithinBudget(t *testing.T) {
	// The largest admitted base curves: the Lissajous (8, 7), the fastest
	// flower, and a 12-vertex polygon of long sides.
	k := 8
	flower := pairedRequest(math.Pi/4, 32, 0)
	flower.Weave.Path, flower.Weave.Amplitude, flower.Weave.Petals = "flower", math.Pi/4, &k
	vs := make([]PolygonVertex, 12)
	for i := range vs {
		vs[i] = PolygonVertex{U: float64(i) * (math.Pi - 1e-5) * 1, V: 0}
		if i%2 == 1 {
			vs[i].V = 1e-3
		}
	}
	for name, q := range map[string]Request{"lissajous": lissajousRequest(8, 7, 32, 0), "flower": flower,
		"polygon": polygonRequest(vs, 32, 0)} {
		q.Samples = 256
		q = withTransport(q, 0)
		q.Weave.Trace = .5
		path := newSpherePath(*q.Weave, q.Samples)
		limit := pairedWeavePoints(q.Curves, q.Samples) + path.segments - q.Samples + len(path.corners) + transportPoints(path, q.Samples)
		r, err := Compute(q)
		if err != nil {
			t.Fatalf("%s: %v", name, err)
		}
		points := 0
		for _, p := range append(r.Paths, r.Companion.Paths...) {
			points += len(p.Points)
		}
		points += len(r.Markers) + len(r.Companion.Markers)
		// The documented largest: the fastest flower adds 1,534 points.
		if name == "flower" && (transportPoints(path, 256) != 1534 || limit != 11880) {
			t.Fatalf("the fastest flower adds %d points, %d in all", transportPoints(path, 256), limit)
		}
		if points > limit || limit > maxPoints {
			t.Fatalf("%s: %d points against the counted bound %d (ceiling %d)", name, points, limit, maxPoints)
		}
	}
}

// Everything drawn depends only on where the point is, so k turns with kγ
// a whole turn return the drawing: the octant triangle encloses π/2, so
// γ = π/4 and eight turns bring the point and its trail home. Seven do not.
func TestTransportReturnsAfterWholeTurnsOfPhase(t *testing.T) {
	angles := [6]float64{.3, -.7, .2, 1.1, -.4, .6}
	q := withTransport(polygonRequest(octantTriangle, 30, 4), 1)
	q.Angles = angles
	at := func(trace float64) Result {
		q.Weave.Trace = trace
		return mustCompute(t, q)
	}
	gap := func(a, b Result) float64 {
		worst := dist4(a.Weave.Correspondence.Transport.Point, b.Weave.Correspondence.Transport.Point)
		la, lb := weavePaths(a, "lift"), weavePaths(b, "lift")
		if len(la) != len(lb) {
			return math.Inf(1)
		}
		for i := range la {
			if len(la[i].FourPoints) != len(lb[i].FourPoints) {
				return math.Inf(1)
			}
			for j := range la[i].FourPoints {
				worst = math.Max(worst, dist4(la[i].FourPoints[j], lb[i].FourPoints[j]))
			}
		}
		return worst
	}
	for _, f := range []float64{0, .37} {
		if g := gap(at(f), at(f+8)); g > 1e-12 {
			t.Fatalf("eight turns from %v leave the drawing %v away", f, g)
		}
		if g := gap(at(f), at(f+7)); g < .1 {
			t.Fatalf("seven turns from %v return the point (gap %v)", f, g)
		}
	}
}

// The window's tolerance applies to the markers as to every circle: a point
// 5·10⁻¹³ beyond the threshold k is drawn, and one 2·10⁻¹² beyond it is
// not. Unrotated, the start over (1, 0, 0) at φ₀ = π/2 has q_w = 1/√2.
func TestMarkersFollowTheWindowTolerance(t *testing.T) {
	q := withTransport(polygonRequest(octantTriangle, 24, 0), math.Pi/2)
	w := expectedStart(Vec3{1, 0, 0}, math.Pi/2)[3]
	for _, c := range []struct {
		beyond float64
		drawn  bool
	}{{-1e-3, true}, {5e-13, true}, {2e-12, false}} {
		k := w - c.beyond
		q.Clip = math.Sqrt((1 + k) / (1 - k))
		r := mustCompute(t, q)
		tr := transportOf(t, "window", r)
		if tr.StartInside != c.drawn || (markerByID(r, "weave/marked/start") != nil) != c.drawn {
			t.Fatalf("start %v beyond the window: drawn %v, inside %v; want %v", c.beyond, markerByID(r, "weave/marked/start") != nil, tr.StartInside, c.drawn)
		}
	}
}

// The fastest admitted flower (A = π/4, 8 petals) at 32 fibers and 256 arc
// samples, unrotated, mid-trace: the largest carried point's work, against
// the same study without it.
func BenchmarkTransportLargest(b *testing.B) {
	k := 8
	q := pairedRequest(math.Pi/4, 32, 0)
	q.Samples, q.Weave.Path, q.Weave.Amplitude, q.Weave.Petals, q.Weave.Trace = 256, "flower", math.Pi/4, &k, .5
	for _, carried := range []bool{false, true} {
		r := q
		if carried {
			r = withTransport(q, 0)
		}
		b.Run(fmt.Sprintf("carried=%v", carried), func(b *testing.B) {
			b.ReportAllocs()
			for range b.N {
				if _, err := Compute(r); err != nil {
					b.Fatal(err)
				}
			}
		})
	}
}
