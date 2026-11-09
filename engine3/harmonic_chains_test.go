package engine3

import (
	"math"
	"strings"
	"testing"
)

func chainStudy(samples, lines int, lo, hi float64) Request {
	return Request{
		Format: "harmonic", Construction: "none", Samples: samples, Lines: lines,
		Harmonic: HarmonicCurve{
			Center: Vec3{0.25, -0.5, 1},
			Terms: []HarmonicTerm{
				{Frequency: 2, Cosine: Vec3{2, 0, 0}, Sine: Vec3{0, 2, 0}},
				{Frequency: -3, Cosine: Vec3{0.75, 0.1, 0}, Sine: Vec3{0, 0.25, 0.5}},
				{Frequency: 5, Cosine: Vec3{0, 0, 0.3}},
				{Frequency: 0, Cosine: Vec3{0.1, 0.2, 0.3}},
			},
			Min: lo, Max: hi,
		},
	}
}

func chainAt(t *testing.T, track HarmonicChainTrack, i int) ([]Vec3, Vec3) {
	t.Helper()
	width := track.Terms + 1
	return track.Points[i*width : i*width+track.Terms], track.Points[i*width+track.Terms]
}

func sameBits(a, b Vec3) bool {
	return math.Float64bits(a.X) == math.Float64bits(b.X) &&
		math.Float64bits(a.Y) == math.Float64bits(b.Y) &&
		math.Float64bits(a.Z) == math.Float64bits(b.Z)
}

// The track is what the study computes: at every representative sample and at
// every diagnostic sample, the same bits.
func TestHarmonicChainsAreTheStudysOwnChains(t *testing.T) {
	cases := []struct {
		name           string
		samples, lines int
		lo, hi         float64
	}{
		{"closed", 1200, 48, 0, 2 * math.Pi},
		{"closed, shifted", 241, 13, -math.Pi, math.Pi},
		{"open", 700, 17, 0.1, 3.3},
		{"descending lines of an open domain", 2400, 240, 0, 5},
	}
	for _, k := range cases {
		c := chainStudy(k.samples, k.lines, k.lo, k.hi)
		c.Diagnostics = true
		out, err := Compute(c)
		if err != nil {
			t.Fatalf("%s: %v", k.name, err)
		}
		track, err := HarmonicChains(c)
		if err != nil {
			t.Fatalf("%s: %v", k.name, err)
		}
		if track.Samples != k.samples || track.Terms != 4 || len(track.Points) != (k.samples+1)*5 {
			t.Fatalf("%s: shape %d samples, %d terms, %d points", k.name, track.Samples, track.Terms, len(track.Points))
		}
		compare := func(kind string, s HarmonicPosition) {
			joints, point := chainAt(t, track, s.SampleIndex)
			for j := range joints {
				if !sameBits(joints[j], s.Joints[j]) {
					t.Fatalf("%s: %s chain %d joint %d: %v, want %v", k.name, kind, s.SampleIndex, j, joints[j], s.Joints[j])
				}
			}
			if !sameBits(point, s.Point) {
				t.Fatalf("%s: %s chain %d point: %v, want %v", k.name, kind, s.SampleIndex, point, s.Point)
			}
		}
		for _, s := range out.Harmonic.Positions {
			compare("representative", s)
		}
		for _, s := range out.Harmonic.Chains {
			compare("diagnostic", s)
		}
		if len(out.Harmonic.Chains) != k.samples+1 {
			t.Fatalf("%s: %d diagnostic chains", k.name, len(out.Harmonic.Chains))
		}
	}
}

// Observed from the engine's own curve and from the terms by hand: the tip is
// the curve's sample, each joint the sum of the terms before it.
func TestHarmonicChainsHeadAndJoints(t *testing.T) {
	const n = 1200
	c := chainStudy(n, 48, 0, 2*math.Pi)
	out, err := Compute(c)
	if err != nil {
		t.Fatal(err)
	}
	track, err := HarmonicChains(c)
	if err != nil {
		t.Fatal(err)
	}
	for i := 0; i <= n; i++ {
		joints, tip := chainAt(t, track, i)
		if out.Base[i] == nil {
			t.Fatalf("sample %d has no curve point", i)
		}
		if d := tip.sub(*out.Base[i]).norm(); d > 1e-13 {
			t.Errorf("sample %d: tip is %g from the curve's head", i, d)
		}
		u := 2 * math.Pi * float64(i) / n
		if i == n {
			u = 0
		}
		sum := c.Harmonic.Center
		for k, term := range c.Harmonic.Terms {
			if d := joints[k].sub(sum).norm(); d > 1e-13 {
				t.Errorf("sample %d joint %d is %g from the sum of its terms", i, k, d)
			}
			w := term.Frequency * u
			sum = sum.add(Vec3{
				term.Cosine.X*math.Cos(w) + term.Sine.X*math.Sin(w),
				term.Cosine.Y*math.Cos(w) + term.Sine.Y*math.Sin(w),
				term.Cosine.Z*math.Cos(w) + term.Sine.Z*math.Sin(w),
			})
		}
	}
}

