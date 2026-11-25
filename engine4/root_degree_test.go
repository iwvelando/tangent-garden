package engine4

import (
	"encoding/json"
	"errors"
	"fmt"
	"math"
	"math/cmplx"
	"testing"
)

// Roots of degree n: w is the continuously followed n-th root of z on the
// circle z(t) = r e^{iφ}(k + e^{it}), wⁿ = z, over n circuits,
// 0 ≤ t ≤ 2πn. Every check reads returned geometry and compares it with
// elementary complex arithmetic from math/cmplx, never the engine's lift.

type degreeCase struct {
	n         int
	r, k, phi float64
	sheet     string
	branch    int
	samples   int
}

// Every degree; the origin, enclosing and missing circles; near both sides
// of the refused band; crossing the principal cut or not; every sheet
// spelling; the smallest and largest counts, and odd ones.
var degreeCases = []degreeCase{
	{3, 1.6, 0, 0, "plus", 0, 1024},
	{3, 0.25, 0.95, -2.2, "plus", 2, 64},
	{4, 4, 1.05, 3, "minus", 1, 513},
	{4, 1, 0.6, 0.4, "plus", 3, 1000},
	{5, 1.2, 0.85, 0.6, "plus", 1, 4096},
	{5, 2.3, 1.6, 2.6, "plus", 4, 256},
	{6, 1, 3, -2 * math.Pi, "minus", 0, 4096},
	{6, 0.7, 0.3, 2 * math.Pi, "plus", 5, 100},
	{6, 1.4, 1.1, 2.8, "minus", 2, 777},
}

func degreeRequest(c degreeCase, from, to, trace float64) Request {
	q := circleRequest(c.r, c.k, c.phi, c.sheet, c.samples, from, to, trace)
	q.Root.Degree, q.Root.Branch = float64(c.n), float64(c.branch)
	return q
}

func (c degreeCase) period() float64 { return 2 * math.Pi * float64(c.n) }

func (c degreeCase) compute(t *testing.T, from, to, p float64) Result {
	t.Helper()
	return rootCompute(t, degreeRequest(c, from, to, p))
}

func (c degreeCase) winding() int {
	if c.k < 1 {
		return 1
	}
	return 0
}

// ω = e^{2πi/n} raised to m.
func omegaTo(n, m int) complex128 {
	return cmplx.Exp(complex(0, 2*math.Pi*float64(m)/float64(n)))
}

func power(w complex128, n int) complex128 {
	p := complex(1, 0)
	for i := 0; i < n; i++ {
		p *= w
	}
	return p
}

// The named root of z(0): σ ω^b times the principal n-th root, whose
// argument is Arg z / n with Arg z in (−π, π].
func (c degreeCase) start() (complex128, complex128) {
	z0 := complex(c.r*(1+c.k), 0) * cmplx.Exp(complex(0, c.phi))
	sigma := complex(1, 0)
	if c.sheet == "minus" {
		sigma = -1
	}
	return z0, sigma * omegaTo(c.n, c.branch) * cmplx.Pow(z0, complex(1/float64(c.n), 0))
}

