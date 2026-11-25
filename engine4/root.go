package engine4

import (
	"fmt"
	"math"
	"math/cmplx"
	"sort"
)

// The root journey (R15.1, S14.1, S14.2). A point travels n times around
// the circle z(t) = r e^{iφ}(k + e^{it}), of radius r about c = k r e^{iφ},
// while its continuously followed n-th root w, wⁿ = z, travels along the
// curve |wⁿ − c| = r, for the unwrapped parameter 0 ≤ t ≤ 2πn and a
// degree n from 2 to 6. The relation wⁿ = z is a complex curve in
// C² = R⁴, here q(t) = (Re z, Im z, Re w, Im w). The square root's origin
// circle, n = 2 and k = 0, is the original study: w = σ√r e^{it/2} and
// |q|² = r² + r. The square root keeps its original arithmetic throughout.
//
// t is never reduced modulo 2π: that would put every circuit on one
// sheet. When z winds about 0, each circuit turns w by ω = e^{2πi/n}, so
// the true period is 2πn: the moving point is evaluated at t mod 2πn, and
// t = 2πn draws exactly what t = 0 draws.

// Entered endpoints within this distance of 0 or 2πn are those endpoints:
// constant expressions such as 2*pi*2 may round past 4π. The same band
// admits a direction rounded past ±2π.
const rootTolerance = 1e-12

const (
	rootMinRadius    = 0.25
	rootMaxRadius    = 4
	rootMinIntervals = 64
	rootMaxIntervals = 4096
	rootMaxOffset    = 3
	rootMaxDegree    = 6
	// A circle with |1 − k| below this passes within r/20 of the branch
	// point: refused, and so is the lemniscate k = 1 through it.
	rootClearance = 0.05
)

type RootParameters struct {
	Radius float64 `json:"radius"`
	// The circle's center c = k r e^{iφ}: Offset is k, in radii, and
	// Direction is φ, in radians. Both absent (zero) is the origin circle.
	Offset    float64 `json:"offset,omitempty"`
	Direction float64 `json:"direction,omitempty"`
	Sheet     string  `json:"sheet"` // "plus" or "minus": w(0) = +√z(0) or −√z(0)
	// The degree n of wⁿ = z, a whole number from 2 to 6, absent for 2,
	// and the initial sheet's turn b, w(0) = σ ω^b ⁿ√z(0), ω = e^{2πi/n}.
	Degree float64 `json:"degree,omitempty"`
	Branch float64 `json:"branch,omitempty"`
	From   float64 `json:"from"`
	To     float64 `json:"to"`
	// Progress from From to To, which only playback sets.
	Trace float64 `json:"trace,omitempty"`
	// A noncircular source path (root_path.go): absent for
	// the circle; "ripple" with Ripple a and Frequency m; or "fourier" with
	// Terms. Each is placed as the circle is, z = r e^{iφ}(k + s(t)).
	Path      string     `json:"path,omitempty"`
	Ripple    float64    `json:"ripple,omitempty"`
	Frequency float64    `json:"frequency,omitempty"`
	Terms     []RootTerm `json:"terms,omitempty"`
}

type RootDiagnostics struct {
	// The unwrapped parameter of the moving point, and its circuit: 1 for
	// t mod 4π in [0, 2π), 2 for [2π, 4π).
	Parameter float64    `json:"parameter"`
	Circuit   int        `json:"circuit"`
	Z         [2]float64 `json:"z"`
	W         [2]float64 `json:"w"`
	// +1 when w is the principal root of z (argument in (−π/2, π/2]),
	// −1 when it is the other. An explanatory convention only: the path
	// is never cut where the principal root jumps.
	Principal int `json:"principal"`
	// The largest |w² − z| over every returned 4D source point.
	Residual float64 `json:"residual"`
	// The framing bound √(R² + R), R = max |z| = r(1 + k), and |q| at the
	// moving point.
	NormBound float64 `json:"normBound"`
	Norm      float64 `json:"norm"`
	Intervals int     `json:"intervals"`
	// Intervals over 0 ≤ t ≤ 4π after refinement near the branch point.
	Refined int `json:"refined"`
	// The center offset k, in radii: 0 for the origin circle.
	Offset float64 `json:"offset"`
	// The winding of z about the branch point over one circuit, 1 or 0,
	// and the closest approach min |z| = r|1 − k|.
	Winding int     `json:"winding"`
	Closest float64 `json:"closest"`
	// The diagram places the z plane's origin at (−Center, 0) and the w
	// plane's at (+Center, 0), at one scale.
	Center float64 `json:"center"`
	// The degree n and w's index m, w = ω^m ⁿ√z with the principal root;
	// both absent for the square root, whose Principal says the same.
	Degree int `json:"degree,omitempty"`
	Index  int `json:"index,omitempty"`
	// For a noncircular path only: its name; the circuits until w is home,
	// n/gcd(n, W); a certified lower bound on min |z| (Closest is then a
	// sampled upper bound); and the drawing's tolerance.
	Path         string  `json:"path,omitempty"`
	Period       int     `json:"period,omitempty"`
	ClosestBound float64 `json:"closestBound,omitempty"`
	Tolerance    float64 `json:"tolerance,omitempty"`
	Projection   string  `json:"projection"`
	Diagram      string  `json:"diagram"`
}

