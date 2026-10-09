package engine3

import (
	"fmt"
	"math"
	"tangentgarden/engine/expr"
)

// Thread is a second space curve b(s) = (x(s), y(s), z(s)), written in t.
// It has no domain of its own: it is evaluated wherever the correspondence
// sends it, and a nonfinite point there is a gap.
type Thread struct {
	X string `json:"x"`
	Y string `json:"y"`
	Z string `json:"z"`
}

// RuledRequest joins the curve a(t) to a partner b by straight rulings,
// S(t, u) = (1 − u) a(t) + u b(φ(t)) for 0 ≤ u ≤ 1, with the explicit
// correspondence φ(t) = Rate·t + Shift. Partner "chord" takes b = a, so the
// rulings are chords of the curve; on a closed curve φ wraps around its
// period, and on an open one a chord exists only while φ(t) stays inside the
// domain. Partner "thread" takes b from Thread, which is then parsed; the
// chord partner ignores it.
type RuledRequest struct {
	Partner string  `json:"partner"`
	Thread  Thread  `json:"thread"`
	Rate    float64 `json:"rate"`
	Shift   float64 `json:"shift"`
}

// RuledResult describes the surface; the partner's points are the Result's
// Plus. Breaks are the base's plus every interval where the partner is
// missing, leaves the domain, or jumps. Closed is set when the curve is closed
// and the partner returns to its start, so the surface closes; otherwise, on
// a closed curve, Gap is the distance between the partner's ends. Outside
// counts samples whose chord would leave an open domain; Coincident counts
// rulings of zero length; Singular counts other rulings on which S_t × S_u
// vanishes at a mesh point, shaded there by the faces around it. Deviation
// is the largest scale-free det(a′, d, d′)/(|a′||d|(|a′| + |d′|)) over
// regular samples, with d = b∘φ − a; the surface is Developable when it is
// within 10⁻⁶.
type RuledResult struct {
	Partner     string  `json:"partner"`
	Breaks      []bool  `json:"breaks"`
	Closed      bool    `json:"closed"`
	Gap         float64 `json:"gap"`
	Outside     int     `json:"outside"`
	Coincident  int     `json:"coincident"`
	Singular    int     `json:"singular"`
	Developable bool    `json:"developable"`
	Deviation   float64 `json:"deviation"`
}

// ruledStrips divides every ruling so a curved (doubly ruled) surface is not
// drawn as one bilinear quad per interval.
const ruledStrips = 4

func (q RuledRequest) validate() error {
	if q.Partner != "chord" && q.Partner != "thread" {
		return fieldErr("ruled.partner", "join the curve to itself or to a second thread")
	}
	if !finite(q.Rate) || math.Abs(q.Rate) > 100 {
		return fieldErr("ruled.rate", "the rate m must be finite and within ±100")
	}
	if !finite(q.Shift) || math.Abs(q.Shift) > 1e6 {
		return fieldErr("ruled.shift", "the shift δ must be finite and within ±1000000")
	}
	return nil
}

// partner returns b and its first and second derivatives in b's own
// parameter at s, whether b and b′ are regular, and whether s lies where b
// is defined. b″ is not checked: it is used only by the surface probe.
func (q RuledRequest) partner(evaluate evaluation, lo, hi float64, closed bool) (func(float64) (Vec3, Vec3, Vec3, bool, bool), error) {
	span := hi - lo
	if q.Partner == "chord" {
		return func(s float64) (Vec3, Vec3, Vec3, bool, bool) {
			if closed {
				s = lo + math.Mod(s-lo, span)
				if s < lo {
					s += span
				}
			} else if s < lo-1e-9*span || s > hi+1e-9*span {
				return Vec3{}, Vec3{}, Vec3{}, false, false
			}
			r, v, a, ok := evaluate(math.Max(lo, math.Min(hi, s)))
			return r, v, a, ok && r.valid() && v.valid(), true
		}, nil
	}
	expressions := make([]expr.Expr, 3)
	for i, s := range []string{q.Thread.X, q.Thread.Y, q.Thread.Z} {
		e, err := expr.Parse(s)
		if err != nil {
			return nil, named("ruled.thread."+[]string{"x", "y", "z"}[i], fmt.Errorf("b %s(t): %w", []string{"x", "y", "z"}[i], err))
		}
		expressions[i] = e
	}
	f := func(s float64) Vec3 { return Vec3{expressions[0](s), expressions[1](s), expressions[2](s)} }
	// Steps follow the stretch of b that φ covers.
	if q.Rate != 0 {
		span *= math.Abs(q.Rate)
	}
	thread := sampled(f, math.Inf(-1), math.Inf(1), span)
	return func(s float64) (Vec3, Vec3, Vec3, bool, bool) {
		r, v, a, ok := thread(s)
		return r, v, a, ok, true
	}, nil
}

