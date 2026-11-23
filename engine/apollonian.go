package engine

import (
	"errors"
	"math"
)

// GardenSeed names the original seed, the default: the enclosing
// Descartes configuration of signed curvatures (−1, 2, 2, 3). The catalog
// (apollonian_seeds.go) and the split family (apollonian_split.go) hold the
// others. See docs/mathematics.md, Apollonian garden.
const GardenSeed = "-1,2,2,3"

// GardenRequest asks for the finite Apollonian packing grown from a seed.
// MinRadius is in model units, the enclosing circle's radius being 1.
type GardenRequest struct {
	Seed       string  `json:"seed"`
	Depth      int     `json:"depth"`
	MinRadius  float64 `json:"minRadius"`
	MaxCircles int     `json:"maxCircles"`
	// Window, when present, limits generation to the gaps that reach into
	// this model rectangle; Keep names one circle whose gaps are filled
	// even outside it. See docs/mathematics.md, Detail for a view.
	Window *GardenWindow   `json:"window,omitempty"`
	Keep   *GardenIdentity `json:"keep,omitempty"`
	// Split is the split-diameter seed's member, the fraction [m, n]:
	// required for that seed and refused for the others
	// (apollonian_split.go).
	Split []int64 `json:"split,omitempty"`
	// Inversion, when present, is the inversive view: the packing inverted
	// in this circle and generated for the image, which then needs a
	// window in the image's coordinates; Glide moves its pole to a far
	// pole and back (apollonian_inversion.go).
	Inversion *GardenInversion `json:"inversion,omitempty"`
	Glide     *GardenPoint     `json:"glide,omitempty"`
}

// GardenWindow is a rectangle in model units, its sides parallel to the axes.
type GardenWindow struct {
	XMin float64 `json:"xMin"`
	XMax float64 `json:"xMax"`
	YMin float64 `json:"yMin"`
	YMax float64 `json:"yMax"`
}

// GardenIdentity is a circle's identity: its exact curvature and the
// numerators of its curvature-weighted center, integers in the seed's units.
type GardenIdentity struct {
	Curvature int64 `json:"curvature"`
	X         int64 `json:"x"`
	Y         int64 `json:"y"`
	// Root holds the √3 coefficients of a ℤ[√3] seed's circle:
	// its curvature is Curvature + Root[0]√3, and its center numerators
	// X + Root[1]√3 and Y + Root[2]√3. Absent, they are zero.
	Root []int64 `json:"root,omitempty"`
}

// GardenOmitted counts unfilled gaps by the cutoff that left them. A gap
// whose circle is below the minimum radius counts as radius, even when it
// is also beyond the depth.
type GardenOmitted struct {
	Radius int `json:"radius"`
	Depth  int `json:"depth"`
	View   int `json:"view"`
}

// GardenResult holds circles in breadth-first order as parallel arrays.
// Circle 0 is the enclosing circle and 1–3 the other seeds. Curvature and
// the curvature-weighted center are exact integers, the circle's identity.
// Parents holds the generating triple, and Opposite the circle replaced in
// the quadruple it was generated from; both are −1 for seeds.
type GardenResult struct {
	Seed       string        `json:"seed"`
	X          []float64     `json:"x"`
	Y          []float64     `json:"y"`
	Radius     []float64     `json:"radius"`
	Curvature  []float64     `json:"curvature"`
	WeightedX  []float64     `json:"weightedX"`
	WeightedY  []float64     `json:"weightedY"`
	Generation []float64     `json:"generation"`
	Parents    [][3]float64  `json:"parents"`
	Opposite   []float64     `json:"opposite"`
	Omitted    GardenOmitted `json:"omitted"`
	// Stopped is "count" or "configurations" when that ceiling ended
	// generation with Pending configurations not fully expanded, else "".
	Stopped string `json:"stopped"`
	Pending int    `json:"pending"`
	// Processed counts candidate configurations examined, each one gap.
	Processed  int `json:"processed"`
	Duplicates int `json:"duplicates"`
	// Seeds other than the original only, absent for it: each circle's
	// exact identity as six integers (p and q of b, X and Y, each
	// p + q√3, with weighted center (X, Y)/Denominator), the number of seed
	// circles, the center denominator and the radicand (1 or 3).
	Exact       []float64 `json:"exact,omitempty"`
	Seeds       int       `json:"seeds,omitempty"`
	Denominator int       `json:"denominator,omitempty"`
	Root        int       `json:"root,omitempty"`
	// With an inversion only: each circle's image as four values, its
	// curvature b', weighted center z' and co-curvature b̄' in drawing
	// units, at the view's pole. A line has b' = 0, unit normal z' and
	// b̄'/2 its distance from the origin. X, Y and Radius stay the source.
	Image []float64 `json:"image,omitempty"`
}

