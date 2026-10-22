package engine

import (
	"math"
	"sort"
	"tangentgarden/engine/refine"
)

// Refinement between samples: points inserted between a drawn curve's
// uniform samples wherever the chord joining them strays from the curve
// (engine/refine, shared with the spatial engine). The uniform samples stay
// the study's identity: its construction lines and circles, reveal and
// probe keep them, and so does framing unless the study asks for each
// curve's reach (Request.AdaptiveFrame).

// RefinedPath is a drawn curve with its refinement (see refine.Path):
// points in parameter order, each at its position in sample steps, with a
// null at every break. A caustic's or chord envelope's points also say
// whether each is virtual, behind its ray's origin or beyond its chord, as
// the result's own Virtual does at the samples.
type RefinedPath struct {
	Points     []*Vec    `json:"points"`
	At         []float64 `json:"at"`
	Tolerance  float64   `json:"tolerance"`
	Inserted   int       `json:"inserted"`
	Breaks     int       `json:"breaks"`
	Unresolved int       `json:"unresolved"`
	Exhausted  bool      `json:"exhausted"`
	Virtual    []bool    `json:"virtual,omitempty"`
	// View is the tolerance of the pieces that meet the view, when a view
	// finer than the study's tolerance was given.
	View float64 `json:"view,omitempty"`
	// Reach, when the study asks for it (AdaptiveFrame), is what the
	// points between samples add to the curve's extent: those outside the
	// box of their interval's two samples, in order, refined to the
	// curve's own tolerance whatever the view, so zooming never moves the
	// framing. ReachAt is each one's position in sample steps, so a reveal
	// shows only what it has reached.
	Reach   []Vec     `json:"reach,omitempty"`
	ReachAt []float64 `json:"reachAt,omitempty"`
}

// AdaptiveResult holds the refined curves a study draws: the base curve, the
// derived input a construction acts on, and the derived curve where it is
// defined pointwise from its input's position and stencil derivatives (a
// pedal, contrapedal or orthotomic curve, the evolute, an offset or each
// member of an offset stack, a catacaustic or diacaustic, or an inversion's
// image), the involute and a rolling circle's or curve's trace, whose arc
// length continues from each sample, and an envelope of lines or chords. A
// path that is not drawn, or cannot be evaluated between samples, is absent.
type AdaptiveResult struct {
	Base    *RefinedPath `json:"base,omitempty"`
	Input   *RefinedPath `json:"input,omitempty"`
	Derived *RefinedPath `json:"derived,omitempty"`
	// Family holds an offset stack's members, or a circle envelope's left
	// and right branches, refined each on its own, in the order of the
	// result's family.
	Family []*RefinedPath `json:"family,omitempty"`
}

// refines reports whether a curve format can be evaluated between samples:
// not an integrated chase or trajectory, whose solver already takes
// adaptive steps, nor a level set or iterated map, which have no parameter.
func refines(format string) bool {
	switch format {
	case "", "parametric", "cartesian", "polar", "roulette", "lissajous", "fourier":
		return true
	}
	return false
}

// plane measures points for refinement.
var plane = refine.Metric[Vec]{
	Distance: func(p, a, b Vec) float64 {
		d := b.Sub(a)
		s := 0.0
		if l := d.Dot(d); l > 0 {
			s = math.Max(0, math.Min(1, p.Sub(a).Dot(d)/l))
		}
		return p.Sub(a.Add(d.Mul(s))).Norm()
	},
	Length: func(a, b Vec) float64 { return b.Sub(a).Norm() },
}

// studyRadius is refine.Radius of points, measured in a power of two near
// their interquartile spread, so that the floors refine.Radius applies, a
// radius of 10⁻⁴ and a spread of 10⁻¹², are relative to the curve's own
// size and a tiny study is not judged against a larger one. Scaling by a
// power of two is exact, so the radius is unchanged wherever the floors do
// not apply.
func studyRadius(points []*Vec) float64 {
	unit := spreadUnit(points)
	// One allocation for every scaled point, not one each: allocation
	// costs WASM's collector more than the arithmetic.
	scaled, values := make([]*Vec, len(points)), make([]Vec, len(points))
	for i, p := range points {
		if p != nil {
			values[i] = p.Mul(1 / unit)
			scaled[i] = &values[i]
		}
	}
	// Radius reads each point's coordinates before asking for the next.
	coords := make([]float64, 2)
	return unit * refine.Radius(scaled, func(p Vec) []float64 {
		coords[0], coords[1] = p.X, p.Y
		return coords
	})
}

