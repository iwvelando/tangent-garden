package engine

import (
	"encoding/json"
	"fmt"
	"math"
	"os"
	"regexp"
	"sort"
	"strconv"
	"testing"
)

// The presets' configurations, as web/presets.ts defines them, which
// scripts/test-wasm.mjs checks. Regenerate after changing a preset with
// `make preset-fixtures` (scripts/preset-fixtures.mjs).
type preset struct {
	Title  string  `json:"title"`
	Config Request `json:"config"`
}

// The fixture names every preset of web/presets.ts, in order.
func TestPresetFixtureIsCurrent(t *testing.T) {
	source, err := os.ReadFile("../web/presets.ts")
	if err != nil {
		t.Fatal(err)
	}
	var titles []string
	for _, m := range regexp.MustCompile(`(?m)^    title: (".*"),$`).FindAllSubmatch(source, -1) {
		var title string
		if err := json.Unmarshal(m[1], &title); err != nil {
			t.Fatal(err)
		}
		titles = append(titles, title)
	}
	var fixture []string
	for _, p := range loadPresets(t) {
		fixture = append(fixture, p.Title)
	}
	if fmt.Sprint(titles) != fmt.Sprint(fixture) {
		t.Errorf("engine/testdata/presets.json lists %q, web/presets.ts %q: regenerate the fixture", fixture, titles)
	}
}

func loadPresets(t *testing.T) []preset {
	t.Helper()
	data, err := os.ReadFile("testdata/presets.json")
	if err != nil {
		t.Fatal(err)
	}
	var out []preset
	if err := json.Unmarshal(data, &out); err != nil {
		t.Fatal(err)
	}
	return out
}

// similarity is the map p ↦ s·p + c.
type similarity struct {
	name string
	s    float64
	c    Vec
}

func (m similarity) at(p Vec) Vec { return p.Mul(m.s).Add(m.c) }

func num(x float64) string { return "(" + strconv.FormatFloat(x, 'g', -1, 64) + ")" }

// coordinate maps an expression for one coordinate, s·(e) + c.
func (m similarity) coordinate(e string, c float64) string {
	if c == 0 {
		return num(m.s) + "*(" + e + ")"
	}
	return num(m.s) + "*(" + e + ")+" + num(c)
}

var variable = regexp.MustCompile(`\b[xy]\b`)

// pullback rewrites an expression in x and y to read the original
// coordinates of a point of the copy, (p − c)/s.
func (m similarity) pullback(e string) string {
	return variable.ReplaceAllStringFunc(e, func(v string) string {
		c := m.c.X
		if v == "y" {
			c = m.c.Y
		}
		return "((" + v + "-" + num(c) + ")/" + num(m.s) + ")"
	})
}

// copyOf is the request for the preset's image under m, with every length
// scaled and every position mapped, or false when the preset's definition
// cannot carry the map: an iterated map's fixed formulas, and a vector
// field's escape circle about the origin, which a translation would move.
func (m similarity) copyOf(q Request) (Request, bool) {
	translated := m.c != (Vec{})
	c := q.Curve
	switch c.Format {
	case "attractor":
		return q, false
	case "parametric":
		c.X, c.Y = m.coordinate(c.X, m.c.X), m.coordinate(c.Y, m.c.Y)
	case "cartesian":
		c.Format, c.X, c.Y = "parametric", m.coordinate("t", m.c.X), m.coordinate(c.Y, m.c.Y)
	case "polar":
		if !translated {
			c.R = num(m.s) + "*(" + c.R + ")"
			break
		}
		c.Format = "parametric"
		c.X, c.Y = m.coordinate("("+c.R+")*cos(t)", m.c.X), m.coordinate("("+c.R+")*sin(t)", m.c.Y)
	case "roulette", "lissajous", "fourier":
		if !translated {
			c.Roulette.FixedRadius *= m.s
			c.Roulette.Radius *= m.s
			c.Roulette.Arm *= m.s
			c.Lissajous.AmplitudeX *= m.s
			c.Lissajous.AmplitudeY *= m.s
			c.Terms = append([]Term{}, c.Terms...)
			for k := range c.Terms {
				c.Terms[k].Radius *= m.s
			}
			break
		}
		x, y := harmonicExpressions(c)
		c.Format, c.X, c.Y = "parametric", m.coordinate(x, m.c.X), m.coordinate(y, m.c.Y)
	case "pursuit":
		c.Pursuit.Pursuers = append([]Pursuer{}, c.Pursuit.Pursuers...)
		for k, p := range c.Pursuit.Pursuers {
			at := m.at(Vec{p.X, p.Y})
			c.Pursuit.Pursuers[k] = Pursuer{at.X, at.Y, p.Speed * m.s}
		}
		c.Pursuit.Capture *= m.s
	case "field":
		if translated {
			return q, false
		}
		c.Field.X = num(m.s) + "*(" + m.pullback(c.Field.X) + ")"
		c.Field.Y = num(m.s) + "*(" + m.pullback(c.Field.Y) + ")"
		c.Field.Seeds = append([]Seed{}, c.Field.Seeds...)
		for k, p := range c.Field.Seeds {
			at := m.at(Vec{p.X, p.Y})
			c.Field.Seeds[k] = Seed{at.X, at.Y}
		}
		c.Field.Escape *= m.s
	case "implicit":
		c.Implicit.F = m.pullback(c.Implicit.F)
		w := c.Implicit.Window
		lo, hi := m.at(Vec{w.XMin, w.YMin}), m.at(Vec{w.XMax, w.YMax})
		c.Implicit.Window = Window{lo.X, hi.X, lo.Y, hi.Y}
	}
	q.Curve = c
	if q.Source.Coordinates == "polar" {
		if translated {
			q.Source.Coordinates = "cartesian"
			q.Source.Position = Vec{q.Source.Radius * math.Cos(q.Source.Theta), q.Source.Radius * math.Sin(q.Source.Theta)}
		} else {
			q.Source.Radius *= m.s
		}
	}
	q.Source.Position = m.at(q.Source.Position)
	q.Pole = m.at(q.Pole)
	q.Offset *= m.s
	q.Distance *= m.s
	q.Stack.From *= m.s
	q.Stack.To *= m.s
	q.Rolling.Radius *= m.s
	q.Rolling.Arm *= m.s
	q.Rolling.Curve.X = num(m.s) + "*(" + q.Rolling.Curve.X + ")"
	q.Rolling.Curve.Y = num(m.s) + "*(" + q.Rolling.Curve.Y + ")"
	q.Rolling.Point = q.Rolling.Point.Mul(m.s)
	q.Envelope.X, q.Envelope.Y = m.coordinate(q.Envelope.X, m.c.X), m.coordinate(q.Envelope.Y, m.c.Y)
	q.Envelope.Radius = num(m.s) + "*(" + q.Envelope.Radius + ")"
	q.Inversion.Center = m.at(q.Inversion.Center)
	q.Inversion.Radius *= m.s
	return q, true
}

