package engine

import "math"

func Reflect(incident, normal Vec) Vec { return incident.Sub(normal.Mul(2 * incident.Dot(normal))) }

// Refract uses eta=nIncident/nTransmitted and a normal facing the incident ray.
// A false result denotes total internal reflection, not a transmitted ray.
func Refract(incident, normal Vec, eta float64) (Vec, bool) {
	if incident.Dot(normal) > 0 {
		normal = normal.Mul(-1)
	}
	c := -incident.Dot(normal)
	k := 1 - eta*eta*(1-c*c)
	if k < 0 {
		return Vec{}, false
	}
	return incident.Mul(eta).Add(normal.Mul(eta*c - math.Sqrt(k))).Unit(), true
}

// envelope of p(t)+lambda*d(t), where det(p'+lambda*d',d)=0. Where
// |det(d,d')| is below floor, the turning is unresolved and there is no
// finite point.
func envelope(p, dp, d, dd Vec, floor float64) (*Vec, float64) {
	den := d.Cross(dd)
	if math.Abs(den) < floor {
		return nil, 0
	}
	s := -d.Cross(dp) / den
	return point(p.Add(d.Mul(s))), s
}

// directionRounding over h bounds the rounding of a unit direction's
// five-point derivative: about 27u at an endpoint's one-sided stencil,
// allowed 64u. As an envelope's floor it follows the parameter's units, so
// constant directions stay parallel while resolved slow turns survive.
const directionRounding = 64 * 0x1p-53

// turningFloor is the envelope floor for a unit direction differentiated
// by s.
func (s stencil) turningFloor() float64 { return directionRounding / s.h }

// stableTurning is stableTangent for a unit direction d, whose derivative
// is du and envelope floor is floor: the full and half stencils can differ
// by rounding alone on a short domain, so the usual jump check may fail by
// that much, one floor for the full stencil and two for the half. A jump,
// such as a refracted ray's at grazing incidence, is far above it.
func (s stencil) stableTurning(d curveFunc, t float64, du, ddu Vec, floor float64) bool {
	if s.stableTangent(d, t, du, ddu) {
		return true
	}
	half, _, _ := s.half(d, t)
	return half.Valid() && du.Valid() && half.Sub(du).Norm() <= 3*floor
}

// rayFloor is the envelope floor for rays leaving a curve at p, where its
// tangent is dp. A ray's direction comes from the tangent's stencil, which
// rounds coordinates at their own magnitude, so the rays turn by rounding
// in proportion to the coordinates' reach normal to the curve over the two
// nested stencils (four steps), per unit of tangent across a step. A
// straight mirror's rays stay parallel at any tilt, position or parameter
// units, while a nearly flat mirror, whose normal coordinate is small,
// keeps its slow turn.
func (s stencil) rayFloor(p, dp Vec) float64 {
	n := dp.Perp().Unit()
	reach := math.Abs(n.X)*(math.Abs(p.X)+4*s.h*math.Abs(dp.X)) + math.Abs(n.Y)*(math.Abs(p.Y)+4*s.h*math.Abs(dp.Y))
	return s.turningFloor() * (1 + reach/(s.h*dp.Norm()))
}

// incident is the direction of the light arriving at g(t): the source's
// angle for parallel light (degrees), or away from a point source, which is
// undefined (NaN) on the source itself.
func (q Request) incident(g curveFunc) curveFunc {
	return func(t float64) Vec {
		if q.Source.Kind == "parallel" {
			a := q.Source.Angle * math.Pi / 180
			return Vec{math.Cos(a), math.Sin(a)}
		}
		p := g(t)
		delta := p.Sub(q.Source.Position)
		if delta.Norm() == 0 || delta.Norm() < 1e-9*(p.Norm()+q.Source.Position.Norm()) {
			return Vec{math.NaN(), math.NaN()}
		}
		return delta.Unit()
	}
}

// direction is the ray leaving g(t), reflected for a catacaustic and
// refracted for a diacaustic. It is undefined (NaN) where g has no tangent
// or the incident light is undefined, and under total internal reflection.
func (q Request) direction(g curveFunc) curveFunc {
	lo, hi := q.Curve.Min, q.Curve.Max
	incident := q.incident(g)
	return func(t float64) Vec {
		dp, ddp := derivatives(g, t, lo, hi)
		if !opticalTangent(g(t), dp, ddp) {
			return Vec{math.NaN(), math.NaN()}
		}
		i := incident(t)
		n := dp.Perp().Unit()
		if q.Kind == "catacaustic" {
			return Reflect(i, n)
		}
		v, ok := Refract(i, n, q.NIncident/q.NTransmitted)
		if !ok {
			return Vec{math.NaN(), math.NaN()}
		}
		return v
	}
}

// opticalTangent uses the curve's own length units for the stationary-point
// guard, as the evolute does. An exactly constant point at the origin has
// no tangent either, even though its relative speed threshold is zero.
func opticalTangent(p, d, dd Vec) bool {
	return p.Valid() && d.Valid() && d.Norm() > 0 && !stationary(p, d, dd)
}
