package engine4

import (
	"fmt"
	"math"
)

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
	// Base-curve segments, at least the arc samples, and the parameters of
	// corners the base curve must pass through exactly: a geodesic
	// polygon's vertices after the first, inserted between them.
	segments int
	corners  []float64
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
	// A geodesic polygon's side count, and the side holding t; absent for
	// every other path.
	sides int
	side  func(t float64) int
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
	case "polygon":
		return validatePolygon(w.Vertices)
	default:
		return fieldErr("weave.path", "Base path must be Latitude, Spherical flower, Great circle, Spherical Lissajous or Geodesic polygon")
	}
	return nil
}

// A geodesic polygon has 3–maxPolygonVertices vertices, and each side
// subtends at least minPolygonSide radians and falls short of a half circle
// by as much: the limits of the 3D notebook's polygon (engine3/transport.go).
const (
	maxPolygonVertices = 12
	minPolygonSide     = 1e-6
)

// validatePolygon checks the vertices' count and coordinates, and that
// each side, from a vertex to the next and from the last to the first, has
// one shortest great-circle arc: its ends neither coincide nor lie
// opposite, within minPolygonSide. A side's refusal names its later vertex.
// Nonadjacent vertices may coincide or lie opposite, and sides may cross.
func validatePolygon(vs []PolygonVertex) error {
	n := len(vs)
	if n < 3 || n > maxPolygonVertices {
		return fieldErr("weave.vertices", "a polygon has 3–%d vertices", maxPolygonVertices)
	}
	field := func(k int, c string) string { return fmt.Sprintf("weave.vertices.%d.%s", k, c) }
	for k, p := range vs {
		if !finite(p.U) || math.Abs(p.U) > 1e5 {
			return fieldErr(field(k, "u"), "vertex %d: u must be finite and within ±100000", k+1)
		}
		if !(math.Abs(p.V) <= math.Pi/2) {
			return fieldErr(field(k, "v"), "vertex %d: v is a latitude, within ±π/2", k+1)
		}
	}
	ps := polygonPoints(vs)
	for i := range ps {
		j := (i + 1) % n
		switch theta := sideAngle(ps[i], ps[j]); {
		case theta < minPolygonSide:
			return fieldErr(field(j, "u"), "vertices %d and %d coincide, so the side between them has no direction", i+1, j+1)
		case theta > math.Pi-minPolygonSide:
			return fieldErr(field(j, "u"), "vertices %d and %d lie opposite, so no single shortest arc joins them", i+1, j+1)
		}
	}
	return nil
}

// polygonPoints are the vertices on the unit base sphere, X(u, v) =
// (cos v cos u, cos v sin u, sin v) as in the 3D notebook's chart, with the
// pole rule's exact poles.
func polygonPoints(vs []PolygonVertex) []Vec3 {
	ps := make([]Vec3, len(vs))
	for k, p := range vs {
		cv := math.Cos(p.V)
		ps[k] = snapPole(Vec3{cv * math.Cos(p.U), cv * math.Sin(p.U), math.Sin(p.V)})
	}
	return ps
}

// sideAngle is the angle between unit vectors a and b, stable near 0 and π.
func sideAngle(a, b Vec3) float64 {
	c := cross(a, b)
	return math.Atan2(math.Sqrt(dot(c, c)), dot(a, b))
}

// polygonPath is the geodesic polygon through the validated vertices,
// parameterized by arc length t from vertex 1, of period the perimeter L.
// Side i runs from p_i to p_{i+1}, the last back to p₀, along the shorter
// great-circle arc: p(t) = p_i cos σ + (B_i × p_i) sin σ, σ = t − s_i, with
// B_i = p_i × p_{i+1}/|p_i × p_{i+1}| and s_i the arc length at vertex i.
// A t within weaveTolerance of a corner is that exact vertex, which begins
// its departing side. The base curve draws the arc samples uniformly in
// t and inserts each later corner that is not within weaveTolerance of one.
func polygonPath(w WeaveParameters, samples int) spherePath {
	ps := polygonPoints(w.Vertices)
	m := len(ps)
	starts := make([]Vec3, m) // B_i × p_i, the side's unit tangent at p_i
	at := make([]float64, m+1)
	for i, p := range ps {
		b := cross(p, ps[(i+1)%m])
		l := math.Sqrt(dot(b, b))
		starts[i] = cross(Vec3{b[0] / l, b[1] / l, b[2] / l}, p)
		at[i+1] = at[i] + sideAngle(p, ps[(i+1)%m])
	}
	// The side holding t, and whether t is that side's first vertex.
	locate := func(t float64) (int, bool) {
		for i, s := range at {
			if math.Abs(t-s) <= weaveTolerance {
				return i % m, true
			}
		}
		i := 0
		for i+1 < m && t >= at[i+1] {
			i++
		}
		return i, false
	}
	return spherePath{name: "polygon", noun: "polygon", kind: "polygon", period: at[m], segments: samples,
		corners: at[1:m],
		point: func(t float64) Vec3 {
			i, vertex := locate(t)
			if vertex {
				return ps[i]
			}
			p, d := ps[i], starts[i]
			s, c := math.Sincos(t - at[i])
			return snapPole(Vec3{p[0]*c + d[0]*s, p[1]*c + d[1]*s, p[2]*c + d[2]*s})
		},
		derivative: func(t float64) Vec3 {
			i, vertex := locate(t)
			if vertex {
				return starts[i]
			}
			p, d := ps[i], starts[i]
			s, c := math.Sincos(t - at[i])
			return Vec3{d[0]*c - p[0]*s, d[1]*c - p[1]*s, d[2]*c - p[2]*s}
		},
		distinct: true, reportPeriod: true, sides: m,
		side: func(t float64) int { i, _ := locate(t); return i }}
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
	case "polygon":
		return polygonPath(w, samples)
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
