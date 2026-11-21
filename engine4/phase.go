package engine4

import (
	"fmt"
	"math"
	"math/cmplx"
)

// A marked point carried along the moving fiber (docs/tesseracts.md,
// "Phase along a moving fiber"). With S³ ⊂ C², a curve q(u) over the base
// path is horizontal when Im⟨q, q′⟩ = 0: its velocity is orthogonal to the
// fiber direction iq. That is the Hopf bundle's canonical connection, and
// the only rule that moves the point. The point q itself is the state; each
// quadrature piece writes it as q = e^{iψ}s(p) in whichever chart s is well
// conditioned there, so a change of chart never moves the point:
//
//	north (p_z > −1): ψ′ = (p × p′)_z / 2(1 + p_z),
//	south (p_z < 1):  ψ′ = −(p × p′)_z / 2(1 − p_z).
//
// After one turn of the path the point is back on its own fiber, turned by
// the holonomy γ ≡ A/2 (mod 2π), half the signed area to the path's left.

// TransportDiagnostics describe the marked point. Start and Point are
// unrotated points of S³; Inside reports whether each lies in the window
// after the 4D rotation, which decides whether it is drawn.
type TransportDiagnostics struct {
	// γ in (−π, π]: one turn of the path, in its orientation, turns the
	// point by e^{iγ} along its fiber.
	Holonomy    float64 `json:"holonomy"`
	Start       Vec4    `json:"start"`
	Point       Vec4    `json:"point"`
	Inside      bool    `json:"inside"`
	StartInside bool    `json:"startInside"`
}

// The longest stretch of the base path, in arc length on S², that one
// quadrature piece covers. A piece is then far from the pole its chart
// excludes, so the integrand is smooth there and eight Gauss–Legendre nodes
// reach rounding.
const transportStep = 1. / 8

var (
	gaussNodes   = [4]float64{0.1834346424956498, 0.5255324099163290, 0.7966664774136267, 0.9602898564975363}
	gaussWeights = [4]float64{0.3626837833783620, 0.3137066458778873, 0.2223810344533745, 0.1012285362903763}
)

// transportPieces is the number of equal pieces per period, before the
// corners are added: the base curve's segments, or more when the path is
// fast, so that no piece is longer than transportStep on S².
func transportPieces(path spherePath) int {
	return max(path.segments, int(math.Ceil(path.period*path.speed/transportStep)))
}

// transportPoints counts the marked point's geometry before evaluation: a
// trail of one turn, sampled at every piece boundary and both ends; the gap,
// at most half the moving fiber at its N arc samples; at most one window
// crossing added per interval of either; and two markers.
func transportPoints(path spherePath, samples int) int {
	return 2*(transportPieces(path)+len(path.corners)+2) + 2*(samples/2+2) + 2
}

// transporter carries points of S³ horizontally over unwrapped parameters
// of one path, piece by piece. Pieces end at the multiples of T/Q and at each corner, in
// every period, so no piece spans a corner or the seam.
type transporter struct {
	path        spherePath
	knots       []float64 // in [0, T), increasing
	evaluations int
}

func newTransporter(path spherePath) *transporter {
	q := transportPieces(path)
	knots := make([]float64, 0, q+len(path.corners))
	corner := 0
	for i := 0; i < q; i++ {
		t := path.period * float64(i) / float64(q)
		for ; corner < len(path.corners) && path.corners[corner] < t-weaveTolerance; corner++ {
			knots = append(knots, path.corners[corner])
		}
		if corner < len(path.corners) && path.corners[corner] <= t+weaveTolerance {
			corner++
		}
		knots = append(knots, t)
	}
	knots = append(knots, path.corners[corner:]...)
	return &transporter{path: path, knots: knots}
}

// breaks returns the knots strictly between a < b, in increasing order. A
// knot within rounding of either end (10⁻¹² of the period) is that end.
func (tr *transporter) breaks(a, b float64) []float64 {
	T := tr.path.period
	lo, hi := a+1e-12*T, b-1e-12*T
	out := []float64{}
	for m := math.Floor(lo / T); m*T <= hi; m++ {
		for _, k := range tr.knots {
			if u := m*T + k; u > lo && u < hi {
				out = append(out, u)
			}
		}
	}
	return out
}

// chartSection is the unit chart representative over p.
func chartSection(p Vec3, north bool) Vec4 {
	s := hopfChart(p, north)
	n := norm(s)
	for i := range s {
		s[i] /= n
	}
	return s
}

func complexPair(q Vec4) (complex128, complex128) {
	return complex(q[0], q[1]), complex(q[2], q[3])
}

// phaseOn returns arg⟨s, q⟩ for q on the fiber of the unit s.
func phaseOn(s, q Vec4) float64 {
	s1, s2 := complexPair(s)
	q1, q2 := complexPair(q)
	return cmplx.Phase(cmplx.Conj(s1)*q1 + cmplx.Conj(s2)*q2)
}