// Every returned source point satisfies wⁿ = z, lies on its circle, and
// has |w| = |z|^{1/n}; the projection is rotate-then-drop, and every point
// lies within the framing radius √(R² + R^{2/n}), R = r(1 + k).
func TestRootDegreeRelationCircleAndFraming(t *testing.T) {
	for _, c := range degreeCases {
		q := degreeRequest(c, 0, c.period(), 0.37)
		res := rootCompute(t, q)
		center := complex(c.k*c.r, 0) * cmplx.Exp(complex(0, c.phi))
		big := c.r * (1 + c.k)
		seen := 0
		for _, path := range res.Paths {
			if path.Role == "axes" {
				continue
			}
			for i, s := range path.FourPoints {
				z, w := zw(s)
				if d := cmplx.Abs(power(w, c.n) - z); d > 1e-13*big {
					t.Fatalf("%+v %s[%d]: |wⁿ − z| = %v", c, path.Source, i, d)
				}
				if d := math.Abs(cmplx.Abs(z-center) - c.r); d > 1e-13*big {
					t.Fatalf("%+v %s[%d]: |z − c| = %v, want r", c, path.Source, i, cmplx.Abs(z-center))
				}
				if d := math.Abs(cmplx.Abs(w) - math.Pow(cmplx.Abs(z), 1/float64(c.n))); d > 1e-13*big {
					t.Fatalf("%+v %s[%d]: |w| differs from |z|^(1/n) by %v", c, path.Source, i, d)
				}
				want := dropAfterRotation(s, q.Angles)
				if d := math.Sqrt(dot(sub(path.Points[i], want), sub(path.Points[i], want))); d > 1e-13*res.Radius {
					t.Fatalf("%s[%d]: projected %v, want rotate-then-drop %v", path.Source, i, path.Points[i], want)
				}
				if v := norm4(s); v > res.Radius*(1+1e-13) {
					t.Fatalf("%s[%d]: |q| = %v exceeds the framing radius %v", path.Source, i, v, res.Radius)
				}
				seen++
			}
		}
		if seen < c.samples {
			t.Fatalf("%+v: only %d source points", c, seen)
		}
		if res.Root.Residual > 1e-13*big || res.Root.Residual == 0 && c.k != 0 {
			t.Fatalf("%+v: residual readout %v", c, res.Root.Residual)
		}
		want := math.Sqrt(big*big + math.Pow(big, 2/float64(c.n)))
		if math.Abs(res.Radius-want) > 1e-14*want || res.Root.NormBound != res.Radius {
			t.Fatalf("%+v: framing %v, want %v", c, res.Radius, want)
		}
		// The planes sit at ±1.25 max(R, R^{1/n}), one scale.
		if want := 1.25 * math.Max(big, math.Pow(big, 1/float64(c.n))); math.Abs(res.Root.Center-want) > 1e-14*want {
			t.Fatalf("%+v: plane center %v, want %v", c, res.Root.Center, want)
		}
	}
}

// w starts on the named root of z(0); each circuit multiplies it by ω when
// z winds about 0 and leaves it when it does not, so the n sheets are
// permuted by an n-cycle or not at all, and w is home after n circuits.
// Each circuit is its own path, ending exactly at 2πc.
func TestRootDegreeInitialSheetPermutationAndClosure(t *testing.T) {
	for _, c := range degreeCases {
		res := c.compute(t, 0, c.period(), 0)
		z0, w0 := c.start()
		first := rootPath(t, res, "root/lifted/circuit/1")
		z, w := zw(first.FourPoints[0])
		if cmplx.Abs(z-z0) > 1e-13*cmplx.Abs(z0) || cmplx.Abs(w-w0) > 1e-13*cmplx.Abs(w0) {
			t.Fatalf("%+v: starts at (%v, %v), want (%v, %v)", c, z, w, z0, w0)
		}
		for k := 1; k <= c.n; k++ {
			p := rootPath(t, res, fmt.Sprintf("root/lifted/circuit/%d", k))
			if p.Branch != fmt.Sprint(k) {
				t.Fatalf("%+v circuit %d: branch %q", c, k, p.Branch)
			}
			if a, b := p.Parameters[0], p.Parameters[len(p.Parameters)-1]; a != 2*math.Pi*float64(k-1) || b != 2*math.Pi*float64(k) {
				t.Fatalf("%+v circuit %d: parameters %v to %v", c, k, a, b)
			}
			// The winding of z about 0 over this circuit, from its own points.
			turn := 0.
			for i := 1; i < len(p.FourPoints); i++ {
				a, _ := zw(p.FourPoints[i-1])
				b, _ := zw(p.FourPoints[i])
				turn += cmplx.Phase(b / a)
			}
			if got := turn / (2 * math.Pi); math.Abs(got-float64(c.winding())) > 1e-9 {
				t.Fatalf("%+v circuit %d: z winds %v times, want %d", c, k, got, c.winding())
			}
			_, end := zw(p.FourPoints[len(p.FourPoints)-1])
			want := w0 * omegaTo(c.n, k*c.winding())
			if d := cmplx.Abs(end - want); d > 1e-12*cmplx.Abs(w0) {
				t.Fatalf("%+v: after %d circuits w = %v, want ω^%d w(0) = %v", c, k, end, k*c.winding(), want)
			}
			if k < c.n {
				_, next := zw(rootPath(t, res, fmt.Sprintf("root/lifted/circuit/%d", k+1)).FourPoints[0])
				if next != end {
					t.Fatalf("%+v: circuit %d ends at %v, circuit %d starts at %v", c, k, end, k+1, next)
				}
			}
		}
		for _, p := range res.Paths {
			if p.Source == fmt.Sprintf("root/lifted/circuit/%d", c.n+1) {
				t.Fatalf("%+v: a circuit beyond the degree", c)
			}
		}
		if res.Root.Winding != c.winding() {
			t.Fatalf("%+v: winding readout %d", c, res.Root.Winding)
		}
		// A partial journey of one circuit is not home when z winds: n ≥ 3
		// never brings w back after fewer than n circuits.
		if c.winding() == 1 {
			for k := 1; k < c.n; k++ {
				if cmplx.Abs(omegaTo(c.n, k)-1) < 0.5 {
					t.Fatalf("ω^%d = 1 for n = %d", k, c.n)
				}
			}
		}
	}
}

