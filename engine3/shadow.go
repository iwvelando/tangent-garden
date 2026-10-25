package engine3

import (
	"fmt"
	"math"
	"tangentgarden/engine"
)

// ShadowRequest declares a plane, x = At, y = At or z = At for Plane "x",
// "y" or "z", on which a curve study casts its shadow: the orthogonal
// projection of its curve. Plane "" or "none" casts none. A surface, mirror
// or level set ignores it.
type ShadowRequest struct {
	// AllPaths projects every field or pursuit path; absent preserves the
	// original single shadow, independently of construction scope.
	AllPaths bool    `json:"allPaths,omitempty"`
	Plane    string  `json:"plane"`
	At       float64 `json:"at"`
	// Grid, for the grid of views beside the drawing, asks for the 2D
	// engine's whole study of the shadow too (see PlaneStudy); it changes
	// nothing else.
	Grid bool `json:"grid,omitempty"`
}

// ShadowPath is a path on the plane, indexed like the curve's samples, with
// the intervals it must not join.
type ShadowPath struct {
	Points []*Vec3 `json:"points"`
	Breaks []bool  `json:"breaks"`
}

// ShadowResult compares a construction with its reduction to the plane.
// Curve is the shadow of the base curve, with the base's breaks; under a
// derived input it is still the base's. Kind names the 2D engine's
// construction on that shadow which corresponds to the study's own (see
// planarKind), or is empty when it has none. Planar holds that 2D
// construction, one path per involute of a family, and Cast the shadow of
// the study's own construction, path for path. Where both have a point at
// a sample, Deviation is the largest distance between them over Size, the
// shadow's radius (as the bounds measure it), counting only samples whose
// planar point lies within 10 sizes of the shadow's center; Compared
// counts those samples. Notes are the 2D engine's warnings. Corners are a
// square window on the plane, in order around it, holding the shadow and
// what is cast with it.
type ShadowResult struct {
	Family    []*ShadowResult `json:"family,omitempty"`
	Plane     string          `json:"plane"`
	At        float64         `json:"at"`
	Corners   [4]Vec3         `json:"corners"`
	Curve     ShadowPath      `json:"curve"`
	Kind      string          `json:"kind"`
	Planar    []ShadowPath    `json:"planar"`
	Cast      []ShadowPath    `json:"cast"`
	Deviation *float64        `json:"deviation,omitempty"`
	Compared  int             `json:"compared"`
	Size      float64         `json:"size"`
	Notes     []string        `json:"notes"`
	// Adaptive holds the shadows refined between samples, present only
	// when the study refines its curves (see ShadowAdaptive).
	Adaptive *ShadowAdaptive `json:"adaptive,omitempty"`
	// Study is present only when the grid asks for it and the study has a
	// 2D counterpart that was drawn.
	Study *PlaneStudy `json:"study,omitempty"`
}

// PlaneStudy is the 2D engine's study of the shadow, for the 2D notebook's
// own drawing of the plane: its kind and input, pole and inversion circle,
// and result, all in the plane's coordinates (see ShadowRequest.flat) in
// units of Unit. Its derived curve and family are Planar's paths, scaled
// down: an involute family's first string is the derived curve, the rest
// its family, and each representative string reaches the first.
type PlaneStudy struct {
	Unit      float64          `json:"unit"`
	Kind      string           `json:"kind"`
	Input     string           `json:"input"`
	Pole      engine.Vec       `json:"pole"`
	Inversion engine.Inversion `json:"inversion"`
	Result    engine.Result    `json:"result"`
}

// ShadowAdaptive is a refined study's shadows refined between samples:
// the curve's shadow and the cast construction, the shadows of the
// study's own refined paths, and the 2D construction, refined by the 2D
// engine, each indexed like the result's.
type ShadowAdaptive struct {
	Curve  *RefinedPath   `json:"curve,omitempty"`
	Planar []*RefinedPath `json:"planar,omitempty"`
	Cast   []*RefinedPath `json:"cast,omitempty"`
}

// shadowing is what a computed curve study keeps to cast its shadow: the
// base's position and domain, and the families its bounds were fitted to,
// with their reach.
type shadowing struct {
	position func(float64) Vec3
	lo, hi   float64
	families [][]*Vec3
	reach    [][]Vec3
}

// shadowed reports whether the request casts a shadow: a curve study with
// a plane.
func (c Request) shadowed() bool {
	if c.Shadow == nil || c.Shadow.Plane == "" || c.Shadow.Plane == "none" {
		return false
	}
	switch c.Format {
	case "surface", "rays", "implicit":
		return false
	}
	return true
}

