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
