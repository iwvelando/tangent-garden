package engine3

import (
	"bufio"
	"bytes"
	"math"
	"os/exec"
	"runtime"
	"slices"
	"strings"
	"testing"
)

// fmin and fmax must be the builtins bit for bit, so that the rasterizer's
// bins do not change: NaNs, both zeros and both infinities included.
func TestFminFmaxMatchBuiltins(t *testing.T) {
	values := []float64{
		math.NaN(), math.Inf(1), math.Inf(-1), 0, math.Copysign(0, -1),
		1, -1, 0.5, -0.5, math.SmallestNonzeroFloat64, -math.SmallestNonzeroFloat64,
		math.MaxFloat64, -math.MaxFloat64, 1 + 1e-16, 960, math.Nextafter(960, 0),
	}
	same := func(a, b float64) bool {
		return math.IsNaN(a) && math.IsNaN(b) || math.Float64bits(a) == math.Float64bits(b)
	}
	for _, x := range values {
		for _, y := range values {
			if got, want := fmin(x, y), min(x, y); !same(got, want) {
				t.Errorf("fmin(%v, %v) = %v (%x), want %v (%x)", x, y, got, math.Float64bits(got), want, math.Float64bits(want))
			}
			if got, want := fmax(x, y), max(x, y); !same(got, want) {
				t.Errorf("fmax(%v, %v) = %v (%x), want %v (%x)", x, y, got, math.Float64bits(got), want, math.Float64bits(want))
			}
		}
	}
}

// On WASM the builtin float min and max, and math.Min and math.Max,
// compile to calls, which cost more than the rest of a receiver bin's
// arithmetic: they made the rasterizer about 70% of a refined receiver's
// frame. The rasterizer's loops, and the curve evaluator and chord distance
// that refinement calls for every point between samples, must keep calling
// the inlined fmin and fmax instead.
func TestHotLoopsInlineMinMaxOnWASM(t *testing.T) {
	if testing.Short() {
		t.Skip("compiles the package for WASM")
	}
	cmd := exec.Command("go", "build", "-gcflags=-S", "-o", "/dev/null", ".")
	cmd.Env = append(cmd.Environ(), "GOOS=js", "GOARCH=wasm")
	var listing bytes.Buffer
	cmd.Stdout, cmd.Stderr = &listing, &listing
	if err := cmd.Run(); err != nil {
		t.Fatalf("building for WASM on %s: %v\n%s", runtime.GOARCH, err, listing.String())
	}
	const pkg = "tangentgarden/engine3."
	hot := []string{
		pkg + "(*raster).triangle", pkg + "(*raster).edge", pkg + "(*raster).line", pkg + "(*raster).span",
		pkg + "Vec3.valid", pkg + "sampled.func1", pkg + "weightedDerivatives", pkg + "segmentDistance",
	}
	scanner := bufio.NewScanner(&listing)
	scanner.Buffer(make([]byte, 1<<20), 1<<20)
	current, seen := "", map[string]bool{}
	for scanner.Scan() {
		line := scanner.Text()
		if fields := strings.Fields(line); len(fields) > 1 && fields[1] == "STEXT" {
			current = fields[0]
			seen[current] = true
			continue
		}
		if !slices.Contains(hot, current) {
			continue
		}
		for _, call := range []string{"runtime.fmin64", "runtime.fmax64", "math.min", "math.max"} {
			if strings.Contains(line, "R_CALL "+call+"+") {
				t.Errorf("%s calls %s", current, call)
			}
		}
	}
	for _, name := range hot {
		// A function inlined everywhere has no listing, and no calls.
		if !seen[name] && !strings.HasPrefix(name, pkg+"Vec3.") {
			t.Errorf("listing has no %s", name)
		}
	}
}

// valid compares each coordinate with its bound instead of taking their
// largest magnitude, and must accept exactly the points it accepted then.
func TestValidMatchesTheLargestMagnitudeBound(t *testing.T) {
	values := []float64{
		math.NaN(), math.Inf(1), math.Inf(-1), 0, math.Copysign(0, -1), 1, -1,
		1e12, -1e12, math.Nextafter(1e12, 0), -math.Nextafter(1e12, 0), math.MaxFloat64,
	}
	for _, x := range values {
		for _, y := range values {
			for _, z := range values {
				v := Vec3{x, y, z}
				want := finite(x) && finite(y) && finite(z) && math.Max(math.Abs(x), math.Max(math.Abs(y), math.Abs(z))) < 1e12
				if got := v.valid(); got != want {
					t.Errorf("%v.valid() = %v, want %v", v, got, want)
				}
			}
		}
	}
}