func (q ShadowRequest) validate() error {
	switch q.Plane {
	case "x", "y", "z":
	default:
		return fieldErr("shadow.plane", "the shadow's plane must be x, y or z")
	}
	if !finite(q.At) || math.Abs(q.At) > 1e5 {
		return fieldErr("shadow.at", "the shadow's plane must stand within ±100000")
	}
	return nil
}

// flat is p's coordinates on the plane, in cyclic order as a receiver's:
// (y, z) on x = c, (z, x) on y = c and (x, y) on z = c. Each is a proper
// rotation of the plane's own axes, so the 2D engine's left and right are
// the plane's seen from the side its normal points to.
func (q ShadowRequest) flat(p Vec3) engine.Vec {
	switch q.Plane {
	case "x":
		return engine.Vec{X: p.Y, Y: p.Z}
	case "y":
		return engine.Vec{X: p.Z, Y: p.X}
	}
	return engine.Vec{X: p.X, Y: p.Y}
}

// lift is the point of the plane with coordinates u.
func (q ShadowRequest) lift(u engine.Vec) Vec3 {
	switch q.Plane {
	case "x":
		return Vec3{q.At, u.X, u.Y}
	case "y":
		return Vec3{u.Y, q.At, u.X}
	}
	return Vec3{u.X, u.Y, q.At}
}

// path is the shadow of points, with their breaks.
func (q ShadowRequest) path(points []*Vec3, breaks []bool) ShadowPath {
	out := ShadowPath{Points: make([]*Vec3, len(points)), Breaks: append([]bool{}, breaks...)}
	for i, p := range points {
		if p != nil {
			s := q.lift(q.flat(*p))
			out.Points[i] = &s
		}
	}
	return out
}

// planarInputs are the 2D engine's names for the curves a construction
// acts on that the plane has too.
var planarInputs = map[string]string{"": "curve", "base": "curve", "tangent-foot": "pedal", "orthotomic": "orthotomic"}

// planarKind is the 2D construction that corresponds to the study's: the
// involute to the involute, the tangent-foot curve to the pedal, the
// orthotomic to the orthotomic and sphere inversion to circle inversion,
// each with the pole and the center projected, acting on the shadow or on
// the shadow's pedal or orthotomic. An involute of an involute or a coil,
// and the surfaces, have none.
func (c Request) planarKind() string {
	switch c.Construction {
	case "involute":
		if _, ok := planarInputs[c.Input]; ok {
			return "involute"
		}
	case "tangent-foot":
		return "pedal"
	case "orthotomic":
		return "orthotomic"
	case "inversion":
		return "inversion"
	}
	return ""
}

// planar is the 2D engine's construction of kind on the shadow of the
// base, sampled where the study samples its curve: its points, one path
// per involute of a family, each refined between samples when the study
// refines, and the result they come from, for its warnings and an
// inversion's breaks, or why it could not be drawn. Its
// lengths are given to the 2D engine in units of unit, a power of two, and
// its points are in those units: the 2D engine keeps a few absolute
// constants, which hold for studies 2⁻²⁰ to 2¹³ across, and a power of two
// changes nothing else, exactly.
func (c Request) planar(kind string, sh *shadowing, unit float64) ([][]*engine.Vec, []*engine.RefinedPath, engine.Result, engine.Request, error) {
	q := *c.Shadow
	flat := func(p Vec3) engine.Vec { return q.flat(p).Mul(1 / unit) }
	f := func(t float64) engine.Vec {
		r := sh.position(t)
		if !r.valid() {
			return engine.Vec{X: math.NaN(), Y: math.NaN()}
		}
		return flat(r)
	}
	request := engine.Request{
		Kind:     kind,
		Curve:    engine.Curve{Min: sh.lo, Max: sh.hi},
		Pole:     flat(c.Pole),
		Samples:  c.Samples + 1,
		Lines:    2,
		Adaptive: c.refines(),
	}
	// The grid draws the study's own number of representative lines; the
	// construction's points do not depend on how many.
	if q.Grid {
		request.Lines = c.Lines
	}
	switch kind {
	case "involute":
		request.Input = planarInputs[c.Input]
		strings, err := c.Involute.offsets(c.Samples)
		if err != nil {
			return nil, nil, engine.Result{}, request, err
		}
		for k := range strings {
			strings[k] /= unit
		}
		family, err := engine.AnchoredInvolutes(request, f, c.Involute.Anchor, strings)
		return family.Members, family.Refined, family.Result, request, err
	case "inversion":
		request.Input = planarInputs[c.Inversion.Input]
		request.Inversion = engine.Inversion{Center: flat(c.Inversion.Center), Radius: c.Inversion.Radius / unit}
	}
	r, err := engine.ComputeOn(request, f)
	var refined []*engine.RefinedPath
	if r.Adaptive != nil && r.Adaptive.Derived != nil {
		refined = []*engine.RefinedPath{r.Adaptive.Derived}
	}
	return [][]*engine.Vec{r.Derived}, refined, r, request, err
}

