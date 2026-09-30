package engine4

import (
	"fmt"
	"math"
	"sort"
)

type BypassParameters struct {
	Inner    float64 `json:"inner"`
	Outer    float64 `json:"outer"`
	Extent   float64 `json:"extent"`
	Outside  Vec3    `json:"outside"`
	Height   float64 `json:"height"`
	Position float64 `json:"position"`
	Obstacle string  `json:"obstacle"`
	W1       float64 `json:"w1"`
	W2       float64 `json:"w2"`
}
type RouteHit struct {
	From float64 `json:"from"`
	To   float64 `json:"to"`
}
type BypassDiagnostics struct {
	State          string     `json:"state"`
	Clearance      float64    `json:"clearance"`
	Current        Vec4       `json:"current"`
	Position       float64    `json:"position"`
	Distance       float64    `json:"distance"`
	ShadowDistance float64    `json:"shadowDistance"`
	Hits           []RouteHit `json:"hits"`
}
type Marker struct {
	ID        string `json:"id"`
	Role      string `json:"role"`
	Point     Vec3   `json:"point"`
	FourPoint Vec4   `json:"fourPoint"`
	Family    int    `json:"family"`
}

// The obstacle is expressed in an orthonormal frame. Production uses the
// canonical frame; the same classifier supports common rigid-motion checks.
type shellObstacle struct {
	inner, outer, extent float64
	radial               bool
	origin               Vec4
	axes                 [4]Vec4
}

func newShellObstacle(l BypassParameters) shellObstacle {
	o := shellObstacle{inner: l.Inner, outer: l.Outer, extent: l.Extent, radial: l.Obstacle == "radial"}
	for i := range o.axes {
		o.axes[i][i] = 1
	}
	return o
}
func (o shellObstacle) local(v Vec4) Vec4 {
	q := Vec4{}
	for i := range q {
		for j := range v {
			q[i] += (v[j] - o.origin[j]) * o.axes[i][j]
		}
	}
	return q
}
func interpolate4(a, b Vec4, t float64) Vec4 {
	if t == 0 {
		return a
	}
	if t == 1 {
		return b
	}
	q := Vec4{}
	for i := range q {
		q[i] = a[i]*(1-t) + b[i]*t
	}
	return q
}
func shellRadius(v Vec4, radial bool) float64 {
	n := 3
	if radial {
		n = 4
	}
	s := 0.
	for i := 0; i < n; i++ {
		s += v[i] * v[i]
	}
	return math.Sqrt(s)
}
func (o shellObstacle) contains(v Vec4, tolerance float64) bool {
	r := shellRadius(v, o.radial)
	return r >= o.inner-tolerance && r <= o.outer+tolerance && (o.radial || math.Abs(v[3]) <= o.extent+tolerance)
}
func sphereCrossings(a, b Vec4, r float64, radial bool) []float64 {
	n := 3
	if radial {
		n = 4
	}
	dd, ad := 0., 0.
	d := Vec4{}
	for i := 0; i < n; i++ {
		d[i] = b[i] - a[i]
		dd += d[i] * d[i]
		ad += a[i] * d[i]
	}
	if dd == 0 {
		return nil
	}
	mid := -ad / dd
	residual := r * r
	for i := 0; i < n; i++ {
		v := a[i] + mid*d[i]
		residual -= v * v
	}
	tol := 1e-12 + 1e-12*r*r
	if residual < -tol {
		return nil
	}
	h := math.Sqrt(math.Max(0, residual) / dd)
	return []float64{mid - h, mid + h}
}

