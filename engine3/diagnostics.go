package engine3

import "math"

// DiagnosticsResult describes the base curve at every sample, indexed like
// Base; sample i is at t = Min + (Max − Min)·i/n. With r′, r″ and r‴ the
// parameter derivatives, the curvature is κ = |r′ × r″|/|r′|³, the binormal
// B = (r′ × r″)/|r′ × r″|, the principal normal N = B × T, the torsion
// τ = (r′ × r″)·r‴/|r′ × r″|² (positive for a right-handed helix), and the
// osculating centre r + N/κ.
//
// Curvature is null where r″ is unknown and 0 where |r′ × r″| is below the
// same guard that leaves the developable's binormal undefined; Flat counts
// those samples, whose N, B, τ, and centre are null. Torsion is also null
// where r‴ is unknown, counted by Unknown. A centre whose radius of
// curvature exceeds 100 study radii is null, at infinity, counted by Clipped.
// A closed curve's last sample repeats its first and is not counted.
type DiagnosticsResult struct {
	Min       float64    `json:"min"`
	Max       float64    `json:"max"`
	Curvature []*float64 `json:"curvature"`
	Torsion   []*float64 `json:"torsion"`
	Tangent   []*Vec3    `json:"tangent"`
	Normal    []*Vec3    `json:"normal"`
	Binormal  []*Vec3    `json:"binormal"`
	Center    []*Vec3    `json:"center"`
	Flat      int        `json:"flat"`
	Unknown   int        `json:"unknown"`
	Clipped   int        `json:"clipped"`
	closed    bool
}

// knotJerk is r‴ of the torus knot, differentiating knot's r″ analytically.
func knotJerk(c Request, t float64) Vec3 {
	p, q := float64(c.P), float64(c.Q)
	cp, sp, cq, sq := math.Cos(p*t), math.Sin(p*t), math.Cos(q*t), math.Sin(q*t)
	h := c.Radius + c.Tube*cq
	dh, ddh, dddh := -c.Tube*q*sq, -c.Tube*q*q*cq, c.Tube*q*q*q*sq
	even, odd := dddh-3*p*p*dh, 3*p*ddh-p*p*p*h
	return Vec3{even*cp - odd*sp, even*sp + odd*cp, -c.Tube * q * q * q * cq}
}

// knotSnap is r⁗ of the torus knot, differentiating knotJerk analytically.
func knotSnap(c Request, t float64) Vec3 {
	p, q := float64(c.P), float64(c.Q)
	cp, sp, cq, sq := math.Cos(p*t), math.Sin(p*t), math.Cos(q*t), math.Sin(q*t)
	h := c.Radius + c.Tube*cq
	dh, ddh, dddh, ddddh := -c.Tube*q*sq, -c.Tube*q*q*cq, c.Tube*q*q*q*sq, c.Tube*q*q*q*q*cq
	even, odd := ddddh-6*p*p*ddh+p*p*p*p*h, 4*p*dddh-4*p*p*p*dh
	return Vec3{even*cp - odd*sp, even*sp + odd*cp, c.Tube * q * q * q * q * sq}
}

// harmonicSnap is r⁗ of the harmonic curve, term by term.
func harmonicSnap(h HarmonicCurve, u float64) Vec3 {
	var j Vec3
	for _, term := range h.Terms {
		w := term.Frequency
		w4 := w * w * w * w
		j = j.add(term.Cosine.mul(w4 * math.Cos(w*u)).add(term.Sine.mul(w4 * math.Sin(w*u))))
	}
	return j
}

// snap returns r⁗ for a knot or a harmonic curve, and nil for a curve
// without analytic derivatives.
func snap(c Request) func(float64) Vec3 {
	switch c.Format {
	case "", "torus":
		return func(t float64) Vec3 { return knotSnap(c, t) }
	case "harmonic":
		return func(t float64) Vec3 { return harmonicSnap(c.Harmonic, t) }
	}
	return nil
}

// harmonicJerk is r‴ of the harmonic curve, term by term.
func harmonicJerk(h HarmonicCurve, u float64) Vec3 {
	var j Vec3
	for _, term := range h.Terms {
		w := term.Frequency
		c, s := math.Cos(w*u), math.Sin(w*u)
		j = j.add(term.Cosine.mul(w * w * w * s).sub(term.Sine.mul(w * w * w * c)))
	}
	return j
}

// jerkStep differences the evaluator's own r″ at step h (see slope).
func jerkStep(evaluate evaluation, t, lo, hi, h float64) (Vec3, bool) {
	return slope(func(s float64) (Vec3, bool) {
		_, _, a, ok := evaluate(s)
		return a, ok && a.valid()
	}, t, lo, hi, h)
}