// planeStudy is the 2D study of the shadow as the 2D notebook draws it,
// from the planar construction's members and their refinements: an
// involute family's result is the involute with offset 0, so its first
// member becomes the derived curve, the rest its family, and each string
// is drawn to the first member.
func planeStudy(kind string, request engine.Request, unit float64, r engine.Result, members [][]*engine.Vec, refined []*engine.RefinedPath) *PlaneStudy {
	if kind == "involute" {
		r.Derived, r.Family = members[0], []engine.Path{}
		for _, m := range members[1:] {
			r.Family = append(r.Family, engine.Path{Points: m})
		}
		rays := make([]engine.Ray, 0, len(r.Rays))
		for _, ray := range r.Rays {
			ray.Target = members[0][ray.SampleIndex]
			if ray.Target != nil {
				rays = append(rays, ray)
			}
		}
		r.Rays = rays
		if len(refined) > 0 {
			r.Adaptive = &engine.AdaptiveResult{Derived: refined[0], Family: refined[1:]}
		}
	}
	return &PlaneStudy{Unit: unit, Kind: kind, Input: request.Input, Pole: request.Pole, Inversion: request.Inversion, Result: r}
}

// refined is a refined path on the plane: the 2D engine's, in units of
// unit, lifted onto it.
func (q ShadowRequest) refined(p *engine.RefinedPath, unit float64) *RefinedPath {
	out := &RefinedPath{Points: make([]*Vec3, len(p.Points)), At: p.At, Tolerance: p.Tolerance * unit, Inserted: p.Inserted, Breaks: p.Breaks, Unresolved: p.Unresolved, Exhausted: p.Exhausted}
	for i, u := range p.Points {
		if u != nil {
			lifted := q.lift(u.Mul(unit))
			out.Points[i] = &lifted
		}
	}
	return out
}

// shade is the shadow of a refined path of the study's, or nil.
func (q ShadowRequest) shade(p *RefinedPath) *RefinedPath {
	if p == nil {
		return nil
	}
	out := *p
	out.Points, out.Reach, out.ReachAt = q.path(p.Points, nil).Points, nil, nil
	return &out
}

// binade is the largest power of two at or below x, or 1 for an x that is
// not positive and finite.
func binade(x float64) float64 {
	if !(x > 0) || math.IsInf(x, 0) {
		return 1
	}
	_, e := math.Frexp(x)
	return math.Ldexp(1, e-1)
}