// harmonicExpressions writes a roulette, Lissajous figure or Fourier curve
// as parametric expressions in t, as Roulette.state, Lissajous.at and
// fourierAt evaluate them.
func harmonicExpressions(c Curve) (x, y string) {
	switch c.Format {
	case "roulette":
		g := c.Roulette
		r := num(g.Radius)
		var center, arm string
		switch g.Roll {
		case "line":
			x, y = r+"*t", r
			arm = "(-pi/2+" + num(g.Phase) + "-t)"
		case "inside":
			k := num(g.FixedRadius - g.Radius)
			center = k
			arm = "(" + num(g.Phase) + "-" + k + "*t/" + r + ")"
		default:
			k := num(g.FixedRadius + g.Radius)
			center = k
			arm = "(pi+" + num(g.Phase) + "+" + k + "*t/" + r + ")"
		}
		if center != "" {
			x, y = center+"*cos(t)", center+"*sin(t)"
		}
		return x + "+" + num(g.Arm) + "*cos" + arm, y + "+" + num(g.Arm) + "*sin" + arm
	case "lissajous":
		l := c.Lissajous
		return num(l.AmplitudeX) + "*sin(" + num(l.FrequencyX) + "*t+" + num(l.Phase) + ")",
			num(l.AmplitudeY) + "*sin(" + num(l.FrequencyY) + "*t)"
	}
	x, y = "0", "0"
	for _, term := range c.Terms {
		a := "(" + num(term.Frequency) + "*t+" + num(term.Phase) + ")"
		x += "+" + num(term.Radius) + "*cos" + a
		y += "+" + num(term.Radius) + "*sin" + a
	}
	return x, y
}

// Scaled copies multiply by powers of two, which binary floating point
// does exactly, so a copy can differ from its original only where the
// engine compares a length with an absolute constant.
var scaledCopies = []similarity{
	{"tiny", 0x1p-20, Vec{}},
	{"huge", 0x1p13, Vec{}},
}

// Translated copies lie hundreds of diameters from the origin, alone and
// on the tiny scale, and some ten thousand. Every coordinate then carries
// the rounding of the larger magnitude.
var translatedCopies = []similarity{
	{"far", 1, Vec{700, -500}},
	{"tiny and far", 0x1p-20, Vec{700 * 0x1p-20, -500 * 0x1p-20}},
	{"very far", 1, Vec{30000, -20000}},
}

// budget bounds the distance from a point of a copy to the image of the
// original's point, relative to the copy's diameter L, twice its study
// radius, plus the point's distance from the base's median point (see
// docs/mathematics.md#scale-and-translation).
type budget struct {
	// exact is whether the copy is at a power-of-two scale.
	exact bool
	// rho is 1 + |c|/L: how far the copy lies from the origin, in
	// diameters, plus one.
	rho float64
}

const unitRoundoff = 0x1p-53

// derivative is the relative error allowed a path that reads k stencil
// derivatives of the base: rounding of order ε·ρ, divided by the stencil
// spacing, 10⁻⁴ of the domain, once per derivative.
func (b budget) derivative(k int) float64 {
	if b.exact {
		return 0
	}
	return 256 * unitRoundoff * b.rho * math.Pow(1e4, float64(k))
}

// integrated is the relative error allowed a chase's or trajectory's path,
// whose adaptive steps are controlled to relative local errors of 10⁻¹²
// and 10⁻¹⁰, and which a translation reaches through different steps.
func (b budget) integrated() float64 {
	if b.exact {
		return 0
	}
	return 1e-8
}

