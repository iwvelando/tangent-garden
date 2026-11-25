package engine

import "math"

// Disk is a Dirichlet eigenmode of the disk of radius Radius about the
// origin (#415 research): the membrane's standing wave
//
//	u(r, θ) = J_m(j_{m,k} r/R)/P_m · (cos a cos mθ + sin a sin mθ),
//
// with m = Order, k = Ring, j_{m,k} the k-th positive zero of J_m and P_m
// the peak of |J_m|, so max |u| = 1. It solves −Δu = λu with
// λ = (j_{m,k}/R)², and u = 0 on r = R. For m = 0 the angular factor is 1
// and a does nothing. When Disk is set, the implicit curve's F is this mode
// and its text is ignored; the contours are traced only inside the disk.
type Disk struct {
	Order  int     `json:"order"`
	Ring   int     `json:"ring"`
	Radius float64 `json:"radius"`
}

// DiskResult describes the traced mode: its boundary radius, the zero
// j_{m,k}, the eigenvalue λ = (j_{m,k}/R)², and the exact nodal set of the
// mode, m diameters at Angles (radians, in [0, π)) and k − 1 circles of
// Radii. Peak is P_m, by which J_m is divided.
type DiskResult struct {
	Order      int       `json:"order"`
	Ring       int       `json:"ring"`
	Radius     float64   `json:"radius"`
	Zero       float64   `json:"zero"`
	Eigenvalue float64   `json:"eigenvalue"`
	Peak       float64   `json:"peak"`
	Angles     []float64 `json:"angles"`
	Radii      []float64 `json:"radii"`
}

func (d Disk) validate() error {
	if d.Order < 0 || d.Order > maxDiskOrder {
		return fieldErr("disk.order", "the angular order m is a whole number from 0 to %d", maxDiskOrder)
	}
	if d.Ring < 1 || d.Ring > maxDiskRing {
		return fieldErr("disk.ring", "the ring number k is a whole number from 1 to %d", maxDiskRing)
	}
	if !finite(d.Radius) || d.Radius < 1e-3 || d.Radius > 1e4 {
		return fieldErr("disk.radius", "the radius must be from 0.001 to 10,000")
	}
	return nil
}

// field returns the mode at shape parameter a, defined for every point of
// the disk, r ≤ R, and NaN beyond it. At the center it is exactly the
// limit: J₀(0) = 1 for m = 0, and 0 for m ≥ 1.
func (d Disk) field(a float64) func(x, y float64) float64 {
	m := d.Order
	j, peak, R := besselZeros[m][d.Ring-1], besselPeaks[m], d.Radius
	// a is reduced exactly (fmod is exact) before its cosine and sine, so
	// a + 2π gives the same field bit for bit. A pure mode's nodal lines
	// cross exactly, where the tracer's choice of pieces rests on rounding:
	// without this, a seamless loop would not end on its start.
	a = math.Mod(a, 2*math.Pi)
	ca, sa := math.Cos(a), math.Sin(a)
	return func(x, y float64) float64 {
		r := math.Hypot(x, y)
		if !(r <= R*(1+1e-12)) {
			return math.NaN()
		}
		if r == 0 {
			if m == 0 {
				return 1
			}
			return 0
		}
		radial := besselJ(m, math.Min(j*r/R, j)) / peak
		if m == 0 {
			return radial
		}
		// cos mθ + i sin mθ = ((x + iy)/r)^m, by repeated products: no
		// angle and so no seam.
		c, s := x/r, y/r
		cm, sm := c, s
		for range m - 1 {
			cm, sm = cm*c-sm*s, cm*s+sm*c
		}
		return radial * (ca*cm + sa*sm)
	}
}

