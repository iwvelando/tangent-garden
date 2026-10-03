package engine4

import (
	"fmt"
	"math"
	"sort"
)

// The slab has a fixed modelling half-thickness, in the source's units.
const liftThickness = .02

// The circular strand is (circleRadius cos 2πt, circleRadius sin 2πt,
// circleHeight). Every source point lies within sourceExtent = |(3, 1, 0)|.
const circleRadius, circleHeight = 1.75, .5

var sourceExtent = math.Sqrt(10)

type LiftParameters struct {
	Center     Vec3    `json:"center"`
	Support    float64 `json:"support"`
	Height     float64 `json:"height"`
	Angle      float64 `json:"angle"`
	From       Vec3    `json:"from"`
	To         Vec3    `json:"to"`
	RadiusFrom float64 `json:"radiusFrom"`
	RadiusTo   float64 `json:"radiusTo"`
}
type LiftDiagnostics struct {
	Thickness        float64 `json:"thickness"`
	MissingRadius    float64 `json:"missingRadius"`
	Sources          int     `json:"sources"`
	VisibleIntervals int     `json:"visibleIntervals"`
	AbsentSources    int     `json:"absentSources"`
	Projection       string  `json:"projection"`
}
type liftCurve struct {
	id     string
	family int
	point  func(float64) Vec3
	events func(Vec3, float64) []float64
	closed bool // parameters 0 and 1 identify the same source point
}
type interval struct{ lo, hi float64 }

func liftHeight(p Vec3, q LiftParameters) float64 {
	d := sub(p, q.Center)
	s2 := dot(d, d) / (q.Support * q.Support)
	if s2 >= 1 {
		return 0
	}
	return q.Height * (1 - s2) * (1 - s2)
}
func missingRadius(q LiftParameters) float64 {
	if q.Height <= liftThickness {
		return 0
	}
	return q.Support * math.Sqrt(1-math.Sqrt(liftThickness/q.Height))
}

// Closest-point geometry avoids subtracting a large quadratic discriminant.
// Return crossings and the closest parameter: sampling must also see a bump
// lying wholly between two original subdivisions.
func lineEvents(a, b, c Vec3, r float64) []float64 {
	d := sub(b, a)
	v := sub(a, c)
	dd := dot(d, d)
	mid := -dot(v, d) / dd
	p := Vec3{v[0] + mid*d[0], v[1] + mid*d[1], v[2] + mid*d[2]}
	residual := r*r - dot(p, p)
	tol := 1e-12 + 1e-10*math.Max(1, r*r)
	roots := []float64{mid}
	if residual >= -tol {
		h := math.Sqrt(math.Max(0, residual) / dd)
		roots = append(roots, mid-h, mid+h)
	}
	return roots
}
func circleEvents(c Vec3, r float64) []float64 {
	// Distance squared to the strand is constant minus
	// 2 circleRadius (cx cos u + cy sin u).
	length := math.Hypot(c[0], c[1])
	if length == 0 {
		return nil
	}
	phase := math.Atan2(c[1], c[0])
	k := (circleRadius*circleRadius + length*length + (circleHeight-c[2])*(circleHeight-c[2]) - r*r) / (2 * circleRadius * length)
	angles := []float64{phase, phase + math.Pi}
	if k >= -1-1e-12 && k <= 1+1e-12 {
		a := math.Acos(math.Max(-1, math.Min(1, k)))
		angles = append(angles, phase-a, phase+a)
	}
	roots := []float64{}
	for _, a := range angles {
		a = math.Mod(a, 2*math.Pi)
		if a < 0 {
			a += 2 * math.Pi
		}
		roots = append(roots, a/(2*math.Pi))
	}
	return roots
}
func liftSources() []liftCurve {
	sources := []liftCurve{}
	for i := 0; i < 5; i++ {
		y := float64(i-2) * .5
		a, b := Vec3{-3, y, 0}, Vec3{3, y, 0}
		sources = append(sources, liftCurve{id: fmt.Sprintf("lift/thread/%d", i), family: 0,
			point:  func(t float64) Vec3 { return Vec3{-3 + 6*t, y, 0} },
			events: func(c Vec3, r float64) []float64 { return lineEvents(a, b, c, r) }})
	}
	sources = append(sources, liftCurve{id: "lift/circle", family: 1, point: func(t float64) Vec3 {
		if t == 1 {
			t = 0
		}
		a := 2 * math.Pi * t
		return Vec3{circleRadius * math.Cos(a), circleRadius * math.Sin(a), circleHeight}
	}, events: circleEvents, closed: true})
	return sources
}
func sortedParameters(values []float64) []float64 {
	sort.Float64s(values)
	out := []float64{}
	for _, v := range values {
		if v >= 0 && v <= 1 && (len(out) == 0 || v-out[len(out)-1] > 1e-13) {
			out = append(out, v)
		}
	}
	return out
}

