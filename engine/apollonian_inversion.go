package engine

import (
	"math"
	"reflect"
)

// The garden's inversive view (docs/mathematics.md, Apollonian garden, The
// inversive view): the packing inverted in a circle, its pole P and radius
// ρ, w = P + ρ²(z − P)/|z − P|². Tangency and contact are kept; a circle
// through the pole becomes a line, and one around it encloses the rest.
//
// Circles carry augmented curvature-center coordinates W = (b, z, b̄),
// b̄ = b|c|² − 1/b, on which inversion acts linearly. Generation for a view
// prunes in the image: a gap is filled when the image of its dual region
// reaches the window, and is left out by radius when its first circle's
// image is below the minimum radius, which bounds every circle in the gap
// whenever the pole lies outside the gap's dual disk.

// GardenInversion is the inversion circle, in model units.
type GardenInversion struct {
	X      float64 `json:"x"`
	Y      float64 `json:"y"`
	Radius float64 `json:"radius"`
}

// GardenPoint is a point in model units: the glide's far pole.
type GardenPoint struct {
	X float64 `json:"x"`
	Y float64 `json:"y"`
}

// Limits of a view: the pole and far pole within ±GardenMaxPole, the
// radius within GardenMinInversion–GardenMaxInversion.
const (
	GardenMaxPole      = 2
	GardenMinInversion = 0.05
	GardenMaxInversion = 2
)

func (q GardenRequest) validateView() error {
	if v := q.Inversion; v != nil {
		if !finite(v.X) || math.Abs(v.X) > GardenMaxPole {
			return fieldErr("inversion.x", "the pole's x must be within ±%d", GardenMaxPole)
		}
		if !finite(v.Y) || math.Abs(v.Y) > GardenMaxPole {
			return fieldErr("inversion.y", "the pole's y must be within ±%d", GardenMaxPole)
		}
		if !finite(v.Radius) || v.Radius < GardenMinInversion || v.Radius > GardenMaxInversion {
			return fieldErr("inversion.radius", "the inversion radius must be %g–%d", GardenMinInversion, GardenMaxInversion)
		}
		if q.Window == nil {
			return fieldErr("window", "an inverted view needs a window")
		}
	}
	if g := q.Glide; g != nil {
		if q.Inversion == nil {
			return fieldErr("glide", "a glide needs an inversion")
		}
		if !finite(g.X) || math.Abs(g.X) > GardenMaxPole {
			return fieldErr("glide.x", "the far pole's x must be within ±%d", GardenMaxPole)
		}
		if !finite(g.Y) || math.Abs(g.Y) > GardenMaxPole {
			return fieldErr("glide.y", "the far pole's y must be within ±%d", GardenMaxPole)
		}
	}
	return nil
}

// poleAt is the glide's pole at progress p: P(p) = (1 − s)P₀ + sP₁ with
// s = (1 − cos 2π·rem(p))/2, resting at both ends. p = 0 and p = 1 give
// P₀ exactly and p = ½ gives P₁ exactly. Without a glide, P₀.
func (q GardenRequest) poleAt(p float64) (x, y float64) {
	v := q.Inversion
	g := q.Glide
	if g == nil {
		return v.X, v.Y
	}
	s := (1 - math.Cos(2*math.Pi*rem(p))) / 2
	return (1-s)*v.X + s*g.X, (1-s)*v.Y + s*g.Y
}

// acc is a circle's augmented curvature-center coordinates in drawing
// units: curvature b, weighted center z = b·c and co-curvature b̄.
type acc struct{ b, x, y, co float64 }

// toACC converts exact coordinates in the seed's units, the co-curvature's
// numerator being k·D²·b̄: in drawing units z = X/D and b̄ = co·|b₀|/(kD²).
func (s *gardenSpec) toACC(c gardenCircle, co qr, k int64) acc {
	d := float64(s.denom)
	return acc{c.b.float() / s.scale, c.x.float() / d, c.y.float() / d, float64(co.float()*s.scale) / float64(d*d*float64(k))}
}