// slope differences f at step h: centrally where the stencil fits in
// [lo, hi], otherwise one-sided over three points. The next stencil is
// tried where one meets an unknown value, as at a trajectory's early end.
func slope(f func(float64) (Vec3, bool), t, lo, hi, h float64) (Vec3, bool) {
	stencils := [][3]float64{{-1, 0, 1}, {-2, -1, 0}, {0, 1, 2}}
	weights := [][3]float64{{-0.5, 0, 0.5}, {0.5, -2, 1.5}, {-1.5, 2, -0.5}}
	for k, offsets := range stencils {
		if t+offsets[0]*h < lo || t+offsets[2]*h > hi {
			continue
		}
		var j Vec3
		ok := true
		for m, o := range offsets {
			if weights[k][m] == 0 {
				continue
			}
			a, fine := f(t + o*h)
			if !fine {
				ok = false
				break
			}
			j = j.add(a.mul(weights[k][m] / h))
		}
		if ok {
			return j, true
		}
	}
	return Vec3{}, false
}

// jerk returns r‴ for the base curve: analytic for a knot or a harmonic
// curve, otherwise differenced from r″ at two steps scaled to the span and
// discarded when they disagree.
func jerk(c Request, evaluate evaluation, lo, hi float64) func(float64, Vec3) (Vec3, bool) {
	switch c.Format {
	case "", "torus":
		return func(t float64, _ Vec3) (Vec3, bool) { return knotJerk(c, t), true }
	case "harmonic":
		return func(t float64, _ Vec3) (Vec3, bool) { return harmonicJerk(c.Harmonic, t), true }
	}
	span := hi - lo
	return func(t float64, v Vec3) (Vec3, bool) {
		j, ok := jerkStep(evaluate, t, lo, hi, span*1e-3)
		j2, ok2 := jerkStep(evaluate, t, lo, hi, span*5e-4)
		if !ok || !ok2 || !j.valid() || !j2.valid() || j.sub(j2).norm() > 1e-2*math.Max(j.norm(), j2.norm())+1e-4*math.Max(1, v.norm()/(span*span)) {
			return Vec3{}, false
		}
		return j2, true
	}
}

// diagnose describes the base at every sample from the sampling loop's
// velocities, accelerations, and binormal guard.
func diagnose(c Request, evaluate evaluation, lo, hi float64, base []*Vec3, velocities, accelerations, binormals []Vec3, defined []bool, closed bool) *DiagnosticsResult {
	n := len(base) - 1
	d := &DiagnosticsResult{Min: lo, Max: hi, Curvature: make([]*float64, n+1), Torsion: make([]*float64, n+1),
		Tangent: make([]*Vec3, n+1), Normal: make([]*Vec3, n+1), Binormal: make([]*Vec3, n+1), Center: make([]*Vec3, n+1), closed: closed}
	third := jerk(c, evaluate, lo, hi)
	last := n
	if closed {
		last = n - 1
	}
	for i := 0; i <= last; i++ {
		if base[i] == nil {
			continue
		}
		v, a := velocities[i], accelerations[i]
		speed := v.norm()
		tangent := v.mul(1 / speed)
		d.Tangent[i] = &tangent
		if !a.valid() {
			continue
		}
		if !defined[i] {
			zero := 0.0
			d.Curvature[i] = &zero
			d.Flat++
			continue
		}
		b := v.cross(a)
		kappa := b.norm() / (speed * speed * speed)
		binormal := binormals[i]
		normal := binormal.cross(tangent)
		center := base[i].add(normal.mul(1 / kappa))
		d.Curvature[i], d.Binormal[i], d.Normal[i], d.Center[i] = &kappa, &binormal, &normal, &center
		t := lo + (hi-lo)*float64(i)/float64(n)
		if j, ok := third(t, v); ok {
			tau := b.dot(j) / b.dot(b)
			d.Torsion[i] = &tau
		} else {
			d.Unknown++
		}
	}
	if closed {
		d.Curvature[n], d.Torsion[n], d.Tangent[n] = d.Curvature[0], d.Torsion[0], d.Tangent[0]
		d.Normal[n], d.Binormal[n], d.Center[n] = d.Normal[0], d.Binormal[0], d.Center[0]
	}
	return d
}

// clip puts centres whose radius of curvature exceeds 100 study radii at
// infinity.
func (d *DiagnosticsResult) clip(radius float64) {
	n := len(d.Center) - 1
	for i, center := range d.Center {
		if center != nil && 1 / *d.Curvature[i] > 100*radius {
			d.Center[i] = nil
			if !d.closed || i < n {
				d.Clipped++
			}
		}
	}
}
