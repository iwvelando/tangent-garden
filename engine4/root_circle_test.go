package engine4

import (
	"errors"
	"math"
	"math/cmplx"
	"testing"
)

// Translated source circles: z(t) = r e^{iφ}(k + e^{it}), a circle of
// radius r about c = k r e^{iφ}. Every check reads returned geometry and
// compares it with elementary complex arithmetic from math/cmplx, never
// the engine's lift.

func circleRequest(r, k, phi float64, sheet string, n int, from, to, trace float64) Request {
	q := rootRequest(r, sheet, n, from, to, trace)
	q.Root.Offset, q.Root.Direction = k, phi
	return q
}

type circleCase struct {
	r, k, phi float64
	sheet     string
	n         int
}

// Enclosing and missing circles, near both sides of the refused band,
// crossing the principal cut or not, at the smallest and largest counts.
var circleCases = []circleCase{
	{1.6, 0.6, 0.4, "plus", 1024},
	{0.25, 0.95, -2.2, "minus", 64},
	{4, 1.05, 3, "plus", 513},
	{2.3, 1.6, 2.6, "minus", 256},
	{1, 3, -2 * math.Pi, "plus", 4096},
	{0.7, 0.3, 2 * math.Pi, "minus", 100},
}

func (c circleCase) center() complex128 {
	return complex(c.k*c.r, 0) * cmplx.Exp(complex(0, c.phi))
}

func (c circleCase) winding() int {
	if c.k < 1 {
		return 1
	}
	return 0
}

func zw(s Vec4) (complex128, complex128) { return complex(s[0], s[1]), complex(s[2], s[3]) }

func (c circleCase) compute(t *testing.T, from, to, p float64) Result {
	t.Helper()
	return rootCompute(t, circleRequest(c.r, c.k, c.phi, c.sheet, c.n, from, to, p))
}

// Every returned source point satisfies w² = z, lies on its circle, and so
// w lies on the Cassini oval |w − √c||w + √c| = r.
func TestRootCircleRelationCircleAndCassiniOval(t *testing.T) {
	for _, c := range circleCases {
		q := circleRequest(c.r, c.k, c.phi, c.sheet, c.n, 0, 4*math.Pi, 0.37)
		res := rootCompute(t, q)
		center, scale := c.center(), c.r*(1+c.k)
		root := cmplx.Sqrt(center)
		seen := 0
		for _, path := range res.Paths {
			if path.Guide {
				continue
			}
			for i, s := range path.FourPoints {
				z, w := zw(s)
				if d := cmplx.Abs(w*w - z); d > 1e-13*scale {
					t.Fatalf("%+v %s[%d]: |w² − z| = %v", c, path.Source, i, d)
				}
				if d := math.Abs(cmplx.Abs(z-center) - c.r); d > 1e-13*scale {
					t.Fatalf("%+v %s[%d]: |z − c| = %v, want r", c, path.Source, i, cmplx.Abs(z-center))
				}
				if d := math.Abs(cmplx.Abs(w-root)*cmplx.Abs(w+root) - c.r); d > 1e-12*scale {
					t.Fatalf("%+v %s[%d]: off the Cassini oval by %v", c, path.Source, i, d)
				}
				want := dropAfterRotation(s, q.Angles)
				if d := math.Sqrt(dot(sub(path.Points[i], want), sub(path.Points[i], want))); d > 1e-13*res.Radius {
					t.Fatalf("%s[%d]: projected %v, want rotate-then-drop %v", path.Source, i, path.Points[i], want)
				}
				if n := norm4(s); n > res.Radius*(1+1e-13) {
					t.Fatalf("%s[%d]: |q| = %v exceeds the framing radius %v", path.Source, i, n, res.Radius)
				}
				seen++
			}
		}
		if seen < c.n {
			t.Fatalf("%+v: only %d source points", c, seen)
		}
		if res.Root.Residual > 1e-13*scale {
			t.Fatalf("%+v: residual readout %v", c, res.Root.Residual)
		}
		// The framing radius is the norm bound √(R² + R), R = r(1 + k).
		if want := math.Sqrt(scale*scale + scale); math.Abs(res.Radius-want) > 1e-15*want || res.Root.NormBound != res.Radius {
			t.Fatalf("%+v: framing %v, want %v", c, res.Radius, want)
		}
	}
}