// coScale is the least k in a short list that makes every seed and
// virtual circle's co-curvature numerator k(X² + Y² − D²)/b exact; the
// replacement then keeps every circle's exact. Six around one needs 3:
// its central circle has b̄ = −1/3. Zero when none does.
func (s *gardenSpec) coScale() int64 {
	for _, k := range []int64{1, 2, 3, 4, 6, 12} {
		ok := true
		for _, c := range append(append([]gardenCircle{}, s.circles...), s.virtual...) {
			if _, exact := s.coOf(c, k); !exact {
				ok = false
				break
			}
		}
		if ok {
			return k
		}
	}
	return 0
}

// coOf is a seed circle's co-curvature numerator, k(X² + Y² − D²)/b,
// exactly in ℤ[√3], or false when the division is not exact.
func (s *gardenSpec) coOf(c gardenCircle, k int64) (qr, bool) {
	num := c.x.mul(c.x).add(c.y.mul(c.y)).sub(z(s.denom * s.denom)).mul(z(k))
	conj := qr{c.b.p, -c.b.q}
	n := c.b.p*c.b.p - 3*c.b.q*c.b.q
	t := num.mul(conj)
	if n == 0 || t.p%n != 0 || t.q%n != 0 {
		return qr{}, false
	}
	return qr{t.p / n, t.q / n}, true
}

// pole is Φ_W(P) = b|P|² − 2z·P + b̄ = b(|P − c|² − r²) along the path,
// a quadratic in s: positive with the pole outside the circle's oriented
// interior, zero on it, negative inside.
type quadratic struct{ c0, c1, c2 float64 }

func (q quadratic) at(s float64) float64 { return q.c0 + s*(q.c1+s*q.c2) }

// rangeOn is the quadratic's exact range on [lo, hi], up to rounding.
func (q quadratic) rangeOn(lo, hi float64) (float64, float64) {
	a, b := q.at(lo), q.at(hi)
	mn, mx := math.Min(a, b), math.Max(a, b)
	if q.c2 != 0 {
		if v := -q.c1 / (2 * q.c2); v > lo && v < hi {
			m := q.at(v)
			mn, mx = math.Min(mn, m), math.Max(mx, m)
		}
	}
	return mn, mx
}

// gardenView is a request's view: the path of poles P₀ + sΔ, s ∈ [0, 1]
// (Δ zero without a glide), ρ², the window's circumscribed disk B and the
// minimum radius in the image.
type gardenView struct {
	px, py, dx, dy, rho2 float64
	window               acc
	minRadius            float64
}

func newView(q GardenRequest) *gardenView {
	v := q.Inversion
	if v == nil {
		return nil
	}
	g := &gardenView{px: v.X, py: v.Y, rho2: v.Radius * v.Radius, minRadius: q.MinRadius}
	if q.Glide != nil {
		g.dx, g.dy = q.Glide.X-v.X, q.Glide.Y-v.Y
	}
	w := q.Window
	cx, cy := (w.XMin+w.XMax)/2, (w.YMin+w.YMax)/2
	r := math.Hypot(w.XMax-w.XMin, w.YMax-w.YMin) / 2
	g.window = acc{1 / r, cx / r, cy / r, (cx*cx + cy*cy - r*r) / r}
	return g
}

// phi is Φ_W along the path, and its terms' magnitude for tolerances.
func (v *gardenView) phi(w acc) (quadratic, float64) {
	// Products are rounded explicitly, so pruning decides alike on every
	// architecture (see image).
	pp := float64(v.px*v.px) + float64(v.py*v.py)
	c0 := float64(w.b*pp) - float64(2*(float64(w.x*v.px)+float64(w.y*v.py))) + w.co
	c1 := 2 * (float64(w.b*(float64(v.px*v.dx)+float64(v.py*v.dy))) - (float64(w.x*v.dx) + float64(w.y*v.dy)))
	c2 := float64(w.b * (float64(v.dx*v.dx) + float64(v.dy*v.dy)))
	ex, ey := math.Abs(v.px)+math.Abs(v.dx), math.Abs(v.py)+math.Abs(v.dy)
	mag := math.Abs(w.b)*(ex*ex+ey*ey) + 2*(math.Abs(w.x)*ex+math.Abs(w.y)*ey) + math.Abs(w.co)
	return quadratic{c0, c1, c2}, mag
}

// gardenGlideLevels bounds the glide's bisection: at most 2⁷ pieces of the
// path, 255 piece tests per gap.
const gardenGlideLevels = 7

