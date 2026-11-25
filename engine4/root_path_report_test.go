package engine4

import (
	"errors"
	"fmt"
	"math"
	"os"
	"sort"
	"testing"
	"time"
)

// The #413 research evidence, reproducible with
//
//	ROOT_PATH_REPORT=1 go test ./engine4 -run TestRootPathReport -v
//
// For each corpus path: the engine's winding against the quadrature's, the
// period, the closest approach and its certified bound, the tolerance and
// the measured deviation of both planes' polylines, the refined grid, the
// returned points, the z evaluations certification made, and the median
// native time of five computations. Then each refusal and its field.
func TestRootPathReport(t *testing.T) {
	if os.Getenv("ROOT_PATH_REPORT") == "" {
		t.Skip("set ROOT_PATH_REPORT=1")
	}
	corpus := append([]pathCase{}, pathCases...)
	corpus = append(corpus,
		pathCase{name: "ripple m=6 a=0.64 grazes (study)", p: ripple(1, 0.3, 0.5, 0.64, 6, 3, "plus", 0), samples: 2048},
		pathCase{name: "ripple m=6 a=0.76 across zero", p: ripple(1, 0.3, 0.5, 0.76, 6, 3, "plus", 0), samples: 2048},
		pathCase{name: "ripple m=-2 a=1.4 star (study)", p: ripple(0.7, 0, 0.3, 1.4, -2, 5, "plus", 0), samples: 2048},
		pathCase{name: "ripple m=12 a=3 n=6 N=4096", p: ripple(0.25, 0, 0, 3, 12, 6, "plus", 0), samples: 4096},
		pathCase{name: "fourier f=64 ρ=0.1 n=2", p: fourier(1, 0.3, 0, []RootTerm{{1, 1, 0}, {64, 0.1, 0}}, 2, "plus", 0), samples: 1024},
		pathCase{name: "leaf n=6 N=4096", p: fourier(1, 0, 0, leafTerms, 6, "plus", 0), samples: 4096},
	)
	t.Logf("%-34s %2s %4s %4s %3s %9s %9s %8s %8s %8s %7s %6s %6s %8s",
		"case", "n", "W", "Wq", "P", "closest", "certified", "tol", "dev z", "dev w", "grid", "points", "evals", "native")
	for _, c := range corpus {
		n := degreeOf(c.p)
		q := pathRequest(c, 0, c.period(), 0.37)
		var evaluations int
		certifyCounter = func(k int) { evaluations = k }
		res, err := Compute(q)
		certifyCounter = nil
		if err != nil {
			t.Logf("%-34s refused: %v", c.name, err)
			continue
		}
		var times []float64
		for i := 0; i < 5; i++ {
			start := time.Now()
			_, _ = Compute(q)
			times = append(times, float64(time.Since(start).Microseconds())/1000)
		}
		sort.Float64s(times)
		wq, _ := quadratureWinding(c.p)
		dz, dw := polylineDeviation(c, res, continueRoot(c.p))
		d := res.Root
		t.Logf("%-34s %2d %4d %4d %3d %9.5f %9.5f %8.2e %8.2e %8.2e %7d %6d %6d %6.1fms",
			c.name, n, d.Winding, wq, d.Period, d.Closest, d.ClosestBound, d.Tolerance, dz, dw, d.Refined, res.EmittedPoints, evaluations, times[2])
	}
	refusals := []struct {
		name    string
		p       RootParameters
		samples int
	}{
		{"ripple through 0 (m=2, a=1)", ripple(1, 0, 0, 1, 2, 2, "plus", 0), 1024},
		{"ripple m=6 a=0.7 crossing", ripple(1, 0.3, 0.5, 0.7, 6, 3, "plus", 0), 2048},
		{"circle k=1.04 off-grid", fourier(1, 1.04, 0, []RootTerm{{1, 1, 0.3}}, 2, "plus", 0), 1024},
		{"circle k=1.05 exactly (grazing)", fourier(1, 1.05, 0, []RootTerm{{1, 1, 0.3}}, 2, "plus", 0), 1024},
		{"circle k=1.0500001", fourier(1, 1.0500001, 0, []RootTerm{{1, 1, 0.3}}, 2, "plus", 0), 1024},
		{"circle k=1.050001", fourier(1, 1.050001, 0, []RootTerm{{1, 1, 0.3}}, 2, "plus", 0), 1024},
		{"f=64 ρ=0.5 n=6 N=4096", fourier(1, 0, 0, []RootTerm{{1, 1, 0}, {64, 0.5, 0}}, 6, "plus", 0), 4096},
		{"constant", fourier(1, 0.5, 0, []RootTerm{{0, 1, 0}}, 2, "plus", 0), 1024},
	}
	for _, r := range refusals {
		c := pathCase{p: r.p, samples: r.samples}
		var evaluations int
		certifyCounter = func(k int) { evaluations = k }
		_, err := Compute(pathRequest(c, 0, c.period(), 0))
		certifyCounter = nil
		var fe *FieldError
		field := "—"
		if errors.As(err, &fe) {
			field = fe.Field
		}
		outcome := "admitted"
		if err != nil {
			outcome = fmt.Sprintf("refused under %s after %d z evaluations: %v", field, evaluations, err)
		}
		t.Logf("%-34s %s", r.name, outcome)
	}
	_ = math.Pi
}