// The winding of z about the branch point, summed from the returned
// circuit's own points, is 1 inside and 0 outside; after one circuit w
// is −w(0) when z winds and w(0) when it does not, and after two it is
// home either way. The start is the named root of z(0).
func TestRootCircleWindingAndClosure(t *testing.T) {
	for _, c := range circleCases {
		res := c.compute(t, 0, 4*math.Pi, 0)
		one, two := rootPath(t, res, "root/lifted/circuit/1"), rootPath(t, res, "root/lifted/circuit/2")
		turn := 0.
		for i := 1; i < len(one.FourPoints); i++ {
			a, _ := zw(one.FourPoints[i-1])
			b, _ := zw(one.FourPoints[i])
			turn += cmplx.Phase(b / a)
		}
		if got := turn / (2 * math.Pi); math.Abs(got-float64(c.winding())) > 1e-9 {
			t.Fatalf("%+v: z winds %v times about 0, want %d", c, got, c.winding())
		}
		if res.Root.Winding != c.winding() {
			t.Fatalf("%+v: winding readout %d", c, res.Root.Winding)
		}
		z0, w0 := zw(one.FourPoints[0])
		want := cmplx.Sqrt(z0)
		if c.sheet == "minus" {
			want = -want
		}
		scale := c.r * (1 + c.k)
		if cmplx.Abs(w0-want) > 1e-14*scale {
			t.Fatalf("%+v: w(0) = %v, want %v", c, w0, want)
		}
		if cmplx.Abs(z0-(c.center()+complex(c.r, 0)*cmplx.Exp(complex(0, c.phi)))) > 1e-14*scale {
			t.Fatalf("%+v: z(0) = %v, want c + r e^{iφ}", c, z0)
		}
		_, half := zw(one.FourPoints[len(one.FourPoints)-1])
		_, end := zw(two.FourPoints[len(two.FourPoints)-1])
		sign := complex(1, 0)
		if c.winding() == 1 {
			sign = -1
		}
		if cmplx.Abs(half-sign*w0) > 1e-13*scale {
			t.Fatalf("%+v: after one circuit w = %v, want %v", c, half, sign*w0)
		}
		if cmplx.Abs(end-w0) > 1e-13*scale {
			t.Fatalf("%+v: after two circuits w = %v, want %v", c, end, w0)
		}
		// A missing circle keeps w on the one oval about ±√c it starts on;
		// the other sheet's oval is never visited.
		if c.winding() == 0 {
			root := cmplx.Sqrt(c.center())
			side := real(w0 * cmplx.Conj(root))
			for _, path := range []Path{one, two} {
				for _, s := range path.FourPoints {
					_, w := zw(s)
					if real(w*cmplx.Conj(root))*side <= 0 {
						t.Fatalf("%+v: w = %v left the oval it started on", c, w)
					}
				}
			}
		}
		if want := c.r * math.Abs(1-c.k); math.Abs(res.Root.Closest-want) > 1e-15*scale {
			t.Fatalf("%+v: closest |z| readout %v, want r|1 − k| = %v", c, res.Root.Closest, want)
		}
	}
}

// Successive points are no farther apart than the arc between them, with
// |dq/dt|² = r² + r²/(4|z|) ≤ r² + r²/(4δ); and near the branch point w
// turns about 0 by at most h/2 per segment, as in the origin study.
func TestRootCircleIsContinuousAndResolvedNearTheBranchPoint(t *testing.T) {
	for _, c := range circleCases {
		res := c.compute(t, 0, 4*math.Pi, 0.6)
		delta := c.r * math.Abs(1-c.k)
		speed := math.Sqrt(c.r*c.r + c.r*c.r/(4*delta))
		h := 4 * math.Pi / float64(c.n)
		for _, path := range res.Paths {
			if path.Guide {
				continue
			}
			for i := 1; i < len(path.FourPoints); i++ {
				a, b := path.FourPoints[i-1], path.FourPoints[i]
				dt := path.Parameters[i] - path.Parameters[i-1]
				if dt <= 0 {
					t.Fatalf("%s: parameters must increase", path.Source)
				}
				var d Vec4
				for k := range d {
					d[k] = b[k] - a[k]
				}
				if norm4(d) > speed*dt*(1+1e-9)+1e-14 {
					t.Fatalf("%+v %s: jump %v over Δt = %v", c, path.Source, norm4(d), dt)
				}
				_, wa := zw(a)
				_, wb := zw(b)
				if turn := math.Abs(cmplx.Phase(wb / wa)); turn > h/2*(1+1e-9) {
					t.Fatalf("%+v %s: w turns %v about 0 between t = %v and %v, more than h/2 = %v",
						c, path.Source, turn, path.Parameters[i-1], path.Parameters[i], h/2)
				}
			}
		}
		if res.Root.Intervals != c.n || res.Root.Refined < c.n {
			t.Fatalf("%+v: intervals %d, refined %d", c, res.Root.Intervals, res.Root.Refined)
		}
	}
	// Near the band, the coarsest count needs refinement; a circle that keeps
	// |z| ≥ r, as the origin circle does, needs none.
	near := rootCompute(t, circleRequest(1, 0.95, 0, "plus", 64, 0, 4*math.Pi, 0))
	far := rootCompute(t, circleRequest(1, 3, 0, "plus", 64, 0, 4*math.Pi, 0))
	if near.Root.Refined <= 64 || far.Root.Refined != 64 {
		t.Fatalf("refined intervals: near %d, far %d", near.Root.Refined, far.Root.Refined)
	}
}

