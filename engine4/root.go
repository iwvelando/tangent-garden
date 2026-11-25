package engine4

import (
	"fmt"
	"math"
	"math/cmplx"
	"sort"
)

// The square-root journey (R15.1, S14.1). A point travels twice around
// the circle z(t) = r e^{iφ}(k + e^{it}), of radius r about c = k r e^{iφ},
// while its continuously followed square root w travels along the
// Cassini oval |w² − c| = r, for the unwrapped parameter 0 ≤ t ≤ 4π. The
// relation w² = z is a complex curve in C² = R⁴, here
// q(t) = (Re z, Im z, Re w, Im w). The origin circle, k = 0, is the
// original study: w = σ√r e^{it/2} and |q|² = r² + r.
//
// t is never reduced modulo 2π: that would put both circuits on one
// sheet. The true period is 4π, so the moving point is evaluated at
// t mod 4π, and t = 4π draws exactly what t = 0 draws.

// Entered endpoints within this distance of 0 or 4π are those endpoints:
// constant expressions such as 2*pi*2 may round past 4π. The same band
// admits a direction rounded past ±2π.
const rootTolerance = 1e-12

const (
	rootMinRadius    = 0.25
	rootMaxRadius    = 4
	rootMinIntervals = 64
	rootMaxIntervals = 4096
	rootMaxOffset    = 3
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
	From      float64 `json:"from"`
	To        float64 `json:"to"`
	// Progress from From to To, which only playback sets.
	Trace float64 `json:"trace,omitempty"`
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
	Center     float64 `json:"center"`
	Projection string  `json:"projection"`
	Diagram    string  `json:"diagram"`
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

// rootCircle is the source circle and its continuous square root.
type rootCircle struct {
	r, k, phi float64
	// s = ±1 makes w(0) the root of z(0) the sheet names.
	s float64
	// The constant factor of w: √r for an enclosing circle, √(kr) e^{iφ/2}
	// for a missing one.
	scale complex128
}

func newRootCircle(r, k, phi, sigma float64) rootCircle {
	c := rootCircle{r: r, k: k, phi: phi, s: 1}
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
	return c
}

// at evaluates q(t) = (z, w). Neither branch takes a principal root of z:
// for k < 1, z = r e^{i(t+φ)}(1 + u) with u = k e^{−it}, and for k > 1,
// z = k r e^{iφ}(1 + u) with u = e^{it}/k. Either way |u| < 1, so 1 + u
// keeps a positive real part and its principal root never meets the cut;
// the remaining factor, e^{i(t+φ)/2} or the constant e^{iφ/2}, is
// continuous in t. The origin circle keeps its original arithmetic.
func (c rootCircle) at(t float64) Vec4 {
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

// grid is the parameter grid over [0, 4π]: the n intervals of length h,
// interval j split into m_j equal parts so that w turns about 0 by at
// most h/2 per part, as on the origin circle. On [t_j, t_j + h],
// |z| ≥ δ_j = max(δ, |z(t_j + h/2)| − r h/2), since |dz/dt| = r, and
// w = √z turns at most r/(2|z|) per unit t, so m_j = ⌈r/δ_j⌉ parts
// suffice. The origin circle has δ_j = r and m_j = 1.
func (c rootCircle) grid(n int) []float64 {
	h := 4 * math.Pi / float64(n)
	delta := c.r * math.Abs(1-c.k)
	ts := make([]float64, 0, n+1)
	for j := 0; j < n; j++ {
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
		return r, fieldErr("mode", "choose Source, value and lift for the square-root journey")
	}
	if q.Root == nil {
		return r, fmt.Errorf("square-root journey parameters are required")
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
	if math.Abs(1-p.Offset) < rootClearance {
		return r, fieldErr("root.offset", "Center offset must stay at least 0.05 from 1: nearer, the circle passes too close to the branch point z = 0")
	}
	if !finite(p.Direction) || math.Abs(p.Direction) > 2*math.Pi+rootTolerance {
		return r, fieldErr("root.direction", "Center direction must be between −2π and 2π")
	}
	sigma := 1.
	switch p.Sheet {
	case "plus":
	case "minus":
		sigma = -1
	default:
		return r, fieldErr("root.sheet", "Initial sheet must be +√z(0) or −√z(0)")
	}
	if q.Samples < rootMinIntervals || q.Samples > rootMaxIntervals {
		return r, fieldErr("samples", "use 64–4,096 parameter intervals")
	}
	period := 4 * math.Pi
	endpoint := func(v float64, key, name string) (float64, error) {
		if !finite(v) || v < -rootTolerance || v > period+rootTolerance {
			return 0, fieldErr("root."+key, "%s must be between 0 and 4π", name)
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
	circle := newRootCircle(rad, k, p.Direction, sigma)
	grid := circle.grid(n)
	h := period / float64(n)
	big := rad * (1 + k)
	larger := math.Max(big, math.Sqrt(big))
	center, reach := 1.25*larger, 1.15*larger
	bound := math.Sqrt(big*big + big)
	now := from*(1-p.Trace) + to*p.Trace
	winding := 0
	if k < 1 {
		winding = 1
	}
	diag := &RootDiagnostics{Parameter: now, Intervals: n, Refined: len(grid), Center: center, NormBound: bound,
		Offset: k, Winding: winding, Closest: rad * math.Abs(1-k),
		Projection: "declared 4D rotation R of q = (Re z, Im z, Re w, Im w), then drop the fourth coordinate: P = (Rq)_xyz, |P| ≤ |q| ≤ √(R² + R), R = max |z| = r(1 + k)",
		Diagram:    "z plane centered at (−c, 0) and w plane at (+c, 0), one scale; c = 1.25 max(R, √R)"}
	r.Root, r.Radius, r.Operation = diag, bound, "orthographic"
	d := Result{Object: "root", Operation: "diagram", Paths: []Path{}, Faces: []Face{}, Points: []Vec3{},
		Sections: []Section{}, Radius: 1.5 * larger}

	at := func(t float64) Vec4 {
		r.Evaluations++
		return circle.at(t)
	}
	lifted := func(v Vec4) Vec3 {
		u := rotate(v, q.Angles)
		return Vec3{u[0], u[1], u[2]}
	}
	source := func(v Vec4) Vec3 { return Vec3{v[0] - center, v[1], 0} }
	value := func(v Vec4) Vec3 { return Vec3{v[2] + center, v[3], 0} }
	residual := func(v Vec4) {
		a, b := v[2]*v[2]-v[3]*v[3], 2*v[2]*v[3]
		diag.Residual = math.Max(diag.Residual, math.Hypot(a-v[0], b-v[1]))
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
	// direction of travel, modulo 4π, split where the circuits meet.
	s := math.Mod(now, period)
	var pieces [][2]float64
	if to >= from {
		if s < 2*math.Pi {
			pieces = [][2]float64{{s + 2*math.Pi, period}, {0, s}}
		} else {
			pieces = [][2]float64{{s - 2*math.Pi, 2 * math.Pi}, {2 * math.Pi, s}}
		}
	} else if s < 2*math.Pi {
		pieces = [][2]float64{{s, 2 * math.Pi}, {2 * math.Pi, s + 2*math.Pi}}
	} else {
		pieces = [][2]float64{{s, period}, {0, s - 2*math.Pi}}
	}
	var traced [][2]float64
	for _, piece := range pieces {
		if piece[1]-piece[0] > 1e-6*h {
			traced = append(traced, piece)
		}
	}

	// Count every returned point before evaluating any: three views of
	// each piece, nine markers and ten guide points, and for a missing
	// circle the other sheet's loop in two views.
	points := 9 + 10
	for _, piece := range append([][2]float64{{0, 2 * math.Pi}, {2 * math.Pi, period}}, traced...) {
		points += 3 * len(parameters(piece[0], piece[1]))
	}
	if winding == 0 {
		points += 2 * len(parameters(0, 2*math.Pi))
	}
	if points > maxPoints {
		return r, fmt.Errorf("square-root journey exceeds budget: at most 65,536 points")
	}

	// One parameter interval within a circuit, in all three views.
	emit := func(id, role string, a, b float64) {
		circuit := 1
		if a >= 2*math.Pi {
			circuit = 2
		}
		ts := parameters(a, b)
		branch := fmt.Sprint(circuit)
		family := 2 * (circuit - 1)
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
	emit("circuit/1", "circuit", 0, 2*math.Pi)
	emit("circuit/2", "circuit", 2*math.Pi, period)
	for i, piece := range traced {
		emit(fmt.Sprintf("trace/%d", i), "trace", piece[0], piece[1])
	}
	// Over a missing circle, w² = z has two disjoint loops, and the
	// journey keeps to one. The other sheet's loop, (z, −w) over one
	// circuit, is a quiet guide in the w plane and the 4D view; the z
	// plane already shows its circle. Over an enclosing circle both
	// sheets are the one loop the circuits draw.
	if winding == 0 {
		ts := parameters(0, 2*math.Pi)
		four := Path{Source: "root/lifted/other-sheet", Role: "other-sheet", Branch: "0", Guide: true, Dashed: true, Family: 3,
			Parameters: ts, FourPoints: make([]Vec4, len(ts)), Points: make([]Vec3, len(ts))}
		w := Path{Source: "root/value/other-sheet", Role: "other-sheet", Branch: "0", Guide: true, Dashed: true, Family: 3,
			Parameters: ts, Points: make([]Vec3, len(ts))}
		for i, t := range ts {
			v := at(t)
			v[2], v[3] = -v[2], -v[3]
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

	diag.Circuit = 1
	if s >= 2*math.Pi {
		diag.Circuit = 2
	}
	diag.Z, diag.W = [2]float64{current[0], current[1]}, [2]float64{current[2], current[3]}
	diag.Norm = math.Sqrt(current[0]*current[0] + current[1]*current[1] + current[2]*current[2] + current[3]*current[3])
	// The principal root has argument Arg z / 2 in (−π/2, π/2].
	ps, pc := math.Sincos(math.Atan2(current[1], current[0]) / 2)
	diag.Principal = 1
	if current[2]*pc+current[3]*ps < 0 {
		diag.Principal = -1
	}
	r.Companion = &d
	return r, nil
}
