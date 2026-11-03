package engine4

import (
	"errors"
	"math"
	"strings"
	"testing"
)

// The square-root journey: z = r e^{it}, w = σ√r e^{it/2}, 0 ≤ t ≤ 4π.
// Every check reads the returned geometry: the 4D view's source points,
// the flat diagram's plane coordinates and the markers. The expected
// values are elementary complex arithmetic, never the engine's sampler.

func rootRequest(r float64, sheet string, n int, from, to, trace float64) Request {
	return Request{Object: "root", Mode: "paired", Samples: n,
		Angles: [6]float64{0.2, 0.35, 0.1, 0.6, 0.45, 0.3},
		Root:   &RootParameters{Radius: r, Sheet: sheet, From: from, To: to, Trace: trace}}
}

func rootCompute(t *testing.T, q Request) Result {
	t.Helper()
	r, err := Compute(q)
	if err != nil {
		t.Fatal(err)
	}
	if r.Companion == nil || r.Root == nil {
		t.Fatal("a square-root journey returns its flat diagram and diagnostics")
	}
	return r
}

// (a+ib)² as a pair.
func square(a, b float64) (float64, float64) { return a*a - b*b, 2 * a * b }

func rootPath(t *testing.T, r Result, source string) Path {
	t.Helper()
	for _, p := range r.Paths {
		if p.Source == source {
			return p
		}
	}
	t.Fatalf("no path %s", source)
	return Path{}
}

func rootMarker(t *testing.T, r Result, id string) Marker {
	t.Helper()
	for _, m := range r.Markers {
		if m.ID == id {
			return m
		}
	}
	t.Fatalf("no marker %s", id)
	return Marker{}
}

// The projection, observed independently: coordinate i of R q is
// (R⁻¹ eᵢ) · q, with R⁻¹ from the inverse-rotation helper.
func dropAfterRotation(q Vec4, angles [6]float64) Vec3 {
	var out Vec3
	for i := 0; i < 3; i++ {
		var e Vec4
		e[i] = 1
		c := undoRotation(e, angles)
		out[i] = c[0]*q[0] + c[1]*q[1] + c[2]*q[2] + c[3]*q[3]
	}
	return out
}

var rootCases = []struct {
	r     float64
	sheet string
	n     int
}{
	{0.25, "plus", 64}, {1, "minus", 513}, {2.3, "plus", 1000}, {4, "minus", 4096},
}

func TestRootSourceObeysRelationNormAndProjection(t *testing.T) {
	for _, c := range rootCases {
		for _, p := range []float64{0, 0.137, 0.5, 0.75, 1} {
			q := rootRequest(c.r, c.sheet, c.n, 0, 4*math.Pi, p)
			res := rootCompute(t, q)
			bound := math.Sqrt(c.r*c.r + c.r)
			if math.Abs(res.Radius-bound) > 1e-15*bound {
				t.Fatalf("framing radius %v, want the norm √(r²+r) = %v", res.Radius, bound)
			}
			paths := 0
			for _, path := range res.Paths {
				if path.Guide {
					continue
				}
				paths++
				if len(path.FourPoints) != len(path.Points) || len(path.Parameters) != len(path.Points) {
					t.Fatalf("%s: every drawn 4D point carries its source and parameter", path.Source)
				}
				for i, s := range path.FourPoints {
					a, b := square(s[2], s[3])
					if d := math.Hypot(a-s[0], b-s[1]); d > 1e-13*c.r {
						t.Fatalf("r=%v %s[%d]: |w² − z| = %v", c.r, path.Source, i, d)
					}
					if d := math.Abs(norm4(s) - bound); d > 1e-13*bound {
						t.Fatalf("%s[%d]: |q| = %v, want %v", path.Source, i, norm4(s), bound)
					}
					want := dropAfterRotation(s, q.Angles)
					got := path.Points[i]
					if d := math.Sqrt(dot(sub(got, want), sub(got, want))); d > 1e-13*bound {
						t.Fatalf("%s[%d]: projected %v, want rotate-then-drop %v", path.Source, i, got, want)
					}
					if norm := math.Sqrt(dot(got, got)); norm > res.Radius*(1+1e-13) {
						t.Fatalf("%s[%d]: |P| = %v exceeds the framing bound %v", path.Source, i, norm, res.Radius)
					}
				}
			}
			if paths < 3 {
				t.Fatalf("expected two circuits and a trace, got %d paths", paths)
			}
		}
	}
}