// Direction turns the whole source rigidly: z by e^{iφ}, and w by ±e^{iφ/2}.
func TestRootCircleDirectionTurnsTheSourceRigidly(t *testing.T) {
	for _, k := range []float64{0, 0.6, 1.6} {
		base := rootCompute(t, circleRequest(1.3, k, 0, "plus", 256, 0, 4*math.Pi, 0))
		for _, phi := range []float64{0.9, -2.5, 2 * math.Pi} {
			turned := rootCompute(t, circleRequest(1.3, k, phi, "plus", 256, 0, 4*math.Pi, 0))
			a, b := rootPath(t, base, "root/lifted/circuit/1"), rootPath(t, turned, "root/lifted/circuit/1")
			if len(a.FourPoints) != len(b.FourPoints) {
				t.Fatalf("k=%v φ=%v: %d points, want %d", k, phi, len(b.FourPoints), len(a.FourPoints))
			}
			rz, rw := cmplx.Exp(complex(0, phi)), cmplx.Exp(complex(0, phi/2))
			_, w0 := zw(a.FourPoints[0])
			_, v0 := zw(b.FourPoints[0])
			sign := complex(1, 0)
			if cmplx.Abs(v0+rw*w0) < cmplx.Abs(v0-rw*w0) {
				sign = -1
			}
			for i := range a.FourPoints {
				z, w := zw(a.FourPoints[i])
				y, v := zw(b.FourPoints[i])
				if cmplx.Abs(y-rz*z) > 1e-13*(1+k) || cmplx.Abs(v-sign*rw*w) > 1e-13*(1+k) {
					t.Fatalf("k=%v φ=%v [%d]: (%v, %v), want (%v, ±%v)", k, phi, i, y, v, rz*z, rw*w)
				}
			}
		}
	}
}

// A missing circle that crosses the negative real axis keeps w continuous
// while the principal label flips at each crossing, in either direction
// of travel; the label always names the root w actually is.
func TestRootCirclePrincipalLabelAcrossTheCutInBothDirections(t *testing.T) {
	c := circleCase{2.3, 1.6, 2.6, "minus", 256}
	for _, reversed := range []bool{false, true} {
		from, to := 0., 4*math.Pi
		if reversed {
			from, to = to, from
		}
		flips, last := 0, 0
		for i := 0; i <= 400; i++ {
			res := c.compute(t, from, to, float64(i)/400)
			z, w := complex(res.Root.Z[0], res.Root.Z[1]), complex(res.Root.W[0], res.Root.W[1])
			want := 1
			if real(w*cmplx.Conj(cmplx.Sqrt(z))) < 0 {
				want = -1
			}
			if res.Root.Principal != want {
				t.Fatalf("reversed=%v t=%v: label %d, but w = %d·√z", reversed, res.Root.Parameter, res.Root.Principal, want)
			}
			if last != 0 && want != last {
				flips++
			}
			last = want
		}
		// Two crossings per circuit, two circuits.
		if flips != 4 {
			t.Fatalf("reversed=%v: the label flipped %d times, want 4", reversed, flips)
		}
	}
}

