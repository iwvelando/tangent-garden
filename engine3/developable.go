// Package engine3 defines spatial constructions independently of planar geometry.
package engine3

import (
	"fmt"
	"math"
)

type Vec3 struct {
	X float64 `json:"x"`
	Y float64 `json:"y"`
	Z float64 `json:"z"`
}

func (a Vec3) add(b Vec3) Vec3    { return Vec3{a.X + b.X, a.Y + b.Y, a.Z + b.Z} }
func (a Vec3) sub(b Vec3) Vec3    { return a.add(b.mul(-1)) }
func (a Vec3) mul(s float64) Vec3 { return Vec3{a.X * s, a.Y * s, a.Z * s} }
func (a Vec3) dot(b Vec3) float64 { return a.X*b.X + a.Y*b.Y + a.Z*b.Z }
func (a Vec3) cross(b Vec3) Vec3 {
	return Vec3{a.Y*b.Z - a.Z*b.Y, a.Z*b.X - a.X*b.Z, a.X*b.Y - a.Y*b.X}
}
func (a Vec3) norm() float64 { return math.Sqrt(a.dot(a)) }
func (a Vec3) unit() Vec3    { return a.mul(1 / a.norm()) }

// P and Q are coprime integer winding numbers. Length is the half-length
// of each tangent ruling, measured in world units, not parameter units.
type Request struct {
	Radius  float64 `json:"radius"`
	Tube    float64 `json:"tube"`
	Length  float64 `json:"length"`
	P       int     `json:"p"`
	Q       int     `json:"q"`
	Samples int     `json:"samples"`
	Lines   int     `json:"lines"`
}
type Vertex struct {
	Position Vec3    `json:"position"`
	Normal   Vec3    `json:"normal"`
	Phase    float64 `json:"phase"`
}
type Ruling struct {
	From Vec3 `json:"from"`
	To   Vec3 `json:"to"`
}
type Result struct {
	Base    []Vec3   `json:"base"`
	Minus   []Vec3   `json:"minus"`
	Plus    []Vec3   `json:"plus"`
	Mesh    []Vertex `json:"mesh"`
	Rulings []Ruling `json:"rulings"`
	Radius  float64  `json:"radius"`
	Omitted int      `json:"omitted"`
}

// knot gives r, r′, r″ analytically; no numerical derivative or hidden
// planar coordinate is involved. z is the torus's axial coordinate.
func knot(c Request, t float64) (Vec3, Vec3, Vec3) {
	p, q := float64(c.P), float64(c.Q)
	cp, sp, cq, sq := math.Cos(p*t), math.Sin(p*t), math.Cos(q*t), math.Sin(q*t)
	h := c.Radius + c.Tube*cq
	dh, ddh := -c.Tube*q*sq, -c.Tube*q*q*cq
	return Vec3{h * cp, h * sp, c.Tube * sq},
		Vec3{dh*cp - p*h*sp, dh*sp + p*h*cp, c.Tube * q * cq},
		Vec3{(ddh-p*p*h)*cp - 2*p*dh*sp, (ddh-p*p*h)*sp + 2*p*dh*cp, -c.Tube * q * q * sq}
}

func Compute(c Request) (Result, error) {
	for _, v := range []float64{c.Radius, c.Tube, c.Length} {
		if math.IsNaN(v) || math.IsInf(v, 0) {
			return Result{}, fmt.Errorf("spatial parameters must be finite")
		}
	}
	if c.Radius < 0.1 || c.Radius > 20 || c.Tube < 0.01 || c.Tube >= c.Radius || c.Length <= 0 || c.Length > 20 {
		return Result{}, fmt.Errorf("require 0.1 ≤ radius ≤ 20, 0.01 ≤ tube < radius, and 0 < tangent reach ≤ 20")
	}
	gcd := func(a, b int) int {
		for b != 0 {
			a, b = b, a%b
		}
		return a
	}
	if c.P < 1 || c.P > 8 || c.Q < 1 || c.Q > 9 || gcd(c.P, c.Q) != 1 {
		return Result{}, fmt.Errorf("windings must be coprime integers (p: 1–8, q: 1–9)")
	}
	if c.Samples < 240 || c.Samples > 2400 || c.Lines < 12 || c.Lines > 240 {
		return Result{}, fmt.Errorf("use 240–2400 samples and 12–240 rulings")
	}
	n := c.Samples
	out := Result{Base: make([]Vec3, n+1), Minus: make([]Vec3, n+1), Plus: make([]Vec3, n+1), Mesh: make([]Vertex, 0, n*12), Rulings: make([]Ruling, 0, c.Lines), Radius: c.Radius + c.Tube + c.Length}
	normals := make([]Vec3, n+1)
	valid := make([]bool, n+1)
	for i := 0; i < n; i++ {
		r, v, a := knot(c, 2*math.Pi*float64(i)/float64(n))
		tangent := v.unit() // speed ≥ p(R−r) > 0 throughout the accepted domain
		b := v.cross(a)
		// Use an a priori derivative scale: dividing by the measured |a|
		// would mistake roundoff at zero curvature for a valid normal.
		derivativeScale := float64(c.P*c.P)*(c.Radius+c.Tube) + float64(2*c.P*c.Q+c.Q*c.Q)*c.Tube
		valid[i] = b.norm() > 1e-10*v.norm()*derivativeScale
		if valid[i] {
			normals[i] = b.unit()
		}
		out.Base[i] = r
		out.Minus[i] = r.sub(tangent.mul(c.Length))
		out.Plus[i] = r.add(tangent.mul(c.Length))
	}
	// An exact seam avoids roundoff cracks. Both sheets end at the knot;
	// never create a face spanning the singular locus u=0.
	out.Base[n] = out.Base[0]
	out.Minus[n] = out.Minus[0]
	out.Plus[n] = out.Plus[0]
	normals[n] = normals[0]
	valid[n] = valid[0]
	for i := 0; i < n; i++ {
		if !valid[i] || !valid[i+1] || normals[i].dot(normals[i+1]) < 0 {
			// Do not interpolate a normal through an unresolved reversal,
			// including an inflection between rather than on samples.
			out.Omitted++
			continue
		}
		for _, side := range []int{-1, 1} {
			edge := out.Plus
			if side < 0 {
				edge = out.Minus
			}
			vertex := func(j int, point Vec3) Vertex {
				return Vertex{point, normals[j].mul(float64(side)), float64(j) / float64(n)}
			}
			a, b, c, d := vertex(i, out.Base[i]), vertex(i, edge[i]), vertex(i+1, out.Base[i+1]), vertex(i+1, edge[i+1])
			out.Mesh = append(out.Mesh, a, b, c, b, d, c)
		}
	}
	for i := 0; i < c.Lines; i++ {
		j := i * n / c.Lines
		out.Rulings = append(out.Rulings, Ruling{out.Minus[j], out.Plus[j]})
	}
	return out, nil
}
