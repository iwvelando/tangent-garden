package threebody

import "math"

// The reference method, written independently of Dormand–Prince: a Taylor
// series of every position, its coefficients from the recurrences of the
// Newtonian field, generic over its arithmetic. In double-double it is the
// reference; in float64 it is a second candidate for production.

// number is an arithmetic the Taylor method runs in.
type number[T any] interface {
	Add(T) T
	Sub(T) T
	Mul(T) T
	Div(T) T
	Scale(float64) T
	Sqrt() T
	Float() float64
}

// f64 is float64 as a number.
type f64 float64

func (a f64) Add(b f64) f64       { return a + b }
func (a f64) Sub(b f64) f64       { return a - b }
func (a f64) Mul(b f64) f64       { return a * b }
func (a f64) Div(b f64) f64       { return a / b }
func (a f64) Scale(c float64) f64 { return a * f64(c) }
func (a f64) Sqrt() f64           { return f64(math.Sqrt(float64(a))) }
func (a f64) Float() float64      { return float64(a) }
func fromFloat(x float64) f64     { return f64(x) }
func floats[T number[T]](v []T) []float64 {
	out := make([]float64, len(v))
	for i, x := range v {
		out[i] = x.Float()
	}
	return out
}

// inverseCube is coefficient k of u = s^(−3/2), from u′s = α s′u with
// α = −3/2: k s₀ uₖ = Σ_{m=1..k} (α m − (k − m)) sₘ u_{k−m}.
func inverseCube[T number[T]](s, u []T, k int) T {
	if k == 0 {
		// 1/(s₀√s₀), with the generic one s₀/s₀.
		return s[0].Div(s[0]).Div(s[0].Mul(s[0].Sqrt()))
	}
	var sum T
	for m := 1; m <= k; m++ {
		sum = sum.Add(s[m].Mul(u[k-m]).Scale(-1.5*float64(m) - float64(k-m)))
	}
	return sum.Div(s[0].Scale(float64(k)))
}

// taylorStats counts a run's steps.
type taylorStats struct{ steps int }

// taylorRun integrates n bodies with masses m from y0 at times[0], positions
// then velocities, and returns the state at each of the increasing times,
// in the method's own arithmetic. The series has the given order; each step
// is as long as the last two coefficients allow for the tolerance relative
// to 1 + max |r| (Jorba and Zou's rule).
func taylorRun[T number[T]](from func(float64) T, m []float64, y0 []float64, times []float64, tol float64, order int) ([][]T, taylorStats) {
	n, p := len(m), order
	mass := make([]T, n)
	for i := range m {
		mass[i] = from(m[i])
	}
	var pairs [][2]int
	for i := 0; i < n; i++ {
		for j := i + 1; j < n; j++ {
			pairs = append(pairs, [2]int{i, j})
		}
	}
	series := func(rows int) [][]T {
		out := make([][]T, rows)
		for q := range out {
			out[q] = make([]T, p+1)
		}
		return out
	}
	X := series(2 * n)
	dx, dy, s, u := series(len(pairs)), series(len(pairs)), series(len(pairs)), series(len(pairs))
	acc := make([]T, 2*n)
	pos, vel := make([]T, 2*n), make([]T, 2*n)
	for q := 0; q < 2*n; q++ {
		pos[q], vel[q] = from(y0[q]), from(y0[2*n+q])
	}
	// The state at offset d along the current series.
	at := func(d T) []T {
		out := make([]T, 4*n)
		for q := 0; q < 2*n; q++ {
			x, v := X[q][p], X[q][p].Scale(float64(p))
			for k := p - 1; k >= 0; k-- {
				x = x.Mul(d).Add(X[q][k])
				if k >= 1 {
					v = v.Mul(d).Add(X[q][k].Scale(float64(k)))
				}
			}
			out[q], out[2*n+q] = x, v
		}
		return out
	}
	t := from(times[0])
	out := make([][]T, 0, len(times))
	var stats taylorStats
	for {
		for q := 0; q < 2*n; q++ {
			X[q][0], X[q][1] = pos[q], vel[q]
		}
		for k := 0; k+2 <= p; k++ {
			for q := range acc {
				acc[q] = from(0)
			}
			for c, pr := range pairs {
				i, j := pr[0], pr[1]
				dx[c][k] = X[2*j][k].Sub(X[2*i][k])
				dy[c][k] = X[2*j+1][k].Sub(X[2*i+1][k])
				var sum T
				for l := 0; l <= k; l++ {
					sum = sum.Add(dx[c][l].Mul(dx[c][k-l])).Add(dy[c][l].Mul(dy[c][k-l]))
				}
				s[c][k] = sum
				u[c][k] = inverseCube(s[c], u[c], k)
				var wx, wy T
				for l := 0; l <= k; l++ {
					wx = wx.Add(dx[c][l].Mul(u[c][k-l]))
					wy = wy.Add(dy[c][l].Mul(u[c][k-l]))
				}
				acc[2*i] = acc[2*i].Add(mass[j].Mul(wx))
				acc[2*i+1] = acc[2*i+1].Add(mass[j].Mul(wy))
				acc[2*j] = acc[2*j].Sub(mass[i].Mul(wx))
				acc[2*j+1] = acc[2*j+1].Sub(mass[i].Mul(wy))
			}
			for q := range acc {
				// Divided by the exact integer: 1/((k+1)(k+2)) rounded to
				// float64 would limit the reference to float64 accuracy.
				X[q][k+2] = acc[q].Div(from(float64((k + 1) * (k + 2))))
			}
		}
		scale := 1.0
		for q := range pos {
			scale = math.Max(scale, 1+math.Abs(pos[q].Float()))
		}
		h := math.Inf(1)
		for _, k := range []int{p - 1, p} {
			norm := 0.0
			for q := range X {
				norm = math.Max(norm, math.Abs(X[q][k].Float()))
			}
			if norm > 0 {
				h = math.Min(h, math.Pow(tol*scale/norm, 1/float64(k)))
			}
		}
		h *= math.Exp(-0.7 / float64(p-1))
		end := t.Float() + h
		for len(out) < len(times) && times[len(out)] <= end {
			out = append(out, at(from(times[len(out)]).Sub(t)))
		}
		if len(out) == len(times) {
			return out, stats
		}
		next := at(from(h))
		copy(pos, next[:2*n])
		copy(vel, next[2*n:])
		t = t.Add(from(h))
		stats.steps++
	}
}