// The journey of either winding reaches its entered endpoints exactly on a
// refined grid; the trace is one circuit ending at the moving point; and
// a whole journey's last drawing is its first.
func TestRootCircleEndpointsTraceAndWholeJourney(t *testing.T) {
	for _, c := range circleCases {
		for _, ends := range [][2]float64{{0, 4 * math.Pi}, {4 * math.Pi, 0}, {0.3, 10.0 / 3}, {11.9, 0.7}} {
			first, last := c.compute(t, ends[0], ends[1], 0), c.compute(t, ends[0], ends[1], 1)
			if first.Root.Parameter != ends[0] || last.Root.Parameter != ends[1] {
				t.Fatalf("%+v %v: t = %v to %v", c, ends, first.Root.Parameter, last.Root.Parameter)
			}
			for _, res := range []Result{first, last, c.compute(t, ends[0], ends[1], 0.413)} {
				length, touches := 0., false
				now := rootMarker(t, res, "root/lifted/current").FourPoint
				for _, path := range res.Paths {
					if path.Role != "trace" {
						continue
					}
					length += path.Parameters[len(path.Parameters)-1] - path.Parameters[0]
					for _, end := range []Vec4{path.FourPoints[0], path.FourPoints[len(path.FourPoints)-1]} {
						var e Vec4
						for k := range e {
							e[k] = end[k] - now[k]
						}
						if norm4(e) < 1e-12*c.r*(1+c.k) {
							touches = true
						}
					}
				}
				if math.Abs(length-2*math.Pi) > 1e-12 || !touches {
					t.Fatalf("%+v %v: trace covers %v and touches the point: %v", c, ends, length, touches)
				}
			}
			if math.Abs(ends[1]-ends[0]) == 4*math.Pi && (!sameDrawing(first, last) || !sameDrawing(*first.Companion, *last.Companion)) {
				t.Fatalf("%+v: a whole journey ends on its first drawing", c)
			}
		}
		// For a missing circle one circuit returns z and w, but not the
		// trace's circuit, so the scene does not close at 2π.
		if c.winding() == 0 {
			a, b := c.compute(t, 0, 2*math.Pi, 0), c.compute(t, 0, 2*math.Pi, 1)
			if rootMarker(t, a, "root/lifted/current").FourPoint == (Vec4{}) || sameDrawing(a, b) {
				t.Fatalf("%+v: a 2π journey must not close the whole scene", c)
			}
		}
	}
}

// The diagram centers the planes by the larger of max |z| and max |w|.
func TestRootCircleDiagramFraming(t *testing.T) {
	c := circleCase{2.3, 1.6, 2.6, "minus", 256}
	res := c.compute(t, 0, 4*math.Pi, 0)
	big := c.r * (1 + c.k)
	if want := 1.25 * math.Max(big, math.Sqrt(big)); res.Root.Center != want || res.Companion.Radius != 1.5*math.Max(big, math.Sqrt(big)) {
		t.Fatalf("plane offset %v, diagram radius %v", res.Root.Center, res.Companion.Radius)
	}
	d, offset := *res.Companion, res.Root.Center
	source := rootPath(t, d, "root/source/circuit/1")
	lifted := rootPath(t, res, "root/lifted/circuit/1")
	for i, q := range lifted.FourPoints {
		if math.Abs(source.Points[i][0]+offset-q[0]) > 1e-13*offset || source.Points[i][1] != q[1] {
			t.Fatalf("source plane %v, want z = (%v, %v)", source.Points[i], q[0], q[1])
		}
	}
}

func TestRootCircleRefusesByField(t *testing.T) {
	for _, c := range []struct {
		k, phi float64
		field  string
	}{
		{0.951, 0, "root.offset"}, {1.049, 0, "root.offset"}, {1, 0, "root.offset"},
		{-0.01, 0, "root.offset"}, {3.01, 0, "root.offset"}, {math.NaN(), 0, "root.offset"},
		{0.5, 2*math.Pi + 0.01, "root.direction"}, {0.5, -2*math.Pi - 0.01, "root.direction"},
		{0.5, math.Inf(1), "root.direction"},
	} {
		_, err := Compute(circleRequest(1, c.k, c.phi, "plus", 256, 0, 4*math.Pi, 0))
		var fe *FieldError
		if !errors.As(err, &fe) || fe.Field != c.field {
			t.Fatalf("k=%v φ=%v: want a %s error, got %v", c.k, c.phi, c.field, err)
		}
	}
	for _, k := range []float64{0, 0.95, 1.05, 3} {
		for _, phi := range []float64{-2 * math.Pi, 0, 2 * math.Pi} {
			if _, err := Compute(circleRequest(1, k, phi, "plus", 256, 0, 4*math.Pi, 0)); err != nil {
				t.Fatalf("k=%v φ=%v is admitted: %v", k, phi, err)
			}
		}
	}
}