// order is the number of the base's stencil derivatives a request's derived
// curve reads.
func order(q Request) int {
	n := inputOrder(q.Input) + constructionOrder(q.Kind)
	if q.Kind == "inversion" {
		n = inputOrder(q.Input)
	}
	return n
}

// copies checks a copy got against the image of want under m.
type copies struct {
	t      *testing.T
	m      similarity
	b      budget
	size   float64 // the copy's diameter L
	center Vec     // the image of the original base's median point
}

func newCopies(t *testing.T, want Result, m similarity) *copies {
	r, center := size(want)
	c := &copies{t: t, m: m, size: m.s * 2 * r, center: m.at(center)}
	c.b = budget{exact: m.c == (Vec{}), rho: 1 + m.c.Norm()/c.size}
	return c
}

// near checks one point against the image of the original's, within limit
// of the copy's size there.
func (c *copies) near(name string, i int, want, got Vec, limit float64) {
	c.t.Helper()
	image := c.m.at(want)
	scale := c.size + got.Sub(c.center).Norm()
	if e := got.Sub(image).Norm(); e > limit*scale {
		c.t.Errorf("%s[%d] = %v, want %v within %.1e of %.3g (off by %.2e)", name, i, got, image, limit, scale, e/scale)
	}
}

// path checks a path sample by sample: the same gaps, and every point
// within limit.
func (c *copies) path(name string, want, got []*Vec, limit float64) {
	c.t.Helper()
	if len(want) != len(got) {
		c.t.Errorf("%s has %d points, want %d", name, len(got), len(want))
		return
	}
	for i := range want {
		switch {
		case (want[i] == nil) != (got[i] == nil):
			c.t.Errorf("%s[%d] is nil: %v, want %v", name, i, got[i] == nil, want[i] == nil)
		case want[i] != nil:
			c.near(name, i, *want[i], *got[i], limit)
		}
	}
}

// polyline checks that every point of got lies within limit of the image of
// want's polyline, for paths whose points need not correspond one to one:
// refinement's insertions and a level set's crossings, which a translation
// may place differently.
func (c *copies) polyline(name string, want, got []*Vec, limit float64) {
	c.t.Helper()
	image := make([]*Vec, len(want))
	for i, p := range want {
		if p != nil {
			q := c.m.at(*p)
			image[i] = &q
		}
	}
	// The nearest segment from lo to hi, and its index.
	nearest := func(p Vec, lo, hi int) (float64, int) {
		best, at := math.Inf(1), -1
		for j := max(lo, 0); j+1 < min(hi, len(image)); j++ {
			if image[j] != nil && image[j+1] != nil {
				if d := plane.Distance(p, *image[j], *image[j+1]); d < best {
					best, at = d, j
				}
			}
		}
		return best, at
	}
	// Both paths run in order, so each point is looked for first beside
	// the previous one's segment, and among all segments only where it is
	// not within limit there.
	last := 0
	for i, p := range got {
		if p == nil {
			continue
		}
		scale := c.size + p.Sub(c.center).Norm()
		best, at := nearest(*p, last-64, last+66)
		if best > limit*scale {
			best, at = nearest(*p, 0, len(image))
		}
		if at >= 0 {
			last = at
		}
		if best > limit*scale {
			c.t.Errorf("%s point %d, %v, is %.2e of %.3g from the original's image, want within %.1e", name, i, *p, best/scale, scale, limit)
		}
	}
}

func (c *copies) same(name string, want, got any) {
	c.t.Helper()
	if a, b := fmt.Sprint(want), fmt.Sprint(got); a != b {
		c.t.Errorf("%s = %s, want %s", name, b, a)
	}
}

// size is the original's study radius, the radius its refinement and probe
// measure it by, which leaves out a few far points near an asymptote, and
// its base's median point; for a level set, half its window's diagonal and
// its center.
func size(r Result) (float64, Vec) {
	if r.Contours != nil {
		w := r.Contours.Window
		return math.Hypot(w.XMax-w.XMin, w.YMax-w.YMin) / 2, Vec{(w.XMin + w.XMax) / 2, (w.YMin + w.YMax) / 2}
	}
	var xs, ys []float64
	for _, p := range r.Base {
		if p != nil {
			xs, ys = append(xs, p.X), append(ys, p.Y)
		}
	}
	sort.Float64s(xs)
	sort.Float64s(ys)
	return studyRadius(r.Base), Vec{xs[len(xs)/2], ys[len(ys)/2]}
}