// Successive returned points never turn w by more than 2π/N about 0: the
// origin circle's turn per interval at every degree, kept near the branch
// point by refinement. Checked at the band's edges and the coarsest count.
func TestRootDegreeIsResolvedNearTheBranchPoint(t *testing.T) {
	for _, n := range []int{3, 4, 5, 6} {
		for _, k := range []float64{0, 0.95, 1.05, 2} {
			for _, samples := range []int{64, 4096} {
				c := degreeCase{n, 1.3, k, 0.9, "plus", n - 1, samples}
				res := c.compute(t, 0, c.period(), 0.43)
				limit := 2 * math.Pi / float64(samples) * (1 + 1e-9)
				for _, p := range res.Paths {
					if p.FourPoints == nil {
						continue
					}
					for i := 1; i < len(p.FourPoints); i++ {
						_, a := zw(p.FourPoints[i-1])
						_, b := zw(p.FourPoints[i])
						if d := math.Abs(cmplx.Phase(b / a)); d > limit {
							t.Fatalf("%+v %s[%d]: w turns %v, more than 2π/N = %v", c, p.Source, i, d, limit)
						}
					}
				}
				if k == 0 && res.Root.Refined != samples {
					t.Fatalf("%+v: the origin circle is never refined (%d)", c, res.Root.Refined)
				}
			}
		}
	}
}