const (
	GardenMaxDepth          = 12
	GardenMaxCircles        = 5000
	GardenMaxConfigurations = 20000
)

type gardenLimits struct{ configurations int }

// An exact circle: curvature b and curvature-weighted center b·c, times
// the seed's denominator.
type gardenCircle struct{ b, x, y qr }

// The seed's circles in index order: enclosing, left, right, top.
var gardenSeed = [4]gardenCircle{{z(-1), z(0), z(0)}, {z(2), z(-1), z(0)}, {z(2), z(1), z(0)}, {z(3), z(0), z(2)}}

func ComputeGarden(q GardenRequest) (GardenResult, error) {
	return computeGarden(q, gardenLimits{GardenMaxConfigurations})
}

func (q GardenRequest) validate(s *gardenSpec) error {
	if s == nil {
		return fieldErr("seed", "choose one of the garden's seeds")
	}
	if q.Depth < 0 || q.Depth > GardenMaxDepth {
		return fieldErr("depth", "depth must be 0–%d generations", GardenMaxDepth)
	}
	if !finite(q.MinRadius) || q.MinRadius <= 0 || q.MinRadius > 1 {
		return fieldErr("minRadius", "minimum radius must be above 0 and at most 1")
	}
	if q.MaxCircles < len(s.circles) || q.MaxCircles > GardenMaxCircles {
		return fieldErr("maxCircles", "circle count must be %d–%d", len(s.circles), GardenMaxCircles)
	}
	if k := q.Keep; k != nil && !s.legacy {
		if k.Root != nil && len(k.Root) != 3 {
			return fieldErr("keep.root", "a kept circle's root coefficients are three numbers")
		}
		for _, v := range append([]int64{k.Curvature, k.X, k.Y}, k.Root...) {
			if v > 1<<53 || v < -(1<<53) {
				return fieldErr("keep", "a kept circle's coefficients must be within ±2^53")
			}
		}
	}
	if err := q.validateView(); err != nil {
		return err
	}
	if w := q.Window; w != nil {
		for _, c := range []struct {
			name string
			v    float64
		}{{"xMin", w.XMin}, {"xMax", w.XMax}, {"yMin", w.YMin}, {"yMax", w.YMax}} {
			if !finite(c.v) || math.Abs(c.v) > GardenMaxWindow {
				return fieldErr("window."+c.name, "window sides must be finite, within ±%d", GardenMaxWindow)
			}
		}
		if w.XMax <= w.XMin {
			return fieldErr("window.xMax", "the window's right side must exceed its left side")
		}
		if w.YMax <= w.YMin {
			return fieldErr("window.yMax", "the window's top must exceed its bottom")
		}
	}
	return nil
}

// GardenMaxWindow bounds a window's sides in model units: far beyond any
// view the 0.1–100 zoom range can show of the unit enclosing circle.
const GardenMaxWindow = 1000

