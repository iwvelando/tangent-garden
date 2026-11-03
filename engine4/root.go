package engine4

import (
	"fmt"
	"math"
)

// The square-root journey (R15.1 prototype). A point travels twice around
// the circle z = r e^{it} while its continuously followed square root
// w = σ√r e^{it/2} travels once around |w| = √r, for the unwrapped
// parameter 0 ≤ t ≤ 4π. The relation w² = z is a complex curve in
// C² = R⁴, here q(t) = (Re z, Im z, Re w, Im w), with |q|² = r² + r.
//
// t is never reduced modulo 2π: that would put both circuits on one
// sheet. The true period is 4π, so the moving point is evaluated at
// t mod 4π, and t = 4π draws exactly what t = 0 draws.

// Entered endpoints within this distance of 0 or 4π are those endpoints:
// constant expressions such as 2*pi*2 may round past 4π.
const rootTolerance = 1e-12

const (
	rootMinRadius    = 0.25
	rootMaxRadius    = 4
	rootMinIntervals = 64
	rootMaxIntervals = 4096
)

type RootParameters struct {
	Radius float64 `json:"radius"`
	Sheet  string  `json:"sheet"` // "plus" or "minus": w(0) = +√r or −√r
	From   float64 `json:"from"`
	To     float64 `json:"to"`
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
	Residual  float64 `json:"residual"`
	NormBound float64 `json:"normBound"`
	Intervals int     `json:"intervals"`
	// The diagram places the z plane's origin at (−Center, 0) and the w
	// plane's at (+Center, 0), at one scale.
	Center     float64 `json:"center"`
	Projection string  `json:"projection"`
	Diagram    string  `json:"diagram"`
}

// rootPoints bounds the returned points of all three views before
// evaluation. A segment of parameter length 2π holds at most n/2 + 2 grid
// points and its two ends; each view draws two circuits, a trace of at most
// two pieces, and three markers; the diagram adds four axes and the cut.
func rootPoints(n int) int {
	segment := n/2 + 4
	view := 2*segment + (n/2 + 6) + 3
	return 3*view + 10
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
	sigma := 1.
	switch p.Sheet {
	case "plus":
	case "minus":
		sigma = -1
	default:
		return r, fieldErr("root.sheet", "Initial sheet must be +√r or −√r")
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
	if rootPoints(q.Samples) > maxPoints {
		return r, fmt.Errorf("square-root journey exceeds budget: at most 65,536 points")
	}

	n, rad := q.Samples, p.Radius
	root := math.Sqrt(rad)
	h := period / float64(n)
	larger := math.Max(rad, root)
	center, reach := 1.25*larger, 1.15*larger
	bound := math.Sqrt(rad*rad + rad)
	now := from*(1-p.Trace) + to*p.Trace
	diag := &RootDiagnostics{Parameter: now, Intervals: n, Center: center, NormBound: bound,
		Projection: "declared 4D rotation R of q = (Re z, Im z, Re w, Im w), then drop the fourth coordinate: P = (Rq)_xyz, |P| ≤ |q| = √(r² + r)",
		Diagram:    "z plane centered at (−c, 0) and w plane at (+c, 0), one scale; c = 1.25 max(r, √r)"}
	r.Root, r.Radius, r.Operation = diag, bound, "orthographic"
	d := Result{Object: "root", Operation: "diagram", Paths: []Path{}, Faces: []Face{}, Points: []Vec3{},
		Sections: []Section{}, Radius: 1.5 * larger}

	at := func(t float64) Vec4 {
		sz, cz := math.Sincos(t)
		sw, cw := math.Sincos(t / 2)
		r.Evaluations++
		return Vec4{rad * cz, rad * sz, sigma * root * cw, sigma * root * sw}
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
		for k := math.Floor(a/h) + 1; k*h < b-eps; k++ {
			if k*h-a > eps {
				ts = append(ts, k*h)
			}
		}
		return append(ts, b)
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
	k := 0
	for _, piece := range pieces {
		if piece[1]-piece[0] > 1e-6*h {
			emit(fmt.Sprintf("trace/%d", k), "trace", piece[0], piece[1])
			k++
		}
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
	// The principal root has argument Arg z / 2 in (−π/2, π/2].
	ps, pc := math.Sincos(math.Atan2(current[1], current[0]) / 2)
	diag.Principal = 1
	if current[2]*pc+current[3]*ps < 0 {
		diag.Principal = -1
	}
	r.Companion = &d
	return r, nil
}