// The moving point is at t = from + p (to − from), evaluated modulo 2πn;
// the start ring is at from; the trace is the one circuit behind the point
// in the direction of travel, in pieces that keep their circuit.
func TestRootDegreeTraceMarkersAndReverseTraversal(t *testing.T) {
	c := degreeCase{5, 1.2, 0.85, 0.6, "plus", 1, 1000}
	for _, e := range [][3]float64{{0, 10 * math.Pi, 0.37}, {10 * math.Pi, 0, 0.37}, {1, 9, 0.5}, {9.5 * math.Pi, 0.2, 0.9}, {0, 10 * math.Pi, 0.05}, {10 * math.Pi, 0, 0.1}, {9.5 * math.Pi, 1, 0.05}} {
		from, to, p := e[0], e[1], e[2]
		res := c.compute(t, from, to, p)
		now := from*(1-p) + to*p
		if res.Root.Parameter != now {
			t.Fatalf("%v: parameter %v, want %v", e, res.Root.Parameter, now)
		}
		want := func(s float64) (complex128, complex128) {
			s = math.Mod(s, c.period())
			z := complex(c.r, 0) * cmplx.Exp(complex(0, c.phi)) * (complex(c.k, 0) + cmplx.Exp(complex(0, s)))
			_, w0 := c.start()
			// Follow w from w(0) by small steps, an independent continuation.
			w := w0
			steps := 20000
			for i := 1; i <= steps; i++ {
				u := s * float64(i) / float64(steps)
				zu := complex(c.r, 0) * cmplx.Exp(complex(0, c.phi)) * (complex(c.k, 0) + cmplx.Exp(complex(0, u)))
				var best complex128
				for m := 0; m < c.n; m++ {
					cand := cmplx.Pow(zu, complex(1/float64(c.n), 0)) * omegaTo(c.n, m)
					if m == 0 || cmplx.Abs(cand-w) < cmplx.Abs(best-w) {
						best = cand
					}
				}
				w = best
			}
			return z, w
		}
		zc, wc := want(now)
		cur := rootMarker(t, res, "root/lifted/current")
		gz, gw := zw(cur.FourPoint)
		if cmplx.Abs(gz-zc) > 1e-12 || cmplx.Abs(gw-wc) > 1e-9 {
			t.Fatalf("%v: current (%v, %v), want (%v, %v)", e, gz, gw, zc, wc)
		}
		if circuit := int(math.Mod(now, c.period())/(2*math.Pi)) + 1; res.Root.Circuit != circuit {
			t.Fatalf("%v: circuit %d, want %d", e, res.Root.Circuit, circuit)
		}
		zs, _ := want(from)
		if sz, _ := zw(rootMarker(t, res, "root/lifted/start").FourPoint); cmplx.Abs(sz-zs) > 1e-12 {
			t.Fatalf("%v: start ring at %v, want %v", e, sz, zs)
		}
		total, touches := 0., false
		for _, path := range res.Paths {
			if path.Role != "trace" {
				continue
			}
			a, b := path.Parameters[0], path.Parameters[len(path.Parameters)-1]
			total += b - a
			k := int(math.Floor(a/(2*math.Pi)+1e-9)) + 1
			if path.Branch != fmt.Sprint(k) || b > 2*math.Pi*float64(k)+1e-12 {
				t.Fatalf("%v: trace piece %v–%v in branch %s", e, a, b, path.Branch)
			}
			s := math.Mod(now, c.period())
			if a == s || b == s {
				touches = true
			}
		}
		if math.Abs(total-2*math.Pi) > 1e-9 || !touches {
			t.Fatalf("%v: trace covers %v and touches the point: %v", e, total, touches)
		}
	}
	// A whole journey ends on the drawing it starts with.
	if a, b := c.compute(t, 0, c.period(), 0), c.compute(t, 0, c.period(), 1); !sameDrawing(a, b) {
		t.Fatal("t = 2πn does not draw t = 0")
	}
}

