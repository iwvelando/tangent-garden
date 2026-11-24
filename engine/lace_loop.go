package engine

import (
	"fmt"
	"math"
	"math/cmplx"
)

// The loop motif (docs/mathematics.md, Hyperbolic lace, Motifs): a closed
// Fourier curve, such as a fit from Draw a loop, placed in the incircle of
// the seed's fundamental triangle 0 and mirrored into all 2p of them, a
// kaleidoscope. Its strokes are circular arcs, each through three points
// of the curve, carried exactly by the tiles' transformations like the
// other motifs' strokes. A tile's copies are drawn with fewer arcs the
// smaller it is drawn.

const (
	// LaceLoopMaxFrequency bounds a loop term's whole frequency, the
	// range Draw a loop fits.
	LaceLoopMaxFrequency = 64
	// laceLoopDetail is the least drawn radius, in model units, that the
	// level of detail assumes without a window: about 2.7 page units at 1×.
	laceLoopDetail = 1.0 / 128
)

// laceLoop is the loop's strokes in the seed at every level of detail:
// levels[ℓ] has 2^(ℓ+1) arcs per copy, up to top. rho0 is the Euclidean
// radius of the seed copy's disk.
type laceLoop struct {
	top    int
	rho0   float64
	levels []laceLoopLevel
}

// laceLoopLevel holds 2p copies of the loop, copy c's arc m at c·arcs + m:
// its ends in the seed and the inversion in its circle.
type laceLoopLevel struct {
	arcs     int
	from, to []complex128
	circles  []laceCircle
}

func (l *laceLoop) level(arcs int) *laceLoopLevel {
	return &l.levels[int(math.Round(math.Log2(float64(arcs))))-1]
}

// validateLoop checks the loop's terms as a Fourier curve's are checked,
// with whole frequencies so that the curve closes over [0, 2π], and
// refuses a loop that does not move: one whose terms of each nonzero
// frequency, added together, are negligible beside its terms' sizes.
func validateLoop(terms []Term) error {
	if len(terms) < 1 || len(terms) > maxTerms {
		return fieldErr("loop", "a loop has 1–%d terms", maxTerms)
	}
	sum := map[float64]complex128{}
	total, moving := 0.0, 0.0
	for k, term := range terms {
		switch {
		case !finite(term.Frequency) || term.Frequency != math.Trunc(term.Frequency) || math.Abs(term.Frequency) > LaceLoopMaxFrequency:
			return fieldErr(fmt.Sprintf("loop.%d.frequency", k), "loop term %d: the frequency must be a whole number within ±%d", k+1, LaceLoopMaxFrequency)
		case !finite(term.Radius) || term.Radius < 0 || term.Radius > 1e5:
			return fieldErr(fmt.Sprintf("loop.%d.radius", k), "loop term %d: the radius must be finite and within 0–100000", k+1)
		case !finite(term.Phase) || math.Abs(term.Phase) > 1e6:
			return fieldErr(fmt.Sprintf("loop.%d.phase", k), "loop term %d: the phase must be finite and within ±1000000 radians", k+1)
		}
		sum[term.Frequency] += cmplx.Rect(term.Radius, term.Phase)
		total += term.Radius
	}
	for f, c := range sum {
		if f != 0 {
			moving += cmplx.Abs(c)
		}
	}
	if !(moving > 1e-9*total) {
		return fieldErr("loop", "the loop must move: give a term a nonzero frequency and radius")
	}
	return nil
}

// pow2 is the least power of two at least x, within lo and hi.
func pow2(x float64, lo, hi int) int {
	n := lo
	for n < hi && float64(n) < x {
		n *= 2
	}
	return n
}