// Successive returned points are no farther apart than the arc between
// their parameters, |dq/dt| = √(r² + r/4): no false break anywhere,
// including where z crosses the negative real axis at t = π and 3π.
func TestRootPathIsContinuousAcrossThePrincipalCut(t *testing.T) {
	for _, c := range rootCases {
		res := rootCompute(t, rootRequest(c.r, c.sheet, c.n, 0, 4*math.Pi, 0.3))
		speed := math.Sqrt(c.r*c.r + c.r/4)
		crossed := 0
		for _, path := range res.Paths {
			if path.Guide {
				continue
			}
			for i := 1; i < len(path.FourPoints); i++ {
				a, b := path.FourPoints[i-1], path.FourPoints[i]
				dt := path.Parameters[i] - path.Parameters[i-1]
				if dt <= 0 {
					t.Fatalf("%s: parameters must increase, %v then %v", path.Source, path.Parameters[i-1], path.Parameters[i])
				}
				var d Vec4
				for k := range d {
					d[k] = b[k] - a[k]
				}
				if norm4(d) > speed*dt*(1+1e-9)+1e-14 {
					t.Fatalf("%s: jump %v over Δt = %v at t = %v", path.Source, norm4(d), dt, path.Parameters[i])
				}
				// z crosses the negative real axis: Im z changes sign with Re z < 0.
				if a[0] < 0 && (a[1] > 0) != (b[1] > 0) {
					crossed++
				}
			}
		}
		if crossed < 2 {
			t.Fatalf("r=%v: the returned circuits should cross the principal cut twice, saw %d", c.r, crossed)
		}
	}
}

func TestRootExchangesBranchAfterOneCircuitAndReturnsAfterTwo(t *testing.T) {
	for _, c := range rootCases {
		res := rootCompute(t, rootRequest(c.r, c.sheet, c.n, 0, 4*math.Pi, 0))
		one, two := rootPath(t, res, "root/lifted/circuit/1"), rootPath(t, res, "root/lifted/circuit/2")
		if one.Branch != "1" || two.Branch != "2" {
			t.Fatalf("circuit identity: branches %q and %q", one.Branch, two.Branch)
		}
		start, half, end := one.FourPoints[0], one.FourPoints[len(one.FourPoints)-1], two.FourPoints[len(two.FourPoints)-1]
		sigma := 1.
		if c.sheet == "minus" {
			sigma = -1
		}
		if start != (Vec4{c.r, 0, sigma * math.Sqrt(c.r), 0}) {
			t.Fatalf("start %v, want z = r and w = σ√r exactly", start)
		}
		tol := 1e-15 * 8 * c.r
		if math.Abs(half[0]-start[0]) > tol || math.Abs(half[1]-start[1]) > tol {
			t.Fatalf("after one circuit z %v should return to %v", half, start)
		}
		if math.Abs(half[2]+start[2]) > tol || math.Abs(half[3]+start[3]) > tol {
			t.Fatalf("after one circuit w %v should be −w(0) = %v", half, start)
		}
		if two.FourPoints[0] != half || two.Parameters[0] != one.Parameters[len(one.Parameters)-1] {
			t.Fatal("the second circuit starts exactly where the first ends")
		}
		if one.Parameters[len(one.Parameters)-1] != 2*math.Pi || two.Parameters[len(two.Parameters)-1] != 4*math.Pi {
			t.Fatalf("circuits end at 2π and 4π, got %v and %v", one.Parameters[len(one.Parameters)-1], two.Parameters[len(two.Parameters)-1])
		}
		for k := range end {
			if math.Abs(end[k]-start[k]) > tol {
				t.Fatalf("after two circuits %v should return to %v", end, start)
			}
		}
	}
}