// result checks a copy's whole result against its original's.
func (c *copies) result(q Request, want, got Result) {
	c.t.Helper()
	k := order(q)
	base, derived, centers := c.b.derivative(0), c.b.derivative(k), c.b.derivative(2)
	if q.Curve.Format == "pursuit" || q.Curve.Format == "field" {
		base = c.b.integrated()
		derived = math.Max(derived, base)
		centers = math.Max(centers, base)
	}
	c.same("warnings", want.Warnings, got.Warnings)
	c.same("invalid", want.Invalid, got.Invalid)
	c.path("base", want.Base, got.Base, base)
	c.path("input", want.Input, got.Input, c.b.derivative(inputOrder(q.Input)))
	c.path("derived", want.Derived, got.Derived, derived)
	c.same("virtual", want.Virtual, got.Virtual)
	c.path("second", want.Second, got.Second, base)
	c.same("family", len(want.Family), len(got.Family))
	for j := range min(len(want.Family), len(got.Family)) {
		c.path(fmt.Sprintf("family[%d]", j), want.Family[j].Points, got.Family[j].Points, derived)
	}
	c.same("rays", len(want.Rays), len(got.Rays))
	for j := range min(len(want.Rays), len(got.Rays)) {
		a, b := want.Rays[j], got.Rays[j]
		c.same(fmt.Sprintf("rays[%d]", j), []any{a.SampleIndex, a.Virtual, a.TIR, a.Target == nil}, []any{b.SampleIndex, b.Virtual, b.TIR, b.Target == nil})
	}
	c.same("circles", len(want.Circles), len(got.Circles))
	for j := range min(len(want.Circles), len(got.Circles)) {
		a, b := want.Circles[j], got.Circles[j]
		c.near("circle centers", j, a.Center, b.Center, base)
		c.near("circle radii", j, Vec{a.Radius, 0}, Vec{b.Radius, 0}.Add(c.m.c), derived)
	}
	c.same("rolling", len(want.Rolling), len(got.Rolling))
	if want.Inversion != nil {
		c.same("inversion breaks", want.Inversion.Breaks, got.Inversion.Breaks)
	}
	if want.Pursuit != nil {
		c.same("capture", want.Pursuit.Capture != nil, got.Pursuit.Capture != nil)
		for j := range want.Pursuit.Paths {
			c.path(fmt.Sprintf("pursuer[%d]", j), want.Pursuit.Paths[j], got.Pursuit.Paths[j], base)
		}
	}
	if want.Field != nil {
		c.same("ends", want.Field.Ends, got.Field.Ends)
		for j := range want.Field.Paths {
			c.path(fmt.Sprintf("trajectory[%d]", j), want.Field.Paths[j], got.Field.Paths[j], base)
		}
	}
	if a, b := want.Diagnostics, got.Diagnostics; a != nil {
		if c.b.exact {
			c.same("flat, unknown, clipped", []int{a.Flat, a.Unknown, a.Clipped}, []int{b.Flat, b.Unknown, b.Clipped})
		} else {
			// At an inflection the curvature is zero within the rounding
			// of a translated copy, which may call it flat or put its
			// center beyond 100 radii: neither has a center.
			c.same("unknown, flat or clipped", []int{a.Unknown, a.Flat + a.Clipped}, []int{b.Unknown, b.Flat + b.Clipped})
		}
		c.path("centers", a.Center, b.Center, centers)
		for i := range a.Curvature {
			switch {
			case (a.Curvature[i] == nil) != (b.Curvature[i] == nil):
				c.t.Errorf("curvature[%d] is nil: %v, want %v", i, b.Curvature[i] == nil, a.Curvature[i] == nil)
			case a.Curvature[i] != nil:
				// Curvature κ is compared as κL/(1 + |κ|L), on the copy's
				// diameter L: as a curvature where the curve is nearly
				// straight, and as a radius of curvature where it turns
				// sharply, each where it is well conditioned.
				squash := func(k float64) float64 { return k * c.size / (1 + math.Abs(k)*c.size) }
				want, got := squash(*a.Curvature[i]/c.m.s), squash(*b.Curvature[i])
				if e := math.Abs(got - want); e > centers {
					c.t.Errorf("curvature[%d] = %g, want %g within %.1e (off by %.2e)", i, *b.Curvature[i], *a.Curvature[i]/c.m.s, centers, e)
				}
			}
		}
	}
	if a, b := want.Adaptive, got.Adaptive; a != nil {
		refined := func(name string, x, y *RefinedPath, limit float64) {
			c.same(name+" present", x != nil, y != nil)
			if x == nil || y == nil {
				return
			}
			if c.b.exact {
				c.same(name+" inserted, breaks, unresolved", []int{x.Inserted, x.Breaks, x.Unresolved}, []int{y.Inserted, y.Breaks, y.Unresolved})
				c.path(name, x.Points, y.Points, limit)
				c.path(name+" reach", pointers(x.Reach), pointers(y.Reach), limit)
				return
			}
			// Refinement stops within its tolerance of the curve, so a
			// translated copy's insertions may fall elsewhere.
			c.same(name+" breaks", x.Breaks, y.Breaks)
			c.polyline(name, x.Points, y.Points, limit+2*refineEpsilon)
		}
		refined("refined base", a.Base, b.Base, base)
		refined("refined input", a.Input, b.Input, c.b.derivative(inputOrder(q.Input)))
		refined("refined derived", a.Derived, b.Derived, derived)
	}
	if a, b := want.Contours, got.Contours; a != nil {
		c.same("contours", len(a.Curve.Contours), len(b.Curve.Contours))
		c.same("nonfinite", a.Nonfinite, b.Nonfinite)
		for j := range min(len(a.Curve.Contours), len(b.Curve.Contours)) {
			// A crossing is placed within a thousandth of a cell, which
			// is 1/160 of the window here.
			x, y := pointers(a.Curve.Contours[j].Points), pointers(b.Curve.Contours[j].Points)
			if c.b.exact {
				c.path(fmt.Sprintf("contour[%d]", j), x, y, 0)
			} else {
				c.polyline(fmt.Sprintf("contour[%d]", j), x, y, 2*contourTolerance/float64(q.Curve.Implicit.Cells))
			}
		}
	}
}