// newLaceLoop places the loop in fundamental triangle 0, (O, M_0, V_1),
// with angles π/p, π/2 and π/q. Its inradius ρ has
// tanh²ρ = (cos²(π/p) + cos²(π/q) − 1)/(2(1 + cos(π/p))(1 + cos(π/q))),
// the cos(π/2) terms vanishing, and its incenter I lies on the bisector
// at O, at distance d with sinh ρ = sinh d · sin(π/2p).
//
// The curve is sampled at 2·top points, top = 8 arcs per turn of its
// fastest term as a power of two from 32 to 512. Arc m of a level with M
// arcs runs through the samples at t = 2πm/M, 2π(m + ½)/M and
// 2π(m + 1)/M. In the curve's plane, C is the center of the least circle
// about the samples, and R the farthest any top-level arc reaches from C,
// measured on the arc, or at its ends for an arc turning π/3 or more,
// which is drawn as a geodesic. The similarity
// w ↦ e^{iβ}(w − C)·tanh(uρ/2)/R, with β turning the curve's +y outward
// along the bisector, puts every
// top-level arc in the disk of radius tanh(uρ/2) about 0, the hyperbolic
// disk of radius uρ; the isometry z ↦ (z + I)/(1 + Īz) carries it to I.
// Both send circles to circles, so each placed arc is the circle through
// the three placed points. A hyperbolic disk is a Euclidean disk under
// every isometry, and geodesically convex, so the copies stay inside their
// triangles wherever the tiles carry them. An arc turning π/3 or more in
// the curve's plane, and an arc of a coarser level that would reach past
// R, are drawn instead as the geodesic between their ends, which stays in
// the disk. The rest keep the bound (1 + |κ|)·L on their turning below
// π/2: the similarity and the isometry are conformal, so an arc turns
// under π/3 plus the incircle's area, at most about 0.08, and it is no
// longer than about the incircle's diameter, at most 0.32.
func newLaceLoop(s *laceSeed, terms []Term, u float64, tl laceTiling) *laceLoop {
	fastest := 0.0
	for _, term := range terms {
		if term.Radius > 0 {
			fastest = math.Max(fastest, math.Abs(term.Frequency))
		}
	}
	top := pow2(8*fastest, 32, 512)
	n := 2 * top
	pts := make([]complex128, n)
	for j := range pts {
		v := fourierAt(terms, 2*math.Pi*float64(j)/float64(n))
		pts[j] = complex(v.X, v.Y)
	}
	center := enclosingCenter(pts)
	// An arc turning a third of a turn or more, as at a cusp, is drawn as
	// the geodesic between its ends, which reaches no farther than they.
	bent := func(a, m, b int) bool { return arcTurn(pts[a], pts[m], pts[b]) >= math.Pi/3 }
	reach := 0.0
	for m := range top {
		a, mid, b := 2*m, 2*m+1, (2*m+2)%n
		if bent(a, mid, b) {
			reach = math.Max(reach, math.Max(cmplx.Abs(pts[a]-center), cmplx.Abs(pts[b]-center)))
		} else {
			reach = math.Max(reach, arcReach(pts[a], pts[mid], pts[b], center))
		}
	}
	cosP, cosQ := math.Cos(tl.piOverP), math.Cos(tl.piOverQ)
	rho := math.Atanh(math.Sqrt((cosP*cosP + cosQ*cosQ - 1) / (2 * (1 + cosP) * (1 + cosQ))))
	bisector := math.Pi/2 + 1.5*tl.piOverP
	in := cmplx.Rect(math.Tanh(math.Asinh(math.Sinh(rho)/math.Sin(tl.piOverP/2))/2), bisector)
	tau := math.Tanh(u * rho / 2)
	scale := cmplx.Rect(tau/reach, bisector-math.Pi/2)
	placed := make([]complex128, n)
	for j, z := range pts {
		w := scale * (z - center)
		placed[j] = (w + in) / (1 + cmplx.Conj(in)*w)
	}
	g := rimGap(in)
	l := &laceLoop{top: top, rho0: g * tau / (1 - (1-g)*tau*tau)}
	p := s.p
	for arcs := 2; arcs <= top; arcs *= 2 {
		lv := laceLoopLevel{
			arcs:    arcs,
			from:    make([]complex128, 2*p*arcs),
			to:      make([]complex128, 2*p*arcs),
			circles: make([]laceCircle, 2*p*arcs),
		}
		stride := top / arcs
		for m := range arcs {
			a, mid, b := 2*m*stride, (2*m+1)*stride, (2*m+2)*stride%n
			lv.from[m], lv.to[m] = placed[a], placed[b]
			c, ok := threePoint(placed[a], placed[mid], placed[b])
			if !ok || bent(a, mid, b) || arcReach(pts[a], pts[mid], pts[b], center) > reach {
				c = geodesicCircle(placed[a], placed[b])
			}
			lv.circles[m] = c
		}
		for k := range p {
			v := s.vertex[(k+1)%p]
			turn := cmplx.Rect(1, 2*math.Pi*float64(k)/float64(p))
			line := v / complex(cmplx.Abs(v), 0)
			mirror := line * line
			for m := range arcs {
				i, j := 2*k*arcs+m, (2*k+1)*arcs+m
				lv.from[i], lv.to[i] = lv.from[m]*turn, lv.to[m]*turn
				lv.circles[i] = lv.circles[m].turned(turn)
				lv.from[j], lv.to[j] = mirror*cmplx.Conj(lv.from[i]), mirror*cmplx.Conj(lv.to[i])
				lv.circles[j] = lv.circles[i].mirrored(mirror)
			}
		}
		l.levels = append(l.levels, lv)
	}
	return l
}