// Partition before sampling. Retain equality, including isolated contacts.
func presentIntervals(source liftCurve, c Vec3, r float64) []interval {
	if r == 0 {
		return []interval{{0, 1}}
	}
	cuts := sortedParameters(append([]float64{0, 1}, source.events(c, r)...))
	// The present set is closed. Its squared-distance tolerance scales with the
	// rounding of |C(t)−c|² near the boundary, about r times the coordinate
	// magnitude (|c| ≤ sourceExtent + r wherever contact is possible), so a
	// tangency or coincident boundary arc is not split a few ulps inside.
	tolerance := 1e-12 * r * (r + sourceExtent)
	present := func(t float64) bool {
		d := sub(source.point(t), c)
		return dot(d, d) >= r*r-tolerance
	}
	out := []interval{}
	for i := 1; i < len(cuts); i++ {
		lo, hi := cuts[i-1], cuts[i]
		if !present((lo + hi) / 2) {
			continue
		}
		if len(out) > 0 && out[len(out)-1].hi == lo {
			out[len(out)-1].hi = hi
		} else {
			out = append(out, interval{lo, hi})
		}
	}
	for _, t := range cuts {
		if !present(t) {
			continue
		}
		covered := false
		for _, s := range out {
			if t >= s.lo && t <= s.hi {
				covered = true
				break
			}
		}
		if !covered {
			out = append(out, interval{t, t})
		}
	}
	sort.Slice(out, func(i, j int) bool { return out[i].lo < out[j].lo })
	if source.closed && len(out) > 1 && out[0].lo == 0 && out[len(out)-1].hi == 1 {
		// A seam contact belongs to either adjacent arc, or to one canonical
		// point at t=0 when both intervals are isolated contacts.
		if out[len(out)-1].lo == 1 {
			out = out[:len(out)-1]
		} else if out[0].hi == 0 {
			out = out[1:]
		}
	}
	return out
}