// ruledSurface builds the surface, and its probe when surface diagnostics
// are requested, from the base's accelerations.
func ruledSurface(c Request, out *Result, partner func(float64) (Vec3, Vec3, Vec3, bool, bool), tangents, accelerations []Vec3, speeds []float64, lo, hi float64, closed bool) error {
	n, m := c.Samples, c.Ruled.Rate
	step := (hi - lo) / float64(n)
	at := func(i float64) float64 { return lo*(1-i/float64(n)) + hi*i/float64(n) }
	q := &RuledResult{Partner: c.Ruled.Partner, Breaks: make([]bool, n+1)}
	plus := make([]*Vec3, n+1)
	velocity := make([]Vec3, n+1)     // d/dt of b(φ(t)), that is m·b′(φ)
	acceleration := make([]Vec3, n+1) // and m²·b″(φ)
	// A closed curve's last sample is its first, so it is counted once.
	last := n
	if closed {
		last = n - 1
	}
	found := false
	for i := 0; i <= n; i++ {
		p, v, a, ok, inside := partner(m*at(float64(i)) + c.Ruled.Shift)
		if !inside && i <= last {
			q.Outside++
		}
		if !inside || !ok {
			continue
		}
		found = true
		plus[i] = &p
		velocity[i], acceleration[i] = v.mul(m), a.mul(m*m)
	}
	if !found && q.Outside == 0 {
		return fmt.Errorf("the second thread has no finite points; check its expressions")
	}
	size := 0.0
	var origin *Vec3
	for i := 0; i <= n; i++ {
		for _, p := range []*Vec3{out.Base[i], plus[i]} {
			if p != nil && origin == nil {
				origin = p
			}
			if p != nil {
				size = math.Max(size, p.sub(*origin).norm())
			}
		}
	}
	if size == 0 {
		size = 1
	}
	if closed && plus[0] != nil && plus[n] != nil {
		q.Gap = plus[n].sub(*plus[0]).norm()
		if q.Gap <= 1e-9*size {
			q.Closed, q.Gap = true, 0
			plus[n], velocity[n], acceleration[n] = plus[0], velocity[0], acceleration[0]
		}
	}
	for i := 0; i < n; i++ {
		broken := out.Breaks[i+1] || plus[i] == nil || plus[i+1] == nil
		if !broken && m != 0 {
			_, v, _, ok, inside := partner(m*at(float64(i)+0.5) + c.Ruled.Shift)
			broken = !ok || !inside || jumps(*plus[i], *plus[i+1], v.mul(m), step)
		}
		q.Breaks[i+1] = broken
	}
	if out.Adaptive != nil {
		// The partner is evaluated pointwise, as at the samples; a gap or jump
		// refinement finds between samples breaks the surface there too.
		var broken []int
		out.Adaptive.Partner, broken = refinePath(plus, q.Breaks, func(t float64) Vec3 {
			p, _, _, ok, inside := partner(m*t + c.Ruled.Shift)
			if !ok || !inside {
				return Vec3{math.NaN(), 0, 0}
			}
			return p
		}, lo, hi, pathTolerance(plus), refineBudget)
		for _, i := range broken {
			q.Breaks[i+1] = true
		}
	}
	// Grid points P(i, k) = a_i + (k/strips) d_i, with normals S_t × S_u.
	type point struct {
		at      Vec3
		normal  Vec3
		defined bool
	}
	grid := make([][]point, n+1)
	for i := 0; i <= n; i++ {
		if out.Base[i] == nil || plus[i] == nil {
			continue
		}
		a, d := *out.Base[i], plus[i].sub(*out.Base[i])
		da := tangents[i].mul(speeds[i])
		coincident := d.norm() <= 1e-9*size
		singular := false
		grid[i] = make([]point, ruledStrips+1)
		for k := range grid[i] {
			u := float64(k) / ruledStrips
			st := da.mul(1 - u).add(velocity[i].mul(u))
			normal := st.cross(d)
			defined := !coincident && st.norm() > 1e-9*(da.norm()+velocity[i].norm()) && normal.norm() > 1e-6*st.norm()*d.norm()
			singular = singular || !defined
			grid[i][k] = point{a.add(d.mul(u)), normal.unit(), defined}
		}
		if i > last {
			continue
		}
		if coincident {
			q.Coincident++
			continue
		}
		if singular {
			q.Singular++
		}
		dd := velocity[i].sub(da)
		q.Deviation = math.Max(q.Deviation, math.Abs(da.dot(d.cross(dd)))/(da.norm()*d.norm()*(da.norm()+dd.norm())))
	}
	q.Developable = q.Deviation <= 1e-6
	// A grid point with a normal is listed once and shared by every
	// triangle at it; a corner without one takes its own triangle's face
	// normal.
	listed := map[[2]int]int32{}
	for i := 0; i < n; i++ {
		if q.Breaks[i+1] {
			out.Omitted++
			continue
		}
		// Both triangles of each cell are ordered so their face normal runs
		// along S_t × S_u, the fallback where a vertex normal is undefined.
		for k := 0; k < ruledStrips; k++ {
			corners := [][2]int{{i, k}, {i + 1, k}, {i, k + 1}, {i + 1, k}, {i + 1, k + 1}, {i, k + 1}}
			for f := 0; f < 6; f += 3 {
				g := [3]point{}
				for j := range g {
					g[j] = grid[corners[f+j][0]][corners[f+j][1]]
				}
				face := g[1].at.sub(g[0].at).cross(g[2].at.sub(g[0].at))
				flat := !(face.norm() > 1e-12*g[1].at.sub(g[0].at).norm()*g[2].at.sub(g[0].at).norm())
				// A flat triangle with a corner that has no normal is left out.
				dropped := false
				for _, p := range g {
					dropped = dropped || (!p.defined && flat)
				}
				if dropped {
					continue
				}
				var vertices [3]int32
				for j, p := range g {
					corner := corners[f+j]
					phase := float64(corner[0]) / float64(n)
					if !p.defined {
						vertices[j] = out.Mesh.vertex(p.at, face.unit(), phase)
						continue
					}
					v, ok := listed[corner]
					if !ok {
						v = out.Mesh.vertex(p.at, p.normal, phase)
						listed[corner] = v
					}
					vertices[j] = v
				}
				out.Mesh.triangle(i+1, vertices[0], vertices[1], vertices[2])
			}
		}
	}
	for line := 0; line < c.Lines; line++ {
		j := line * n / (c.Lines - 1)
		if out.Base[j] != nil && plus[j] != nil {
			out.Rulings = append(out.Rulings, Ruling{j, *out.Base[j], *plus[j]})
		}
	}
	out.Minus, out.Plus, out.Ruled = []*Vec3{}, plus, q
	if c.SurfaceDiagnostics {
		// S = a + u d with d = b∘φ − a, so S_t = a′ + u d′, S_tt = a″ + u d″
		// and S_tu = d′, regular by the drawing's own guards.
		at := func(i int, u float64) ruledSample {
			if out.Base[i] == nil || plus[i] == nil {
				return ruledSample{}
			}
			a, d := *out.Base[i], plus[i].sub(*out.Base[i])
			da := tangents[i].mul(speeds[i])
			dd := velocity[i].sub(da)
			st := da.add(dd.mul(u))
			regular := d.norm() > 1e-9*size && st.norm() > 1e-9*(da.norm()+velocity[i].norm()) && st.cross(d).norm() > 1e-6*st.norm()*d.norm()
			ddd := acceleration[i].sub(accelerations[i])
			return ruledSample{X: a.add(d.mul(u)), St: st, Su: d, Stt: accelerations[i].add(ddd.mul(u)), Stu: dd,
				Point: true, Regular: regular, Known: accelerations[i].valid() && acceleration[i].valid()}
		}
		out.Probe = ruledProbe("ruled", n, closed && q.Closed, lo, hi, spanned(0, 1), at, func(float64) bool { return false }, false)
	}
	return nil
}