// meets reports whether the disk at (x, y) of radius r reaches the window.
// The disk is enlarged by a relative margin far above rounding, so a gap
// that touches the window is never lost; admitting a gap just outside it
// only adds a circle that is not seen.
func (w *GardenWindow) meets(x, y, r float64) bool {
	cx := math.Max(w.XMin, math.Min(w.XMax, x))
	cy := math.Max(w.YMin, math.Min(w.YMax, y))
	return math.Hypot(x-cx, y-cy) <= r+1e-9*(1+r)
}

// dualDisk is the circle through the three points where a, b and c touch.
// It is orthogonal to all three, and the curvilinear triangle they bound,
// with every circle inside it, lies within it. Circles j and k touch at
// (z_j + z_k)/(b_j + b_k), for either sign of curvature. When the contacts
// are collinear the dual circle is a line, and ok is false: in this packing
// only the seed's lower gap, between the enclosing circle and the two
// half-radius circles touching on its diameter.
func dualDisk(a, b, c gardenCircle) (x, y, r float64, ok bool) {
	touch := func(p, q gardenCircle) (float64, float64) {
		s := float64(p.b.p + q.b.p)
		return float64(p.x.p+q.x.p) / s, float64(p.y.p+q.y.p) / s
	}
	ax, ay := touch(a, b)
	bx, by := touch(b, c)
	cx, cy := touch(c, a)
	d := 2 * (ax*(by-cy) + bx*(cy-ay) + cx*(ay-by))
	if d == 0 {
		return 0, 0, 0, false
	}
	a2, b2, c2 := ax*ax+ay*ay, bx*bx+by*by, cx*cx+cy*cy
	x = (a2*(by-cy) + b2*(cy-ay) + c2*(ay-by)) / d
	y = (a2*(cx-bx) + b2*(ax-cx) + c2*(bx-ax)) / d
	return x, y, math.Hypot(ax-x, ay-y), true
}

var errGardenRange = errors.New("a circle's curvature exceeds the exact integer range")

// Breadth-first over Descartes quadruples. Children fill a quadruple's
// gaps in index order, skipping the reversal that restores its parent, so
// each gap is met once. Pruning a gap prunes its descendants, which lie in
// that gap and are smaller than the circle that fills it.
func computeGarden(q GardenRequest, limits gardenLimits) (GardenResult, error) {
	s, err := q.spec()
	if err != nil {
		return GardenResult{}, err
	}
	return computeGardenFrom(q, s, limits)
}

// spec is the request's seed: a catalog entry, nil for an unknown id, or
// the split family's member.
func (q GardenRequest) spec() (*gardenSpec, error) {
	if q.Seed != GardenSplitSeed {
		if q.Split != nil {
			return nil, fieldErr("split", "only the split diameter takes a split")
		}
		return gardenSpecs[q.Seed], nil
	}
	if len(q.Split) != 2 {
		return nil, fieldErr("split", "the split diameter needs its split, a fraction [m, n]")
	}
	m, n := q.Split[0], q.Split[1]
	if n < 2 || n > GardenMaxSplitDenominator || m < 1 || m >= n || gcd64(m, n) != 1 {
		if m < 1 || (n > 0 && m >= n) {
			return nil, fieldErr("split", "split must be 0.05–0.95")
		}
		return nil, fieldErr("split", "the split must be a fraction in lowest terms with a denominator of 2–%d", GardenMaxSplitDenominator)
	}
	if !validSplit(m, n) {
		return nil, fieldErr("split", "split must be 0.05–0.95")
	}
	return splitSpec(m, n), nil
}

func computeGardenFrom(q GardenRequest, s *gardenSpec, limits gardenLimits) (GardenResult, error) {
	return computeGardenWith(q, s, limits, nil)
}