// Successive samples move no further than the terms' speed allows, and the
// chain really moves between the representative samples rather than holding.
func TestHarmonicChainsMoveBetweenSamplesAtTheAnalyticSpeed(t *testing.T) {
	const n = 1200
	const lines = 48
	c := chainStudy(n, lines, 0, 2*math.Pi)
	track, err := HarmonicChains(c)
	if err != nil {
		t.Fatal(err)
	}
	step := 2 * math.Pi / n
	speed := make([]float64, track.Terms+1)
	for k, term := range c.Harmonic.Terms {
		speed[k+1] = speed[k] + math.Abs(term.Frequency)*(term.Cosine.norm()+term.Sine.norm())
	}
	moved := 0
	for i := 0; i < n; i++ {
		a, at := chainAt(t, track, i)
		b, bt := chainAt(t, track, i+1)
		for k := range a {
			if d := b[k].sub(a[k]).norm(); d > speed[k]*step*(1+1e-9)+1e-13 {
				t.Errorf("sample %d: joint %d moved %g, more than %g", i, k, d, speed[k]*step)
			}
		}
		d := bt.sub(at).norm()
		if d > speed[track.Terms]*step*(1+1e-9)+1e-13 {
			t.Errorf("sample %d: tip moved %g, more than %g", i, d, speed[track.Terms]*step)
		}
		if d > 0 {
			moved++
		}
	}
	if moved < n-2 {
		t.Errorf("the tip moved between only %d of %d samples", moved, n)
	}
}

func TestHarmonicChainsClosedLastSampleIsTheFirst(t *testing.T) {
	const n = 1200
	track, err := HarmonicChains(chainStudy(n, 48, 0, 2*math.Pi))
	if err != nil {
		t.Fatal(err)
	}
	first, a := chainAt(t, track, 0)
	last, b := chainAt(t, track, n)
	if !sameBits(a, b) {
		t.Errorf("tip %v, want %v", b, a)
	}
	for j := range first {
		if !sameBits(first[j], last[j]) {
			t.Errorf("joint %d: %v, want %v", j, last[j], first[j])
		}
	}
}

func TestHarmonicChainsLargestTrack(t *testing.T) {
	c := chainStudy(2400, 240, 0, 2*math.Pi)
	for len(c.Harmonic.Terms) < 8 {
		c.Harmonic.Terms = append(c.Harmonic.Terms, HarmonicTerm{Frequency: float64(len(c.Harmonic.Terms) + 6), Cosine: Vec3{0.01, 0, 0}})
	}
	track, err := HarmonicChains(c)
	if err != nil {
		t.Fatal(err)
	}
	if len(track.Points) != 2401*9 {
		t.Errorf("%d points, want %d", len(track.Points), 2401*9)
	}
}

func TestHarmonicChainsRefusals(t *testing.T) {
	valid := chainStudy(1200, 48, 0, 2*math.Pi)
	cases := []struct {
		name   string
		change func(*Request)
		want   string
	}{
		{"another format", func(c *Request) { c.Format = "torus" }, "harmonic"},
		{"too few samples", func(c *Request) { c.Samples = 239 }, "240–2400"},
		{"too many samples", func(c *Request) { c.Samples = 2401 }, "240–2400"},
		{"no terms", func(c *Request) { c.Harmonic.Terms = nil }, "1–8"},
		{"a nonfinite vector", func(c *Request) { c.Harmonic.Terms = []HarmonicTerm{{Frequency: 1, Cosine: Vec3{math.Inf(1), 0, 0}}} }, "finite"},
		{"an empty domain", func(c *Request) { c.Harmonic.Max = c.Harmonic.Min }, ""},
	}
	for _, k := range cases {
		c := valid
		k.change(&c)
		_, err := HarmonicChains(c)
		if err == nil {
			t.Errorf("%s: no refusal", k.name)
		} else if !strings.Contains(err.Error(), k.want) {
			t.Errorf("%s: %v", k.name, err)
		}
	}
}