func (d Disk) result(a float64) *DiskResult {
	m, k := d.Order, d.Ring
	j := besselZeros[m][k-1]
	out := &DiskResult{Order: m, Ring: k, Radius: d.Radius, Zero: j, Eigenvalue: (j / d.Radius) * (j / d.Radius), Peak: besselPeaks[m], Angles: []float64{}, Radii: []float64{}}
	// cos(mθ − a) = 0 where mθ − a = π/2 + iπ: m diameters.
	for i := range m {
		θ := math.Mod((a+math.Pi/2+float64(i)*math.Pi)/float64(m), math.Pi)
		if θ < 0 {
			θ += math.Pi
		}
		out.Angles = append(out.Angles, θ)
	}
	for _, f := range diskRadii(m, k) {
		out.Radii = append(out.Radii, f*d.Radius)
	}
	return out
}

// diskDomain restricts tracing to the disk r ≤ R. Within a band just
// beyond R, F is continued by its mirror image across the circle,
// F(p (2R − r)/r), so the boundary, where a Dirichlet mode vanishes, is a
// fold the tracer never draws, and a nodal line meeting the boundary
// crosses it transversally instead of turning along it. Beyond the band
// the grid is outside the domain: neither evaluated nor counted as
// undefined. Traced contours are then cut at r = R.
type diskDomain struct {
	R, band float64
}

func (d diskDomain) extend(f func(x, y float64) float64) func(x, y float64) float64 {
	return func(x, y float64) float64 {
		r := math.Hypot(x, y)
		if r <= d.R {
			return f(x, y)
		}
		if r > d.R+d.band {
			return math.NaN()
		}
		s := (2*d.R - r) / r
		return f(x*s, y*s)
	}
}

func (d diskDomain) outside(p Vec) bool { return math.Hypot(p.X, p.Y) > d.R+d.band }

func (d diskDomain) inside(p Vec) bool { return math.Hypot(p.X, p.Y) <= d.R }

// cross returns where the chord from p, inside, to q, outside, meets the
// circle.
func (d diskDomain) cross(p, q Vec) Vec {
	e := q.Sub(p)
	A, B, C := e.Dot(e), p.Dot(e), p.Dot(p)-d.R*d.R
	// The root of A t² + 2B t + C in [0, 1]; C ≤ 0 since p is inside.
	t := (-B + math.Sqrt(math.Max(0, B*B-A*C))) / A
	return p.Add(e.Mul(math.Min(1, math.Max(0, t))))
}

// clip cuts a level set's contours at the circle, keeping the pieces
// inside in order and orientation. At level 0, the boundary's own value, a
// piece ends where its chord meets the circle, at a nodal line's end on the
// boundary. Any other level is nowhere on the circle: a piece that leaves
// the disk there has met its own mirror image within a cell of the
// boundary, unresolved by the grid, and ends at its last vertex inside.
func (d diskDomain) clip(set *LevelSet) {
	toCircle := set.Level == 0
	var out []Contour
	for _, c := range set.Contours {
		pts := c.Points
		start := -1
		for i, p := range pts {
			if !d.inside(p) {
				start = i
				break
			}
		}
		if start < 0 {
			out = append(out, c)
			continue
		}
		// A closed contour is walked from an outside point round to it
		// again; an open one from its start, which may be inside.
		if c.Closed {
			pts = append(append([]Vec{}, pts[start:]...), pts[:start+1]...)
		}
		var cur []Vec
		for i := range pts {
			p := pts[i]
			in := d.inside(p)
			if i > 0 {
				prev := pts[i-1]
				prevIn := d.inside(prev)
				switch {
				case prevIn && !in:
					if toCircle {
						cur = append(cur, d.cross(prev, p))
					}
					if len(cur) > 1 {
						out = append(out, Contour{Points: cur})
					}
					cur = nil
				case !prevIn && in:
					cur = nil
					if toCircle {
						cur = []Vec{d.cross(p, prev)}
					}
				}
			}
			if in {
				cur = append(cur, p)
			}
		}
		if len(cur) > 1 {
			out = append(out, Contour{Points: cur})
		}
	}
	if out == nil {
		out = []Contour{}
	}
	set.Contours = out
}