// Refinement is counted before evaluation; at the band's edges and the
// largest count, all three views fit the point budget and match the count.
func TestRootCircleBudget(t *testing.T) {
	for _, k := range []float64{0.95, 1.05} {
		for _, r := range []float64{0.25, 4} {
			res := rootCompute(t, circleRequest(r, k, 1, "plus", 4096, 0, 4*math.Pi, 0.3))
			counted := len(res.Markers) + len(res.Companion.Markers)
			for _, v := range []Result{res, *res.Companion} {
				for _, path := range v.Paths {
					counted += len(path.Points)
				}
			}
			if res.EmittedPoints != counted || counted > maxPoints {
				t.Fatalf("k=%v r=%v: emitted %d, counted %d, budget %d", k, r, res.EmittedPoints, counted, maxPoints)
			}
			if res.Root.Refined <= 4096 {
				t.Fatalf("k=%v: refined %d", k, res.Root.Refined)
			}
		}
	}
}

// Over a missing circle, w² = z has two disjoint loops, one per sheet, and
// the journey visits one; the other, (z, −w), is drawn as a quiet guide in
// the w plane and the 4D view. Over an enclosing circle the two sheets are
// one loop, already drawn, so no guide is added.
func TestRootCircleDrawsTheUnvisitedSheetOnlyWhenItIsSeparate(t *testing.T) {
	for _, c := range circleCases {
		q := circleRequest(c.r, c.k, c.phi, c.sheet, c.n, 0, 4*math.Pi, 0.2)
		res := rootCompute(t, q)
		var lifted, value *Path
		for i := range res.Paths {
			if res.Paths[i].Source == "root/lifted/other-sheet" {
				lifted = &res.Paths[i]
			}
		}
		for i := range res.Companion.Paths {
			if res.Companion.Paths[i].Source == "root/value/other-sheet" {
				value = &res.Companion.Paths[i]
			}
			if res.Companion.Paths[i].Source == "root/source/other-sheet" {
				t.Fatal("the z plane has one circle for both sheets")
			}
		}
		if c.winding() == 1 {
			if lifted != nil || value != nil {
				t.Fatalf("%+v: an enclosing circle's sheets are one loop; no separate guide", c)
			}
			continue
		}
		if lifted == nil || value == nil {
			t.Fatalf("%+v: the unvisited sheet's loop is drawn in the w plane and the 4D view", c)
		}
		if !lifted.Guide || !value.Guide || lifted.Role != "other-sheet" || value.Role != "other-sheet" || !value.Dashed {
			t.Fatalf("%+v: the unvisited loop is a dashed guide: %+v", c, value)
		}
		journey := rootPath(t, res, "root/lifted/circuit/1")
		_, w0 := zw(journey.FourPoints[0])
		root := cmplx.Sqrt(c.center())
		side := real(w0 * cmplx.Conj(root))
		scale := c.r * (1 + c.k)
		offset := res.Root.Center
		for i, s := range lifted.FourPoints {
			z, w := zw(s)
			if cmplx.Abs(w*w-z) > 1e-13*scale || math.Abs(cmplx.Abs(z-c.center())-c.r) > 1e-13*scale {
				t.Fatalf("%+v other[%d]: off the relation or the circle", c, i)
			}
			if real(w*cmplx.Conj(root))*side >= 0 {
				t.Fatalf("%+v other[%d]: w = %v is on the visited oval", c, i, w)
			}
			want := dropAfterRotation(s, q.Angles)
			if d := math.Sqrt(dot(sub(lifted.Points[i], want), sub(lifted.Points[i], want))); d > 1e-13*res.Radius {
				t.Fatalf("other[%d]: projected %v, want %v", i, lifted.Points[i], want)
			}
			v := value.Points[i]
			if math.Abs(v[0]-offset-s[2]) > 1e-13*offset || v[1] != s[3] || v[2] != 0 {
				t.Fatalf("other[%d]: w plane %v, want w = (%v, %v)", i, v, s[2], s[3])
			}
		}
		// A whole closed loop: both ends at t = 0 and 2π.
		first, last := lifted.FourPoints[0], lifted.FourPoints[len(lifted.FourPoints)-1]
		var e Vec4
		for k := range e {
			e[k] = last[k] - first[k]
		}
		if lifted.Parameters[0] != 0 || lifted.Parameters[len(lifted.Parameters)-1] != 2*math.Pi || norm4(e) > 1e-13*scale {
			t.Fatalf("%+v: the other sheet's loop spans one closed circuit", c)
		}
	}
}