// rootPoints bounds the returned points of the origin circle's three views,
// which are never refined. A segment of parameter length 2π holds at most
// n/2 + 2 grid points and its two ends; each view draws two circuits, a
// trace of at most two pieces, and three markers; the diagram adds four
// axes and the cut. A translated circle's refined grid is counted exactly
// before evaluation instead.
func rootPoints(n int) int {
	segment := n/2 + 4
	view := 2*segment + (n/2 + 6) + 3
	return 3*view + 10
}

// rootCircle is the source circle and its continuously followed n-th
// root.
type rootCircle struct {
	r, k, phi float64
	n         int
	// s = ±1 makes the square root's w(0) the root of z(0) the sheet names.
	s float64
	// For n ≥ 3, the n-th root of unity that does the same.
	unit complex128
	// The constant factor of w: r^{1/n} for an enclosing circle,
	// (kr)^{1/n} e^{iφ/n} for a missing one.
	scale complex128
}

// principalRoot is ⁿ√z with Arg z in (−π, π], as the readout uses.
func principalRoot(z complex128, n int) complex128 {
	s, c := math.Sincos(math.Atan2(imag(z), real(z)) / float64(n))
	m := math.Pow(cmplx.Abs(z), 1/float64(n))
	return complex(m*c, m*s)
}

// unity is ω^m, ω = e^{2πi/n}.
func unity(n, m int) complex128 {
	s, c := math.Sincos(2 * math.Pi * float64(m) / float64(n))
	return complex(c, s)
}

// newRootCircle names w(0) = σ ω^b ⁿ√z(0).
func newRootCircle(r, k, phi, sigma float64, n, b int) rootCircle {
	c := rootCircle{r: r, k: k, phi: phi, n: n, s: 1, unit: 1}
	if n == 2 {
		if k < 1 {
			c.scale = complex(math.Sqrt(r), 0)
		} else {
			c.scale = complex(math.Sqrt(k*r), 0) * cmplx.Exp(complex(0, phi/2))
		}
		// The principal root of z(0), Arg z(0) in (−π, π], as the readout uses.
		v := c.at(0)
		z0, w0 := complex(v[0], v[1]), complex(v[2], v[3])
		a := math.Atan2(imag(z0), real(z0)) / 2
		principal := complex(math.Sqrt(cmplx.Abs(z0))*math.Cos(a), math.Sqrt(cmplx.Abs(z0))*math.Sin(a))
		if real(w0*cmplx.Conj(principal)) < 0 {
			c.s = -1
		}
		c.s *= sigma
		if b == 1 {
			c.s = -c.s
		}
		return c
	}
	if k < 1 {
		c.scale = complex(math.Pow(r, 1/float64(n)), 0)
	} else {
		sp, cp := math.Sincos(phi / float64(n))
		c.scale = complex(math.Pow(k*r, 1/float64(n)), 0) * complex(cp, sp)
	}
	// Which n-th root of unity turns the lift's own w(0) onto the named
	// root: the nearest multiple of 2π/n between them.
	v := c.at(0)
	z0, w0 := complex(v[0], v[1]), complex(v[2], v[3])
	want := complex(sigma, 0) * unity(n, b) * principalRoot(z0, n)
	m := int(math.Round(cmplx.Phase(want/w0) * float64(n) / (2 * math.Pi)))
	c.unit = unity(n, ((m%n)+n)%n)
	return c
}

