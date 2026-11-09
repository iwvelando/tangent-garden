package engine

import (
	"fmt"
	"math"
	"slices"
)

// FourierCorrection moves a vertex and its local arc, without adding points.
// Reach is one of the supported fractions of the closed polygon's perimeter.
type FourierCorrection struct {
	Index  int     `json:"index"`
	Target Vec     `json:"target"`
	Reach  float64 `json:"reach"`
}

// CorrectFourierOutline applies a raised-cosine displacement to the shortest
// cyclic arc distance from Index. Storage, start and traversal are preserved;
// an explicit repeated endpoint aliases vertex zero. The input is never mutated.
func CorrectFourierOutline(points []Vec, q FourierCorrection) ([]Vec, error) {
	if len(points) < 3 || len(points) > FourierFitMaxPoints {
		return nil, fmt.Errorf("correction needs 3–4096 outline points")
	}
	if q.Index < 0 || q.Index >= len(points) {
		return nil, fmt.Errorf("select an outline point to correct")
	}
	if q.Reach != .05 && q.Reach != .1 && q.Reach != .2 {
		return nil, fmt.Errorf("correction reach must be 5%%, 10%% or 20%% of the perimeter")
	}
	valid := func(p Vec) bool { return p.Valid() && math.Abs(p.X) <= 1e5 && math.Abs(p.Y) <= 1e5 }
	if !valid(q.Target) {
		return nil, fmt.Errorf("correction coordinates must be finite and within ±100000")
	}
	for _, p := range points {
		if !valid(p) {
			return nil, fmt.Errorf("outline coordinates must be finite and within ±100000")
		}
	}
	n := len(points)
	if points[n-1] == points[0] {
		n--
	}
	index := q.Index % n
	lengths := make([]float64, n+1)
	for i := 0; i < n; i++ {
		lengths[i+1] = lengths[i] + points[(i+1)%n].Sub(points[i]).Norm()
	}
	total := lengths[n]
	if total < 1e-6 {
		return nil, fmt.Errorf("outline total length must be at least 0.000001")
	}
	out := append([]Vec(nil), points...)
	delta := q.Target.Sub(points[index])
	for i := 0; i < n; i++ {
		d := math.Abs(lengths[i] - lengths[index])
		d = math.Min(d, total-d)
		if d < q.Reach*total {
			weight := (1 + math.Cos(math.Pi*d/(q.Reach*total))) / 2
			out[i] = points[i].Add(delta.Mul(weight))
			if !valid(out[i]) {
				return nil, fmt.Errorf("corrected outline coordinates must be finite and within ±100000")
			}
		}
	}
	out[index] = q.Target
	if n < len(out) {
		out[n] = out[0]
	}
	return out, nil
}

// CloseFourierOutline divides the straight segment from an outline's last point
// back to its first at about the outline's mean edge length, so a correction can
// bend that segment locally like any other arc. The polygon is unchanged, and so
// is its fit. It stops at the point limit, and leaves unchanged anything
// FitFourier refuses: chord points must not supply missing distinct points.
func CloseFourierOutline(points []Vec) []Vec {
	out := append([]Vec(nil), points...)
	if len(points) < 3 || len(points) >= FourierFitMaxPoints {
		return out
	}
	distinct := make([]Vec, 0, 3)
	length, edges := 0., 0
	for j, p := range points {
		if !p.Valid() || math.Abs(p.X) > 1e5 || math.Abs(p.Y) > 1e5 {
			return out
		}
		if len(distinct) < 3 && !slices.Contains(distinct, p) {
			distinct = append(distinct, p)
		}
		if j > 0 && p != points[j-1] {
			length += p.Sub(points[j-1]).Norm()
			edges++
		}
	}
	if len(distinct) < 3 {
		return out
	}
	from, to := points[len(points)-1], points[0]
	inner := int(math.Ceil(to.Sub(from).Norm()*float64(edges)/length)) - 1
	inner = min(inner, FourierFitMaxPoints-len(points))
	for j := 1; j <= inner; j++ {
		u := float64(j) / float64(inner+1)
		out = append(out, Vec{from.X + (to.X-from.X)*u, from.Y + (to.Y-from.Y)*u})
	}
	return out
}
