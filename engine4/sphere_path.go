package engine4

import "math"

// Base sphere and fibers lifts one closed analytic path on the unit base
// sphere S² (docs/tesseracts.md, "Base sphere and fibers" and the path
// sections after it). A spherePath is that path's descriptor: its point and
// derivative, its exact period, how finely the base curve is drawn, and how
// its samples are identified. pairedWeave samples every path the same way,
// at tⱼ = Tj/n, so nothing downstream branches on the path's name.
type spherePath struct {
	name   string  // correspondence.path; empty for the latitude
	noun   string  // as in "use 1–32 fibers on the <noun>"
	kind   string  // section kind of a nonconstant path other than the latitude
	level  float64 // section level: α for the latitude and flower
	period float64 // the exact closing parameter T, p(t + T) = p(t)
	// Base-curve segments, at least the arc samples.
	segments int
	// The point on S², with exact poles where the path's pole rule snaps
	// them, and dp/dt of the formula. Increasing t is the path's orientation.
	point      func(t float64) Vec3
	derivative func(t float64) Vec3
	// Every point is one pole: a collapsed latitude or zero-amplitude flower.
	constant bool
	// Samples carry provenance: exact repeated poles share one fiber through
	// correspondence.aliases, and a trace within rounding of a sample uses
	// the frozen sample. False keeps the original latitude presentation.
	distinct bool
	// Report the period in the diagnostics. The latitude and flower omit it,
	// so their results keep their bytes.
	reportPeriod bool
}

// The absent spherical Lissajous frequencies.
const defaultAzimuthal, defaultPolar = 2, 1

func flowerPetals(w WeaveParameters) int {
	if w.Petals != nil {
		return *w.Petals
	}
	return 5
}

func lissajousFrequencies(w WeaveParameters) (int, int) {
	m1, m2 := defaultAzimuthal, defaultPolar
	if w.Azimuthal != nil {
		m1 = *w.Azimuthal
	}
	if w.Polar != nil {
		m2 = *w.Polar
	}
	return m1, m2
}

// validateSpherePath checks the active path's own fields, naming each one.
// The latitude's α and sweep endpoints are checked with the shared fields.
func validateSpherePath(w WeaveParameters) error {
	switch w.Path {
	case "", "latitude":
	case "flower":
		if petals := flowerPetals(w); petals < 1 || petals > 8 {
			return fieldErr("weave.petals", "Petals must be a whole number from 1 to 8")
		}
		// The latitude's rounding tolerance: a touch entered as constant
		// expressions can round past a pole, which the snap restores.
		if !finite(w.Alpha) || w.Alpha < -weaveTolerance || w.Alpha > math.Pi/2+weaveTolerance {
			return fieldErr("weave.alpha", "Central latitude α must be between 0 and π/2")
		}
		if !finite(w.Amplitude) || w.Amplitude < 0 || w.Alpha-w.Amplitude < -weaveTolerance ||
			w.Alpha+w.Amplitude > math.Pi/2+weaveTolerance {
			return fieldErr("weave.amplitude", "Flower amplitude A must be nonnegative and keep α ± A within 0 and π/2")
		}
	case "great-circle":
		if !finite(w.Tilt) || w.Tilt < -weaveTolerance || w.Tilt > math.Pi+weaveTolerance {
			return fieldErr("weave.tilt", "Tilt β must be between 0 and π")
		}
	case "lissajous":
		m1, m2 := lissajousFrequencies(w)
		if m1 < 1 || m1 > 8 {
			return fieldErr("weave.azimuthal", "Azimuthal frequency m₁ must be a whole number from 1 to 8")
		}
		if m2 < 1 || m2 > 8 {
			return fieldErr("weave.polar", "Polar frequency m₂ must be a whole number from 1 to 8")
		}
	default:
		return fieldErr("weave.path", "Base path must be Latitude, Spherical flower, Great circle or Spherical Lissajous")
	}
	return nil
}

// snapLatitude applies the latitude's rounding-distance pole policy to α.
func snapLatitude(a float64) float64 {
	if a <= weaveTolerance {
		return 0
	} else if a >= math.Pi/2-weaveTolerance {
		return math.Pi / 2
	}
	return a
}