// spreadUnit is the power of two at or below the larger interquartile
// range of points' coordinates, taken as refine.Radius takes its quartiles,
// or of their full range where that is zero, or of their largest
// quartile where the spread is only rounding, and 1 for points all at the
// origin.
func spreadUnit(points []*Vec) float64 {
	var xs, ys []float64
	for _, p := range points {
		if p != nil {
			xs, ys = append(xs, p.X), append(ys, p.Y)
		}
	}
	spread := func(full bool) float64 {
		out := 0.0
		for _, vs := range [][]float64{xs, ys} {
			lo, hi := vs[0], vs[len(vs)-1]
			if !full {
				lo, hi = vs[len(vs)/4], vs[3*len(vs)/4]
			}
			out = math.Max(out, hi-lo)
		}
		return out
	}
	if len(xs) == 0 {
		return 1
	}
	sort.Float64s(xs)
	sort.Float64s(ys)
	s := spread(false)
	if s == 0 {
		s = spread(true)
	}
	// A spread within 2⁻⁴⁰ of the points' quartiles' magnitude is rounding,
	// as where a curve collapses to a point: such points are measured in
	// that magnitude, which is as small as the study is, and which an
	// asymptote's outliers do not reach.
	magnitude := 0.0
	for _, vs := range [][]float64{xs, ys} {
		magnitude = math.Max(magnitude, math.Max(math.Abs(vs[len(vs)/4]), math.Abs(vs[3*len(vs)/4])))
	}
	if s <= 0x1p-40*magnitude {
		s = magnitude
	}
	return binade(s)
}

// focus is the refinement of a view (see refine.Focus): the pieces that
// meet it, or the margin of half its width and height on each side that a
// wider panel or a short pan shows, are refined to refine.Epsilon of its
// half diagonal, the fraction of the study's radius the rest is refined
// to, and to chords no longer than a quarter of that half diagonal, ahead
// of the rest.
func (v View) focus() refine.Focus[Vec] {
	r := math.Hypot(v.X1-v.X0, v.Y1-v.Y0) / 2
	if v.Radius != 0 {
		r = v.Radius
	}
	mx, my := (v.X1-v.X0)/2, (v.Y1-v.Y0)/2
	return refine.Focus[Vec]{
		Tolerance: refine.Epsilon * r,
		Chord:     r / 4,
		Meets: func(points []*Vec, grow float64) bool {
			x0, y0, x1, y1 := math.Inf(1), math.Inf(1), math.Inf(-1), math.Inf(-1)
			for _, p := range points {
				if p != nil {
					x0, y0 = math.Min(x0, p.X), math.Min(y0, p.Y)
					x1, y1 = math.Max(x1, p.X), math.Max(y1, p.Y)
				}
			}
			return x0-grow <= v.X1+mx && x1+grow >= v.X0-mx && y0-grow <= v.Y1+my && y1+grow >= v.Y0-my
		},
	}
}

// valid reports whether a view is a rectangle with finite corners, and its
// radius, when given, positive and finite.
func (v View) valid() bool {
	return Vec{v.X0, v.Y0}.Valid() && Vec{v.X1, v.Y1}.Valid() && v.X1 > v.X0 && v.Y1 > v.Y0 &&
		(v.Radius == 0 || v.Radius > 0 && !math.IsInf(v.Radius, 1))
}

// refinePath refines points, broken after each interval in broken, with the
// curve evaluated by at (see refine.Refine), at refine.Epsilon of the
// path's own robust radius, and more finely where it meets the view, when
// there is one. It returns the intervals refinement broke.
func refinePath(points []*Vec, broken map[int]bool, at func(float64) *Vec, lo, hi float64, view *View) (*RefinedPath, []int) {
	breaks := make([]bool, len(points))
	for i := range broken {
		breaks[i+1] = true
	}
	tolerance := refine.Epsilon * studyRadius(points)
	var path *refine.Path[Vec]
	var found []int
	var focused float64
	if view == nil {
		path, found = refine.Refine(points, breaks, at, plane, lo, hi, tolerance, refine.Budget)
	} else {
		focus := view.focus()
		path, found = refine.RefineFocused(points, breaks, at, plane, lo, hi, tolerance, refine.Budget, focus)
		if focus.Tolerance < tolerance {
			focused = focus.Tolerance
		}
	}
	return &RefinedPath{
		View:       focused,
		Points:     path.Points,
		At:         path.At,
		Tolerance:  path.Tolerance,
		Inserted:   path.Inserted,
		Breaks:     path.Breaks,
		Unresolved: path.Unresolved,
		Exhausted:  path.Exhausted,
	}, found
}