// refineEpsilon is refinement's tolerance relative to a path's radius.
const refineEpsilon = 2e-4

func pointers(points []Vec) []*Vec {
	out := make([]*Vec, len(points))
	for i := range points {
		out[i] = &points[i]
	}
	return out
}

// checkCopies computes each preset and its copies under ms, with the base's
// diagnostics and refinement between samples where it has them.
func checkCopies(t *testing.T, ms []similarity, skip func(preset, *copies) string) {
	for _, p := range loadPresets(t) {
		q := p.Config
		q.Diagnostics = refines(q.Curve.Format)
		q.Adaptive = refines(q.Curve.Format)
		q.AdaptiveFrame = q.Adaptive
		want, err := Compute(q)
		if err != nil {
			t.Fatalf("%s: %v", p.Title, err)
		}
		for _, m := range ms {
			t.Run(p.Title+", "+m.name, func(t *testing.T) {
				t.Parallel()
				copy, ok := m.copyOf(q)
				if !ok {
					t.Skip("the definition cannot carry the map")
				}
				c := newCopies(t, want, m)
				if why := skip(p, c); why != "" {
					t.Skip(why)
				}
				got, err := Compute(copy)
				if err != nil {
					t.Fatal(err)
				}
				c.result(q, want, got)
			})
		}
	}
}

// Every preset scaled by a power of two draws the image of the original,
// exactly, with the same gaps, breaks, refinement and diagnostics.
func TestScaledPresetsDrawTheOriginalsImage(t *testing.T) {
	checkCopies(t, scaledCopies, func(preset, *copies) string { return "" })
}

// Every preset carried hundreds of diameters from the origin draws the
// image of the original within the translation budget, with the same gaps,
// breaks and diagnostics. A study so small for its distance that the
// budget for its centers of curvature exceeds its size has a curvature
// within rounding there, as a few thousandths of a unit 36,000 units out.
func TestTranslatedPresetsDrawTheOriginalsImage(t *testing.T) {
	checkCopies(t, translatedCopies, func(p preset, c *copies) string {
		if order(p.Config) > 2 {
			return "a construction on an evolute reads three derivatives, past the translation budget"
		}
		if c.b.derivative(2) > 1 {
			return "its curvature is within rounding this far out"
		}
		return ""
	})
}

// A cusp, (1 − cos 20t, 20t − sin 20t) at t = 0, a sample, scaled and
// moved. At the origin the point's own size bounds no noise, and the
// curve's acceleration measures the stencil's truncation, which a fast cusp
// makes larger than the coordinates there; a million units out, the
// coordinates bound the rounding. At every scale and place the base is
// drawn at the cusp, which has no tangent, no center of curvature and no
// point on the evolute, while the samples beside it have one.
func TestCuspAtAnyScaleAndPlace(t *testing.T) {
	for _, m := range []similarity{
		{"unit", 1, Vec{}},
		{"tiny", 0x1p-20, Vec{}},
		{"huge", 0x1p13, Vec{}},
		{"a million units out", 1, Vec{1e6, -1e6}},
	} {
		q := Request{Kind: "evolute", Samples: 1025, Lines: 2, Diagnostics: true,
			Curve: Curve{Format: "parametric", X: m.coordinate("1-cos(20*t)", m.c.X), Y: m.coordinate("20*t-sin(20*t)", m.c.Y), Min: -1, Max: 1}}
		r, err := Compute(q)
		if err != nil {
			t.Fatal(err)
		}
		const cusp = 512
		if r.Base[cusp] == nil || *r.Base[cusp] != m.c {
			t.Errorf("%s: base at the cusp = %v, want %v", m.name, r.Base[cusp], m.c)
		}
		if r.Derived[cusp] != nil {
			t.Errorf("%s: evolute at the cusp = %v, want none", m.name, *r.Derived[cusp])
		}
		if d := r.Diagnostics; d.Tangent[cusp] != nil || d.Center[cusp] != nil {
			t.Errorf("%s: tangent %v and center %v at the cusp, want neither", m.name, d.Tangent[cusp], d.Center[cusp])
		}
		for _, j := range []int{cusp - 1, cusp + 1} {
			if r.Derived[j] == nil || r.Diagnostics.Center[j] == nil {
				t.Errorf("%s: no evolute or center beside the cusp, at sample %d", m.name, j)
			}
		}
	}
}

// A pole 10⁻¹⁷ beside the sample at t = 0 of (t, 1/(t − 10⁻¹⁷)), scaled and
// moved. The sample is finite, 10¹⁷ times the curve's size, and its stencil
// straddles the pole, so its first derivative disagrees with the half
// step's: neither the sample's own size nor the second derivative across
// the pole may excuse that. At every scale and place the pedal curve has
// no point there and a circle rolled from t = −1 stops before the pole.
func TestPoleBesideASampleAtAnyScaleAndPlace(t *testing.T) {
	for _, m := range []similarity{
		{"unit", 1, Vec{}},
		{"tiny", 0x1p-20, Vec{}},
		{"huge", 0x1p13, Vec{}},
		{"far", 1, Vec{700, -500}},
	} {
		x, y := m.coordinate("t", m.c.X), m.coordinate("1/(t-1e-17)", m.c.Y)
		pedal := request("pedal", x, y, -1, 1)
		pedal.Pole = m.c
		if r := compute(t, pedal); r.Derived[250] != nil {
			t.Errorf("%s: pedal point %v at the pole", m.name, *r.Derived[250])
		}
		rolling := rollingRequest(x, y, -1, 1, Roller{Side: "left", Radius: .1 * m.s, Arm: .1 * m.s})
		for j, p := range compute(t, rolling).Derived {
			if u := sampleT(rolling, j); u > 0 && p != nil {
				t.Errorf("%s: rolled past the pole, to t = %g", m.name, u)
				break
			}
		}
	}
}