// Over a missing circle w keeps to one of n separate loops, about one n-th
// root of c; the other n − 1 sheets' loops (z, ω^m w) are dashed guides,
// each closed over one circuit. Over an enclosing circle the circuits
// visit every sheet, so none is drawn. At n = 2 the guide keeps its ID.
func TestRootDegreeDrawsTheUnvisitedSheets(t *testing.T) {
	for _, c := range degreeCases {
		res := c.compute(t, 0, c.period(), 0)
		visited := rootPath(t, res, "root/lifted/circuit/1")
		guides := 0
		for _, p := range res.Paths {
			if p.Role == "other-sheet" {
				guides++
			}
		}
		for _, p := range res.Companion.Paths {
			if p.Role == "other-sheet" {
				guides++
			}
		}
		if c.winding() == 1 {
			if guides != 0 {
				t.Fatalf("%+v: %d other-sheet guides over an enclosing circle", c, guides)
			}
			continue
		}
		if guides != 2*(c.n-1) {
			t.Fatalf("%+v: %d other-sheet guides, want %d", c, guides, 2*(c.n-1))
		}
		for m := 1; m < c.n; m++ {
			p := rootPath(t, res, fmt.Sprintf("root/lifted/other-sheet/%d", m))
			if !p.Guide || !p.Dashed || len(p.FourPoints) != len(visited.FourPoints) {
				t.Fatalf("%+v other sheet %d: guide %v dashed %v, %d points", c, m, p.Guide, p.Dashed, len(p.FourPoints))
			}
			for i, s := range p.FourPoints {
				z, w := zw(s)
				vz, vw := zw(visited.FourPoints[i])
				if z != vz || cmplx.Abs(w-omegaTo(c.n, m)*vw) > 1e-13*cmplx.Abs(vw) {
					t.Fatalf("%+v other sheet %d[%d]: (%v, %v), want (z, ω^m w)", c, m, i, z, w)
				}
			}
			if a, b := p.FourPoints[0], p.FourPoints[len(p.FourPoints)-1]; norm4(Vec4{a[0] - b[0], a[1] - b[1], a[2] - b[2], a[3] - b[3]}) > 1e-12 {
				t.Fatalf("%+v other sheet %d is not closed", c, m)
			}
		}
	}
	// The square root keeps its single guide's ID.
	res := rootCompute(t, circleRequest(1.2, 1.1, 2.8, "plus", 512, 0, 4*math.Pi, 0))
	rootPath(t, res, "root/lifted/other-sheet")
	rootPath(t, *res.Companion, "root/value/other-sheet")
}

// The readout names w as ω^m times the principal n-th root of z, a label
// that changes where z crosses the principal cut, and the degree.
func TestRootDegreeDiagnostics(t *testing.T) {
	for _, c := range degreeCases {
		for _, p := range []float64{0, 0.13, 0.5, 0.77, 1} {
			res := c.compute(t, 0, c.period(), p)
			d := res.Root
			if d.Degree != c.n {
				t.Fatalf("%+v: degree %d", c, d.Degree)
			}
			z, w := d.Z, d.W
			zc, wc := complex(z[0], z[1]), complex(w[0], w[1])
			principal := cmplx.Pow(zc, complex(1/float64(c.n), 0))
			m := -1
			for j := 0; j < c.n; j++ {
				if cmplx.Abs(wc-omegaTo(c.n, j)*principal) < 1e-9*cmplx.Abs(principal) {
					m = j
				}
			}
			if m < 0 || d.Index != m || (d.Principal == 1) != (m == 0) {
				t.Fatalf("%+v at %v: index %d principal %d, want %d", c, p, d.Index, d.Principal, m)
			}
			if d.Closest != c.r*math.Abs(1-c.k) {
				t.Fatalf("%+v: closest %v", c, d.Closest)
			}
		}
	}
	// The square root's diagnostics carry neither: its results are as before.
	res := rootCompute(t, rootRequest(1.6, "minus", 1024, 0, 4*math.Pi, 0.6))
	b, err := json.Marshal(res.Root)
	if err != nil {
		t.Fatal(err)
	}
	var fields map[string]any
	if err := json.Unmarshal(b, &fields); err != nil {
		t.Fatal(err)
	}
	if _, ok := fields["degree"]; ok {
		t.Fatalf("a square root reports its degree: %s", b)
	}
	if _, ok := fields["index"]; ok {
		t.Fatalf("a square root reports an index: %s", b)
	}
}