// cast casts the computed study's shadow and frames it with the study.
func (out *Result) cast(c Request) {
	q, sh := *c.Shadow, out.shadowing
	s := &ShadowResult{Plane: q.Plane, At: q.At, Kind: c.planarKind(), Planar: []ShadowPath{}, Cast: []ShadowPath{}, Notes: []string{}}
	base, breaks := out.Base, out.Breaks
	if out.Composition != nil {
		base, breaks = out.Composition.Curve, out.Composition.Breaks
	}
	s.Curve = q.path(base, breaks)
	if c.integrated != nil {
		// A stationary seed has no tangent, but still has a shadow. Use
		// its positions rather than the regular samples of a construction,
		// with the trajectory's breaks rather than a composed input's.
		points := make([]*Vec3, c.Samples+1)
		for i := range points {
			t := sh.lo*(1-float64(i)/float64(c.Samples)) + sh.hi*float64(i)/float64(c.Samples)
			p := c.integrated.position(c, c.member, t)
			if p.valid() {
				points[i] = &p
			}
		}
		s.Curve = q.path(points, breaks)
	}
	if s.Kind != "" {
		switch {
		case out.Involute != nil:
			for _, m := range out.Involute.Members {
				s.Cast = append(s.Cast, q.path(m.Points, out.Breaks))
			}
		case out.Projection != nil:
			b := out.Projection.Breaks
			if b == nil {
				b = out.Breaks
			}
			s.Cast = append(s.Cast, q.path(out.Projection.Points, b))
		case out.Inversion != nil:
			s.Cast = append(s.Cast, q.path(out.Inversion.Points, out.Inversion.Breaks))
		}
		unit := binade(out.Bounds.Radius)
		members, refined, r, request, err := c.planar(s.Kind, sh, unit)
		if err != nil {
			s.Notes = append(s.Notes, fmt.Sprintf("The 2D construction of the shadow is not drawn: %s.", err))
		} else if q.Grid {
			s.Study = planeStudy(s.Kind, request, unit, r, members, refined)
		}
		s.Notes = append(s.Notes, r.Warnings...)
		for _, member := range members {
			path := ShadowPath{Points: make([]*Vec3, len(member)), Breaks: make([]bool, len(member))}
			for i, p := range member {
				if p != nil {
					lifted := q.lift(p.Mul(unit))
					path.Points[i] = &lifted
				}
			}
			if r.Inversion != nil {
				for _, j := range r.Inversion.Breaks {
					path.Breaks[j] = true
				}
			}
			s.Planar = append(s.Planar, path)
		}
		if out.Adaptive != nil {
			s.Adaptive = &ShadowAdaptive{}
			for _, p := range refined {
				s.Adaptive.Planar = append(s.Adaptive.Planar, q.refined(p, unit))
			}
			switch a := out.Adaptive; {
			case out.Involute != nil:
				for _, p := range a.Involute {
					s.Adaptive.Cast = append(s.Adaptive.Cast, q.shade(p))
				}
			case out.Projection != nil && a.Projection != nil:
				s.Adaptive.Cast = append(s.Adaptive.Cast, q.shade(a.Projection))
			case out.Inversion != nil && a.Image != nil:
				s.Adaptive.Cast = append(s.Adaptive.Cast, q.shade(a.Image))
			}
		}
	}
	if out.Adaptive != nil {
		if s.Adaptive == nil {
			s.Adaptive = &ShadowAdaptive{}
		}
		s.Adaptive.Curve = q.shade(out.Adaptive.Base)
		if out.Composition != nil {
			s.Adaptive.Curve = q.shade(out.Adaptive.Parent)
		}
	}
	fitted := fit(s.Curve.Points)
	s.Size = fitted.Radius
	if len(s.Planar) == len(s.Cast) && len(s.Cast) > 0 {
		worst := 0.0
		for k, planar := range s.Planar {
			for i, p := range planar.Points {
				if i >= len(s.Cast[k].Points) {
					break
				}
				if g := s.Cast[k].Points[i]; p != nil && g != nil && p.sub(fitted.Center).norm() <= 10*s.Size {
					worst = math.Max(worst, p.sub(*g).norm())
					s.Compared++
				}
			}
		}
		if s.Compared > 0 {
			deviation := worst / s.Size
			s.Deviation = &deviation
		}
	}
	families := [][]*Vec3{s.Curve.Points}
	for _, p := range append(append([]ShadowPath{}, s.Planar...), s.Cast...) {
		families = append(families, p.Points)
	}
	// What is drawn between samples lies on the window too: a refined
	// involute's swing can reach far past the chord its samples leave.
	if s.Adaptive != nil {
		for _, p := range append(append([]*RefinedPath{s.Adaptive.Curve}, s.Adaptive.Planar...), s.Adaptive.Cast...) {
			if p != nil {
				families = append(families, p.Points)
			}
		}
	}
	s.Corners = q.window(families)
	if sh.families != nil {
		corners := make([]*Vec3, 4)
		for k := range s.Corners {
			corners[k] = &s.Corners[k]
		}
		all := append(append(append([][]*Vec3{}, sh.families...), families...), corners)
		out.Bounds = fitReach(all, sh.reach)
		out.Radius = out.Bounds.Radius
	}
	out.Shadow = s
}

// window is a rectangle on the plane around the shadow's families: the
// extent of their points within the radius the bounds fit them to (so an
// inverted curve's far reaches are left out, as the bounds leave them
// out), widened on each side by a twentieth of its longer side, with its
// corners in order around it.
func (q ShadowRequest) window(families [][]*Vec3) [4]Vec3 {
	fitted := fit(families...)
	low := engine.Vec{X: math.Inf(1), Y: math.Inf(1)}
	high := engine.Vec{X: math.Inf(-1), Y: math.Inf(-1)}
	for _, family := range families {
		for _, p := range family {
			if p == nil || p.sub(fitted.Center).norm() > fitted.Radius {
				continue
			}
			u := q.flat(*p)
			low = engine.Vec{X: math.Min(low.X, u.X), Y: math.Min(low.Y, u.Y)}
			high = engine.Vec{X: math.Max(high.X, u.X), Y: math.Max(high.Y, u.Y)}
		}
	}
	if low.X > high.X {
		low, high = q.flat(fitted.Center), q.flat(fitted.Center)
	}
	pad := math.Max(math.Max(high.X-low.X, high.Y-low.Y)/20, fitted.Radius*1e-3)
	low, high = low.Sub(engine.Vec{X: pad, Y: pad}), high.Add(engine.Vec{X: pad, Y: pad})
	return [4]Vec3{q.lift(low), q.lift(engine.Vec{X: high.X, Y: low.Y}), q.lift(high), q.lift(engine.Vec{X: low.X, Y: high.Y})}
}