// admits decides a candidate gap with dual circle d and first circle c:
// reach is false when the gap's image misses the window for every pole on
// the path, and large is false when, wherever it may reach, every circle
// in it is below the minimum radius. Without a glide both are exact. With
// one, the path is bisected while a piece may do both, and a piece passes
// when its bounds allow, so a glide admits at least what each of its poles
// would.
func (v *gardenView) admits(d, c acc) (reach, large bool) {
	t := v.gapTerms(d, c)
	if v.dx == 0 && v.dy == 0 {
		return t.reaches(0, 0), t.large(0, 0)
	}
	var walk func(lo, hi float64, level int) bool
	walk = func(lo, hi float64, level int) bool {
		if !t.reaches(lo, hi) {
			return false
		}
		reach = true
		if !t.large(lo, hi) {
			return false
		}
		if level == gardenGlideLevels {
			return true
		}
		mid := (lo + hi) / 2
		return walk(lo, mid, level+1) || walk(mid, hi, level+1)
	}
	large = walk(0, 1, 0)
	return reach, large
}

// gapTerms holds a gap's polynomials along the path: Φ of its dual and
// first circles, the quartic f = ⟨R_K d, B⟩ and the thresholds.
type gapTerms struct {
	v            *gardenView
	pd, pc       quadratic
	magD         float64
	f            [5]float64
	limit, outer float64
}

func (v *gardenView) gapTerms(d, c acc) gapTerms {
	b := v.window
	inner := float64(d.x*b.x) + float64(d.y*b.y) - (float64(d.b*b.co)+float64(d.co*b.b))/2
	pb, _ := v.phi(b)
	pd, mag := v.phi(d)
	pc, _ := v.phi(c)
	g := [3]float64{v.rho2*b.b - pb.c0, -pb.c1, -pb.c2}
	h := [3]float64{v.rho2*d.b - pd.c0, -pd.c1, -pd.c2}
	t := gapTerms{v: v, pd: pd, pc: pc, magD: mag}
	for i, gi := range g {
		for j, hj := range h {
			t.f[i+j] -= float64(gi*hj) / (2 * v.rho2)
		}
	}
	t.f[0] += inner
	scale := math.Abs(inner)
	for _, k := range t.f {
		scale = math.Max(scale, math.Abs(k))
	}
	t.limit = -1 - 1e-9*(1+scale)
	// Around the pole, the outside of a disk larger than B misses it.
	t.outer = -v.rho2*b.b*(1-1e-9) + 1e-9*mag
	return t
}

// reaches is false only when, for every s in [lo, hi], the image of the
// gap's dual region misses the window's disk B (radius R). Below −1, f
// says two regions are disjoint, or that one of two disks holds the other:
// then the image is the outside of a disk A (Φ_d < 0), which misses B only
// when A, of radius ρ²/|Φ_d|, is the larger. So the image misses B exactly
// when f < −1 and Φ_d > −ρ²/R.
func (t gapTerms) reaches(lo, hi float64) bool {
	if mn, _ := t.pd.rangeOn(lo, hi); mn <= t.outer {
		return true
	}
	if lo == hi {
		return t.f[0]+lo*(t.f[1]+lo*(t.f[2]+lo*(t.f[3]+lo*t.f[4]))) > t.limit
	}
	return bernsteinMax(t.f, lo, hi-lo) > t.limit
}

// large is false only when, for every s in [lo, hi], the pole lies
// strictly outside the gap's dual disk and the first circle's image,
// radius ρ²/Φ_c, is below the minimum radius: then every circle in the
// gap is smaller still.
func (t gapTerms) large(lo, hi float64) bool {
	if mn, _ := t.pd.rangeOn(lo, hi); !(mn > 1e-9*t.magD) {
		return true
	}
	mn, _ := t.pc.rangeOn(lo, hi)
	return !(mn > 0 && t.v.rho2/mn < t.v.minRadius)
}