// The moving point at progress p is t = from(1−p) + to·p, unwrapped.
func TestRootCurrentPointAtWholeAndHalfJourneys(t *testing.T) {
	for _, c := range rootCases {
		for _, reversed := range []bool{false, true} {
			from, to := 0., 4*math.Pi
			if reversed {
				from, to = to, from
			}
			at := func(p float64) Result { return rootCompute(t, rootRequest(c.r, c.sheet, c.n, from, to, p)) }
			first, half, last := at(0), at(0.5), at(1)
			if half.Root.Parameter != 2*math.Pi {
				t.Fatalf("half way t = %v, want 2π exactly", half.Root.Parameter)
			}
			if first.Root.Parameter != from || last.Root.Parameter != to {
				t.Fatalf("endpoints t = %v and %v, want %v and %v", first.Root.Parameter, last.Root.Parameter, from, to)
			}
			s := rootMarker(t, first, "root/lifted/current").FourPoint
			m := rootMarker(t, half, "root/lifted/current").FourPoint
			tol := 1e-15 * 8 * c.r
			if math.Abs(m[0]-s[0]) > tol || math.Abs(m[1]-s[1]) > tol || math.Abs(m[2]+s[2]) > tol || math.Abs(m[3]+s[3]) > tol {
				t.Fatalf("reversed=%v: one circuit gives %v, want the same z and opposite w of %v", reversed, m, s)
			}
			// The whole journey reproduces every pane exactly: the loop
			// joins without a seam.
			if !sameDrawing(first, last) || !sameDrawing(*first.Companion, *last.Companion) {
				t.Fatalf("reversed=%v: the drawing at 4π must be the drawing at 0", reversed)
			}
		}
	}
}

func sameDrawing(a, b Result) bool {
	if len(a.Paths) != len(b.Paths) || len(a.Markers) != len(b.Markers) {
		return false
	}
	for i := range a.Paths {
		p, q := a.Paths[i], b.Paths[i]
		if p.Source != q.Source || p.Role != q.Role || p.Branch != q.Branch || len(p.Points) != len(q.Points) {
			return false
		}
		for j := range p.Points {
			if p.Points[j] != q.Points[j] {
				return false
			}
		}
	}
	for i := range a.Markers {
		if a.Markers[i] != b.Markers[i] {
			return false
		}
	}
	return true
}

// The trace is the one circuit of t behind the moving point, in the
// direction of travel, taken modulo the true period 4π, and every piece
// lies within one circuit.
func TestRootTraceIsOneCircuitWithCircuitIdentity(t *testing.T) {
	for _, c := range rootCases {
		for _, reversed := range []bool{false, true} {
			for _, p := range []float64{0, 0.137, 0.25, 0.5, 0.61, 1} {
				from, to := 0., 4*math.Pi
				if reversed {
					from, to = to, from
				}
				res := rootCompute(t, rootRequest(c.r, c.sheet, c.n, from, to, p))
				now := res.Root.Parameter
				length := 0.
				current := rootMarker(t, res, "root/lifted/current")
				touches := false
				for _, path := range res.Paths {
					if path.Role != "trace" {
						continue
					}
					lo, hi := path.Parameters[0], path.Parameters[len(path.Parameters)-1]
					length += hi - lo
					want := "1"
					if lo >= 2*math.Pi {
						want = "2"
					}
					if path.Branch != want || (want == "1" && hi > 2*math.Pi) {
						t.Fatalf("trace piece [%v, %v] has branch %q", lo, hi, path.Branch)
					}
					for _, end := range []int{0, len(path.FourPoints) - 1} {
						d := path.FourPoints[end]
						var e Vec4
						for k := range e {
							e[k] = d[k] - current.FourPoint[k]
						}
						if norm4(e) < 1e-12*c.r {
							touches = true
						}
					}
				}
				if math.Abs(length-2*math.Pi) > 1e-12 {
					t.Fatalf("p=%v: trace covers %v of t, want one circuit, 2π", p, length)
				}
				if !touches {
					t.Fatalf("reversed=%v p=%v t=%v: the trace must end at the moving point", reversed, p, now)
				}
			}
		}
	}
}

