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

// Envelope of p(t)+lambda*d(t), where det(p'+lambda*d',d)=0.
func Envelope(p, dp, d, dd Vec) (*Vec, float64) {
	den := d.Cross(dd)
	if math.Abs(den) < 1e-9 {
		return nil, 0
	}
	s := -d.Cross(dp) / den
	return point(p.Add(d.Mul(s))), s
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
		delta := g(t).Sub(q.Source.Position)
		if delta.Norm() < 1e-9 {
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
		dp, _ := derivatives(g, t, lo, hi)
		if dp.Norm() < 1e-9 {
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