// adapt refines a computed study's drawn curves: the base from f, a derived
// input from g, and a derived curve or family defined pointwise from g, or
// from g and what the sample loop recorded: the involute's or rolling
// shape's progress, or an envelope's lines or circles. Intervals
// broken on a curve stay broken on the curves built on it. An inversion's
// image is refined in place of the uniform passage test, whose breaks it
// replaces.
func (q Request) adapt(out *Result, f, g curveFunc) {
	lo, hi := q.Curve.Min, q.Curve.Max
	a, broken := q.adaptCurves(out, f, g)
	note := func(intervals []int) {
		for _, i := range intervals {
			broken[i] = true
		}
	}
	var found []int
	if derived := q.derivedAt(f, g, out); derived != nil {
		if out.Inversion != nil {
			// The passage test's breaks give way to refinement's.
			out.Inversion.Breaks = []int{}
		}
		a.Derived, found = refinePath(out.Derived, broken, derived, lo, hi, q.View)
		note(found)
		if at := q.virtualAt(f, g, out); at != nil {
			n := float64(q.Samples - 1)
			// As refine.Refine places its points.
			markVirtual(a.Derived, out.Virtual, func(u float64) (*Vec, bool) { return at(lo*(1-u/n) + hi*u/n) })
		}
	}
	// Each member of a stack, or branch of a circle envelope, is broken
	// where its input is, not where another is: one member's fold is not a
	// break in its neighbors.
	stations := q.sharedStations(f, g)
	for _, member := range out.Family {
		if at := q.memberAlong(stations, out, member); at != nil {
			path, _ := refinePath(member.Points, broken, at, lo, hi, q.View)
			a.Family = append(a.Family, path)
		}
	}
	if out.Inversion != nil {
		for i := range broken {
			out.Inversion.Breaks = append(out.Inversion.Breaks, i+1)
		}
		sort.Ints(out.Inversion.Breaks)
	}
	out.Adaptive = a
}

// adaptCurves refines a computed study's base from f and its derived
// input from g, and gives the intervals they find broken, which every
// curve built on them is broken at too.
func (q Request) adaptCurves(out *Result, f, g curveFunc) (*AdaptiveResult, map[int]bool) {
	lo, hi := q.Curve.Min, q.Curve.Max
	position := func(c curveFunc) func(float64) *Vec {
		return func(t float64) *Vec { return point(c(t)) }
	}
	broken := map[int]bool{}
	note := func(intervals []int) {
		for _, i := range intervals {
			broken[i] = true
		}
	}
	a := &AdaptiveResult{}
	var found []int
	a.Base, found = refinePath(out.Base, nil, position(f), lo, hi, q.View)
	note(found)
	if out.Input != nil {
		a.Input, found = refinePath(out.Input, broken, position(g), lo, hi, q.View)
		note(found)
	}
	return a, broken
}

// reach gives each of out's refined curves its reach, from the curves
// refined to their own tolerance: under a view, refined again without it,
// in a copy of out, since refinement replaces an inversion's breaks.
func (q Request) reach(out *Result, f, g curveFunc) {
	study := out.Adaptive
	if q.View != nil {
		plain, copied := q, *out
		plain.View = nil
		if out.Inversion != nil {
			inversion := *out.Inversion
			copied.Inversion = &inversion
		}
		plain.adapt(&copied, f, g)
		study = copied.Adaptive
	}
	a := out.Adaptive
	for _, pair := range [][2]*RefinedPath{{a.Base, study.Base}, {a.Input, study.Input}, {a.Derived, study.Derived}} {
		if pair[0] != nil {
			pair[0].Reach, pair[0].ReachAt = reachOf(pair[1])
		}
	}
	for i, member := range a.Family {
		member.Reach, member.ReachAt = reachOf(study.Family[i])
	}
}

// reachOf is a refined path's reach (see refine.Reach): its points between
// samples outside the box of their interval's two samples, with their
// positions.
func reachOf(path *RefinedPath) ([]Vec, []float64) {
	return refine.Reach(path.Points, path.At, func(p Vec) []float64 { return []float64{p.X, p.Y} })
}