// Within one circuit of the moving point, behind it: forward traversal
// traces [t − 2π, t], reversed traversal [t, t + 2π].
func TestRootTraceFollowsTheDirectionOfTravel(t *testing.T) {
	const p = 0.3
	at := func(from, to float64) (Result, float64) {
		res := rootCompute(t, rootRequest(1.7, "plus", 400, from, to, p))
		return res, res.Root.Parameter
	}
	contains := func(res Result, x float64) bool {
		x = math.Mod(x+8*math.Pi, 4*math.Pi)
		for _, path := range res.Paths {
			if path.Role == "trace" && path.Parameters[0] <= x && x <= path.Parameters[len(path.Parameters)-1] {
				return true
			}
		}
		return false
	}
	forward, t1 := at(0, 4*math.Pi)
	if !contains(forward, t1-1) || contains(forward, t1+1) {
		t.Fatal("forward traversal traces the circuit behind the point")
	}
	backward, t2 := at(4*math.Pi, 0)
	if !contains(backward, t2+1) || contains(backward, t2-1) {
		t.Fatal("reversed traversal traces the circuit behind the point")
	}
}

// A non-grid parameter is evaluated itself, not rounded onto the grid.
func TestRootNonGridParameter(t *testing.T) {
	res := rootCompute(t, rootRequest(2, "plus", 64, 0, 4*math.Pi, 0.137))
	now := res.Root.Parameter
	if want := 4 * math.Pi * 0.137; math.Abs(now-want) > 1e-15*want {
		t.Fatalf("t = %v, want %v", now, want)
	}
	m := rootMarker(t, res, "root/lifted/current").FourPoint
	// Independent: z = r e^{it}, and w is the root with argument t/2.
	if math.Abs(m[0]-2*math.Cos(now)) > 1e-14 || math.Abs(m[1]-2*math.Sin(now)) > 1e-14 {
		t.Fatalf("z = (%v, %v)", m[0], m[1])
	}
	if arg := math.Atan2(m[3], m[2]); math.Abs(arg-now/2) > 1e-14 {
		t.Fatalf("arg w = %v, want t/2 = %v", arg, now/2)
	}
	for _, path := range res.Paths {
		for i := 1; i < len(path.Parameters); i++ {
			if path.Parameters[i]-path.Parameters[i-1] < 1e-9 {
				t.Fatalf("%s: near-duplicate samples at %v", path.Source, path.Parameters[i])
			}
		}
	}
}

// Expressions such as 4*pi or 2*pi*2 can round past 4π; within rounding they
// are the endpoint itself, and beyond it they are refused by name.
func TestRootRoundedEndpoints(t *testing.T) {
	over := math.Nextafter(4*math.Pi, 20)
	under := -math.SmallestNonzeroFloat64 * 1e10
	res := rootCompute(t, rootRequest(1, "plus", 128, under, over, 1))
	if res.Root.Parameter != 4*math.Pi {
		t.Fatalf("t = %v, want 4π", res.Root.Parameter)
	}
	first := rootCompute(t, rootRequest(1, "plus", 128, under, over, 0))
	if first.Root.Parameter != 0 || !sameDrawing(first, res) {
		t.Fatal("rounded endpoints of a whole journey still join exactly")
	}
	for _, c := range []struct {
		from, to float64
		field    string
	}{{-1e-6, 4 * math.Pi, "root.from"}, {0, 4*math.Pi + 1e-6, "root.to"}, {math.NaN(), 1, "root.from"}, {0, math.Inf(1), "root.to"}} {
		_, err := Compute(rootRequest(1, "plus", 128, c.from, c.to, 0))
		var fe *FieldError
		if !errors.As(err, &fe) || fe.Field != c.field {
			t.Fatalf("from=%v to=%v: want a %s error, got %v", c.from, c.to, c.field, err)
		}
	}
}