// turnedBy is e^{iθ}q.
func turnedBy(q Vec4, theta float64) Vec4 {
	e := cmplx.Exp(complex(0, theta))
	z1, z2 := complexPair(q)
	z1, z2 = e*z1, e*z2
	return Vec4{real(z1), imag(z1), real(z2), imag(z2)}
}

// onFiber returns the point of p's fiber with the phase of q, measured in
// the chart hopfFiber uses at p: q itself, up to rounding, when q is over p.
func onFiber(q Vec4, p Vec3) Vec4 {
	s, _ := hopfFiber(p)
	return turnedBy(s, phaseOn(s, q))
}

// at evaluates the path at an unwrapped parameter u of the period holding
// it.
func (tr *transporter) at(u, shift float64) (Vec3, Vec3) {
	tr.evaluations++
	return tr.path.point(u - shift), tr.path.derivative(u - shift)
}

// piece carries q from x to y within one piece.
func (tr *transporter) piece(q Vec4, x, y float64) Vec4 {
	if x == y {
		return q
	}
	T := tr.path.period
	mid := (x + y) / 2
	shift := math.Floor(mid/T) * T
	pm, _ := tr.at(mid, shift)
	north := pm[2] >= 0
	px, _ := tr.at(x, shift)
	psi := phaseOn(chartSection(px, north), q)
	half := (y - x) / 2
	for i, node := range gaussNodes {
		for _, sign := range []float64{-1, 1} {
			p, d := tr.at(mid+sign*node*half, shift)
			cz := p[0]*d[1] - p[1]*d[0]
			rate := cz / (2 * (1 + p[2]))
			if !north {
				rate = -cz / (2 * (1 - p[2]))
			}
			psi += gaussWeights[i] * half * rate
		}
	}
	py, _ := tr.at(y, shift)
	return turnedBy(chartSection(py, north), psi)
}

// startingPoint is e^{iφ₀} times the north chart's representative over p,
// with z₁ real and positive, or e^{iφ₀}(0, 0, 1, 0) at the south pole where
// z₁ = 0. In the south hemisphere it is computed as e^{−iδ}q_S, δ =
// arg(p_x + i p_y), which stays well conditioned near that pole.
func startingPoint(p Vec3, phase float64) Vec4 {
	q, chart := hopfFiber(p)
	if chart == "south" {
		q = turnedBy(q, -math.Atan2(p[1], p[0]))
	}
	if phase == 0 {
		return q
	}
	return turnedBy(q, phase)
}

func validateTransport(w WeaveParameters) error {
	if w.Transport && (!finite(w.Phase) || math.Abs(w.Phase) > 1e5) {
		return fieldErr("weave.phase", "Starting phase φ₀ must be finite and within ±100000 radians")
	}
	return nil
}

