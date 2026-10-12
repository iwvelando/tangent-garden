package engine

import "math"

type Vec struct {
	X float64 `json:"x"`
	Y float64 `json:"y"`
}

func (a Vec) Add(b Vec) Vec       { return Vec{a.X + b.X, a.Y + b.Y} }
func (a Vec) Sub(b Vec) Vec       { return Vec{a.X - b.X, a.Y - b.Y} }
func (a Vec) Mul(k float64) Vec   { return Vec{a.X * k, a.Y * k} }
func (a Vec) Dot(b Vec) float64   { return a.X*b.X + a.Y*b.Y }
func (a Vec) Cross(b Vec) float64 { return a.X*b.Y - a.Y*b.X }
func (a Vec) Norm() float64       { return math.Hypot(a.X, a.Y) }
func (a Vec) Perp() Vec           { return Vec{-a.Y, a.X} }
func (a Vec) Unit() Vec           { return a.Mul(1 / a.Norm()) }
func finite(x float64) bool       { return !math.IsNaN(x) && !math.IsInf(x, 0) }
func (a Vec) Valid() bool         { return finite(a.X) && finite(a.Y) }
func point(a Vec) *Vec {
	if !a.Valid() {
		return nil
	}
	return &a
}

// binade is the largest power of two at or below x, and 1 for an x that is
// not positive and finite. A tolerance of a fraction of x plus its binade is
// relative to x, and rounds exactly as one with 1 in place of the binade
// wherever x lies from 1 to 2.
func binade(x float64) float64 {
	if !(x > 0) || math.IsInf(x, 0) {
		return 1
	}
	_, e := math.Frexp(x)
	return math.Ldexp(1, max(-1000, min(1000, e-1)))
}