// The flat diagram shows z and w side by side at one scale, for the same
// parameters as the 4D view.
func TestRootDiagramPlanesMatchTheSource(t *testing.T) {
	for _, c := range rootCases {
		res := rootCompute(t, rootRequest(c.r, c.sheet, c.n, 0, 4*math.Pi, 0.61))
		d, offset := *res.Companion, res.Root.Center
		if want := 1.25 * math.Max(c.r, math.Sqrt(c.r)); offset != want {
			t.Fatalf("plane offset %v, want %v", offset, want)
		}
		for _, id := range []string{"circuit/1", "circuit/2"} {
			lifted := rootPath(t, res, "root/lifted/"+id)
			source, value := rootPath(t, d, "root/source/"+id), rootPath(t, d, "root/value/"+id)
			if len(source.Points) != len(lifted.Points) || len(value.Points) != len(lifted.Points) {
				t.Fatal("each view draws the same samples")
			}
			for i, q := range lifted.FourPoints {
				s, v := source.Points[i], value.Points[i]
				if source.Parameters[i] != lifted.Parameters[i] || value.Parameters[i] != lifted.Parameters[i] {
					t.Fatal("each view refers to the same parameter")
				}
				if math.Abs(s[0]+offset-q[0]) > 1e-13*offset || s[1] != q[1] || s[2] != 0 {
					t.Fatalf("source plane %v, want z = (%v, %v) left of center", s, q[0], q[1])
				}
				if math.Abs(v[0]-offset-q[2]) > 1e-13*offset || v[1] != q[3] || v[2] != 0 {
					t.Fatalf("value plane %v, want w = (%v, %v) right of center", v, q[2], q[3])
				}
				// And the relation, read from the two planes alone.
				a, b := square(v[0]-offset, v[1])
				if math.Hypot(a-(s[0]+offset), b-s[1]) > 1e-12*c.r {
					t.Fatalf("diagram planes break w² = z at %d", i)
				}
			}
		}
		// The branch point is drawn separately in each view: the origin,
		// which no admitted path reaches.
		for _, m := range []struct {
			r  Result
			id string
			at Vec3
		}{{res, "root/lifted/branch-point", Vec3{}}, {d, "root/source/branch-point", Vec3{-offset, 0, 0}}, {d, "root/value/branch-point", Vec3{offset, 0, 0}}} {
			got := rootMarker(t, m.r, m.id)
			if got.Point != m.at || got.FourPoint != (Vec4{}) || got.Role != "branch-point" {
				t.Fatalf("%s: %+v", m.id, got)
			}
		}
		if d.Radius != 1.5*math.Max(c.r, math.Sqrt(c.r)) {
			t.Fatalf("diagram framing %v", d.Radius)
		}
	}
}

func TestRootPrincipalSheetIsOnlyAReadout(t *testing.T) {
	for _, sheet := range []string{"plus", "minus"} {
		sigma := 1
		if sheet == "minus" {
			sigma = -1
		}
		for _, c := range []struct {
			t    float64
			want int
		}{{0, 1}, {math.Pi - 0.01, 1}, {math.Pi + 0.01, -1}, {2 * math.Pi, -1}, {3*math.Pi - 0.01, -1}, {3*math.Pi + 0.01, 1}, {4 * math.Pi, 1}} {
			res := rootCompute(t, rootRequest(1.3, sheet, 256, 0, 4*math.Pi, c.t/(4*math.Pi)))
			if res.Root.Principal != sigma*c.want {
				t.Fatalf("%s t=%v: w = %d·√z (principal), want %d", sheet, c.t, res.Root.Principal, sigma*c.want)
			}
		}
	}
}