// enclosingCenter is the center of the least circle enclosing the points,
// by Welzl's incremental method over a fixed odd-stride permutation of
// them, which keeps its expected work linear.
func enclosingCenter(pts []complex128) complex128 {
	n := len(pts)
	order := make([]complex128, n)
	for j := range n {
		order[j] = pts[j*2654435761%n]
	}
	c, r := order[0], 0.0
	out := func(z complex128) bool { return cmplx.Abs(z-c) > r*(1+1e-12) }
	for i := 1; i < n; i++ {
		if !out(order[i]) {
			continue
		}
		c, r = order[i], 0
		for j := range i {
			if !out(order[j]) {
				continue
			}
			c = (order[i] + order[j]) / 2
			r = cmplx.Abs(order[i]-order[j]) / 2
			for k := range j {
				if !out(order[k]) {
					continue
				}
				if cc, ok := circumcenter(order[i], order[j], order[k]); ok {
					c, r = cc, cmplx.Abs(order[i]-cc)
				}
			}
		}
	}
	return c
}

// arcTurn is the Euclidean turning of the arc from a through m to b, the
// angle its circle subtends: 2(π − ∠amb), 0 for a straight run.
func arcTurn(a, m, b complex128) float64 {
	u, v := a-m, b-m
	if u == 0 || v == 0 {
		return 0
	}
	return 2 * (math.Pi - math.Abs(cmplx.Phase(v/u)))
}

// circumcenter is the center of the circle through three points, or false
// when they are collinear.
func circumcenter(a, b, c complex128) (complex128, bool) {
	b, c = b-a, c-a
	d := 2 * (real(b)*imag(c) - imag(b)*real(c))
	if d == 0 {
		return 0, false
	}
	b2, c2 := real(b)*real(b)+imag(b)*imag(b), real(c)*real(c)+imag(c)*imag(c)
	return a + complex((imag(c)*b2-imag(b)*c2)/d, (real(b)*c2-real(c)*b2)/d), true
}

// arcReach is the farthest the arc from a through m to b comes from x: an
// end, or the point of its circle beyond its center from x when that point
// lies on the arc, on m's side of the chord. Collinear points give the
// farther end when m lies between them, and otherwise no finite arc.
func arcReach(a, m, b, x complex128) float64 {
	far := math.Max(cmplx.Abs(a-x), cmplx.Abs(b-x))
	c, ok := circumcenter(a, m, b)
	if !ok {
		if real((m-a)*cmplx.Conj(m-b)) <= 0 {
			return far
		}
		return math.Inf(1)
	}
	rho := cmplx.Abs(a - c)
	d := c - x
	if cmplx.Abs(d) == 0 {
		return rho
	}
	top := c + d*complex(rho/cmplx.Abs(d), 0)
	side := func(z complex128) float64 { return imag((z - a) * cmplx.Conj(b-a)) }
	if side(top)*side(m) > 0 {
		far = math.Max(far, cmplx.Abs(top-x))
	}
	return far
}

// threePoint is the inversion in the circle through a, m and b, or the
// reflection in their line when m lies between them on it: the normalized
// (u, k, w) of the circle with center c and radius ρ, u = c/ρ, k = 1/ρ and
// w = (ρ² − |c|²)/ρ. The center is found relative to a, c = a + c′, which
// keeps it accurate for points close together far from the origin, and
// since |a − c| = ρ, w = −(|a|² + 2Re(ā c′))/ρ needs no difference of the
// large ρ² and |c|². False when the points do not determine a finite arc.
func threePoint(a, m, b complex128) (laceCircle, bool) {
	rel, ok := circumcenter(0, m-a, b-a)
	if !ok {
		if a == b || real((m-a)*cmplx.Conj(m-b)) > 0 {
			return laceCircle{}, false
		}
		n := (b - a) * complex(0, 1) / complex(cmplx.Abs(b-a), 0)
		return laceCircle{u: n, w: -2 * real(a*cmplx.Conj(n))}, true
	}
	rho := cmplx.Abs(rel)
	if !(rho > 0) || !finite(rho) {
		return laceCircle{}, false
	}
	c := a + rel
	return laceCircle{
		u: c / complex(rho, 0),
		k: 1 / rho,
		w: -(real(a)*real(a) + imag(a)*imag(a) + 2*real(cmplx.Conj(a)*rel)) / rho,
	}, true
}

// geodesicCircle is the inversion in the geodesic through z and w: its
// circle orthogonal to the rim, with w = (ρ² − |c|²)/ρ = −1/ρ. Where that
// geodesic is drawn straight, it is the reflection in the line through z
// and w, k = 0, u its unit normal and w = −2d for the line Re(ū z) = d.
func geodesicCircle(z, w complex128) laceCircle {
	c, rho, straight := geodesic(z, w)
	if !straight {
		return laceCircle{u: c / complex(rho, 0), k: 1 / rho, w: -1 / rho}
	}
	d := w - z
	if cmplx.Abs(d) == 0 {
		d = z
		if cmplx.Abs(d) == 0 {
			d = 1
		}
	}
	n := d * complex(0, 1) / complex(cmplx.Abs(d), 0)
	return laceCircle{u: n, w: -2 * real(z*cmplx.Conj(n))}
}
