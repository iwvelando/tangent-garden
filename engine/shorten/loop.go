package shorten

// Research for #409: curve shortening from a user's own closed loop.
//
// A loop arrives as one of two frozen sources: fitted Fourier terms
// z(u) = Σ r e^{i(fu + φ)} with whole frequencies (Draw a loop's fit), or a
// bounded outline polygon. Admission measures the source (scale,
// regularity, simplicity, minimum feature) and refuses what no arm can
// evolve honestly; then one of three arms evolves it:
//
//   - "polar": the shipped radial graph (bloom.go), seeded with the source's
//     polar radius about the center that keeps its tangents farthest from
//     its rays. Only star-shaped loops.
//   - "arc": the equal-arclength tangent-angle solver (arclength.go), with
//     N chosen from the source's curvature spectrum.
//   - "bgn": a polygon-native parametric scheme (bgn.go), the only arm that
//     takes an outline's corners as given.
//
// The trigonometric source admits a certificate of embeddedness: |z''| is
// bounded by Σ r f², so every arc between dense samples stays within a
// known distance of its chord, and the samples can prove, up to rounding,
// that no two arcs meet.

import (
	"errors"
	"fmt"
	"math"
	"math/cmplx"
	"sort"
	"strings"

	"tangentgarden/engine"
)

// Loop is a frozen user loop: Fourier terms or outline points, exactly one.
type Loop struct {
	Terms  []engine.Term `json:"terms,omitempty"`
	Points []engine.Vec  `json:"points,omitempty"`
}

// LoopRequest is one evolution of a user loop. Solver is "polar", "arc" or
// "bgn", or empty to let admission choose; Nodes and Tau of 0 choose the
// arm's defaults.
type LoopRequest struct {
	Loop    Loop    `json:"loop"`
	Solver  string  `json:"solver,omitempty"`
	Nodes   int     `json:"nodes,omitempty"`
	Tau     float64 `json:"tau,omitempty"`
	Horizon float64 `json:"horizon"`
	// Order is the polygon arm's order in time, 1 or 2 (0: 1).
	Order int `json:"order,omitempty"`
}

// Admission is what admission measured, in units of the equal-area radius
// R where noted, and the arm and resolution it chose.
type Admission struct {
	Source   string  `json:"source"`
	Reversed bool    `json:"reversed"`
	Area     float64 `json:"area"`
	Length   float64 `json:"length"`
	Radius   float64 `json:"radius"`
	CenterX  float64 `json:"centerX"`
	CenterY  float64 `json:"centerY"`
	// Fourier: the certified least speed over the mean speed.
	MinSpeed float64 `json:"minSpeed"`
	// κR on dense samples (a polygon's are its turns over its mean edge).
	MinKappa float64 `json:"minKappa"`
	MaxKappa float64 `json:"maxKappa"`
	// The narrowest neck and the thickness min(ρ_min, neck/2), over R.
	Neck      float64 `json:"neck"`
	Thickness float64 `json:"thickness"`
	// Embeddedness proven: by the certificate (Fourier) or exactly (polygon).
	Certified bool `json:"certified"`
	Samples   int  `json:"samples"`
	// The best star margin, min sin(tangent, ray), and its center.
	Star  float64 `json:"star"`
	StarX float64 `json:"starX"`
	StarY float64 `json:"starY"`
	// An outline's largest turn at a vertex, in radians.
	Corner float64 `json:"corner,omitempty"`
	Solver string  `json:"solver"`
	Nodes  int     `json:"nodes"`
	// The initial loop's largest distance from the source, over R.
	Remesh float64 `json:"remesh"`
	// Why each arm that was not chosen could not take the loop.
	Refused map[string]string `json:"refused,omitempty"`
}

// The research's limits.
const (
	loopTerms     = 16
	loopFrequency = 64
	loopPoints    = 4096
	// Certificate samples: from 2^12, doubled to at most 2^18.
	certifyFrom, certifyTo = 1 << 12, 1 << 18
	// The arclength arm's resolutions.
	arcFrom, arcTo = 256, 4096
	// The polygon arm's nodes by default and at most.
	bgnNodes, bgnTo = 1024, 4096
	// A neck must span this many node spacings.
	neckSpacings = 4
	// Checkpoints a user loop's film keeps: twice the seeds' 64, so a seek
	// retakes half as many steps (#409: smooth playback).
	loopCheckpoints = 128
	// Star margin the polar arm needs: tangents at least atan(1/10) off
	// their rays, the shipped scheme's own limit.
	starMargin = 0.0995037190209989
)

// trig is z(u) = Σ c e^{ifu} on u ∈ [0, 2π).
type trig struct {
	f []int
	c []complex128
}

func (s trig) top() int {
	m := 0
	for _, f := range s.f {
		m = max(m, abs(f))
	}
	return m
}

func abs(v int) int {
	if v < 0 {
		return -v
	}
	return v
}

func (s trig) eval(u float64) (z, z1, z2 complex128) {
	for k, c := range s.c {
		f := float64(s.f[k])
		e := c * cmplx.Rect(1, f*u)
		z += e
		z1 += e * complex(0, f)
		z2 -= e * complex(f*f, 0)
	}
	return
}