// An ellipse's curvature and evolute do not depend on its choice of length
// units, even below the fixed speed limits of other constructions. The
// closed forms check the returned geometry rather than another stencil.
func TestTinyEllipseRetainsCurvatureAndEvolute(t *testing.T) {
	for _, scale := range []float64{1, 0x1p-20, 0x1p-35, 0x1p-40, 0x1p-100} {
		t.Run(num(scale), func(t *testing.T) {
			for _, adaptive := range []bool{false, true} {
				q := request("evolute", num(2*scale)+"*cos(t)", num(scale)+"*sin(t)", 0, 2*math.Pi)
				q.Samples, q.Lines = 65, 8
				q.Diagnostics, q.Adaptive = true, adaptive
				at := 0.731
				q.Probe = &ProbeQuery{T: &at}
				r := compute(t, q)
				d := r.Diagnostics
				if d.Flat != 0 || d.Unknown != 0 || d.Clipped != 0 || r.Invalid != 0 {
					t.Fatalf("adaptive %v: flat %d, unknown %d, clipped %d, invalid %d", adaptive, d.Flat, d.Unknown, d.Clipped, r.Invalid)
				}
				center := func(u float64) Vec { return Vec{1.5 * math.Pow(math.Cos(u), 3), -3 * math.Pow(math.Sin(u), 3)} }
				check := func(u float64, p *Vec, curvature *float64) {
					t.Helper()
					if p == nil || curvature == nil {
						t.Fatalf("t=%g: missing center or curvature", u)
					}
					closeVec(t, point(p.Mul(1/scale)), center(u), 2e-6)
					want := 2 / math.Pow(4*math.Pow(math.Sin(u), 2)+math.Pow(math.Cos(u), 2), 1.5)
					if math.Abs(*curvature*scale-want) > 2e-7*want {
						t.Fatalf("t=%g: scaled curvature %g, want %g", u, *curvature*scale, want)
					}
				}
				if len(r.Rays) != q.Lines {
					t.Fatalf("%d representative normals, want %d", len(r.Rays), q.Lines)
				}
				for _, ray := range r.Rays {
					if ray.Target == nil {
						t.Fatal("normal without its center")
					}
					closeVec(t, point(ray.Target.Mul(1/scale)), center(sampleT(q, ray.SampleIndex)), 2e-6)
				}
				for i, p := range r.Derived {
					check(sampleT(q, i), p, d.Curvature[i])
					check(sampleT(q, i), d.Center[i], d.Curvature[i])
				}
				check(at, r.Probe.Center, r.Probe.Curvature)
				if adaptive {
					path := r.Adaptive.Derived
					if path == nil || path.Inserted == 0 || path.Breaks != 0 {
						t.Fatalf("missing continuous refined evolute: %+v", path)
					}
					// The ellipse's evolute is the astroid with semiaxes
					// 3/2 and 3: |x/(3/2)|^(2/3)+|y/3|^(2/3)=1.
					for _, p := range path.Points {
						if p == nil {
							t.Fatal("gap in refined ellipse evolute")
						}
						x, y := p.X/scale/1.5, p.Y/scale/3
						if e := math.Abs(math.Pow(math.Abs(x), 2.0/3) + math.Pow(math.Abs(y), 2.0/3) - 1); e > 2e-5 {
							t.Fatalf("refined point off astroid by %g", e)
						}
					}
				}
			}
		})
	}
}

// Removing a unit floor must not invent centers for a straight line, a
// constant point, or the stationary point of a cusp.
func TestTinyCurvatureKeepsDegenerateGaps(t *testing.T) {
	for _, scale := range []float64{1, 0x1p-40, 0x1p-100} {
		for _, xy := range [][2]string{{"t", "0"}, {"0", "0"}, {"t^2", "t^3"}} {
			q := request("evolute", num(scale)+"*("+xy[0]+")", num(scale)+"*("+xy[1]+")", -1, 1)
			q.Diagnostics = true
			r := compute(t, q)
			if r.Derived[q.Samples/2] != nil || r.Diagnostics.Center[q.Samples/2] != nil {
				t.Fatalf("scale %g, %v: center at a degeneracy", scale, xy)
			}
			if xy[1] == "0" {
				for _, p := range r.Derived {
					if p != nil {
						t.Fatalf("scale %g, %v: finite evolute on a line or point", scale, xy)
					}
				}
			}
		}
	}
}

