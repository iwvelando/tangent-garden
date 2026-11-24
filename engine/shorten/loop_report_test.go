package shorten

import (
	"fmt"
	"math"
	"os"
	"strings"
	"testing"
	"time"
)

// LOOP_REPORT=1 prints #409's admission and evolution tables.
func TestLoopReport(t *testing.T) {
	if os.Getenv("LOOP_REPORT") == "" {
		t.Skip("set LOOP_REPORT=1")
	}
	var b strings.Builder
	fmt.Fprintln(&b, "| case | admission | R | κR range | neck/R | thick/R | star | polar | arc | bgn |")
	fmt.Fprintln(&b, "|---|---|---|---|---|---|---|---|---|---|")
	for _, c := range append(fourierCorpus(t), outlineCorpus()...) {
		src, err := admit(c.loop)
		if err != nil {
			fmt.Fprintf(&b, "| %s | refused: %v |||||||||\n", c.name, err)
			continue
		}
		a := src.adm
		row := fmt.Sprintf("| %s | %s cert=%v (%d) | %.3g | %.3g…%.3g | %.3g | %.3g | %.3f |", c.name, a.Source, a.Certified, a.Samples, a.Radius, a.MinKappa, a.MaxKappa, a.Neck, a.Thickness, a.Star)
		for _, arm := range []string{"polar", "arc", "bgn"} {
			start := time.Now()
			f, err := SolveLoop(LoopRequest{Loop: c.loop, Solver: arm, Horizon: 0.999})
			if err != nil {
				row += fmt.Sprintf(" %s |", short(err.Error()))
				continue
			}
			r, _ := f.Frames(nil)
			end, _ := f.Sample(r.End)
			area := math.Abs(end.Area-(r.Area0-2*math.Pi*r.End)) / r.Area0
			row += fmt.Sprintf(" N=%d end %.3fT %s, area err %.1e, %d steps, %.1fM upd, seed remesh %.1e, remeshed %d (%.1e), %.2fs |", f.Admission.Nodes, r.End/r.Extinction, r.Stop, area, r.Stats.Accepted, float64(r.Stats.NodeUpdates)/1e6, f.Admission.Remesh, r.Stats.Remeshed, r.Stats.RemeshError, time.Since(start).Seconds())
		}
		fmt.Fprintln(&b, row)
	}
	t.Log("\n" + b.String())
}

func short(s string) string {
	if len(s) > 90 {
		return s[:90] + "…"
	}
	return s
}