// dense samples z, z' and z” at m equally spaced parameters, m a power of
// two above twice the top frequency.
func (s trig) dense(m int) (z, z1, z2 []complex128) {
	z, z1, z2 = make([]complex128, m), make([]complex128, m), make([]complex128, m)
	for k, c := range s.c {
		j := ((s.f[k] % m) + m) % m
		f := float64(s.f[k])
		z[j] += c
		z1[j] += c * complex(0, f)
		z2[j] -= c * complex(f*f, 0)
	}
	for _, a := range [][]complex128{z, z1, z2} {
		fft(a, true)
		for i := range a {
			a[i] *= complex(float64(m), 0)
		}
	}
	return
}

// area is the signed enclosed area π Σ f|c|², exact for whole frequencies.
func (s trig) area() float64 {
	a := 0.0
	for k, c := range s.c {
		a += float64(s.f[k]) * real(c*cmplx.Conj(c))
	}
	return math.Pi * a
}

// reversed is z(−u): the same loop traversed the other way.
func (s trig) reversed() trig {
	r := trig{f: make([]int, len(s.f)), c: append([]complex128{}, s.c...)}
	for k, f := range s.f {
		r.f[k] = -f
	}
	return r
}

// bound is Σ |c| f², which bounds |z”| everywhere.
func (s trig) bound() float64 {
	b := 0.0
	for k, c := range s.c {
		f := float64(s.f[k])
		b += cmplx.Abs(c) * f * f
	}
	return b
}

func trigOfTerms(terms []engine.Term) (trig, error) {
	if len(terms) < 1 || len(terms) > loopTerms {
		return trig{}, field("loop.terms", "A loop has 1–%d terms.", loopTerms)
	}
	sum := map[int]complex128{}
	for k, t := range terms {
		ok := !math.IsNaN(t.Radius) && !math.IsInf(t.Radius, 0) && t.Radius >= 0 && t.Radius <= 1e5 &&
			!math.IsNaN(t.Phase) && math.Abs(t.Phase) <= 1e6 &&
			t.Frequency == math.Trunc(t.Frequency) && math.Abs(t.Frequency) <= loopFrequency
		if !ok {
			return trig{}, field(fmt.Sprintf("loop.terms.%d", k), "Term %d needs a radius within 0–100,000, a phase within ±1,000,000 and a whole frequency within ±%d.", k+1, loopFrequency)
		}
		sum[int(t.Frequency)] += cmplx.Rect(t.Radius, t.Phase)
	}
	s := trig{}
	for f := range sum {
		s.f = append(s.f, f)
	}
	sort.Ints(s.f)
	for _, f := range s.f {
		s.c = append(s.c, sum[f])
	}
	return s, nil
}

// outline cleans an outline: finite, in range, consecutive duplicates and
// a repeated first point removed, at least three distinct points.
func outline(points []engine.Vec) ([]engine.Vec, error) {
	if len(points) > loopPoints {
		return nil, field("loop.points", "An outline has at most %d points.", loopPoints)
	}
	clean := make([]engine.Vec, 0, len(points))
	for k, p := range points {
		if !p.Valid() || math.Abs(p.X) > 1e5 || math.Abs(p.Y) > 1e5 {
			return nil, field(fmt.Sprintf("loop.points.%d", k), "Point %d must be finite and within ±100,000.", k+1)
		}
		if len(clean) == 0 || p != clean[len(clean)-1] {
			clean = append(clean, p)
		}
	}
	for len(clean) > 1 && clean[len(clean)-1] == clean[0] {
		clean = clean[:len(clean)-1]
	}
	if len(clean) < 3 {
		return nil, field("loop.points", "An outline needs at least three distinct points.")
	}
	return clean, nil
}

// trigOfOutline is the polygon's trigonometric interpolant in arclength,
// on m equally spaced samples: the smooth curve arms polar and arc see.
func trigOfOutline(p []engine.Vec) trig {
	m := 1024
	for m < 2*len(p) {
		m *= 2
	}
	z := resample(p, m)
	fft(z, false)
	s := trig{}
	for k := range m {
		if 2*k == m {
			continue
		}
		f := k
		if k > m/2 {
			f = k - m
		}
		if z[k] != 0 {
			s.f = append(s.f, f)
			s.c = append(s.c, z[k]/complex(float64(m), 0))
		}
	}
	return s
}

// resample places m points at equal arclength along a closed polygon,
// from its first point.
func resample(p []engine.Vec, m int) []complex128 {
	n := len(p)
	acc := make([]float64, n+1)
	for j := range n {
		acc[j+1] = acc[j] + p[(j+1)%n].Sub(p[j]).Norm()
	}
	total := acc[n]
	z := make([]complex128, m)
	e := 0
	for j := range m {
		s := total * float64(j) / float64(m)
		for e < n-1 && acc[e+1] <= s {
			e++
		}
		a, b := p[e], p[(e+1)%n]
		w := (s - acc[e]) / (acc[e+1] - acc[e])
		z[j] = complex(a.X+(b.X-a.X)*w, a.Y+(b.Y-a.Y)*w)
	}
	return z
}

// polygonArea is the shoelace area, signed, about the first point.
func signedArea(x, y []float64) float64 {
	n := len(x)
	a := 0.0
	for i := range n {
		j := (i + 1) % n
		a += (x[i]-x[0])*(y[j]-y[0]) - (x[j]-x[0])*(y[i]-y[0])
	}
	return a / 2
}