// derivedAt evaluates a study's derived curve at any t from the base f, the
// input g, and what out records at the samples: the involute's and rolling
// shapes' progress, and an envelope's lines. It is nil when that curve is
// not defined pointwise, or is a family of paths.
func (q Request) derivedAt(f, g curveFunc, out *Result) func(float64) *Vec {
	lo, hi := q.Curve.Min, q.Curve.Max
	switch {
	case usesPole(q.Kind):
		project := map[string]func(p, d, pole Vec) *Vec{"pedal": Pedal, "contrapedal": Contrapedal, "orthotomic": Orthotomic}[q.Kind]
		return func(t float64) *Vec {
			p := g(t)
			d, _ := derivatives(g, t, lo, hi)
			return project(p, d, q.Pole)
		}
	case q.Kind == "evolute":
		at := q.stations(f, g)
		return func(t float64) *Vec {
			if s := at(t); s.ok {
				return evolute(s.p, s.d, s.dd, s.resolution)
			}
			return nil
		}
	case q.Kind == "offset" && !q.Stack.Enabled:
		return q.along(f, g, func(_ float64, p, d, dd Vec) *Vec { return offsetPoint(p, d, dd, q.Distance) })
	case q.Kind == "catacaustic" || q.Kind == "diacaustic" || (q.Kind == "envelope" && out != nil && out.lineFamily != nil):
		at := q.virtualAt(f, g, out)
		return func(t float64) *Vec {
			p, _ := at(t)
			return p
		}
	case q.Kind == "inversion":
		return func(t float64) *Vec { return Invert(g(t), q.Inversion.Center, q.Inversion.Radius) }
	case q.Kind == "involute":
		return q.involuteAt(f, g, out.arcs)
	case q.Kind == "rolling":
		return q.rollingAt(f, g, out.rolled)
	}
	return nil
}

// involuteAt evaluates the involute at any t from the arc length arcs
// records at each sample where it is drawn: continued from the last sample
// at or before t by the sample loop's own Simpson step, so it is undefined
// wherever a sample there would be, and past a sample without an involute.
// A reversal of the input's tangent between samples is not tested here: the
// unwinding direction flips there and the involute jumps by twice its
// string, which refinement breaks as a jump.
func (q Request) involuteAt(f, g curveFunc, arcs []float64) func(float64) *Vec {
	lo, hi := q.Curve.Min, q.Curve.Max
	step := (hi - lo) / float64(q.Samples-1)
	return q.along(f, g, func(t float64, p, d, dd Vec) *Vec {
		j := q.sampleBefore(t)
		return q.unwound(g, lo+float64(j)*step, arcs[j], t, p, d, dd)
	})
}

// sampleBefore is the index of the sample at or before t, as the sample
// loop places it.
func (q Request) sampleBefore(t float64) int {
	lo, hi := q.Curve.Min, q.Curve.Max
	n := q.Samples - 1
	step := (hi - lo) / float64(n)
	j := max(0, min(n, int(math.Floor((t-lo)/step))))
	if j < n && lo+float64(j+1)*step <= t {
		j++
	} else if j > 0 && lo+float64(j)*step > t {
		j--
	}
	return j
}

// rollingRun is a rolling study's progress at each sample where its trace
// is drawn (nil elsewhere), with its rolling curve, or nil for a circle.
type rollingRun struct {
	mv *mover
	at []*travel
}

// rollingAt evaluates a rolling circle's or curve's trace at any t from the
// travel run records at each sample where it is drawn: continued from the
// last sample at or before t by the sample loop's own step, which splits its
// Simpson arc length at a cusp and reverses the heading there, so the trace
// rolls back out of a cusp between samples as it does at them. It is
// undefined wherever a sample there would be, past a sample without a
// trace, and where a rolling curve cannot be placed.
func (q Request) rollingAt(f, g curveFunc, run *rollingRun) func(float64) *Vec {
	lo, hi := q.Curve.Min, q.Curve.Max
	step := (hi - lo) / float64(q.Samples-1)
	return q.along(f, g, func(t float64, p, d, _ Vec) *Vec {
		j := q.sampleBefore(t)
		if run.at[j] == nil {
			return nil
		}
		v := *run.at[j]
		start := lo + float64(j)*step
		if h := t - start; h > 0 {
			a, _ := derivatives(g, start, lo, hi)
			b, _ := derivatives(g, t-h/2, lo, hi)
			if !v.step(t, h, a, b, d) {
				return nil
			}
		}
		// Where a rolling curve cannot be placed, roll has no point.
		target, _, _, _ := q.roll(run.mv, p, d, &v)
		return target
	})
}

