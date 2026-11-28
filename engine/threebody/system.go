// Package threebody integrates the planar Newtonian problem of three point
// masses, G = 1, as one coupled system: twelve state components, positions
// then velocities, body by body: the history behind the three-body study
// (docs/mathematics.md#three-bodies).
//
// The driver is written for any small number of bodies so the analytic
// two-body (Kepler) problem can test it; requests admit exactly three.
package threebody

import "math"

// system is the gravitational field of n point masses. The pair table lists
// every unordered pair once, (1,2), (1,3), (2,3) for three bodies, and each
// pair contributes equal and opposite accelerations.
type system struct {
	n     int
	m     []float64
	pairs [][2]int
}

func newSystem(m []float64) *system {
	s := &system{n: len(m), m: append([]float64{}, m...)}
	for i := 0; i < s.n; i++ {
		for j := i + 1; j < s.n; j++ {
			s.pairs = append(s.pairs, [2]int{i, j})
		}
	}
	return s
}

// accel writes the accelerations of the positions in y (the first 2n
// components) into a, and reports whether every one is finite.
func (s *system) accel(y, a []float64) bool {
	for q := range a[:2*s.n] {
		a[q] = 0
	}
	for _, p := range s.pairs {
		i, j := p[0], p[1]
		dx, dy := y[2*j]-y[2*i], y[2*j+1]-y[2*i+1]
		r2 := dx*dx + dy*dy
		inv := 1 / (r2 * math.Sqrt(r2))
		a[2*i] += s.m[j] * dx * inv
		a[2*i+1] += s.m[j] * dy * inv
		a[2*j] -= s.m[i] * dx * inv
		a[2*j+1] -= s.m[i] * dy * inv
	}
	for _, v := range a[:2*s.n] {
		if math.IsNaN(v) || math.IsInf(v, 0) {
			return false
		}
	}
	return true
}

// deriv is the first-order system: positions move with the velocities, and
// velocities with the accelerations.
func (s *system) deriv(_ float64, y, out []float64) {
	k := 2 * s.n
	copy(out[:k], y[k:2*k])
	s.accel(y, out[k:2*k])
}

// energy is the kinetic plus potential energy.
func (s *system) energy(y []float64) float64 {
	k := 2 * s.n
	e := 0.0
	for i, m := range s.m {
		vx, vy := y[k+2*i], y[k+2*i+1]
		e += m * (vx*vx + vy*vy) / 2
	}
	for _, p := range s.pairs {
		i, j := p[0], p[1]
		e -= s.m[i] * s.m[j] / math.Hypot(y[2*j]-y[2*i], y[2*j+1]-y[2*i+1])
	}
	return e
}

// momentum is the total linear momentum.
func (s *system) momentum(y []float64) [2]float64 {
	k := 2 * s.n
	var p [2]float64
	for i, m := range s.m {
		p[0] += m * y[k+2*i]
		p[1] += m * y[k+2*i+1]
	}
	return p
}

// angular is the total angular momentum about the origin.
func (s *system) angular(y []float64) float64 {
	k := 2 * s.n
	l := 0.0
	for i, m := range s.m {
		l += m * (y[2*i]*y[k+2*i+1] - y[2*i+1]*y[k+2*i])
	}
	return l
}

// center is the center of mass, for a total mass of 1 or not.
func (s *system) center(y []float64) [2]float64 {
	var c [2]float64
	total := 0.0
	for i, m := range s.m {
		c[0] += m * y[2*i]
		c[1] += m * y[2*i+1]
		total += m
	}
	return [2]float64{c[0] / total, c[1] / total}
}

// closest is the smallest pair separation and its index in the pair table.
func (s *system) closest(y []float64) (float64, int) {
	best, at := math.Inf(1), -1
	for k, p := range s.pairs {
		i, j := p[0], p[1]
		if d := math.Hypot(y[2*j]-y[2*i], y[2*j+1]-y[2*i+1]); d < best || at < 0 {
			best, at = d, k
		}
	}
	return best, at
}
