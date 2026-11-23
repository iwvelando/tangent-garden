package engine

import (
	"crypto/sha256"
	"encoding/json"
	"fmt"
	"runtime"
	"testing"
)

// The {7,3} lace's results as main produced them before the tiling became
// a parameter (#389), so generalizing the generator cannot change a single
// bit of the shipped drawing: patches over the cutoffs and star points,
// placed under isometries, and frames along motions.
func laceFingerprints(t *testing.T) map[string]string {
	t.Helper()
	out := map[string]string{}
	sum := func(v any) string {
		b, err := json.Marshal(v)
		if err != nil {
			t.Fatal(err)
		}
		return fmt.Sprintf("%x", sha256.Sum256(b))[:16]
	}
	for _, depth := range []int{0, 1, 3, 5, 8} {
		for _, maxTiles := range []int{1, 29, 400, 1000} {
			for _, u := range []float64{0, 0.3, 1} {
				q := LaceRequest{Tiling: "7,3", Depth: depth, MaxTiles: maxTiles, StarPoint: u}
				r, err := ComputeLace(q)
				if err != nil {
					t.Fatal(err)
				}
				out[fmt.Sprintf("patch %d %d %v", depth, maxTiles, u)] = sum(r)
			}
		}
	}
	isos := []LaceIsometry{{0.3, 1, 0.5}, {0.71814307181038606, -0.2243994752564138, 0}, {0.8, -2, 3}}
	for i, iso := range isos {
		q := LaceRequest{Tiling: "7,3", Depth: 5, MaxTiles: 1000, StarPoint: 0.3, Isometry: &iso}
		r, err := ComputeLace(q)
		if err != nil {
			t.Fatal(err)
		}
		out[fmt.Sprintf("moved %d", i)] = sum(r)
	}
	src, err := NewLaceSource(LaceRequest{Tiling: "7,3", Depth: 5, MaxTiles: 1000, StarPoint: 0.3})
	if err != nil {
		t.Fatal(err)
	}
	for _, p := range []float64{0, 0.125, 0.5, 0.9, 1} {
		f, err := src.Frame(LaceFrameRequest{
			Lace:     LaceRequest{Tiling: "7,3", Depth: 5, MaxTiles: 1000, StarPoint: 0.3, Isometry: &isos[1]},
			Motion:   LaceMotion{Offset: 0.6, Orbits: 1, Turns: -2},
			Progress: p,
		})
		if err != nil {
			t.Fatal(err)
		}
		out[fmt.Sprintf("frame %v", p)] = sum(f)
	}
	return out
}