// memberAt evaluates a member of an offset stack, or a branch of a circle
// envelope, at any t, or is nil for a study with neither.
func (q Request) memberAt(f, g curveFunc, out *Result, member Path) func(float64) *Vec {
	return q.memberAlong(q.stations(f, g), out, member)
}

// memberAlong is memberAt with its input read from at, which a family's
// members share (see sharedStations).
func (q Request) memberAlong(at func(float64) station, out *Result, member Path) func(float64) *Vec {
	switch {
	case q.Kind == "offset" && q.Stack.Enabled:
		var slab vecSlab
		return q.alongStations(at, func(_ float64, p, d, dd Vec) *Vec {
			if o, ok := offsetAt(p, d, dd, member.Distance); ok {
				return slab.keep(o)
			}
			return nil
		})
	case q.Kind == "envelope" && out != nil && out.circleFamily != nil:
		return q.alongStations(at, func(t float64, p, d, dd Vec) *Vec {
			circle := out.circleFamily.at(t, p, d, dd)
			if member.Branch == "left" {
				return circle.left
			}
			return circle.right
		})
	}
	return nil
}

// virtualAt evaluates a study's caustic, or its envelope of lines or chords,
// at any t, with whether its point is virtual: behind its ray's origin, or
// beyond a chord that is not extended. It is nil for another construction.
// The sample loop evaluates each with the same function, (*caustic).point
// or (*lines).at, so a refined curve passes exactly through the samples.
func (q Request) virtualAt(f, g curveFunc, out *Result) func(float64) (*Vec, bool) {
	if c := q.causticAt(f, g); c != nil {
		return c.at
	}
	if q.Kind != "envelope" || out == nil || out.lineFamily == nil {
		return nil
	}
	return func(t float64) (*Vec, bool) {
		virtual := false
		p := q.along(f, g, func(t float64, p, d, _ Vec) *Vec {
			member := out.lineFamily.at(t, p, d)
			virtual = member.virtual
			return member.target
		})(t)
		return p, virtual
	}
}

// along evaluates a construction built from its input's position and
// stencil derivatives at any t, undefined wherever a sample there would be:
// where the base or the input is undefined, or the derivatives either
// needs are ill-conditioned, each checked as at the samples.
func (q Request) along(f, g curveFunc, construct func(t float64, p, d, dd Vec) *Vec) func(float64) *Vec {
	return q.alongStations(q.stations(f, g), construct)
}

// alongStations is along with its input read from at.
func (q Request) alongStations(at func(float64) station, construct func(t float64, p, d, dd Vec) *Vec) func(float64) *Vec {
	return func(t float64) *Vec {
		s := at(t)
		if !s.ok {
			return nil
		}
		return construct(t, s.p, s.d, s.dd)
	}
}

// vecSlab keeps points in blocks, one allocation for many: allocation
// costs WASM's collector more than refinement's arithmetic.
type vecSlab []Vec

func (s *vecSlab) keep(v Vec) *Vec {
	if len(*s) == cap(*s) {
		*s = make([]Vec, 0, 512)
	}
	*s = append(*s, v)
	return &(*s)[len(*s)-1]
}

// station is what along builds a construction from at one t: its input's
// position and stencil derivatives, and whether they passed its checks.
type station struct {
	p, d, dd Vec
	// resolution is dd's (see stencil.resolution).
	resolution float64
	ok         bool
}

// stations evaluates along's input at any t.
func (q Request) stations(f, g curveFunc) func(float64) station {
	lo, hi := q.Curve.Min, q.Curve.Max
	base := baseStencil(lo, hi)
	return func(t float64) station {
		p := f(t)
		d, dd := base.derivatives(f, t)
		ok, resolution := base.checked(f, t, d, dd, derivativeOrder(q))
		if !p.Valid() || !ok {
			return station{}
		}
		if composed(q.Input) {
			p = g(t)
			d, dd = base.derivatives(g, t)
			if ok, resolution = inputStencil(lo, hi).checked(g, t, d, dd, constructionOrder(q.Kind)); !p.Valid() || !ok {
				return station{}
			}
		}
		return station{p, d, dd, resolution, true}
	}
}

// sharedStations is stations remembered by t, for a family's members:
// refinement probes each at the same parameters, wherever it has nothing
// to insert, so the input is evaluated there once for them all.
func (q Request) sharedStations(f, g curveFunc) func(float64) station {
	at, seen := q.stations(f, g), map[float64]station{}
	return func(t float64) station {
		s, ok := seen[t]
		if !ok {
			s = at(t)
			seen[t] = s
		}
		return s
	}
}