// at evaluates q(t) = (z, w). No branch takes a principal root of z: for
// k < 1, z = r e^{i(t+φ)}(1 + u) with u = k e^{−it}, and for k > 1,
// z = k r e^{iφ}(1 + u) with u = e^{it}/k. Either way |u| < 1, so 1 + u
// keeps a positive real part and its principal root never meets the cut;
// the remaining factor, e^{i(t+φ)/n} or the constant e^{iφ/n}, is
// continuous in t. The square root's origin circle keeps its original
// arithmetic, and the square root its own.
func (c rootCircle) at(t float64) Vec4 {
	if c.n != 2 {
		return c.atDegree(t)
	}
	if c.k == 0 {
		sz, cz := math.Sincos(t + c.phi)
		sw, cw := math.Sincos((t + c.phi) / 2)
		return Vec4{c.r * cz, c.r * sz, c.s * math.Sqrt(c.r) * cw, c.s * math.Sqrt(c.r) * sw}
	}
	z := complex(c.r, 0) * cmplx.Exp(complex(0, c.phi)) * (complex(c.k, 0) + cmplx.Exp(complex(0, t)))
	var w complex128
	if c.k < 1 {
		w = c.scale * cmplx.Exp(complex(0, (t+c.phi)/2)) * cmplx.Sqrt(1+complex(c.k, 0)*cmplx.Exp(complex(0, -t)))
	} else {
		w = c.scale * cmplx.Sqrt(1+cmplx.Exp(complex(0, t))/complex(c.k, 0))
	}
	w *= complex(c.s, 0)
	return Vec4{real(z), imag(z), real(w), imag(w)}
}

// atDegree is at for n ≥ 3, with the principal n-th root of 1 + u.
func (c rootCircle) atDegree(t float64) Vec4 {
	n := float64(c.n)
	var z, w complex128
	if c.k == 0 {
		sz, cz := math.Sincos(t + c.phi)
		z = complex(c.r*cz, c.r*sz)
	} else {
		z = complex(c.r, 0) * cmplx.Exp(complex(0, c.phi)) * (complex(c.k, 0) + cmplx.Exp(complex(0, t)))
	}
	switch {
	case c.k == 0:
		sw, cw := math.Sincos((t + c.phi) / n)
		w = c.scale * complex(cw, sw)
	case c.k < 1:
		sw, cw := math.Sincos((t + c.phi) / n)
		w = c.scale * complex(cw, sw) * principalRoot(1+complex(c.k, 0)*cmplx.Exp(complex(0, -t)), c.n)
	default:
		w = c.scale * principalRoot(1+cmplx.Exp(complex(0, t))/complex(c.k, 0), c.n)
	}
	w *= c.unit
	return Vec4{real(z), imag(z), real(w), imag(w)}
}

// grid is the parameter grid over the journey [0, 2πn]: N intervals of
// length h, interval j split into m_j equal parts so that w turns about 0
// by at most h/n = 2π/N per part, as on the origin circle. On
// [t_j, t_j + h], |z| ≥ δ_j = max(δ, |z(t_j + h/2)| − r h/2), since
// |dz/dt| = r, and w = ⁿ√z turns at most r/(n|z|) per unit t, so
// m_j = ⌈r/δ_j⌉ parts suffice. The origin circle has δ_j = r and m_j = 1.
func (c rootCircle) grid(intervals int) []float64 {
	h := 2 * math.Pi * float64(c.n) / float64(intervals)
	delta := c.r * math.Abs(1-c.k)
	ts := make([]float64, 0, intervals+1)
	for j := 0; j < intervals; j++ {
		t := float64(j) * h
		ts = append(ts, t)
		if c.k == 0 {
			continue
		}
		s, co := math.Sincos(t + h/2)
		near := math.Max(delta, c.r*math.Hypot(c.k+co, s)-c.r*h/2)
		m := int(math.Max(1, math.Ceil(c.r/near-1e-9)))
		for i := 1; i < m; i++ {
			ts = append(ts, t+float64(i)*h/float64(m))
		}
	}
	return ts
}