// Degree 2, given or absent, draws exactly what the square root drew.
func TestRootDegreeTwoIsTheSquareRoot(t *testing.T) {
	for _, c := range circleCases {
		q := circleRequest(c.r, c.k, c.phi, c.sheet, c.n, 0.4, 4*math.Pi, 0.71)
		a, err := Compute(q)
		if err != nil {
			t.Fatal(err)
		}
		q.Root.Degree = 2
		b, err := Compute(q)
		if err != nil {
			t.Fatal(err)
		}
		x, _ := json.Marshal(a)
		y, _ := json.Marshal(b)
		if string(x) != string(y) {
			t.Fatalf("%+v: degree 2 differs from the absent degree", c)
		}
		// A turn of one half names the other square root: −√z(0) as a turn
		// of +√z(0), and +√z(0) as one of −√z(0).
		other := map[string]string{"plus": "minus", "minus": "plus"}[c.sheet]
		q.Root.Branch = 1
		turned, err := Compute(q)
		if err != nil {
			t.Fatal(err)
		}
		q.Root.Branch, q.Root.Sheet = 0, other
		named, err := Compute(q)
		if err != nil {
			t.Fatal(err)
		}
		x, _ = json.Marshal(turned)
		y, _ = json.Marshal(named)
		if string(x) != string(y) {
			t.Fatalf("%+v: a half turn of %s differs from %s", c, c.sheet, other)
		}
	}
}

func TestRootDegreeRefusesByField(t *testing.T) {
	base := degreeCase{3, 1, 0.5, 0, "plus", 0, 256}
	for _, tc := range []struct {
		edit  func(*RootParameters)
		field string
	}{
		{func(p *RootParameters) { p.Degree = 1 }, "root.degree"},
		{func(p *RootParameters) { p.Degree = 7 }, "root.degree"},
		{func(p *RootParameters) { p.Degree = 2.5 }, "root.degree"},
		{func(p *RootParameters) { p.Degree = math.NaN() }, "root.degree"},
		{func(p *RootParameters) { p.Branch = -1 }, "root.branch"},
		{func(p *RootParameters) { p.Branch = 3 }, "root.branch"},
		{func(p *RootParameters) { p.Branch = 1.5 }, "root.branch"},
		{func(p *RootParameters) { p.Branch = math.Inf(1) }, "root.branch"},
		{func(p *RootParameters) { p.Sheet = "minus" }, "root.sheet"},
		{func(p *RootParameters) { p.To = 6*math.Pi + 1e-9 }, "root.to"},
		{func(p *RootParameters) { p.From = -1e-9 }, "root.from"},
		{func(p *RootParameters) { p.Degree, p.Branch = 2, 2 }, "root.branch"},
	} {
		q := degreeRequest(base, 0, base.period(), 0)
		tc.edit(q.Root)
		_, err := Compute(q)
		var fe *FieldError
		if !errors.As(err, &fe) || fe.Field != tc.field {
			t.Fatalf("%+v: error %v, want a field error on %s", *q.Root, err, tc.field)
		}
	}
	// Admitted: a start and end beyond 4π at degree 3, the minus sheet at
	// even degree, and ends rounded within 10⁻¹² of 2πn.
	for _, edit := range []func(*RootParameters){
		func(p *RootParameters) { p.From, p.To = 5*math.Pi, 6*math.Pi },
		func(p *RootParameters) { p.Degree, p.Sheet, p.Branch = 4, "minus", 3 },
		func(p *RootParameters) { p.To = 2 * math.Pi * 3 * (1 + 2e-16) },
	} {
		q := degreeRequest(base, 0, base.period(), 0)
		edit(q.Root)
		if _, err := Compute(q); err != nil {
			t.Fatalf("%+v refused: %v", *q.Root, err)
		}
	}
}

// Every admitted journey fits the point budget, counted exactly before
// evaluation: the largest are at the band's edges and the largest count.
func TestRootDegreeBudget(t *testing.T) {
	largest := 0
	for _, n := range []int{2, 3, 4, 5, 6} {
		for _, k := range []float64{0, 0.95, 1.05} {
			for _, phi := range []float64{0, 1, math.Pi} {
				c := degreeCase{n, 4, k, phi, "plus", 0, 4096}
				res := c.compute(t, 0, c.period(), 0.5)
				if res.EmittedPoints > maxPoints {
					t.Fatalf("%+v: %d points", c, res.EmittedPoints)
				}
				largest = max(largest, res.EmittedPoints)
			}
		}
	}
	t.Logf("largest journey: %d points", largest)
}