// caustic evaluates a catacaustic or diacaustic at any t, with whether its
// point is virtual. The sample loop and refinement share point, one
// compiled function, so a refined caustic passes exactly through the
// samples: copies inlined in different places can round differently.
type caustic struct {
	q               Request
	f, g, direction curveFunc
}

// causticAt is a study's caustic, or nil for another construction.
func (q Request) causticAt(f, g curveFunc) *caustic {
	if q.Kind != "catacaustic" && q.Kind != "diacaustic" {
		return nil
	}
	return &caustic{q, f, g, q.direction(g)}
}

// at is undefined wherever a sample would be: where along's checks fail,
// and wherever point is undefined.
func (c *caustic) at(t float64) (*Vec, bool) {
	virtual := false
	p := c.q.along(c.f, c.g, func(t float64, p, d, _ Vec) *Vec {
		var target *Vec
		target, virtual = c.point(t, p, d)
		return target
	})(t)
	return p, virtual
}

// point is the caustic point on the ray leaving p, where the input's
// tangent is d, once along's checks have passed: the sample loop, which
// made them itself, calls it directly. It is undefined under total internal
// reflection, and for a diacaustic where the rays' turning is
// ill-conditioned, as where a refracted ray crosses to the curve's other
// side at grazing incidence and the rays jump; a reflected ray grazes
// continuously.
func (c *caustic) point(t float64, p, d Vec) (*Vec, bool) {
	dir := c.direction(t)
	if !dir.Valid() {
		return nil, false
	}
	rays := baseStencil(c.q.Curve.Min, c.q.Curve.Max)
	turn, bend := rays.derivatives(c.direction, t)
	if c.q.Kind == "diacaustic" && !rays.stableTangent(c.direction, t, turn, bend) {
		return nil, false
	}
	target, s := Envelope(p, d, dir, turn)
	return target, s < 0
}

// markVirtual marks each point of a refined caustic or chord envelope
// virtual or real, the samples as the uniform study marks them, and bisects
// every change between neighbors to the finest step, where a caustic
// crosses its curve or a touching point passes its chord's end, so the real
// and virtual parts are drawn to meet. A change across a jump, or one where
// the curve stops between them, is a break. at evaluates the curve at a
// position in sample steps.
func markVirtual(path *RefinedPath, samples []bool, at func(float64) (*Vec, bool)) {
	finest := math.Ldexp(1, -refine.Depth)
	broken := map[int]bool{}
	for k, p := range path.Points {
		if p == nil && path.At[k] != math.Trunc(path.At[k]) {
			broken[int(path.At[k])] = true
		}
	}
	type vertex struct {
		u       float64
		p       *Vec
		virtual bool
	}
	var marked []vertex
	for k, p := range path.Points {
		u := path.At[k]
		virtual := false
		switch {
		case p == nil:
		case u == math.Trunc(u):
			virtual = samples[int(u)]
		default:
			_, virtual = at(u)
		}
		if k > 0 && p != nil && marked[len(marked)-1].p != nil && virtual != marked[len(marked)-1].virtual {
			a, b := marked[len(marked)-1], vertex{u, p, virtual}
			var between []vertex
			for b.u-a.u > finest && path.Inserted < refine.Budget {
				m := (a.u + b.u) / 2
				pm, vm := at(m)
				if pm == nil {
					between = append(between, vertex{m, nil, false})
					break
				}
				path.Inserted++
				between = append(between, vertex{m, pm, vm})
				if vm == a.virtual {
					a = vertex{m, pm, vm}
				} else {
					b = vertex{m, pm, vm}
				}
			}
			if a.p != nil && b.p != nil && b.u-a.u <= finest && b.p.Sub(*a.p).Norm() > refine.Jump*path.Tolerance {
				between = append(between, vertex{(a.u + b.u) / 2, nil, false})
			}
			sort.Slice(between, func(i, j int) bool { return between[i].u < between[j].u })
			for _, v := range between {
				if v.p == nil && !broken[int(v.u)] {
					broken[int(v.u)] = true
					path.Breaks++
				}
			}
			marked = append(marked, between...)
		}
		marked = append(marked, vertex{u, p, virtual})
	}
	path.Points, path.At, path.Virtual = path.Points[:0], path.At[:0], make([]bool, 0, len(marked))
	for _, v := range marked {
		path.Points = append(path.Points, v.p)
		path.At = append(path.At, v.u)
		path.Virtual = append(path.Virtual, v.virtual)
	}
}