// Every sphere/slab event partitions the complete segment before membership
// classification. No sample count enters the collision decision.
func shellSegment(a, b Vec4, o shellObstacle, operations *int) []interval {
	a, b = o.local(a), o.local(b)
	cuts := []float64{0, 1}
	cuts = append(cuts, sphereCrossings(a, b, o.inner, o.radial)...)
	cuts = append(cuts, sphereCrossings(a, b, o.outer, o.radial)...)
	if !o.radial && a[3] != b[3] {
		for _, w := range []float64{-o.extent, o.extent} {
			cuts = append(cuts, (w-a[3])/(b[3]-a[3]))
		}
	}
	cuts = sortedParameters(cuts)
	inside := func(t, tol float64) bool { *operations++; return o.contains(interpolate4(a, b, t), tol) }
	pieces := []interval{}
	for i := 1; i < len(cuts); i++ {
		lo, hi := cuts[i-1], cuts[i]
		if !inside((lo+hi)/2, 0) {
			continue
		}
		if len(pieces) > 0 && pieces[len(pieces)-1].hi == lo {
			pieces[len(pieces)-1].hi = hi
		} else {
			pieces = append(pieces, interval{lo, hi})
		}
	}
	tolerance := 1e-12 + 1e-10*o.outer
	for _, t := range cuts {
		if !inside(t, tolerance) {
			continue
		}
		covered := false
		for _, s := range pieces {
			if t >= s.lo && t <= s.hi {
				covered = true
				break
			}
		}
		if !covered {
			pieces = append(pieces, interval{t, t})
		}
	}
	sort.Slice(pieces, func(i, j int) bool { return pieces[i].lo < pieces[j].lo })
	return pieces
}
func bypass(q Request, r Result) (Result, error) {
	if q.Mode != "shadow" && q.Mode != "diagram" {
		return r, fmt.Errorf("choose XYZ shadow or Coordinate diagram")
	}
	if q.Bypass == nil {
		return r, fmt.Errorf("shell bypass parameters are required")
	}
	l := *q.Bypass
	if l.Obstacle != "embedded" && l.Obstacle != "radial" {
		return r, fmt.Errorf("choose an embedded or radial obstacle")
	}
	if !finite(l.Inner) || l.Inner < .05 || l.Inner > 10 {
		return r, fmt.Errorf("Inner radius a must be between 0.05 and 10")
	}
	if !finite(l.Outer) || l.Outer-l.Inner < .001 || l.Outer > 20 {
		return r, fmt.Errorf("Outer radius b must exceed a by at least 0.001 and be at most 20")
	}
	if l.Obstacle == "embedded" && (!finite(l.Extent) || l.Extent < 0 || l.Extent > 5) {
		return r, fmt.Errorf("Fourth-coordinate extent ε must be between 0 and 5")
	}
	if l.Obstacle == "radial" {
		l.Extent = 0
	}
	if !finite(l.Height) || l.Height < 0 || l.Height > 20 {
		return r, fmt.Errorf("Route height H must be between 0 and 20")
	}
	if !finite(l.Position) || l.Position < 0 || l.Position > 1 {
		return r, fmt.Errorf("Route position s must be between 0 and 1")
	}
	for i, v := range l.Outside {
		if !finite(v) || math.Abs(v) > 20 {
			return r, fmt.Errorf("Outside point %s must be finite and within ±20", []string{"x", "y", "z"}[i])
		}
	}
	outside := math.Sqrt(dot(l.Outside, l.Outside))
	if outside <= l.Outer || outside > 40 {
		return r, fmt.Errorf("Outside point radius must exceed b and be at most 40")
	}
	for _, f := range []struct {
		name string
		v    float64
	}{{"First comparison w", l.W1}, {"Second comparison w", l.W2}} {
		if !finite(f.v) || math.Abs(f.v) > 20 {
			return r, fmt.Errorf("%s must be finite and within ±20", f.name)
		}
	}
	if q.Samples < 8 || q.Samples > 256 {
		return r, fmt.Errorf("use 8–256 shell samples")
	}
	vertices := []Vec4{{l.Outside[0], l.Outside[1], l.Outside[2], 0}, {l.Outside[0], l.Outside[1], l.Outside[2], l.Height}, {0, 0, 0, l.Height}, {0, 0, 0, 0}}
	leg := math.Min(2, math.Floor(3*l.Position))
	k := int(leg)
	t := 3*l.Position - leg
	current := interpolate4(vertices[k], vertices[k+1], t)
	o := newShellObstacle(l)
	d := &BypassDiagnostics{State: "clear", Current: current, Position: l.Position, Distance: math.Abs(l.W2 - l.W1), ShadowDistance: 0, Hits: []RouteHit{}}
	for i := 0; i < 3; i++ {
		for _, hit := range shellSegment(vertices[i], vertices[i+1], o, &r.Evaluations) {
			d.Hits = append(d.Hits, RouteHit{(float64(i) + hit.lo) / 3, (float64(i) + hit.hi) / 3})
			if d.State == "clear" {
				d.State = "contact"
			}
			v := interpolate4(vertices[i], vertices[i+1], (hit.lo+hit.hi)/2)
			rho := shellRadius(v, o.radial)
			if hit.hi > hit.lo && rho > l.Inner && rho < l.Outer && (o.radial || l.Extent == 0 || math.Abs(v[3]) < l.Extent) {
				d.State = "crossing"
			}
		}
	}
	d.Clearance = math.Min(outside-l.Outer, math.Min(l.Inner, math.Max(0, l.Height-l.Extent)))
	if l.Obstacle == "radial" || d.State != "clear" {
		d.Clearance = 0
	}
	r.Bypass = d
	// Each representation has fixed framing over the entire route and comparison.
	wLo := math.Min(-l.Extent, math.Min(l.W1, l.W2))
	wHi := math.Max(l.Height, math.Max(l.W1, l.W2))
	if o.radial {
		wLo = math.Min(wLo, -l.Outer)
		wHi = math.Max(wHi, l.Outer)
	}
	project := func(v Vec4) Vec3 {
		if q.Mode == "diagram" {
			return Vec3{shellRadius(v, false) - outside/2, v[3] - (wLo+wHi)/2, 0}
		}
		return Vec3{v[0], v[1], v[2]}
	}
	r.Radius = outside
	if q.Mode == "diagram" {
		r.Radius = math.Hypot(outside/2, (wHi-wLo)/2)
	}
	add := func(id, role string, family int, guide, dashed bool, vs []Vec4, ts []float64) {
		p := Path{Source: id, Branch: "0", Role: role, Family: family, Guide: guide, Dashed: dashed, FourPoints: vs, Parameters: ts}
		for _, v := range vs {
			p.Points = append(p.Points, project(v))
			r.Evaluations++
		}
		if len(vs) == 1 {
			p.Points = append(p.Points, p.Points[0])
			p.FourPoints = append(p.FourPoints, p.FourPoints[0])
			p.Parameters = append(p.Parameters, p.Parameters[0])
		}
		r.Paths = append(r.Paths, p)
	}
	add("bypass/route", "route-context", 0, false, true, vertices, []float64{0, 1. / 3, 2. / 3, 1})
	prefix := []Vec4{vertices[0]}
	parameters := []float64{0}
	for i := 1; i < 4; i++ {
		s := float64(i) / 3
		if s < l.Position {
			prefix = append(prefix, vertices[i])
			parameters = append(parameters, s)
		}
	}
	if l.Position > 0 {
		prefix = append(prefix, current)
		parameters = append(parameters, l.Position)
	}
	family := 0
	if d.State != "clear" {
		family = 3
	}
	add("bypass/traveled", "route-traveled", family, false, d.State != "clear", prefix, parameters)
	for i, hit := range d.Hits {
		at := func(s float64) Vec4 {
			j := int(math.Min(2, math.Floor(3*s)))
			return interpolate4(vertices[j], vertices[j+1], 3*s-float64(j))
		}
		add(fmt.Sprintf("bypass/hit/%d", i), "collision", 3, false, true, []Vec4{at(hit.From), at(hit.To)}, []float64{hit.From, hit.To})
	}
	if q.Mode == "diagram" {
		if o.radial {
			for i, radius := range []float64{l.Inner, l.Outer} {
				vs := []Vec4{}
				for j := 0; j <= q.Samples; j++ {
					a := -math.Pi/2 + math.Pi*float64(j)/float64(q.Samples)
					vs = append(vs, Vec4{math.Max(0, radius*math.Cos(a)), 0, 0, radius * math.Sin(a)})
				}
				add(fmt.Sprintf("bypass/shell/%d", i), "shell", i+1, true, false, vs, nil)
			}
		} else {
			add("bypass/shell", "shell", 1, true, false, []Vec4{{l.Inner, 0, 0, -l.Extent}, {l.Outer, 0, 0, -l.Extent}, {l.Outer, 0, 0, l.Extent}, {l.Inner, 0, 0, l.Extent}, {l.Inner, 0, 0, -l.Extent}}, nil)
		}
		add("bypass/radial-axis", "axes", 2, true, true, []Vec4{{0, 0, 0, 0}, {outside, 0, 0, 0}}, nil)
		add("bypass/w-axis", "axes", 2, true, true, []Vec4{{0, 0, 0, wLo}, {0, 0, 0, wHi}}, nil)
	} else {
		for i, radius := range []float64{l.Inner, l.Outer} {
			for plane := 0; plane < 3; plane++ {
				vs := []Vec4{}
				for j := 0; j <= q.Samples; j++ {
					a := 2 * math.Pi * float64(j) / float64(q.Samples)
					if j == q.Samples {
						a = 0
					}
					v := Vec4{}
					v[plane] = radius * math.Cos(a)
					v[(plane+1)%3] = radius * math.Sin(a)
					vs = append(vs, v)
				}
				add(fmt.Sprintf("bypass/shell/%d/%d", i, plane), "shell", i+1, true, false, vs, nil)
			}
		}
	}
	for _, m := range []struct {
		id, role string
		v        Vec4
		family   int
	}{{"bypass/moving", "moving", current, family}, {"bypass/q1", "comparison", Vec4{l.Inner / 2, 0, 0, l.W1}, 1}, {"bypass/q2", "comparison", Vec4{l.Inner / 2, 0, 0, l.W2}, 2}} {
		r.Markers = append(r.Markers, Marker{m.id, m.role, project(m.v), m.v, m.family})
		r.Evaluations++
	}
	return r, nil
}