// snapPole returns the exact pole for a point within horizontal distance
// 2·10⁻¹² of it: the latitude's 10⁻¹²-radian α snap, expressed on S².
func snapPole(p Vec3) Vec3 {
	if math.Hypot(p[0], p[1]) <= 2*weaveTolerance {
		return Vec3{0, 0, math.Copysign(1, p[2])}
	}
	return p
}

// latitudeVelocity is d/dt of latitudePoint(α(t), t) for dα/dt = da.
func latitudeVelocity(alpha, da, t float64) Vec3 {
	s2, c2 := math.Sincos(2 * alpha)
	s, c := math.Sincos(t)
	return Vec3{2*da*c2*c - s2*s, 2*da*c2*s + s2*c, -2 * da * s2}
}

// newSpherePath returns the descriptor of a validated path. samples is the
// arc-sample count N, the least number of base-curve segments.
func newSpherePath(w WeaveParameters, samples int) spherePath {
	switch w.Path {
	case "great-circle":
		// p(t) = (cos t, cos β sin t, sin β sin t): unit speed, turning
		// counterclockwise about (0, −sin β, cos β).
		sb, cb := math.Sincos(math.Min(math.Max(w.Tilt, 0), math.Pi))
		return spherePath{name: w.Path, noun: "great circle", kind: w.Path, period: 2 * math.Pi, segments: samples,
			point: func(t float64) Vec3 {
				s, c := math.Sincos(t)
				return snapPole(Vec3{c, cb * s, sb * s})
			},
			derivative: func(t float64) Vec3 {
				s, c := math.Sincos(t)
				return Vec3{-s, cb * c, sb * c}
			},
			distinct: true, reportPeriod: true}
	case "lissajous":
		// Erb's spherical Lissajous curve p(t) = (sin(m₂t) cos(m₁t),
		// sin(m₂t) sin(m₁t), cos(m₂t)). A common factor g of m₁ and m₂
		// retraces the reduced curve, so it closes at T = 2π/g.
		m1, m2 := lissajousFrequencies(w)
		g := m1
		for b := m2; b != 0; {
			g, b = b, g%b
		}
		f1, f2 := float64(m1), float64(m2)
		return spherePath{name: w.Path, noun: "Lissajous curve", kind: w.Path, period: 2 * math.Pi / float64(g),
			segments: max(samples, 16*(m1+m2)/g),
			point: func(t float64) Vec3 {
				sp, cp := math.Sincos(f2 * t)
				sa, ca := math.Sincos(f1 * t)
				return snapPole(Vec3{sp * ca, sp * sa, cp})
			},
			derivative: func(t float64) Vec3 {
				sp, cp := math.Sincos(f2 * t)
				sa, ca := math.Sincos(f1 * t)
				return Vec3{f2*cp*ca - f1*sp*sa, f2*cp*sa + f1*sp*ca, -f2 * sp}
			},
			distinct: true, reportPeriod: true}
	}
	alpha := weaveLatitudes(w.Alpha, 0, 1)[0]
	p := spherePath{noun: "latitude", level: alpha, period: 2 * math.Pi, segments: samples,
		point:      func(t float64) Vec3 { return latitudePoint(alpha, t) },
		derivative: func(t float64) Vec3 { return latitudeVelocity(alpha, 0, t) },
		constant:   alpha == 0 || alpha == math.Pi/2}
	if w.Path != "flower" {
		return p
	}
	p.name, p.noun = w.Path, "flower"
	if w.Amplitude == 0 {
		return p // the latitude, including its collapsed poles
	}
	// α(t) = α₀ + A cos(kt), with at least 16 base segments per petal.
	k := float64(flowerPetals(w))
	p.kind, p.constant, p.distinct = w.Path, false, true
	p.segments = max(samples, 16*flowerPetals(w))
	p.point = func(t float64) Vec3 {
		return latitudePoint(snapLatitude(w.Alpha+w.Amplitude*math.Cos(k*t)), t)
	}
	p.derivative = func(t float64) Vec3 {
		return latitudeVelocity(w.Alpha+w.Amplitude*math.Cos(k*t), -w.Amplitude*k*math.Sin(k*t), t)
	}
	return p
}