// computeGardenWith also hands each admitted circle, with its exact
// co-curvature under a view, to onAdd.
func computeGardenWith(q GardenRequest, s *gardenSpec, limits gardenLimits, onAdd func(gardenCircle, qr)) (GardenResult, error) {
	if err := q.validate(s); err != nil {
		return GardenResult{}, err
	}
	type quad struct {
		id              [4]int
		last, only, gen int
	}
	r := GardenResult{Seed: q.Seed}
	if !s.legacy {
		r.Seeds, r.Denominator, r.Root = len(s.circles), int(s.denom), s.root
	}
	var circles []gardenCircle
	at := func(id int) gardenCircle {
		if id < 0 {
			return s.virtual[-1-id]
		}
		return circles[id]
	}
	// Under a view, or for onAdd, each circle's exact co-curvature, which
	// follows the same replacement; virtual circles' are computed.
	view := newView(q)
	withCo := view != nil || onAdd != nil
	var cos, virtualCo []qr
	var coK int64
	if withCo {
		if coK = s.coScale(); coK == 0 {
			return GardenResult{}, errGardenRange
		}
		for _, c := range s.virtual {
			co, ok := s.coOf(c, coK)
			if !ok {
				return GardenResult{}, errGardenRange
			}
			virtualCo = append(virtualCo, co)
		}
	}
	coAt := func(id int) qr {
		if id < 0 {
			return virtualCo[-1-id]
		}
		return cos[id]
	}
	var pole [2]float64
	if view != nil {
		pole[0], pole[1] = q.poleAt(0)
	}
	known := map[gardenCircle]bool{}
	add := func(c gardenCircle, co qr, gen int, parents [3]float64, opposite float64) {
		x, y, radius, b := s.center(c)
		circles = append(circles, c)
		known[c] = true
		r.X = append(r.X, x)
		r.Y = append(r.Y, y)
		r.Radius = append(r.Radius, radius)
		r.Curvature = append(r.Curvature, b)
		r.WeightedX = append(r.WeightedX, c.x.float()/float64(s.denom))
		r.WeightedY = append(r.WeightedY, c.y.float()/float64(s.denom))
		r.Generation = append(r.Generation, float64(gen))
		r.Parents = append(r.Parents, parents)
		r.Opposite = append(r.Opposite, opposite)
		if !s.legacy {
			for _, v := range []qr{c.b, c.x, c.y} {
				r.Exact = append(r.Exact, float64(v.p), float64(v.q))
			}
		}
		if withCo {
			cos = append(cos, co)
		}
		if view != nil {
			im := s.toACC(c, co, coK).image(pole[0], pole[1], view.rho2)
			r.Image = append(r.Image, im[:]...)
		}
		if onAdd != nil {
			onAdd(c, co)
		}
	}
	// Another seed's kept circle, by its exact identity.
	var kept *[2]float64
	if k := q.Keep; k != nil && (!s.legacy || view != nil) {
		root := [3]int64{}
		copy(root[:], k.Root)
		c := gardenCircle{qr{k.Curvature, root[0]}, qr{k.X, root[1]}, qr{k.Y, root[2]}}
		if c.b.sign() > 0 {
			x, y, _, _ := s.center(c)
			kept = &[2]float64{x, y}
		}
	}
	for _, c := range s.circles {
		var co qr
		if withCo {
			var ok bool
			if co, ok = s.coOf(c, coK); !ok {
				return GardenResult{}, errGardenRange
			}
		}
		add(c, co, 0, [3]float64{-1, -1, -1}, -1)
	}
	var queue []quad
	for _, st := range s.starts {
		queue = append(queue, quad{id: st.id, last: -1, only: st.only})
	}
	for head := 0; head < len(queue); head++ {
		p := queue[head]
		for i := 0; i < 4; i++ {
			if i == p.last || (p.only >= 0 && i != p.only) {
				continue
			}
			if r.Processed == limits.configurations {
				r.Stopped, r.Pending = "configurations", len(queue)-head
				return r, nil
			}
			r.Processed++
			var others [3]int
			for j, k := 0, 0; j < 4; j++ {
				if j != i {
					others[k] = p.id[j]
					k++
				}
			}
			a, b, c, old := at(others[0]), at(others[1]), at(others[2]), at(p.id[i])
			nb, ok1 := replaceQR(a.b, b.b, c.b, old.b)
			nx, ok2 := replaceQR(a.x, b.x, c.x, old.x)
			ny, ok3 := replaceQR(a.y, b.y, c.y, old.y)
			if !ok1 || !ok2 || !ok3 {
				return GardenResult{}, errGardenRange
			}
			next := gardenCircle{nb, nx, ny}
			gen := p.gen + 1
			var nco qr
			var dual, first acc
			if withCo {
				ca, cb, cc, cold := coAt(others[0]), coAt(others[1]), coAt(others[2]), coAt(p.id[i])
				var ok bool
				if nco, ok = replaceQR(ca, cb, cc, cold); !ok {
					return GardenResult{}, errGardenRange
				}
				// The gap's dual circle, (W_j + W_k + W_l − W_o)/2, exactly
				// summed before conversion.
				sum := func(u, v, w, o qr) qr { return u.add(v).add(w).sub(o) }
				dual = s.toACC(gardenCircle{sum(a.b, b.b, c.b, old.b), sum(a.x, b.x, c.x, old.x), sum(a.y, b.y, c.y, old.y)}, sum(ca, cb, cc, cold), coK).half()
				first = s.toACC(next, nco, coK)
			}
			viewReach, viewLarge := true, true
			if view != nil {
				viewReach, viewLarge = view.admits(dual, first, keptIn(kept, dual))
			}
			switch {
			case view != nil && !viewReach:
				r.Omitted.View++
				continue
			case view != nil && !viewLarge:
				r.Omitted.Radius++
				continue
			case view == nil && q.Window != nil && s.legacy && !inView(q, a, b, c):
				r.Omitted.View++
				continue
			case view == nil && q.Window != nil && !s.legacy && !s.linearView(q, kept, a, b, c, old):
				r.Omitted.View++
				continue
			case view == nil && s.scale/nb.float() < q.MinRadius:
				r.Omitted.Radius++
				continue
			case gen > q.Depth:
				r.Omitted.Depth++
				continue
			case known[next]:
				r.Duplicates++
				continue
			case len(circles) == q.MaxCircles:
				r.Stopped, r.Pending = "count", len(queue)-head
				return r, nil
			}
			opposite := float64(p.id[i])
			if p.id[i] < 0 {
				opposite = -1
			}
			add(next, nco, gen, [3]float64{float64(others[0]), float64(others[1]), float64(others[2])}, opposite)
			child := p
			child.id[i], child.last, child.only, child.gen = len(circles)-1, i, -1, gen
			queue = append(queue, child)
		}
	}
	return r, nil
}

