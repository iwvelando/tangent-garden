package physical

import (
	"fmt"
	"math"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
	"time"

	"tangentgarden/engine"
)

// corpusCase is one frozen research fixture (#543).
type corpusCase struct {
	name string
	q    LaceSolidRequest
}

func eight() []engine.Term {
	return []engine.Term{
		{Frequency: 1, Radius: 0.5, Phase: -math.Pi / 2}, {Frequency: -1, Radius: 0.5, Phase: math.Pi / 2},
		{Frequency: 2, Radius: 0.25}, {Frequency: -2, Radius: 0.25, Phase: math.Pi},
	}
}

// researchCorpus is the corpus recorded on the issue before code: two
// tilings and more, straight and curved motifs, an edited loop with a
// crossing, sparse, dense, tangent, disconnected, underfilled and
// unprintable cases, at 60/120/180 mm with 2 and 3 mm walls.
func researchCorpus() []corpusCase {
	var out []corpusCase
	add := func(name string, l engine.LaceRequest, d, line float64, treatment, rim string, clip float64) {
		q := solidRequest(l, d, line, treatment, rim)
		q.Clip = clip
		out = append(out, corpusCase{name, q})
	}
	star := starLace(5, 1000)
	for _, d := range []float64{60, 120, 180} {
		for _, line := range []float64{2, 3} {
			for _, tr := range []string{Raised, Recessed} {
				add(fmt.Sprintf("star73-%g-%g-%s", d, line, tr), star, d, line, tr, RimMotif, 0)
			}
		}
	}
	add("star73-120-2-rim", star, 120, 2, Raised, RimClean, 0)
	add("star73-120-2-crop0.5", star, 120, 2, Raised, RimCrop, 0.5)
	petals := engine.LaceRequest{Tiling: "5,4", Depth: 5, MaxTiles: 1000, StarPoint: 0.3, Motif: "petals", Size: 0.7}
	add("petals54-120-2", petals, 120, 2, Raised, RimMotif, 0)
	add("petals54-120-2-recessed-rim", petals, 120, 2, Recessed, RimClean, 0)
	leaves := engine.LaceRequest{Tiling: "7,3", Depth: 5, MaxTiles: 1000, StarPoint: 0.3, Motif: "leaves", Size: 0.6}
	add("leaves73-150-2", leaves, 150, 2, Raised, RimMotif, 0)
	tangent := engine.LaceRequest{Tiling: "7,3", Depth: 5, MaxTiles: 1000, StarPoint: 0.3, Motif: "rings", Size: 1}
	add("rings73-tangent-120-2", tangent, 120, 2, Raised, RimMotif, 0)
	tpet := engine.LaceRequest{Tiling: "5,4", Depth: 5, MaxTiles: 1000, StarPoint: 0.3, Motif: "petals", Size: 1}
	add("petals54-tangent-120-2", tpet, 120, 2, Raised, RimMotif, 0)
	apart := engine.LaceRequest{Tiling: "4,5", Depth: 6, MaxTiles: 1000, StarPoint: 0.3, Motif: "rings", Size: 0.6}
	add("rings45-apart-150-2", apart, 150, 2, Raised, RimMotif, 0)
	loop := engine.LaceRequest{Tiling: "7,3", Depth: 5, MaxTiles: 1000, StarPoint: 0.3, Motif: "loop", Size: 0.9, Loop: eight()}
	add("loop-eight-180-2-crop0.3", loop, 180, 2, Raised, RimCrop, 0.3)
	add("loop-eight-120-2", loop, 120, 2, Raised, RimMotif, 0)
	add("sparse-depth2-120-2", starLace(2, 1000), 120, 2, Raised, RimMotif, 0)
	add("underfilled-depth1-180-2", starLace(1, 1000), 180, 2, Raised, RimMotif, 0)
	dense := starLace(8, 1000)
	add("dense73-depth8-180-2-rim", dense, 180, 2, Raised, RimClean, 0)
	add("dense73-depth8-180-2-rim0.98", dense, 180, 2, Raised, RimClean, 0.98)
	moved := starLace(5, 1000)
	moved.Isometry = &engine.LaceIsometry{Offset: 0.5, Direction: 0.3, Rotation: 0.2}
	add("moved73-120-2-crop0.4", moved, 120, 2, Recessed, RimCrop, 0.4)
	add("unprintable-20-3", starLace(5, 1000), 20, 3, Raised, RimMotif, 0)
	// The owner's first exploration: rings with tile sides, recessed at
	// 210 mm, a rim at 0.95 on a 0.3 mm grid, then a crop turned face
	// down, and openwork.
	rings := engine.LaceRequest{Tiling: "7,3", Depth: 5, MaxTiles: 1000, StarPoint: 0.3, Motif: "rings", Size: 0.6}
	owner := func(name string, d float64, tr, rim string, clip float64, edit func(*LaceSolidRequest)) {
		q := solidRequest(rings, d, 2, tr, rim)
		q.Clip, q.Grid, q.Lines = clip, 0.3, LinesBoth
		edit(&q)
		out = append(out, corpusCase{name, q})
	}
	owner("owner-rings-sides-210-rim0.95", 210, Recessed, RimClean, 0.95, func(q *LaceSolidRequest) {})
	owner("owner-rings-sides-210-rim0.95-simplify", 210, Recessed, RimClean, 0.95, func(q *LaceSolidRequest) { q.Design.Simplify = true })
	owner("owner-rings-sides-210-crop0.8-facedown", 210, Recessed, RimCrop, 0.8, func(q *LaceSolidRequest) {
		q.Design.Simplify, q.Design.FaceDown = true, true
	})
	owner("owner-rings-sides-150-openwork-crop0.8", 150, Raised, RimCrop, 0.8, func(q *LaceSolidRequest) {
		q.Design.Simplify, q.Design.Floor = true, 0
	})
	add("star73-150-2-openwork", starLace(4, 1000), 150, 2, Raised, RimMotif, 0)
	out[len(out)-1].q.Design.Floor = 0
	return out
}

