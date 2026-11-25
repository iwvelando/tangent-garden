package engine

import (
	"fmt"
	"math"
	"os"
	"testing"
	"time"
)

// TestDiskModeReport prints the #415 research evidence: Bessel accuracy,
// and per mode and grid, the traced nodal set against the exact one with
// the work and native time. Run it with
//
//	DISK_REPORT=1 go test ./engine -run TestDiskModeReport -v
func TestDiskModeReport(t *testing.T) {
	if os.Getenv("DISK_REPORT") == "" {
		t.Skip("set DISK_REPORT=1 to print the disk-mode evidence")
	}
	worst := 0.0
	for m := 0; m <= maxBesselOrder; m++ {
		for i := 0; i <= 640; i++ {
			x := maxBesselArg * float64(i) / 640
			worst = math.Max(worst, math.Abs(besselJ(m, x)-refBessel(m, x)))
		}
	}
	start := time.Now()
	s := 0.0
	for i := range 1000000 {
		s += besselJ(maxDiskOrder, besselZeros[maxDiskOrder][maxDiskRing-1]*float64(i)/1e6)
	}
	fmt.Printf("J_m, m ≤ %d, x ≤ %d: largest error %.2g against the 320-bit series; %.0f ns per evaluation at the largest mode (%g)\n\n",
		maxBesselOrder, maxBesselArg, worst, float64(time.Since(start).Nanoseconds())/1e6, s*0)
	fmt.Println("| (m, k) | cells | contours | points | max |u| at a vertex | chords beyond center (cells) | center deviation / gap (cells) | boundary ends | native |")
	fmt.Println("|---|---|---|---|---|---|---|---|---|")
	for _, mk := range [][2]int{{0, 6}, {1, 2}, {2, 3}, {5, 3}, {8, 5}, {12, 10}} {
		m, k := mk[0], mk[1]
		for _, cells := range []int{80, 160, 320, 1024} {
			v := diskStudy(m, k, 1, cells)
			a := 0.37
			if m == 0 {
				a = 0
			}
			start := time.Now()
			res, _, err := v.contours(a, 24)
			elapsed := time.Since(start)
			if err != nil {
				t.Fatal(err)
			}
			h := 2.08 / float64(cells)
			own, u := exactNodal(m, k, 1, a), ownMode(m, k, 1, a)
			center := (float64(m)/math.Pi + 1.2) * h
			var resid, beyond, centerDev, centerGap float64
			points, ends := 0, 0
			for _, c := range res.Curve.Contours {
				n := len(c.Points)
				points += n
				for _, p := range c.Points {
					resid = math.Max(resid, math.Abs(u(p)))
				}
				if !c.Closed {
					for _, p := range []Vec{c.Points[0], c.Points[n-1]} {
						if math.Abs(p.Norm()-1) <= 1e-12 {
							ends++
						}
					}
				}
				last := n - 1
				if c.Closed {
					last = n
				}
				for j := 0; j < last; j++ {
					p, q := c.Points[j], c.Points[(j+1)%n]
					d := own.dist(p.Add(q).Mul(.5)) / h
					if math.Min(p.Norm(), q.Norm()) <= center {
						centerDev = math.Max(centerDev, d)
					} else {
						beyond = math.Max(beyond, d)
					}
				}
			}
			ix := indexChords([]LevelSet{res.Curve}, h)
			for _, p := range own.points(h / 4) {
				if p.Norm() <= center {
					centerGap = math.Max(centerGap, ix.near(p, 6)/h)
				}
			}
			fmt.Printf("| (%d, %d) | %d | %d | %d | %.1e | %.3f (tolerance %.3f) | %.2f / %.2f | %d of %d | %.1f ms |\n",
				m, k, cells, len(res.Curve.Contours), points, resid, beyond, drawingTolerance*2.08/h, centerDev, centerGap, ends, 2*m, float64(elapsed.Microseconds())/1000)
		}
	}
}