// certify tries to prove the trigonometric loop embedded on m samples.
// It returns "" when proven; otherwise why it could not be, with "cross"
// when the samples themselves cross.
func (s trig) certify(m int) (why string, vmin float64) {
	z, z1, _ := s.dense(m)
	b := s.bound() * (1 + 1e-9)
	h := 2 * math.Pi / float64(m)
	low := math.Inf(1)
	for _, d := range z1 {
		low = min(low, cmplx.Abs(d))
	}
	// |z'| is Lipschitz with constant b, so between samples it stays at
	// least low − bh/2.
	vmin = low - b*h/2
	if !(vmin > 0) {
		return "speed", vmin
	}
	// The tangent turns at |z'×z''|/|z'|² ≤ b/vmin, so any arc of k
	// intervals with khb/vmin < π/2 has every tangent within π/2 of its
	// first, a graph over it: injective.
	k := int(0.99 * math.Pi / 2 * vmin / (b * h))
	if k < 2 {
		return "turning", vmin
	}
	// Arcs at least k intervals apart must keep their chords farther apart
	// than both arcs' departures from them, bh²/8 each.
	gap := b*h*h/4 + 1e-12*s.scale()
	x, y := make([]float64, m), make([]float64, m)
	for i, p := range z {
		x[i], y[i] = real(p), imag(p)
	}
	if close := nearSegments(x, y, gap, k); close != "" {
		return close, vmin
	}
	return "", vmin
}

func (s trig) scale() float64 {
	r := 0.0
	for k, c := range s.c {
		if s.f[k] != 0 {
			r += cmplx.Abs(c)
		}
	}
	return r
}

// nearSegments reports "cross" when two segments of the closed polygon at
// least k apart cross, "near" when they come within gap, and "" otherwise.
func nearSegments(x, y []float64, gap float64, k int) string {
	n := len(x)
	cell := gap
	for i := range n {
		j := (i + 1) % n
		cell = max(cell, math.Hypot(x[j]-x[i], y[j]-y[i])+gap)
	}
	g := segmentCells(x, y, cell, gap/2)
	near, cross := false, false
	for i := 0; i < n && !cross; i++ {
		i2 := (i + 1) % n
		x0, x1 := cellOf(min(x[i], x[i2])-gap/2, cell), cellOf(max(x[i], x[i2])+gap/2, cell)
		y0, y1 := cellOf(min(y[i], y[i2])-gap/2, cell), cellOf(max(y[i], y[i2])+gap/2, cell)
		for a := x0; a <= x1; a++ {
			for b := y0; b <= y1; b++ {
				g.each(a, b, func(j int) {
					if j <= i || cross {
						return
					}
					if d := j - i; d < k || n-d < k {
						return
					}
					j2 := (j + 1) % n
					if crosses(x, y, i, i2, j, j2) {
						cross = true
					} else if !near && segmentDistance(x, y, i, i2, j, j2) <= gap {
						near = true
					}
				})
			}
		}
	}
	switch {
	case cross:
		return "cross"
	case near:
		return "near"
	}
	return ""
}

// crosses reports whether segments ab and cd cross. Their boxes must
// overlap first: nearly collinear disjoint segments, as along a straight
// closing edge, otherwise give orientations of rounding noise.
func crosses(x, y []float64, a, b, c, d int) bool {
	if max(x[a], x[b]) < min(x[c], x[d]) || max(x[c], x[d]) < min(x[a], x[b]) ||
		max(y[a], y[b]) < min(y[c], y[d]) || max(y[c], y[d]) < min(y[a], y[b]) {
		return false
	}
	o := func(p, q, r int) float64 {
		return (x[q]-x[p])*(y[r]-y[p]) - (y[q]-y[p])*(x[r]-x[p])
	}
	return o(a, b, c)*o(a, b, d) < 0 && o(c, d, a)*o(c, d, b) < 0
}

func segmentDistance(x, y []float64, a, b, c, d int) float64 {
	pt := func(p, q, r int) float64 {
		dx, dy := x[q]-x[p], y[q]-y[p]
		l := dx*dx + dy*dy
		w := 0.0
		if l > 0 {
			w = math.Max(0, math.Min(1, ((x[r]-x[p])*dx+(y[r]-y[p])*dy)/l))
		}
		return math.Hypot(x[p]+w*dx-x[r], y[p]+w*dy-y[r])
	}
	return min(pt(a, b, c), pt(a, b, d), pt(c, d, a), pt(c, d, b))
}

// simplePolygon reports whether no two nonadjacent edges of the polygon
// meet, exactly up to rounding.
func simplePolygon(x, y []float64) bool {
	return nearSegments(x, y, 0, 2) != "cross"
}

// neck is the narrowest neck of a closed curve sampled at equal arclength:
// the least distance between two samples that is a local minimum in both
// (a doubly critical pair: the chord is normal to the curve at both ends),
// away from the diagonal. A circle has none; an ellipse's is its minor
// axis; two arcs that nearly touch give their gap. A polygon's corner is
// not one, since the distance keeps falling toward the corner. Only chords
// shorter than limit are looked for; with none, the neck is limit.
func neck(x, y []float64, limit float64) float64 {
	n := len(x)
	d := func(i, j int) float64 {
		i, j = (i+n)%n, (j+n)%n
		return math.Hypot(x[j]-x[i], y[j]-y[i])
	}
	g := newCells(n)
	for i := range n {
		g.add(cellOf(x[i], limit), cellOf(y[i], limit), i)
	}
	best := limit
	for i := range n {
		cx, cy := cellOf(x[i], limit), cellOf(y[i], limit)
		for a := cx - 1; a <= cx+1; a++ {
			for b := cy - 1; b <= cy+1; b++ {
				g.each(a, b, func(j int) {
					if j <= i || min(j-i, n-j+i) < 3 {
						return
					}
					c := d(i, j)
					if c >= best {
						return
					}
					if c <= d(i-1, j) && c <= d(i+1, j) && c <= d(i, j-1) && c <= d(i, j+1) {
						best = c
					}
				})
			}
		}
	}
	return best
}