// TestResearchReport prints the corpus's measurements and writes each
// package to PHYSICAL_OUT, when PHYSICAL_REPORT is set.
func TestResearchReport(t *testing.T) {
	if os.Getenv("PHYSICAL_REPORT") == "" {
		t.Skip("set PHYSICAL_REPORT=1")
	}
	out := os.Getenv("PHYSICAL_OUT")
	for _, c := range researchCorpus() {
		runtime.GC()
		var before, after runtime.MemStats
		runtime.ReadMemStats(&before)
		// The heap's peak, sampled every few milliseconds while building.
		stop := make(chan struct{})
		peak := make(chan uint64)
		go func() {
			var top uint64
			var m runtime.MemStats
			for {
				select {
				case <-stop:
					peak <- top
					return
				default:
				}
				runtime.ReadMemStats(&m)
				top = max(top, m.HeapAlloc)
				time.Sleep(3 * time.Millisecond)
			}
		}()
		s, err := BuildLaceSolid(c.q, DefaultLimits)
		close(stop)
		heapPeak := <-peak
		runtime.ReadMemStats(&after)
		if err != nil {
			t.Logf("%-32s REFUSED: %v", c.name, err)
			continue
		}
		var failing []string
		for _, it := range s.Checks {
			if it.Required && it.Status != StatusPass || it.Status == StatusWarn {
				failing = append(failing, fmt.Sprintf("%s:%s(%.3g/%.3g)", it.ID, it.Status, it.Value, it.Limit))
			}
		}
		total := 0.0
		for _, v := range s.Stats.Millis {
			total += v
		}
		t.Logf("%-32s valid=%-5v tiles %3d/%3d (%s r=%.3f, %d rounds, %d failed) pieces %d strokes %d nodes %d evals %.1fM verts %d tris %d pairs %.2fM | ms total %.0f %v | mesh %.1f MB pkg %.2f MB work≈%.0f MB alloc %.0f MB peak heap %.0f MiB | dev %.4f mm specks %d | %s",
			c.name, s.Validated, s.Cutoff.Admitted, s.Source.Tiles, s.Cutoff.Reason, s.Cutoff.Radius, s.Cutoff.Rounds, s.Cutoff.FailedRounds,
			s.Source.Pieces, s.Stats.Strokes, s.Stats.Nodes, float64(s.Stats.Evaluations)/1e6, s.Stats.Vertices, s.Stats.Triangles, float64(s.Stats.PairTests)/1e6,
			total, roundMillis(s.Stats.Millis), float64(s.Stats.MeshBytes)/1e6, float64(s.Stats.PackageBytes)/1e6, float64(s.Stats.WorkingBytes)/1e6,
			float64(after.TotalAlloc-before.TotalAlloc)/1e6, float64(heapPeak-before.HeapAlloc)/(1<<20), s.Stats.Deviation, s.Stats.Specks, strings.Join(failing, " "))
		if out != "" {
			if err := os.WriteFile(filepath.Join(out, c.name+".3mf"), s.Package, 0o644); err != nil {
				t.Fatal(err)
			}
		}
	}
}

func roundMillis(m map[string]float64) string {
	var parts []string
	for _, k := range []string{"lace", "cutoff", "cells", "contour", "solid", "check", "package"} {
		parts = append(parts, fmt.Sprintf("%s %.0f", k, m[k]))
	}
	return strings.Join(parts, ", ")
}

// TestCoupons writes the owner's physical coupons to PHYSICAL_COUPONS: a
// raised and a recessed 80 mm star plaque with 2 mm walls for each
// printer, with heights that are whole layers on both profiles (1.4, 2.0,
// 2.6 and 3.2 mm are 0.2 + 0.6k).
func TestCoupons(t *testing.T) {
	out := os.Getenv("PHYSICAL_COUPONS")
	if out == "" {
		t.Skip("set PHYSICAL_COUPONS to a directory")
	}
	for _, prof := range DefaultProfiles() {
		for _, d := range []Design{
			{Treatment: Raised, Line: 2, Floor: 1.4, Relief: 1.2},
			{Treatment: Recessed, Line: 2, Floor: 2, Relief: 1.2},
		} {
			q := LaceSolidRequest{Lace: starLace(5, 1000), Diameter: 80, Design: d, Rim: RimMotif, Profile: prof}
			s, err := BuildLaceSolid(q, DefaultLimits)
			if err != nil {
				t.Fatal(err)
			}
			name := fmt.Sprintf("coupon-%s-80mm-%s.3mf", d.Treatment, strings.SplitN(prof.ID, "-", 3)[1])
			var notes []string
			for _, c := range s.Checks {
				if c.Status != StatusPass {
					notes = append(notes, fmt.Sprintf("%s:%s %s", c.ID, c.Status, c.Detail))
				}
			}
			t.Logf("%s validated=%v tiles %d/%d, %d triangles, top %.1f mm; %s", name, s.Validated, s.Cutoff.Admitted, s.Source.Tiles, s.Stats.Triangles, math.Max(s.Levels.Plan, s.Levels.Rest), strings.Join(notes, "; "))
			if err := os.WriteFile(filepath.Join(out, name), s.Package, 0o644); err != nil {
				t.Fatal(err)
			}
		}
	}
}