// A line's second derivative consists only of rounding. In particular a
// tilted line must not acquire an evolute where its probe reads zero
// curvature. The full and half stencils share points, so their rounding can
// agree by chance: at 2000 samples, as the examples draw, the line's sample
// at t = 2·988/1999 − 1 has two second derivatives far closer than their
// rounding, and the probe stands there.
func TestTiltedLineHasNoEvolute(t *testing.T) {
	for _, run := range []struct {
		samples int
		at      float64
	}{{65, 0.731}, {2000, -1 + 2*988.0/1999}} {
		for _, scale := range []float64{1, 0x1p-40, 0x1p-100, 0x1p13} {
			for _, offset := range []float64{0, 860, 36000} {
				for _, adaptive := range []bool{false, true} {
					tiltedLineHasNoEvolute(t, run.samples, run.at, scale, offset, adaptive)
				}
			}
		}
	}
}

func tiltedLineHasNoEvolute(t *testing.T, samples int, at, scale, offset float64, adaptive bool) {
	t.Run(fmt.Sprintf("samples=%d/scale=%g/offset=%g/refine=%v", samples, scale, offset, adaptive), func(t *testing.T) {
		m := similarity{s: scale, c: Vec{offset * scale, -offset * scale}}
		q := request("evolute", m.coordinate("t", m.c.X), m.coordinate("0.7*t+0.3", m.c.Y), -1, 1)
		q.Samples, q.Lines = samples, 8
		q.Diagnostics, q.Adaptive = true, adaptive
		q.Probe = &ProbeQuery{T: &at}
		r := compute(t, q)
		for i, p := range r.Derived {
			if r.Base[i] == nil {
				t.Fatalf("missing straight base at sample %d", i)
			}
			if p != nil || r.Diagnostics.Center[i] != nil {
				t.Fatalf("finite curvature center at sample %d: evolute %v, probe %v", i, p, r.Diagnostics.Center[i])
			}
			if k := r.Diagnostics.Curvature[i]; k == nil || *k != 0 {
				t.Fatalf("line's curvature at sample %d: %v", i, k)
			}
		}
		if len(r.Rays) != 0 || r.Invalid != q.Samples {
			t.Fatalf("line has %d normals and %d/%d omitted evolute samples", len(r.Rays), r.Invalid, q.Samples)
		}
		if r.Probe.Point == nil || r.Probe.Derived != nil || r.Probe.Center != nil || r.Probe.Curvature == nil || *r.Probe.Curvature != 0 {
			t.Fatalf("between-sample probe disagrees with straight line: %+v", r.Probe)
		}
		if adaptive {
			for _, p := range r.Adaptive.Derived.Points {
				if p != nil {
					t.Fatalf("finite refined evolute on a line: %v", p)
				}
			}
		}
	})
}

func TestTiltedLineEvoluteInputIsUndefined(t *testing.T) {
	for _, n := range []int{65, 2000} {
		for _, adaptive := range []bool{false, true} {
			q := request("inversion", "t", "0.7*t+0.3", -1, 1)
			q.Input, q.Adaptive = "evolute", adaptive
			q.Inversion.Radius = 1
			q.Samples, q.Lines = n, 8
			r := compute(t, q)
			for i, p := range r.Input {
				if r.Base[i] == nil || p != nil || r.Derived[i] != nil {
					t.Fatalf("refine=%v sample %d: base %v, input %v, image %v", adaptive, i, r.Base[i], p, r.Derived[i])
				}
			}
			if adaptive {
				for _, path := range []*RefinedPath{r.Adaptive.Input, r.Adaptive.Derived} {
					for _, p := range path.Points {
						if p != nil {
							t.Fatalf("finite refined image of a line's evolute: %v", p)
						}
					}
				}
			}
		}
	}
}

// The evolute of a line's offset, itself a parallel line, is just as
// undefined: the check reads the offset's own second derivatives.
func TestTiltedLineOffsetHasNoEvolute(t *testing.T) {
	for _, n := range []int{65, 2000} {
		for _, adaptive := range []bool{false, true} {
			q := request("evolute", "t", "0.7*t+0.3", -1, 1)
			q.Input, q.Distance, q.Adaptive = "offset", 0.4, adaptive
			q.Samples, q.Lines = n, 8
			r := compute(t, q)
			for i, p := range r.Input {
				if p == nil || r.Derived[i] != nil {
					t.Fatalf("refine=%v sample %d: offset %v, evolute %v", adaptive, i, p, r.Derived[i])
				}
			}
			if adaptive {
				for _, p := range r.Adaptive.Derived.Points {
					if p != nil {
						t.Fatalf("finite refined evolute of a line's offset: %v", p)
					}
				}
			}
		}
	}
}