// starAbout is min sin(tangent, ray) about c on dense samples of a
// counterclockwise loop.
func starAbout(z, z1 []complex128, c complex128) float64 {
	low := math.Inf(1)
	for i, p := range z {
		r := p - c
		d := z1[i]
		v := (real(r)*imag(d) - imag(r)*real(d)) / (cmplx.Abs(r) * cmplx.Abs(d))
		low = min(low, v)
	}
	return low
}

// bestStar searches for the center with the largest star margin, by a
// compass search from c0 with steps from size/4 down to size/4096.
func bestStar(z, z1 []complex128, c0 complex128, size float64) (complex128, float64) {
	c, v := c0, starAbout(z, z1, c0)
	for step := size / 4; step > size/4096; {
		moved := false
		for _, d := range []complex128{1, -1, 1i, -1i, (1 + 1i) / math.Sqrt2, (1 - 1i) / math.Sqrt2, (-1 + 1i) / math.Sqrt2, (-1 - 1i) / math.Sqrt2} {
			q := c + d*complex(step, 0)
			if w := starAbout(z, z1, q); w > v {
				c, v, moved = q, w, true
			}
		}
		if !moved {
			step /= 2
		}
	}
	return c, v
}

// source is a frozen, counterclockwise loop and its measures.
type source struct {
	adm Admission
	// The smooth loop (Fourier, or an outline's interpolant).
	s trig
	// An outline's cleaned polygon, counterclockwise.
	poly []engine.Vec
	// The smooth loop is certified embedded (or an outline's interpolant is).
	smoothOK  string
	certified bool
	curve     seedCurve
}

// admit freezes and measures a loop. It refuses, by field, what no arm can
// take: an invalid or degenerate source, a self-intersection or a cusp.
func admit(l Loop) (*source, error) {
	src := &source{}
	switch {
	case len(l.Terms) > 0 && len(l.Points) == 0:
		s, err := trigOfTerms(l.Terms)
		if err != nil {
			return nil, err
		}
		src.adm.Source = "fourier"
		src.s = s
	case len(l.Points) > 0 && len(l.Terms) == 0:
		p, err := outline(l.Points)
		if err != nil {
			return nil, err
		}
		x, y := make([]float64, len(p)), make([]float64, len(p))
		for i, q := range p {
			x[i], y[i] = q.X, q.Y
		}
		if !simplePolygon(x, y) {
			return nil, field("loop.points", "The outline crosses itself.")
		}
		if signedArea(x, y) < 0 {
			for i, j := 0, len(p)-1; i < j; i, j = i+1, j-1 {
				p[i], p[j] = p[j], p[i]
			}
			// Keep the first point first.
			p = append(p[len(p)-1:], p[:len(p)-1]...)
			src.adm.Reversed = true
		}
		src.poly = p
		src.adm.Source = "outline"
		src.adm.Certified = true
		src.s = trigOfOutline(p)
	default:
		return nil, field("loop", "Give a loop as Fourier terms or as outline points, not both.")
	}
	a := src.s.area()
	if src.adm.Source == "outline" {
		x, y := polyXY(src.poly)
		a = signedArea(x, y)
	} else if a < 0 {
		src.s = src.s.reversed()
		src.adm.Reversed = true
		a = -a
	}
	scale := src.s.scale()
	if !(a > 1e-12*scale*scale) || !(a > 1e-10) {
		return nil, field(src.path(), "The loop encloses no area.")
	}
	R := math.Sqrt(a / math.Pi)
	if R < 1e-3 || R > 1e3 {
		return nil, field(src.path(), "The loop's equal-area radius must be from 0.001 to 1,000.")
	}
	src.adm.Area, src.adm.Radius = a, R

	// The smooth loop: certificate, regularity and curvature.
	why := "speed"
	m := certifyFrom
	for m < 4*src.s.top() {
		m *= 2
	}
	vmin := 0.0
	for ; m <= certifyTo; m *= 2 {
		if why, vmin = src.s.certify(m); why == "" || why == "cross" {
			break
		}
	}
	m = min(m, certifyTo)
	src.adm.Samples = m
	src.smoothOK = why
	z, z1, z2 := src.s.dense(m)
	mean := 0.0
	for _, d := range z1 {
		mean += cmplx.Abs(d) / float64(m)
	}
	src.adm.Length = 2 * math.Pi * mean
	if why == "" {
		src.certified = true
		src.adm.MinSpeed = vmin / mean
	}
	if src.adm.Source == "fourier" {
		src.adm.Certified = src.certified
		switch why {
		case "":
		case "cross":
			return nil, field("loop.terms", "The loop crosses itself.")
		case "speed", "turning":
			return nil, field("loop.terms", "The loop has a cusp, or so nearly one that its speed cannot be proven positive.")
		default:
			return nil, field("loop.terms", "Two arcs of the loop come too close to prove they do not touch.")
		}
	}
	src.adm.MinKappa, src.adm.MaxKappa = math.Inf(1), math.Inf(-1)
	var cx, cy float64
	for i := range m {
		d, dd := z1[i], z2[i]
		v := cmplx.Abs(d)
		k := (real(d)*imag(dd) - imag(d)*real(dd)) / (v * v * v)
		src.adm.MinKappa, src.adm.MaxKappa = min(src.adm.MinKappa, k*R), max(src.adm.MaxKappa, k*R)
		// Area centroid: ∮ x² dy / 2A, ∮ −y² dx / 2A.
		cx += real(z[i]) * real(z[i]) * imag(d)
		cy -= imag(z[i]) * imag(z[i]) * real(d)
	}
	h := 2 * math.Pi / float64(m)
	src.adm.CenterX, src.adm.CenterY = cx*h/(2*a), cy*h/(2*a)
	if src.adm.Source == "outline" {
		x, y := polyXY(src.poly)
		c := Contour{X: x, Y: y}
		polygonStats(&c, x[0], y[0])
		src.adm.CenterX, src.adm.CenterY, src.adm.Length = c.CenterX, c.CenterY, c.Length
		src.adm.Corner = corner(x, y)
		mk := src.adm.Corner / (c.Length / float64(len(x)))
		src.adm.MaxKappa = math.Max(src.adm.MaxKappa, mk*R)
	}
	// Neck and thickness, on 8,192 equal-arclength samples of the loop.
	var nx, ny []float64
	if src.adm.Source == "outline" {
		nz := resample(src.poly, 8192)
		nx, ny = make([]float64, len(nz)), make([]float64, len(nz))
		for i, p := range nz {
			nx[i], ny[i] = real(p), imag(p)
		}
	} else {
		nx, ny = src.equalArc(8192)
	}
	src.adm.Neck = neck(nx, ny, 2*R) / R
	rhoMin := 1 / math.Max(math.Abs(src.adm.MinKappa), math.Abs(src.adm.MaxKappa))
	src.adm.Thickness = math.Min(rhoMin, src.adm.Neck/2)
	// Star margin about the best center.
	c, v := bestStar(z, z1, complex(src.adm.CenterX, src.adm.CenterY), R)
	src.adm.Star, src.adm.StarX, src.adm.StarY = v, real(c), imag(c)
	return src, nil
}