// bernsteinMax bounds the quartic Σ f_k s^k above on [a, a + w]: the
// largest of its Bernstein coefficients there, which the polynomial never
// exceeds.
func bernsteinMax(f [5]float64, a, w float64) float64 {
	// Coefficients in t, s = a + wt: q_j = w^j Σ_{k≥j} C(k, j) a^{k−j} f_k.
	binom := [5][5]float64{{1}, {1, 1}, {1, 2, 1}, {1, 3, 3, 1}, {1, 4, 6, 4, 1}}
	var q [5]float64
	wj := 1.0
	for j := 0; j <= 4; j++ {
		sum, ak := 0.0, 1.0
		for k := j; k <= 4; k++ {
			sum += binom[k][j] * ak * f[k]
			ak *= a
		}
		q[j] = wj * sum
		wj *= w
	}
	best := math.Inf(-1)
	for i := 0; i <= 4; i++ {
		beta := 0.0
		for j := 0; j <= i; j++ {
			beta += binom[i][j] / binom[4][j] * q[j]
		}
		best = math.Max(best, beta)
	}
	return best
}

// image is W inverted about the pole (x, y): W − 2⟨W, K⟩K, with image
// curvature b' = Φ_W(P)/ρ². A line has b' = 0, its unit normal z' and
// b̄' twice its distance from the origin.
//
// Every product is rounded explicitly, so the compiler cannot fuse a
// multiply and add: a frame and the static view, and arm64 and amd64,
// then agree bit for bit.
func (w acc) image(x, y, rho2 float64) [4]float64 {
	pp := float64(x*x) + float64(y*y)
	dot := float64(w.x*x) + float64(w.y*y)
	b := (float64(w.b*pp) - float64(2*dot) + w.co) / rho2
	d := w.b - b
	return [4]float64{b, w.x - float64(d*x), w.y - float64(d*y), w.co - float64(d*(pp-rho2))}
}

// keptIn reports whether the kept circle's center, in the source, lies in
// the gap's dual disk d, so that the gap holds it.
func keptIn(kept *[2]float64, d acc) bool {
	return kept != nil && d.b > 0 && math.Hypot(kept[0]-d.x/d.b, kept[1]-d.y/d.b) < 1/d.b
}

func (w acc) half() acc { return acc{w.b / 2, w.x / 2, w.y / 2, w.co / 2} }

// GardenSource is a generated view frozen for its glide: the circles'
// coordinates, from which each frame inverts them about its own pole. It
// holds one packing, at most GardenMaxCircles circles.
type GardenSource struct {
	q GardenRequest
	w []acc
}

// NewGardenSource validates an inverted request and generates its packing.
func NewGardenSource(q GardenRequest) (*GardenSource, error) {
	if q.Inversion == nil {
		return nil, fieldErr("inversion", "a frame needs an inverted view")
	}
	s, err := q.spec()
	if err != nil {
		return nil, err
	}
	src := &GardenSource{q: q}
	k := s.coScale()
	_, err = computeGardenWith(q, s, gardenLimits{GardenMaxConfigurations}, func(c gardenCircle, co qr) {
		src.w = append(src.w, s.toACC(c, co, k))
	})
	if err != nil {
		return nil, err
	}
	return src, nil
}

// GardenFrameRequest asks for a frozen view's circles at a progress of its
// glide. Garden must be the source's request.
type GardenFrameRequest struct {
	Garden   GardenRequest `json:"garden"`
	Progress float64       `json:"progress"`
}

// GardenFrame is a frame's image coordinates, four per circle as in
// GardenResult.Image, and the pole they are inverted about.
type GardenFrame struct {
	Progress float64    `json:"progress"`
	Pole     [2]float64 `json:"pole"`
	Image    []float64  `json:"image"`
}

// Matches reports whether a frame request is for this source's packing.
func (s *GardenSource) Matches(q GardenRequest) bool { return reflect.DeepEqual(q, s.q) }

func (s *GardenSource) Frame(f GardenFrameRequest) (GardenFrame, error) {
	if !s.Matches(f.Garden) {
		return GardenFrame{}, fieldErr("garden", "a frame must be for the frozen packing's settings")
	}
	if !finite(f.Progress) || f.Progress < 0 || f.Progress > 1 {
		return GardenFrame{}, fieldErr("progress", "progress must be 0–1")
	}
	x, y := s.q.poleAt(f.Progress)
	rho2 := s.q.Inversion.Radius * s.q.Inversion.Radius
	out := GardenFrame{Progress: f.Progress, Pole: [2]float64{x, y}, Image: make([]float64, 0, 4*len(s.w))}
	for _, w := range s.w {
		v := w.image(x, y, rho2)
		out.Image = append(out.Image, v[:]...)
	}
	return out, nil
}