func presentIntervalCount(source liftCurve, pieces []interval) int {
	n := len(pieces)
	if source.closed && n > 1 && pieces[0].lo == 0 && pieces[n-1].hi == 1 {
		// The drawing has two parameter pieces, but the source arc is joined
		// through its identified endpoints. Never draw across the missing arc.
		n--
	}
	return n
}
func lifted(q Request, r Result) (Result, error) {
	if q.Mode != "reference" && q.Mode != "lifted" {
		return r, fieldErr("mode", "choose Reference slice or Lifted construction")
	}
	if q.Lift == nil {
		return r, fmt.Errorf("localized lift parameters are required")
	}
	l := *q.Lift
	for _, field := range []struct {
		name, key string
		v         Vec3
	}{{"Lift center", "center", l.Center}, {"Drift start", "from", l.From}, {"Drift end", "to", l.To}} {
		for i, v := range field.v {
			if !finite(v) || math.Abs(v) > 20 {
				return r, fieldErr(fmt.Sprintf("lift.%s.%d", field.key, i), "%s coordinates must be finite and within ±20", field.name)
			}
		}
	}
	for _, field := range []struct {
		name, key string
		v         float64
	}{{"Lift support radius L", "support", l.Support}, {"Support start", "radiusFrom", l.RadiusFrom}, {"Support end", "radiusTo", l.RadiusTo}} {
		if !finite(field.v) || field.v < .05 || field.v > 20 {
			return r, fieldErr("lift."+field.key, "%s must be between 0.05 and 20", field.name)
		}
	}
	if !finite(l.Height) || l.Height < 0 || l.Height > 10 {
		return r, fieldErr("lift.height", "Lift height A must be between 0 and 10")
	}
	if q.Mode == "lifted" && (!finite(l.Angle) || math.Abs(l.Angle) > 1e6) {
		return r, fieldErr("lift.angle", "Presentation xw angle must be finite and within ±1000000 radians")
	}
	if q.Samples < 8 || q.Samples > 256 {
		return r, fieldErr("samples", "use 8–256 thread samples")
	}
	// Static over either motion and both linked views, including optional guides.
	bound := math.Max(l.Support, math.Max(l.RadiusFrom, l.RadiusTo))
	for _, c := range []Vec3{l.Center, l.From, l.To} {
		bound = math.Max(bound, math.Sqrt(dot(c, c))+math.Max(l.Support, math.Max(l.RadiusFrom, l.RadiusTo)))
	}
	r.Radius = math.Max(math.Hypot(sourceExtent, l.Height), bound)
	hole := missingRadius(l)
	sources := liftSources()
	diag := &LiftDiagnostics{Thickness: liftThickness, MissingRadius: hole, Sources: len(sources), Projection: "reference slice w = 0; no presentation rotation"}
	if q.Mode == "lifted" {
		diag.Projection = "xw presentation rotation, then orthographic xyz projection"
	}
	r.Lift = diag
	project := func(v Vec4) Vec3 {
		if q.Mode == "lifted" {
			s, c := math.Sincos(l.Angle)
			v[0] = c*v[0] - s*v[3]
		}
		return Vec3{v[0], v[1], v[2]}
	}
	point := func(source liftCurve, t float64) Vec4 {
		p := source.point(t)
		return Vec4{p[0], p[1], p[2], liftHeight(p, l)}
	}
	for _, source := range sources {
		evaluate := source.point
		source.point = func(t float64) Vec3 { r.Evaluations++; return evaluate(t) }
		visible := presentIntervals(source, l.Center, hole)
		events := append(source.events(l.Center, l.Support), source.events(l.Center, hole)...)
		diag.VisibleIntervals += presentIntervalCount(source, visible)
		if len(visible) == 0 {
			diag.AbsentSources++
		}
		pieces := visible
		role := "reference"
		if q.Mode == "lifted" {
			pieces = []interval{{0, 1}}
			role = "lifted"
		}
		for i, piece := range pieces {
			ts := []float64{piece.lo, piece.hi}
			for j := 1; j < q.Samples; j++ {
				t := float64(j) / float64(q.Samples)
				if t > piece.lo && t < piece.hi {
					ts = append(ts, t)
				}
			}
			for _, t := range events {
				if t > piece.lo && t < piece.hi {
					ts = append(ts, t)
				}
			}
			ts = sortedParameters(ts)
			path := Path{Source: source.id, Branch: fmt.Sprint(i), Role: role, Family: source.family}
			for _, t := range ts {
				v := point(source, t)
				if q.Mode == "reference" {
					v[3] = 0
				}
				path.Parameters = append(path.Parameters, t)
				path.FourPoints = append(path.FourPoints, v)
				path.Points = append(path.Points, project(v))
			}
			// Round-capped zero-length paths retain isolated tangent contacts.
			if len(ts) == 1 {
				path.Parameters = append(path.Parameters, ts[0])
				path.FourPoints = append(path.FourPoints, path.FourPoints[0])
				path.Points = append(path.Points, path.Points[0])
			}
			r.Paths = append(r.Paths, path)
		}
		if q.Mode == "lifted" {
			for j := 0; j <= 8; j++ {
				t := float64(j) / 8
				v := point(source, t)
				if v[3] == 0 {
					continue
				}
				base := v
				base[3] = 0
				r.Paths = append(r.Paths, Path{Source: source.id, Branch: fmt.Sprint(j), Role: "displacement", Guide: true, Family: 3, Parameters: []float64{t, t}, FourPoints: []Vec4{base, v}, Points: []Vec3{project(base), project(v)}})
			}
		}
	}
	if hole > 0 {
		for k := 0; k < 3; k++ {
			path := Path{Source: fmt.Sprintf("lift/missing-guide/%d", k), Branch: "0", Role: "missing-guide", Guide: true, Family: 2}
			for j := 0; j <= q.Samples; j++ {
				a := 2 * math.Pi * float64(j) / float64(q.Samples)
				if j == q.Samples {
					a = 0
				}
				v := Vec4{l.Center[0], l.Center[1], l.Center[2], 0}
				v[k] += hole * math.Cos(a)
				v[(k+1)%3] += hole * math.Sin(a)
				path.Points = append(path.Points, project(v))
				r.Evaluations++
			}
			r.Paths = append(r.Paths, path)
		}
	}
	return r, nil
}