func (src *source) path() string {
	if src.adm.Source == "outline" {
		return "loop.points"
	}
	return "loop.terms"
}

func polyXY(p []engine.Vec) (x, y []float64) {
	x, y = make([]float64, len(p)), make([]float64, len(p))
	for i, q := range p {
		x[i], y[i] = q.X, q.Y
	}
	return
}

// corner is a polygon's largest turn at a vertex.
func corner(x, y []float64) float64 {
	n := len(x)
	top := 0.0
	for i := range n {
		a, c := (i+n-1)%n, (i+1)%n
		ux, uy := x[i]-x[a], y[i]-y[a]
		vx, vy := x[c]-x[i], y[c]-y[i]
		top = math.Max(top, math.Abs(math.Atan2(ux*vy-uy*vx, ux*vx+uy*vy)))
	}
	return top
}

// equalArc samples the smooth loop at n points of equal arclength from
// u = 0, by Newton on its spectrally integrated arclength.
func (src *source) equalArc(n int) (x, y []float64) {
	u := src.arcParameters(n)
	x, y = make([]float64, n), make([]float64, n)
	for j, v := range u {
		p, _, _ := src.s.eval(v)
		x[j], y[j] = real(p), imag(p)
	}
	return
}

// arcParameters are the parameters of n equal-arclength points.
func (src *source) arcParameters(n int) []float64 {
	m := 4096
	for m < 8*src.s.top() || m < 2*n {
		m *= 2
	}
	_, z1, _ := src.s.dense(m)
	sp := make([]complex128, m)
	mean := 0.0
	for i, d := range z1 {
		sp[i] = complex(cmplx.Abs(d), 0)
		mean += real(sp[i]) / float64(m)
	}
	// Arclength s(u) = mean·u + P(u), P periodic: its table on the m
	// parameters, then Newton from linear interpolation.
	for i := range sp {
		sp[i] -= complex(mean, 0)
	}
	fft(sp, false)
	for k := range sp {
		if w := wavenumber(k, m); w == 0 {
			sp[k] = 0
		} else {
			sp[k] /= complex(0, w)
		}
	}
	fft(sp, true)
	h := 2 * math.Pi / float64(m)
	acc := make([]float64, m+1)
	for i := range m {
		acc[i] = mean*h*float64(i) + real(sp[i]) - real(sp[0])
	}
	acc[m] = mean * 2 * math.Pi
	out := make([]float64, n)
	i := 0
	for j := range n {
		target := acc[m] * float64(j) / float64(n)
		for i < m-1 && acc[i+1] <= target {
			i++
		}
		u := h * (float64(i) + (target-acc[i])/(acc[i+1]-acc[i]))
		// Newton on s(u) − target with s' = |z'|; s(u) by Simpson from the
		// table's node (16 panels).
		for range 4 {
			s := acc[i] + src.speedIntegral(h*float64(i), u)
			_, d, _ := src.s.eval(u)
			u -= (s - target) / cmplx.Abs(d)
		}
		out[j] = u
	}
	return out
}