func rootJourney(q Request, r Result) (Result, error) {
	if q.Mode != "paired" {
		return r, fieldErr("mode", "choose Source, value and lift for the root journey")
	}
	if q.Root == nil {
		return r, fmt.Errorf("root journey parameters are required")
	}
	p := *q.Root
	for i, a := range q.Angles {
		if !finite(a) || math.Abs(a) > 1e6 {
			return r, fieldErr(fmt.Sprintf("angles.%d", i), "rotation angles must be finite and within ±1000000 radians")
		}
	}
	if !finite(p.Radius) || p.Radius < rootMinRadius || p.Radius > rootMaxRadius {
		return r, fieldErr("root.radius", "Radius r must be between 0.25 and 4")
	}
	if !finite(p.Offset) || p.Offset < 0 || p.Offset > rootMaxOffset {
		return r, fieldErr("root.offset", "Center offset must be between 0 and 3 radii")
	}
	if p.Path == "" && math.Abs(1-p.Offset) < rootClearance {
		return r, fieldErr("root.offset", "Center offset must stay at least 0.05 from 1: nearer, the circle passes too close to the branch point z = 0")
	}
	if !finite(p.Direction) || math.Abs(p.Direction) > 2*math.Pi+rootTolerance {
		return r, fieldErr("root.direction", "Center direction must be between −2π and 2π")
	}
	degree := 2
	if p.Degree != 0 {
		if !finite(p.Degree) || p.Degree != math.Trunc(p.Degree) || p.Degree < 2 || p.Degree > rootMaxDegree {
			return r, fieldErr("root.degree", "Degree n must be a whole number from 2 to 6")
		}
		degree = int(p.Degree)
	}
	if !finite(p.Branch) || p.Branch != math.Trunc(p.Branch) || p.Branch < 0 || p.Branch >= float64(degree) {
		return r, fieldErr("root.branch", "Initial sheet must be one of the %d roots of z(0): a whole number of turns ω from 0 to %d", degree, degree-1)
	}
	sigma := 1.
	switch p.Sheet {
	case "plus":
	case "minus":
		if degree%2 == 1 {
			return r, fieldErr("root.sheet", "Initial sheet −ⁿ√z(0) is not a root of z(0) at odd degree %d: choose a power of ω", degree)
		}
		sigma = -1
	default:
		return r, fieldErr("root.sheet", "Initial sheet must be +√z(0) or −√z(0)")
	}
	if q.Samples < rootMinIntervals || q.Samples > rootMaxIntervals {
		return r, fieldErr("samples", "use 64–4,096 parameter intervals")
	}
	// The journey is n circuits, the n-th ending at 2πn: 4π for the square
	// root. Each 2πc is computed one way, so circuits meet exactly.
	boundary := func(c int) float64 { return 2 * math.Pi * float64(c) }
	period := boundary(degree)
	endpoint := func(v float64, key, name string) (float64, error) {
		if !finite(v) || v < -rootTolerance || v > period+rootTolerance {
			return 0, fieldErr("root."+key, "%s must be between 0 and %dπ", name, 2*degree)
		}
		if v <= rootTolerance {
			return 0, nil
		}
		if v >= period-rootTolerance {
			return period, nil
		}
		return v, nil
	}
	from, err := endpoint(p.From, "from", "Trace start")
	if err != nil {
		return r, err
	}
	to, err := endpoint(p.To, "to", "Trace end")
	if err != nil {
		return r, err
	}
	if !finite(p.Trace) || p.Trace < 0 || p.Trace > 1 {
		return r, fmt.Errorf("the journey's progress must be between 0 and 1")
	}

	n, rad, k := q.Samples, p.Radius, p.Offset
	var path *rootLoop
	var evaluate func(float64) Vec4
	var grid []float64
	big := rad * (1 + k)
	winding := 0
	if k < 1 {
		winding = 1
	}
	if p.Path != "" {
		terms, err := rootShape(p)
		if err != nil {
			return r, err
		}
		path = newRootPath(p, terms, degree, sigma)
		if err := path.certify(n); err != nil {
			return r, err
		}
		evaluate, grid, big, winding = path.at, path.journeyGrid(), path.reach, path.winding
	} else {
		circle := newRootCircle(rad, k, p.Direction, sigma, degree, int(p.Branch))
		evaluate, grid = circle.at, circle.grid(n)
	}
	h := period / float64(n)
	// |w| = |z|^{1/n} ≤ R^{1/n}, so |q|² ≤ R² + R^{2/n}. Only the root
	// depends on the degree before the planes are placed, and the square
	// root's bound keeps its own expression, which arm64 may fuse.
	root := math.Sqrt(big)
	if degree != 2 {
		root = math.Pow(big, 1/float64(degree))
	}
	larger := math.Max(big, root)
	center, reach := 1.25*larger, 1.15*larger
	bound := math.Sqrt(big*big + rad*(1+k))
	if degree != 2 || path != nil {
		bound = math.Sqrt(big*big + math.Pow(big, 2/float64(degree)))
	}
	now := from*(1-p.Trace) + to*p.Trace
	diag := &RootDiagnostics{Parameter: now, Intervals: n, Refined: len(grid), Center: center, NormBound: bound,
		Offset: k, Winding: winding, Closest: rad * math.Abs(1-k),
		Projection: "declared 4D rotation R of q = (Re z, Im z, Re w, Im w), then drop the fourth coordinate: P = (Rq)_xyz, |P| ≤ |q| ≤ √(R² + R), R = max |z| = r(1 + k)",
		Diagram:    "z plane centered at (−c, 0) and w plane at (+c, 0), one scale; c = 1.25 max(R, √R)"}
	if degree != 2 {
		diag.Projection = fmt.Sprintf("declared 4D rotation R of q = (Re z, Im z, Re w, Im w), then drop the fourth coordinate: P = (Rq)_xyz, |P| ≤ |q| ≤ √(R² + R^{2/%d}), R = max |z| = r(1 + k)", degree)
		diag.Diagram = fmt.Sprintf("z plane centered at (−c, 0) and w plane at (+c, 0), one scale; c = 1.25 max(R, R^{1/%d})", degree)
	}
	if path != nil {
		diag.Path, diag.Period = p.Path, degree/gcdInt(degree, winding)
		diag.Closest, diag.ClosestBound, diag.Tolerance = path.closest, path.closestBound, path.tol
		diag.Projection = fmt.Sprintf("declared 4D rotation R of q = (Re z, Im z, Re w, Im w), then drop the fourth coordinate: P = (Rq)_xyz, |P| ≤ |q| ≤ √(R² + R^{2/%d}), R = r(k + Σρ) ≥ max |z|", degree)
		diag.Diagram = fmt.Sprintf("z plane centered at (−c, 0) and w plane at (+c, 0), one scale; c = 1.25 max(R, R^{1/%d})", degree)
	}
	r.Root, r.Radius, r.Operation = diag, bound, "orthographic"
	d := Result{Object: "root", Operation: "diagram", Paths: []Path{}, Faces: []Face{}, Points: []Vec3{},
		Sections: []Section{}, Radius: 1.5 * larger}

	at := func(t float64) Vec4 {
		r.Evaluations++
		return evaluate(t)
	}
	lifted := func(v Vec4) Vec3 {
		u := rotate(v, q.Angles)
		return Vec3{u[0], u[1], u[2]}
	}
	source := func(v Vec4) Vec3 { return Vec3{v[0] - center, v[1], 0} }
	value := func(v Vec4) Vec3 { return Vec3{v[2] + center, v[3], 0} }
	residual := func(v Vec4) {
		if degree != 2 {
			w, p := complex(v[2], v[3]), complex(1, 0)
			for i := 0; i < degree; i++ {
				p *= w
			}
			diag.Residual = math.Max(diag.Residual, cmplx.Abs(p-complex(v[0], v[1])))
			return
		}
		a, b := v[2]*v[2]-v[3]*v[3], 2*v[2]*v[3]
		diag.Residual = math.Max(diag.Residual, math.Hypot(a-v[0], b-v[1]))
	}
	// The circuit of a parameter in [0, 2πn): c when 2π(c − 1) ≤ t < 2πc.
	circuitOf := func(t float64) int {
		c := 1
		for c < degree && t >= boundary(c) {
			c++
		}
		return c
	}
	// The grid parameters strictly inside (a, b), with both ends.
	parameters := func(a, b float64) []float64 {
		eps := 1e-6 * h
		ts := []float64{a}
		for i := sort.SearchFloat64s(grid, a+eps); i < len(grid) && grid[i] < b-eps; i++ {
			if grid[i]-a > eps {
				ts = append(ts, grid[i])
			}
		}
		return append(ts, b)
	}

	// The trace: the one circuit of t behind the moving point in the
	// direction of travel, modulo 2πn, split where the circuits meet.
	s := math.Mod(now, period)
	var pieces [][2]float64
	// The circuit boundary at or below s, and the one above it.
	below := boundary(circuitOf(s) - 1)
	if to >= from {
		if s < 2*math.Pi {
			pieces = [][2]float64{{s + boundary(degree-1), period}, {0, s}}
		} else {
			pieces = [][2]float64{{s - 2*math.Pi, below}, {below, s}}
		}
	} else if above := circuitOf(s); above < degree {
		pieces = [][2]float64{{s, boundary(above)}, {boundary(above), s + 2*math.Pi}}
	} else {
		pieces = [][2]float64{{s, period}, {0, s - boundary(degree-1)}}
	}
	var traced [][2]float64
	for _, piece := range pieces {
		if piece[1]-piece[0] > 1e-6*h {
			traced = append(traced, piece)
		}
	}

	// Count every returned point before evaluating any: three views of
	// each piece, nine markers and ten guide points, and for a missing
	// circle the other n − 1 sheets' loops in two views.
	circuits := make([][2]float64, degree)
	for c := range circuits {
		circuits[c] = [2]float64{boundary(c), boundary(c + 1)}
	}
	points := 9 + 10
	for _, piece := range append(circuits[:degree:degree], traced...) {
		points += 3 * len(parameters(piece[0], piece[1]))
	}
	// The sheets the permutation never visits: ω^m w for m not a multiple
	// of gcd(n, W). For a circle, all others when it misses 0, else none.
	orbit := gcdInt(degree, winding)
	unvisited := 0
	for m := 1; m < degree; m++ {
		if m%orbit != 0 {
			unvisited++
		}
	}
	points += 2 * unvisited * len(parameters(0, 2*math.Pi))
	if points > maxPoints {
		if path != nil {
			return r, fieldErr("samples", "%s", rootBudgetMessage)
		}
		return r, fmt.Errorf("root journey exceeds budget: at most 65,536 points")
	}

	// One parameter interval within a circuit, in all three views.
	emit := func(id, role string, a, b float64) {
		circuit := circuitOf(a)
		ts := parameters(a, b)
		branch := fmt.Sprint(circuit)
		// The square root's circuits take the first and third inks; higher
		// degrees draw each circuit in its own index ink, by its branch.
		family := 2 * (circuit - 1)
		if degree != 2 {
			family = 0
		}
		four := Path{Source: "root/lifted/" + id, Role: role, Branch: branch, Family: family, Parameters: ts,
			FourPoints: make([]Vec4, len(ts)), Points: make([]Vec3, len(ts))}
		z := Path{Source: "root/source/" + id, Role: role, Branch: branch, Family: family, Parameters: ts, Points: make([]Vec3, len(ts))}
		w := Path{Source: "root/value/" + id, Role: role, Branch: branch, Family: family, Parameters: ts, Points: make([]Vec3, len(ts))}
		for i, t := range ts {
			v := at(t)
			residual(v)
			four.FourPoints[i], four.Points[i] = v, lifted(v)
			z.Points[i], w.Points[i] = source(v), value(v)
		}
		r.Paths = append(r.Paths, four)
		d.Paths = append(d.Paths, z, w)
	}
	for c, circuit := range circuits {
		emit(fmt.Sprintf("circuit/%d", c+1), "circuit", circuit[0], circuit[1])
	}
	for i, piece := range traced {
		emit(fmt.Sprintf("trace/%d", i), "trace", piece[0], piece[1])
	}
	// Over a missing circle, wⁿ = z has n disjoint loops, and the journey
	// keeps to one. The other sheets' loops, (z, ω^m w) over one circuit,
	// are quiet guides in the w plane and the 4D view; the z plane already
	// shows their circle. Over an enclosing circle every sheet lies on the
	// one loop the circuits draw.
	for m := 1; m < degree; m++ {
		if m%orbit == 0 {
			continue
		}
		id, turn := "other-sheet", unity(degree, m)
		if degree != 2 {
			id = fmt.Sprintf("other-sheet/%d", m)
		}
		ts := parameters(0, 2*math.Pi)
		four := Path{Source: "root/lifted/" + id, Role: "other-sheet", Branch: "0", Guide: true, Dashed: true, Family: 3,
			Parameters: ts, FourPoints: make([]Vec4, len(ts)), Points: make([]Vec3, len(ts))}
		w := Path{Source: "root/value/" + id, Role: "other-sheet", Branch: "0", Guide: true, Dashed: true, Family: 3,
			Parameters: ts, Points: make([]Vec3, len(ts))}
		for i, t := range ts {
			v := at(t)
			if degree == 2 {
				v[2], v[3] = -v[2], -v[3]
			} else {
				o := turn * complex(v[2], v[3])
				v[2], v[3] = real(o), imag(o)
			}
			residual(v)
			four.FourPoints[i], four.Points[i] = v, lifted(v)
			w.Points[i] = value(v)
		}
		r.Paths = append(r.Paths, four)
		d.Paths = append(d.Paths, w)
	}

	start, current := at(math.Mod(from, period)), at(s)
	for _, m := range []struct {
		role string
		v    Vec4
	}{{"start", start}, {"current", current}, {"branch-point", Vec4{}}} {
		r.Markers = append(r.Markers, Marker{ID: "root/lifted/" + m.role, Role: m.role, Point: lifted(m.v), FourPoint: m.v})
		if m.role == "branch-point" {
			d.Markers = append(d.Markers,
				Marker{ID: "root/source/branch-point", Role: m.role, Point: Vec3{-center, 0, 0}},
				Marker{ID: "root/value/branch-point", Role: m.role, Point: Vec3{center, 0, 0}})
			continue
		}
		d.Markers = append(d.Markers,
			Marker{ID: "root/source/" + m.role, Role: m.role, Point: source(m.v), FourPoint: m.v},
			Marker{ID: "root/value/" + m.role, Role: m.role, Point: value(m.v), FourPoint: m.v})
	}

	// Axes of both planes, and the principal root's cut along the negative
	// real z axis: a convention for the readout, never a break in the path.
	for _, plane := range []struct {
		name string
		c    float64
	}{{"source", -center}, {"value", center}} {
		d.Paths = append(d.Paths,
			Path{Source: "root/" + plane.name + "/axis/re", Role: "axes", Branch: "0", Guide: true, Family: 3,
				Points: []Vec3{{plane.c - reach, 0, 0}, {plane.c + reach, 0, 0}}},
			Path{Source: "root/" + plane.name + "/axis/im", Role: "axes", Branch: "0", Guide: true, Family: 3,
				Points: []Vec3{{plane.c, -reach, 0}, {plane.c, reach, 0}}})
	}
	d.Paths = append(d.Paths, Path{Source: "root/source/cut", Role: "cut", Branch: "0", Guide: true, Family: 3, Dashed: true,
		Points: []Vec3{{-center, 0, 0}, {-center - reach, 0, 0}}})

	diag.Circuit = circuitOf(s)
	diag.Z, diag.W = [2]float64{current[0], current[1]}, [2]float64{current[2], current[3]}
	diag.Norm = math.Sqrt(current[0]*current[0] + current[1]*current[1] + current[2]*current[2] + current[3]*current[3])
	if degree != 2 {
		// w = ω^m ⁿ√z: the nearest multiple of 2π/n between w and the
		// principal root, whose argument is Arg z / n.
		z, w := complex(current[0], current[1]), complex(current[2], current[3])
		m := int(math.Round(cmplx.Phase(w/principalRoot(z, degree)) * float64(degree) / (2 * math.Pi)))
		diag.Degree, diag.Index = degree, ((m%degree)+degree)%degree
		diag.Principal = 1
		if diag.Index != 0 {
			diag.Principal = -1
		}
		r.Companion = &d
		return r, nil
	}
	// The principal root has argument Arg z / 2 in (−π/2, π/2].
	ps, pc := math.Sincos(math.Atan2(current[1], current[0]) / 2)
	diag.Principal = 1
	if current[2]*pc+current[3]*ps < 0 {
		diag.Principal = -1
	}
	r.Companion = &d
	return r, nil
}