// The C¹ graph |t|^1.5 has a tangent at zero but no second derivative.
// Changing length units must not make its unresolved curvature pass the
// half-step check. Inversion retains the base without asking for r″, so
// its diagnostics and continuous probe must report unknown curvature.
func TestCurvatureStabilityAtAnyLengthScale(t *testing.T) {
	for _, scale := range []float64{1, 0x1p-20, 0x1p-40, 0x1p-100, 0x1p13} {
		for _, adaptive := range []bool{false, true} {
			t.Run(fmt.Sprintf("scale=%g/refine=%v", scale, adaptive), func(t *testing.T) {
				q := request("evolute", num(scale)+"*t", num(scale)+"*abs(t)^1.5", -1, 1)
				q.Samples, q.Lines, q.Adaptive = 65, 8, adaptive
				middle := q.Samples / 2
				r := compute(t, q)
				if r.Base[middle] != nil || r.Derived[middle] != nil {
					t.Errorf("kept sample with no second derivative: base %v, evolute %v", r.Base[middle], r.Derived[middle])
				}
				// Regular neighboring samples still have their analytic
				// curvature centers on both sides of the singular point.
				for _, j := range []int{middle - 1, middle + 1} {
					u := sampleT(q, j)
					d := 1.5 * math.Copysign(math.Sqrt(math.Abs(u)), u)
					dd := 0.75 / math.Sqrt(math.Abs(u))
					want := Vec{u - d*(1+d*d)/dd, math.Pow(math.Abs(u), 1.5) + (1+d*d)/dd}
					p := r.Derived[j]
					if p == nil {
						t.Fatalf("missing regular neighbor at t=%g", u)
					}
					closeVec(t, point(p.Mul(1/scale)), want, 1e-6)
				}
				if adaptive {
					found := false
					for i, at := range r.Adaptive.Derived.At {
						if at == float64(middle) {
							found = true
							if r.Adaptive.Derived.Points[i] != nil {
								t.Error("refined evolute keeps unresolved curvature")
							}
						}
					}
					if !found {
						t.Error("refined evolute lost the uniform sample")
					}
				}
				q.Kind, q.Diagnostics = "inversion", true
				q.Inversion.Center, q.Inversion.Radius = Vec{2 * scale, 0}, scale
				for _, at := range []float64{0, 0.00001} {
					q.Probe = &ProbeQuery{T: &at}
					r = compute(t, q)
					d := r.Diagnostics
					if r.Base[middle] == nil || d.Tangent[middle] == nil || d.Curvature[middle] != nil || d.Center[middle] != nil || d.Unknown == 0 {
						t.Errorf("sample: base %v, tangent %v, curvature %v, center %v, unknown %d", r.Base[middle], d.Tangent[middle], d.Curvature[middle], d.Center[middle], d.Unknown)
					}
					if p := r.Probe; p.Point == nil || p.Tangent == nil || p.Curvature != nil || p.Center != nil {
						t.Errorf("t=%g: probe must keep tangent without curvature: %+v", at, p)
					}
				}
			})
		}
	}
}

func TestCurvatureStabilityRetainsTranslatedLines(t *testing.T) {
	// The second derivative of a translated line consists of rounding.
	// Its allowance must follow coordinate size even when the speed floor
	// is small, so a regular tangent remains flat rather than unknown.
	for _, scale := range []float64{1, 0x1p-40, 0x1p-100, 0x1p13} {
		q := request("inversion", num(scale)+"*(t+36000)", num(scale)+"*(0.3141592653589793*t-36000)", -1, 1)
		q.Samples, q.Diagnostics = 65, true
		q.Inversion.Radius = scale
		at := 0.377
		q.Probe = &ProbeQuery{T: &at}
		r := compute(t, q)
		if d := r.Diagnostics; d.Flat != q.Samples || d.Unknown != 0 {
			t.Fatalf("scale %g: %d flat and %d unknown of %d", scale, d.Flat, d.Unknown, q.Samples)
		}
		if p := r.Probe; p.Point == nil || p.Tangent == nil || p.Curvature == nil || *p.Curvature != 0 || p.Center != nil {
			t.Fatalf("scale %g: translated line probe %+v", scale, p)
		}
	}
}

// A barely bending parabola still has no resolved finite center. This
// guards the speed reference when its acceleration is much smaller.
func TestTinyCurvatureKeepsFlatGuard(t *testing.T) {
	for _, scale := range []float64{1, 0x1p-40, 0x1p-100} {
		q := request("evolute", num(scale)+"*t", num(scale)+"*1e-12*t^2", -1, 1)
		q.Diagnostics = true
		r := compute(t, q)
		for i, p := range r.Derived {
			if p != nil || r.Diagnostics.Center[i] != nil || r.Diagnostics.Curvature[i] == nil || *r.Diagnostics.Curvature[i] != 0 {
				t.Fatalf("scale %g, sample %d: unresolved curvature acquired a center", scale, i)
			}
		}
	}
}

// A tilted line's stencil r″ is rounding, not exactly zero. Its curvature
// readouts and probe still find no center at any scale or offset; only the
// evolute itself keeps the rounding's far points, as it does at unit scale.
func TestTinyTiltedLineHasNoCurvatureCenter(t *testing.T) {
	for _, scale := range []float64{1, 0x1p-40, 0x1p-100} {
		for _, off := range []float64{0, 5} {
			q := request("evolute", num(scale)+"*(t+"+num(off)+")", num(scale)+"*(0.3141592653589793*t-"+num(off)+")", -1, 1)
			q.Diagnostics = true
			at := 0.377
			q.Probe = &ProbeQuery{T: &at}
			r := compute(t, q)
			if d := r.Diagnostics; d.Flat != q.Samples {
				t.Fatalf("scale %g, offset %g: %d of %d samples flat, %d clipped", scale, off, d.Flat, q.Samples, d.Clipped)
			}
			for i, c := range r.Diagnostics.Center {
				if c != nil {
					t.Fatalf("scale %g, offset %g, sample %d: center on a line", scale, off, i)
				}
			}
			if r.Probe == nil || r.Probe.Center != nil {
				t.Fatalf("scale %g, offset %g: probe center on a line: %+v", scale, off, r.Probe)
			}
		}
	}
}