func (src *source) speedIntegral(a, b float64) float64 {
	const panels = 16
	w := (b - a) / panels
	sum := 0.0
	for k := 0; k <= panels; k++ {
		_, d, _ := src.s.eval(a + w*float64(k))
		c := 2.0
		if k == 0 || k == panels {
			c = 1
		} else if k%2 == 1 {
			c = 4
		}
		sum += c * cmplx.Abs(d)
	}
	return sum * w / 3
}

// seedCurve is the smooth loop for the arclength arm: point, speed and a
// continuous tangent angle, unwrapped against a dense table.
func (src *source) seedCurve() seedCurve {
	if src.curve != nil {
		return src.curve
	}
	src.curve = src.makeSeedCurve()
	return src.curve
}

func (src *source) makeSeedCurve() seedCurve {
	m := 1 << 16
	for m < 8*src.s.top() {
		m *= 2
	}
	_, z1, _ := src.s.dense(m)
	tab := make([]float64, m+1)
	prev := 0.0
	for i := 0; i <= m; i++ {
		a := cmplx.Phase(z1[i%m])
		if i > 0 {
			a += 2 * math.Pi * math.Round((prev-a)/(2*math.Pi))
		}
		tab[i], prev = a, a
	}
	turn := tab[m] - tab[0]
	return func(phi float64) (x, y, speed, angle float64) {
		p, d, _ := src.s.eval(phi)
		a := cmplx.Phase(d)
		turns := math.Floor(phi / (2 * math.Pi))
		w := phi - 2*math.Pi*turns
		est := tab[min(m, int(w/(2*math.Pi)*float64(m)))] + turns*turn
		a += 2 * math.Pi * math.Round((est-a)/(2*math.Pi))
		return real(p), imag(p), cmplx.Abs(d), a
	}
}

// Evolution is a solved film that can be sampled at its times.
type Evolution interface {
	Frames(times []float64) (Reply, error)
}

// LoopFilm is a user loop's admission and the film of its chosen arm.
type LoopFilm struct {
	Admission Admission
	film      interface {
		Frames(times []float64) (Reply, error)
		Sample(t float64) (Contour, error)
	}
}

// Frames samples the chosen arm's film, with the admission attached.
func (f *LoopFilm) Frames(times []float64) (Reply, error) {
	r, err := f.film.Frames(times)
	if err != nil {
		return r, err
	}
	a := f.Admission
	r.Admission = &a
	return r, nil
}

// Sample is the loop at time t.
func (f *LoopFilm) Sample(t float64) (Contour, error) { return f.film.Sample(t) }

// End is the film's last time.
func (f *LoopFilm) End() float64 {
	r, _ := f.film.Frames(nil)
	return r.End
}

// SolveLoop admits q's loop and evolves it with the requested arm, or with
// the first arm that takes it: arc, polar, then bgn.
func SolveLoop(q LoopRequest) (*LoopFilm, error) {
	if !(q.Horizon > 0 && q.Horizon <= 0.999) {
		return nil, field("horizon", "Horizon must be above 0 and at most 0.999 of the extinction time.")
	}
	if q.Tau != 0 && !(q.Tau >= 1e-4 && q.Tau <= 0.2) {
		return nil, field("tau", "Step factor must be from 0.0001 to 0.2.")
	}
	src, err := admit(q.Loop)
	if err != nil {
		return nil, err
	}
	// Automatic: the spectrally accurate arm first, then the shipped radial
	// graph, then the polygon scheme, which takes the most.
	arms := []string{"arc", "polar", "bgn"}
	switch q.Solver {
	case "":
	case "polar", "arc", "bgn":
		arms = []string{q.Solver}
	default:
		return nil, field("solver", "Solver must be polar, arc or bgn.")
	}
	refused := map[string]string{}
	var last error
	for _, arm := range arms {
		var film interface {
			Frames([]float64) (Reply, error)
			Sample(float64) (Contour, error)
		}
		var nodes int
		var remesh float64
		switch arm {
		case "polar":
			film, nodes, remesh, err = src.polar(q)
		case "arc":
			film, nodes, remesh, err = src.arc(q)
		case "bgn":
			film, nodes, remesh, err = src.bgn(q)
		}
		if err != nil {
			refused[arm] = err.Error()
			last = err
			continue
		}
		adm := src.adm
		adm.Solver, adm.Nodes, adm.Remesh = arm, nodes, remesh/src.adm.Radius
		if len(refused) > 0 {
			adm.Refused = refused
		}
		return &LoopFilm{Admission: adm, film: film}, nil
	}
	if len(arms) == 1 {
		// Shown alone, an arm's reason reads as a sentence.
		var fe *engine.FieldError
		if errors.As(last, &fe) {
			m := fe.Message
			if m != "" && m[0] >= 'a' && m[0] <= 'z' {
				m = string(m[0]-'a'+'A') + m[1:]
			}
			if !strings.HasSuffix(m, ".") {
				m += "."
			}
			return nil, &engine.FieldError{Field: fe.Field, Message: m}
		}
		return nil, last
	}
	return nil, field(src.path(), "No solver can take this loop: %s", joinRefusals(arms, refused))
}