// transport carries the marked point from the selected sample, at u₀, over
// trace turns of the path, and draws it, its start and its trail: the
// horizontal lift over the whole turn of the path behind the point, so the
// trail's ends lie on the moving fiber, apart by the holonomy. Everything
// drawn but the start depends only on where the point is, so a motion of k
// turns with kγ a whole turn ends as it began. moving is the moving point's
// base point, which the marked point lies over exactly.
func (b *weaveBuilder) transport(w WeaveParameters, path spherePath, u0 float64, moving Vec3, c *CorrespondenceDiagnostics) {
	start := startingPoint(path.point(u0), w.Phase)
	if path.constant {
		start = startingPoint(moving, w.Phase)
	}
	d := &TransportDiagnostics{Start: start, Point: start}
	c.Transport = d
	k := b.k
	inside := func(v Vec4) bool { return rotate(v, b.q.Angles)[3] <= k+weaveTolerance }
	defer func() {
		d.Inside, d.StartInside = inside(d.Point), inside(d.Start)
		for _, m := range []struct {
			id, role string
			q        Vec4
			in       bool
		}{{"weave/marked/start", "marked-start", d.Start, d.StartInside}, {"weave/marked", "marked", d.Point, d.Inside}} {
			if !m.in {
				continue
			}
			v := rotate(m.q, b.q.Angles)
			den := 1 - v[3]
			b.r.Markers = append(b.r.Markers, Marker{ID: m.id, Role: m.role, Point: Vec3{v[0] / den, v[1] / den, v[2] / den}, FourPoint: v})
			b.r.Evaluations++
		}
	}()
	if path.constant {
		return // every point is one pole: the point never moves
	}
	tr := newTransporter(path)
	T := path.period
	turns := math.Floor(w.Trace)
	f := w.Trace - turns
	now := u0 + f*T

	// One march over a period from the start supplies everything: the
	// holonomy at its end, the point at now, and the trail over [now − T,
	// now], whose part before u₀ is the march after now turned back by γ.
	// The grid is the knots, with now in place of any knot within rounding
	// of it.
	us := []float64{u0}
	at := 0 // where now is in us
	for _, k := range tr.breaks(u0, u0+T) {
		if at == 0 && f != 0 && k >= now-1e-12*T {
			at = len(us)
			us = append(us, now)
		}
		if math.Abs(k-now) > 1e-12*T {
			us = append(us, k)
		}
	}
	if at == 0 && f != 0 {
		at = len(us)
		us = append(us, now)
	}
	us = append(us, u0+T)
	qs := make([]Vec4, len(us))
	qs[0] = start
	for i := 1; i < len(us); i++ {
		qs[i] = tr.piece(qs[i-1], us[i-1], us[i])
	}
	d.Holonomy = phaseOn(start, qs[len(qs)-1])
	if d.Holonomy <= -math.Pi {
		d.Holonomy = math.Pi // the same turn, reported in (−π, π]
	}
	switch {
	case f == 0 && turns == 0:
	case f == 0:
		d.Point = turnedBy(start, turns*d.Holonomy)
	default:
		d.Point = onFiber(turnedBy(qs[at], turns*d.Holonomy), moving)
	}

	// The trail in increasing u, reported unwrapped as u₀ + trace·T is:
	// the march from now to its end, a period back and turned by (k − 1)γ,
	// then from just after u₀ to now, turned by kγ. Each sample keeps its
	// marched parameter and point, from which a crossing is carried.
	type sample struct {
		u, shift, turn float64
		q              Vec4
	}
	trail := []sample{}
	for i := at; i < len(us); i++ {
		trail = append(trail, sample{us[i], (turns - 1) * T, (turns - 1) * d.Holonomy, qs[i]})
	}
	for i := 1; i <= at; i++ {
		trail = append(trail, sample{us[i], turns * T, turns * d.Holonomy, qs[i]})
	}
	tu, tq := make([]float64, len(trail)), make([]Vec4, len(trail))
	for i, t := range trail {
		tu[i], tq[i] = t.u+t.shift, turnedBy(t.q, t.turn)
	}
	tq[len(tq)-1] = d.Point
	b.clipped("weave/lift", "lift", tu, tq, func(i int, u float64) Vec4 {
		t := trail[i]
		return turnedBy(tr.piece(t.q, t.u, u-t.shift), t.turn)
	})

	// The gap: the moving fiber's arc from where the trail lands, e^{−iγ}
	// times the point, to the point. Its parameter s is the turn from the
	// point, increasing, at the fiber's own arc-sample spacing.
	if d.Holonomy != 0 {
		lo, hi := math.Min(-d.Holonomy, 0), math.Max(-d.Holonomy, 0)
		m := max(2, int(math.Ceil((hi-lo)/b.step)))
		ss, gs := make([]float64, m+1), make([]Vec4, m+1)
		for i := range ss {
			ss[i] = lo + (hi-lo)*float64(i)/float64(m)
			gs[i] = turnedBy(d.Point, ss[i])
		}
		ss[m] = hi
		b.clipped("weave/holonomy", "holonomy", ss, gs, func(_ int, s float64) Vec4 { return turnedBy(d.Point, s) })
	}
	b.r.Evaluations += tr.evaluations
}

// clipped emits a sampled curve of S³, its unrotated points qs at
// increasing parameters us, clipped to the window, as arcs (branches) of
// one source. A crossing between two samples is found by bisection on the
// curve itself: at(i, u) evaluates it at u from sample i.
func (b *weaveBuilder) clipped(source, role string, us []float64, qs []Vec4, at func(i int, u float64) Vec4) {
	k := b.k
	rotated := make([]Vec4, len(qs))
	for i, q := range qs {
		rotated[i] = rotate(q, b.q.Angles)
	}
	in := func(v Vec4) bool { return v[3] <= k+weaveTolerance }
	crossing := func(i, j int) (float64, Vec4) {
		// Sample i is inside and j outside; they lie in one piece.
		lo, hi := us[i], us[j]
		u, v := lo, rotated[i]
		for range 60 {
			mid := (lo + hi) / 2
			if mid == lo || mid == hi {
				break
			}
			w := rotate(at(i, mid), b.q.Angles)
			if in(w) {
				lo, u, v = mid, mid, w
			} else {
				hi = mid
			}
		}
		return u, v
	}
	var arc *Path
	branch := 0
	add := func(u float64, v Vec4) {
		if arc == nil {
			arc = &Path{Source: source, SectionID: "weave/latitude/0", Branch: fmt.Sprint(branch), Role: role}
			branch++
		}
		den := 1 - v[3]
		arc.Parameters = append(arc.Parameters, u)
		arc.FourPoints = append(arc.FourPoints, v)
		arc.Points = append(arc.Points, Vec3{v[0] / den, v[1] / den, v[2] / den})
		b.r.Evaluations++
	}
	end := func() {
		if arc != nil && len(arc.Points) > 1 {
			b.r.Paths = append(b.r.Paths, *arc)
		}
		arc = nil
	}
	for i, v := range rotated {
		if in(v) {
			if i > 0 && !in(rotated[i-1]) {
				add(crossing(i, i-1))
			}
			add(us[i], v)
			continue
		}
		if i > 0 && in(rotated[i-1]) {
			add(crossing(i-1, i))
		}
		end()
	}
	end()
}