// Recorded from main's engine on each architecture: arm64 fuses
// multiply-adds that amd64 rounds separately, so the bits differ between
// them, though not between main and this generator on either.
var laceGolden = map[string]map[string]string{
	"arm64": {
		"frame 0":          "34a9e0a7d2753489",
		"frame 0.125":      "52f18192d5f63d7f",
		"frame 0.5":        "7431b0cef8a39b6e",
		"frame 0.9":        "5589b5f6800a1608",
		"frame 1":          "34e7a22593ac0a3a",
		"moved 0":          "74713784be334c1f",
		"moved 1":          "9bf142995d66e3eb",
		"moved 2":          "64d228fe3b69e05f",
		"patch 0 1 0":      "91f15e3c93a8ae7e",
		"patch 0 1 0.3":    "92bbeee3c052e7b3",
		"patch 0 1 1":      "1b7fda0d0cbd2e28",
		"patch 0 1000 0":   "91f15e3c93a8ae7e",
		"patch 0 1000 0.3": "92bbeee3c052e7b3",
		"patch 0 1000 1":   "1b7fda0d0cbd2e28",
		"patch 0 29 0":     "91f15e3c93a8ae7e",
		"patch 0 29 0.3":   "92bbeee3c052e7b3",
		"patch 0 29 1":     "1b7fda0d0cbd2e28",
		"patch 0 400 0":    "91f15e3c93a8ae7e",
		"patch 0 400 0.3":  "92bbeee3c052e7b3",
		"patch 0 400 1":    "1b7fda0d0cbd2e28",
		"patch 1 1 0":      "fb22b456cf237c92",
		"patch 1 1 0.3":    "525d6b8c02af63e0",
		"patch 1 1 1":      "36099063269131a6",
		"patch 1 1000 0":   "78c3451c3e323ad5",
		"patch 1 1000 0.3": "4d2c94bf80c0bbd3",
		"patch 1 1000 1":   "58fddfc0074a0087",
		"patch 1 29 0":     "78c3451c3e323ad5",
		"patch 1 29 0.3":   "4d2c94bf80c0bbd3",
		"patch 1 29 1":     "58fddfc0074a0087",
		"patch 1 400 0":    "78c3451c3e323ad5",
		"patch 1 400 0.3":  "4d2c94bf80c0bbd3",
		"patch 1 400 1":    "58fddfc0074a0087",
		"patch 3 1 0":      "fb22b456cf237c92",
		"patch 3 1 0.3":    "525d6b8c02af63e0",
		"patch 3 1 1":      "36099063269131a6",
		"patch 3 1000 0":   "916b11762dbb4dbd",
		"patch 3 1000 0.3": "57777753abc64a94",
		"patch 3 1000 1":   "36fd0ef7eb52fc54",
		"patch 3 29 0":     "2f0ea7783faacf57",
		"patch 3 29 0.3":   "e8c9ba866106e092",
		"patch 3 29 1":     "941ca06c32003b9c",
		"patch 3 400 0":    "916b11762dbb4dbd",
		"patch 3 400 0.3":  "57777753abc64a94",
		"patch 3 400 1":    "36fd0ef7eb52fc54",
		"patch 5 1 0":      "fb22b456cf237c92",
		"patch 5 1 0.3":    "525d6b8c02af63e0",
		"patch 5 1 1":      "36099063269131a6",
		"patch 5 1000 0":   "b59c4e04276eadc6",
		"patch 5 1000 0.3": "b533ef2869ec87bb",
		"patch 5 1000 1":   "2e00955606fe4dc5",
		"patch 5 29 0":     "2f0ea7783faacf57",
		"patch 5 29 0.3":   "e8c9ba866106e092",
		"patch 5 29 1":     "941ca06c32003b9c",
		"patch 5 400 0":    "67cec23c19edc2a9",
		"patch 5 400 0.3":  "dc75687f4d2ffda6",
		"patch 5 400 1":    "e90bfaf16b19b486",
		"patch 8 1 0":      "fb22b456cf237c92",
		"patch 8 1 0.3":    "525d6b8c02af63e0",
		"patch 8 1 1":      "36099063269131a6",
		"patch 8 1000 0":   "5cd7bfab878054a7",
		"patch 8 1000 0.3": "2823673145b8144f",
		"patch 8 1000 1":   "ecc17de1f76354b0",
		"patch 8 29 0":     "2f0ea7783faacf57",
		"patch 8 29 0.3":   "e8c9ba866106e092",
		"patch 8 29 1":     "941ca06c32003b9c",
		"patch 8 400 0":    "67cec23c19edc2a9",
		"patch 8 400 0.3":  "dc75687f4d2ffda6",
		"patch 8 400 1":    "e90bfaf16b19b486",
	},
	"amd64": {
		"frame 0":          "e1b8f66d61705adc",
		"frame 0.125":      "47d3989eebb6de5a",
		"frame 0.5":        "9591cefe0a61fa12",
		"frame 0.9":        "7be9c4c48a2255f8",
		"frame 1":          "66c2dada6f652986",
		"moved 0":          "e949886f9a4f25c8",
		"moved 1":          "89696095f1a4d9eb",
		"moved 2":          "12e3c7a05ce98366",
		"patch 0 1 0":      "0eed58deff461a83",
		"patch 0 1 0.3":    "2118fd116ea7e7e1",
		"patch 0 1 1":      "5c5c0c8d9e1ffd3e",
		"patch 0 1000 0":   "0eed58deff461a83",
		"patch 0 1000 0.3": "2118fd116ea7e7e1",
		"patch 0 1000 1":   "5c5c0c8d9e1ffd3e",
		"patch 0 29 0":     "0eed58deff461a83",
		"patch 0 29 0.3":   "2118fd116ea7e7e1",
		"patch 0 29 1":     "5c5c0c8d9e1ffd3e",
		"patch 0 400 0":    "0eed58deff461a83",
		"patch 0 400 0.3":  "2118fd116ea7e7e1",
		"patch 0 400 1":    "5c5c0c8d9e1ffd3e",
		"patch 1 1 0":      "97f6ebbfa7eb6d8c",
		"patch 1 1 0.3":    "62766cc295374910",
		"patch 1 1 1":      "763ad0fcfee65fc5",
		"patch 1 1000 0":   "8203322ec8106222",
		"patch 1 1000 0.3": "81a062bb9559073b",
		"patch 1 1000 1":   "b5c813abfa665159",
		"patch 1 29 0":     "8203322ec8106222",
		"patch 1 29 0.3":   "81a062bb9559073b",
		"patch 1 29 1":     "b5c813abfa665159",
		"patch 1 400 0":    "8203322ec8106222",
		"patch 1 400 0.3":  "81a062bb9559073b",
		"patch 1 400 1":    "b5c813abfa665159",
		"patch 3 1 0":      "97f6ebbfa7eb6d8c",
		"patch 3 1 0.3":    "62766cc295374910",
		"patch 3 1 1":      "763ad0fcfee65fc5",
		"patch 3 1000 0":   "97366dd772144f71",
		"patch 3 1000 0.3": "b05541fb599a2fe8",
		"patch 3 1000 1":   "9727609673797dec",
		"patch 3 29 0":     "5657776fa3df296b",
		"patch 3 29 0.3":   "662315faeef6da3b",
		"patch 3 29 1":     "c342944a1b12d02b",
		"patch 3 400 0":    "97366dd772144f71",
		"patch 3 400 0.3":  "b05541fb599a2fe8",
		"patch 3 400 1":    "9727609673797dec",
		"patch 5 1 0":      "97f6ebbfa7eb6d8c",
		"patch 5 1 0.3":    "62766cc295374910",
		"patch 5 1 1":      "763ad0fcfee65fc5",
		"patch 5 1000 0":   "6bbad2c0d992e900",
		"patch 5 1000 0.3": "08e948c02aa23458",
		"patch 5 1000 1":   "655f53575d8b8807",
		"patch 5 29 0":     "5657776fa3df296b",
		"patch 5 29 0.3":   "662315faeef6da3b",
		"patch 5 29 1":     "c342944a1b12d02b",
		"patch 5 400 0":    "518d5e53ab3d3bf0",
		"patch 5 400 0.3":  "f6dcee09dcace166",
		"patch 5 400 1":    "dfac27ef64ffc495",
		"patch 8 1 0":      "97f6ebbfa7eb6d8c",
		"patch 8 1 0.3":    "62766cc295374910",
		"patch 8 1 1":      "763ad0fcfee65fc5",
		"patch 8 1000 0":   "f4479b6768a32add",
		"patch 8 1000 0.3": "aa21b7fa85edfe00",
		"patch 8 1000 1":   "d7b9219599a0b4f8",
		"patch 8 29 0":     "5657776fa3df296b",
		"patch 8 29 0.3":   "662315faeef6da3b",
		"patch 8 29 1":     "c342944a1b12d02b",
		"patch 8 400 0":    "518d5e53ab3d3bf0",
		"patch 8 400 0.3":  "f6dcee09dcace166",
		"patch 8 400 1":    "dfac27ef64ffc495",
	},
}

func TestLaceFingerprintsUnchanged(t *testing.T) {
	golden, ok := laceGolden[runtime.GOARCH]
	if !ok {
		t.Skipf("no fingerprints recorded on %s", runtime.GOARCH)
	}
	fp := laceFingerprints(t)
	if len(fp) != len(golden) {
		t.Fatalf("%d fingerprints, want %d", len(fp), len(golden))
	}
	for k, want := range golden {
		if fp[k] != want {
			t.Errorf("%s: %s, want %s as on main", k, fp[k], want)
		}
	}
}