func joinRefusals(arms []string, refused map[string]string) string {
	s := ""
	for i, a := range arms {
		if i > 0 {
			s += "; "
		}
		s += a + ": " + refused[a]
	}
	return s
}

// polar seeds the shipped radial graph with the loop's polar radius about
// its best star center.
func (src *source) polar(q LoopRequest) (*Film, int, float64, error) {
	if src.adm.Source == "outline" && src.adm.Corner > turnLimit {
		return nil, 0, 0, field("loop.points", "the outline turns %.2f rad at a vertex, more than the radial graph resolves (%.2f)", src.adm.Corner, turnLimit)
	}
	if src.smoothOK != "" {
		return nil, 0, 0, field(src.path(), "the smooth loop is not certified embedded (%s)", src.smoothOK)
	}
	if src.adm.Star < starMargin {
		return nil, 0, 0, field(src.path(), "the loop is not star-shaped with tangents at least atan(1/10) off its rays (best margin %.3g)", src.adm.Star)
	}
	n := q.Nodes
	if n == 0 {
		n = shortenNodes
	}
	if n < 32 || n > bgnTo || n%2 != 0 {
		return nil, 0, 0, field("nodes", "Nodes must be an even number from 32 to %d.", bgnTo)
	}
	tau := q.Tau
	if tau == 0 {
		tau = 0.0025
	}
	c := complex(src.adm.StarX, src.adm.StarY)
	m := src.adm.Samples
	z, _, _ := src.s.dense(m)
	// The unwrapped polar angle about c, increasing along the loop.
	th := make([]float64, m+1)
	prev := 0.0
	for i := 0; i <= m; i++ {
		a := cmplx.Phase(z[i%m] - c)
		if i > 0 {
			a += 2 * math.Pi * math.Round((prev-a)/(2*math.Pi))
		}
		th[i], prev = a, a
	}
	h := 2 * math.Pi / float64(m)
	l := make([]float64, n)
	x, y := make([]float64, n), make([]float64, n)
	for i := range n {
		phi := 2 * math.Pi * float64(i) / float64(n)
		// The same direction within [th0, th0 + 2π).
		target := phi + 2*math.Pi*math.Ceil((th[0]-phi)/(2*math.Pi))
		j := sort.SearchFloat64s(th[:m], target) - 1
		j = max(0, min(m-1, j))
		u := h * (float64(j) + (target-th[j])/(th[j+1]-th[j]))
		for range 8 {
			p, d, _ := src.s.eval(u)
			r := p - c
			a := cmplx.Phase(r)
			a += 2 * math.Pi * math.Round((target-a)/(2*math.Pi))
			rate := (real(r)*imag(d) - imag(r)*real(d)) / real(r*cmplx.Conj(r))
			u -= (a - target) / rate
		}
		p, _, _ := src.s.eval(u)
		l[i] = math.Log(cmplx.Abs(p - c))
		x[i], y[i] = real(p), imag(p)
	}
	f := &Film{tau: tau}
	f.Area0 = src.adm.Area
	f.Extinction = f.Area0 / (2 * math.Pi)
	f.horizon = q.Horizon * f.Extinction
	p := newPolar(n, real(c), imag(c))
	p.floor = floorFraction * src.adm.Radius
	f.s = p
	if why := p.guard(l); why != "" {
		return nil, 0, 0, field("nodes", "the loop fails the polar %s limit on %d nodes", why, n)
	}
	if !src.neckResolved(n) {
		return nil, 0, 0, field("nodes", "the loop's narrowest neck spans fewer than %d node spacings on %d nodes", neckSpacings, n)
	}
	f.run(l)
	return f, n, src.chordDeparture(x, y), nil
}

// The polar arm's default resolution, the shipped flowers'.
const shortenNodes = 512

// neckResolved reports whether the narrowest neck spans neckSpacings mean
// node spacings at n nodes.
func (src *source) neckResolved(n int) bool {
	return src.adm.Neck*src.adm.Radius >= neckSpacings*src.adm.Length/float64(n)
}

// arc seeds the arclength solver, at the coarsest N from arcFrom to arcTo
// that resolves the loop's curvature spectrum, unless q names N.
func (src *source) arc(q LoopRequest) (*arcFilm, int, float64, error) {
	if src.adm.Source == "outline" {
		// An outline's chords meet at kinks however finely it is drawn, and
		// an interpolant of them never passes the spectral resolution test
		// (#409: not even a 1,024-point ellipse); refusing at once saves the
		// attempts at every N.
		return nil, 0, 0, field("loop.points", "the arclength solver needs a smooth loop; an outline's chords meet at corners")
	}
	if src.smoothOK != "" {
		return nil, 0, 0, field(src.path(), "the smooth loop is not certified embedded (%s)", src.smoothOK)
	}
	step := q.Tau
	if step == 0 {
		step = 0.01
	}
	curve := src.seedCurve()
	floor := floorFraction * src.adm.Radius
	ns := []int{}
	if q.Nodes != 0 {
		ns = append(ns, q.Nodes)
	} else {
		for n := arcFrom; n <= arcTo; n *= 2 {
			ns = append(ns, n)
		}
	}
	var last error
	for _, n := range ns {
		if n < 64 || n > arcTo || n&(n-1) != 0 {
			return nil, 0, 0, field("nodes", "Nodes must be a power of two from 64 to %d.", arcTo)
		}
		e := newETD(n, step)
		u := src.arcInitial(e, curve)
		if why := e.guard(u, floor); why != "" {
			last = field("nodes", "the loop fails the arclength %s limit on %d nodes", why, n)
			continue
		}
		if !src.neckResolved(n) {
			last = field("nodes", "the loop's narrowest neck spans fewer than %d node spacings on %d nodes", neckSpacings, n)
			continue
		}
		f, err := solveArc(arcRequest{Nodes: n, Step: step, Horizon: q.Horizon, MaxNodes: arcTo, EveryStep: true, Checkpoints: loopCheckpoints,
			Initial: func(e *etd) []complex128 { return append([]complex128{}, u...) }}, curve, src.adm.Area)
		if err != nil {
			return nil, 0, 0, err
		}
		c, _ := f.Sample(0)
		return f, n, src.chordDeparture(c.X, c.Y), nil
	}
	return nil, 0, 0, last
}