func TestRootDiagnosticsAndBudget(t *testing.T) {
	for _, p := range []float64{0, 0.13, 0.5, 0.99} {
		res := rootCompute(t, rootRequest(4, "plus", 4096, 0, 4*math.Pi, p))
		if res.EmittedPoints > rootPoints(4096) || rootPoints(4096) > maxPoints {
			t.Fatalf("emitted %d of the bound %d (ceiling %d)", res.EmittedPoints, rootPoints(4096), maxPoints)
		}
		counted := len(res.Markers) + len(res.Companion.Markers)
		for _, r := range []Result{res, *res.Companion} {
			for _, path := range r.Paths {
				counted += len(path.Points)
			}
		}
		if res.EmittedPoints != counted {
			t.Fatalf("emitted %d, counted %d across all three views", res.EmittedPoints, counted)
		}
		if res.Root.Residual > 1e-12*4 || res.Root.Intervals != 4096 {
			t.Fatalf("diagnostics %+v", *res.Root)
		}
		circuit := 1
		if math.Mod(res.Root.Parameter, 4*math.Pi) >= 2*math.Pi {
			circuit = 2
		}
		if res.Root.Circuit != circuit {
			t.Fatalf("t=%v: circuit %d", res.Root.Parameter, res.Root.Circuit)
		}
	}
}

func TestRootRefusesByField(t *testing.T) {
	ok := rootRequest(1, "plus", 256, 0, 4*math.Pi, 0)
	for _, c := range []struct {
		edit  func(*Request)
		field string
		text  string
	}{
		{func(q *Request) { q.Root.Radius = 0.2 }, "root.radius", "0.25"},
		{func(q *Request) { q.Root.Radius = 4.01 }, "root.radius", "4"},
		{func(q *Request) { q.Root.Radius = math.NaN() }, "root.radius", ""},
		{func(q *Request) { q.Root.Sheet = "up" }, "root.sheet", ""},
		{func(q *Request) { q.Samples = 63 }, "samples", "4,096"},
		{func(q *Request) { q.Samples = 4097 }, "samples", "4,096"},
		{func(q *Request) { q.Angles[4] = math.Inf(1) }, "angles.4", ""},
		{func(q *Request) { q.Mode = "stereo" }, "mode", ""},
	} {
		q := ok
		root := *ok.Root
		q.Root = &root
		c.edit(&q)
		_, err := Compute(q)
		var fe *FieldError
		if !errors.As(err, &fe) || fe.Field != c.field || !strings.Contains(fe.Message, c.text) {
			t.Fatalf("want a %s error mentioning %q, got %v", c.field, c.text, err)
		}
	}
	// Only playback sets the trace, so its refusal names no control.
	for _, trace := range []float64{-0.01, 1.01, math.NaN()} {
		q := ok
		root := *ok.Root
		root.Trace = trace
		q.Root = &root
		_, err := Compute(q)
		var fe *FieldError
		if err == nil || errors.As(err, &fe) {
			t.Fatalf("trace %v: want a plain refusal, got %v", trace, err)
		}
	}
	q := ok
	q.Root = nil
	if _, err := Compute(q); err == nil {
		t.Fatal("parameters are required")
	}
}

// The entered endpoints are reached exactly, not up to rounding of their
// difference, so the last frame is the entered end.
func TestRootReachesEnteredEndpointsExactly(t *testing.T) {
	for _, c := range [][2]float64{{0.3, 4*math.Pi - 0.7}, {0.1, 2 * math.Pi}, {11.9, 0.7}, {1.0 / 3, 10.0 / 3}} {
		for p, want := range map[float64]float64{0: c[0], 1: c[1]} {
			res := rootCompute(t, rootRequest(1.1, "minus", 200, c[0], c[1], p))
			if res.Root.Parameter != want {
				t.Fatalf("from %v to %v at p=%v: t = %v, want %v", c[0], c[1], p, res.Root.Parameter, want)
			}
		}
	}
}