// inView reports whether the gap bounded by a, b and c can hold a circle
// that reaches the window, or holds the kept circle. A packing circle lies
// in this gap exactly when its center lies in the gap's dual disk: every
// other circle's interior is disjoint from theirs, the dual disk outside
// their disks is the gap, and a, b and c, orthogonal to the dual circle,
// have their centers outside it.
//
// A gap whose dual circle is a line is always filled. It is the half of the
// enclosing disk below the diameter, and only one circle fills it.
func inView(q GardenRequest, a, b, c gardenCircle) bool {
	x, y, r, ok := dualDisk(a, b, c)
	if !ok || q.Window.meets(x, y, r) {
		return true
	}
	k := q.Keep
	if k == nil || k.Curvature <= 0 {
		return false
	}
	kb := float64(k.Curvature)
	return math.Hypot(float64(k.X)/kb-x, float64(k.Y)/kb-y) < r
}

// descartes is 2(a + b + c) − old, the circle (or weighted center) on the
// other side of a, b and c, or false beyond ±2^53, where float64 transport
// stops being exact. Inputs are within that range, so nothing overflows.
func descartes(a, b, c, old int64) (int64, bool) {
	const limit = 1 << 53
	for _, v := range []int64{a, b, c, old} {
		if v > limit || v < -limit {
			return 0, false
		}
	}
	v := 2*(a+b+c) - old
	return v, v <= limit && v >= -limit
}