// arcInitial is the arclength arm's initial state on e's N nodes: the
// tangent angle at N equal-arclength parameters of the smooth loop, from
// its own arclength table, in place of the generic seed's spectral
// Newton, which costs O(N²) per node set.
func (src *source) arcInitial(e *etd, curve seedCurve) []complex128 {
	n := e.n
	params := src.arcParameters(n)
	u := make([]complex128, n+4)
	for j, p := range params {
		_, _, _, angle := curve(p)
		u[j] = complex(angle-2*math.Pi*float64(j)/float64(n), 0)
	}
	fft(u[:n], false)
	x0, y0, _, _ := curve(0)
	u[n] = complex(math.Log(src.smoothLength()), 0)
	u[n+2], u[n+3] = complex(x0, 0), complex(y0, 0)
	return u
}

// smoothLength is the smooth loop's length, by the mean of its speed.
func (src *source) smoothLength() float64 {
	m := 4096
	for m < 8*src.s.top() {
		m *= 2
	}
	_, z1, _ := src.s.dense(m)
	sum := 0.0
	for _, d := range z1 {
		sum += cmplx.Abs(d)
	}
	return 2 * math.Pi * sum / float64(m)
}

// chordDeparture is the largest distance from the source to the polygon
// through x, y: each chord's farthest departure from the arc it spans,
// measured on the arc's own samples. The vertices lie on the source.
func (src *source) chordDeparture(x, y []float64) float64 {
	if src.adm.Source == "outline" {
		// The smooth arms see the interpolant; the remeshing error is then
		// the interpolant's departure from the polygon plus the chords'.
		return polygonDistance(src.poly, x, y)
	}
	n := len(x)
	m := 16 * n
	z, _, _ := src.s.dense(pow2(m))
	return hausdorff(z, x, y)
}

func pow2(m int) int {
	p := 1
	for p < m {
		p *= 2
	}
	return p
}

// hausdorff is the larger of the two one-sided distances between dense
// curve samples z and the closed polygon x, y, each point to the nearest
// segment, by buckets.
func hausdorff(z []complex128, x, y []float64) float64 {
	zx, zy := make([]float64, len(z)), make([]float64, len(z))
	for i, p := range z {
		zx[i], zy[i] = real(p), imag(p)
	}
	return math.Max(toPolygon(zx, zy, x, y), toPolygon(x, y, zx, zy))
}

func polygonDistance(p []engine.Vec, x, y []float64) float64 {
	px, py := polyXY(p)
	dense := resample(p, max(8192, 8*len(x)))
	dx, dy := make([]float64, len(dense)), make([]float64, len(dense))
	for i, q := range dense {
		dx[i], dy[i] = real(q), imag(q)
	}
	return math.Max(toPolygon(dx, dy, x, y), toPolygon(x, y, px, py))
}

// toPolygon is the largest distance from a point (qx, qy) to the closed
// polygon (x, y).
func toPolygon(qx, qy, x, y []float64) float64 {
	n := len(x)
	cell := 0.0
	for i := range n {
		j := (i + 1) % n
		cell = math.Max(cell, math.Hypot(x[j]-x[i], y[j]-y[i]))
	}
	cell = math.Max(cell, 1e-12)
	g := segmentCells(x, y, cell, 0)
	worst := 0.0
	for k := range qx {
		best := math.Inf(1)
		cx, cy := cellOf(qx[k], cell), cellOf(qy[k], cell)
		for ring := int64(1); ring < 1<<20 && math.IsInf(best, 1); ring *= 2 {
			for a := cx - ring; a <= cx+ring; a++ {
				for b := cy - ring; b <= cy+ring; b++ {
					g.each(a, b, func(i int) {
						j := (i + 1) % n
						best = math.Min(best, pointSegment(qx[k], qy[k], x[i], y[i], x[j], y[j]))
					})
				}
			}
			// A segment found in this ring is the nearest only if it is
			// within the ring's inner radius; widen once more otherwise.
			if best > float64(ring)*cell {
				best = math.Inf(1)
			}
		}
		worst = math.Max(worst, best)
	}
	return worst
}

func pointSegment(px, py, ax, ay, bx, by float64) float64 {
	dx, dy := bx-ax, by-ay
	l := dx*dx + dy*dy
	w := 0.0
	if l > 0 {
		w = math.Max(0, math.Min(1, ((px-ax)*dx+(py-ay)*dy)/l))
	}
	return math.Hypot(ax+w*dx-px, ay+w*dy-py)
}
