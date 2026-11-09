package engine

// A PositionTrack is one moving construction at every sample of a study:
// Width points per sample, as consecutive x, y pairs in Coords, and for a
// circle or a rigid motion one value per sample in Values, its radius or
// angle. Defined[j] is false where the construction has no position at
// sample j, whose points and value are then zero. Flat numbers and flags,
// so that the bridge lifts them out of the JSON (cmd/wasm/lift).
//
// The points are, per construction:
//   - harmonic: a Fourier curve's joints or a Lissajous figure's two guide
//     points, then the curve's point (Epicycles);
//   - roulette and rolling: the rolling circle's center, contact and
//     tracing point, with its radius (Rolling);
//   - moving: the rolling curve's origin, contact and tracing point, with
//     its angle (Placement).
type PositionTrack struct {
	Width   int       `json:"width"`
	Coords  []float64 `json:"coords"`
	Values  []float64 `json:"values,omitempty"`
	Defined []bool    `json:"defined"`
}

// ConstructionTrack is a study's moving constructions at every sample, for
// a reveal to draw where the curve's head has reached rather than at the
// last representative sample. Each is present only when the study has it.
// Samples ≤ 32768 and a width ≤ 17 bound its size.
type ConstructionTrack struct {
	Samples  int            `json:"samples"`
	Harmonic *PositionTrack `json:"harmonic,omitempty"`
	Roulette *PositionTrack `json:"roulette,omitempty"`
	Rolling  *PositionTrack `json:"rolling,omitempty"`
	Moving   *PositionTrack `json:"moving,omitempty"`
}

func newPositionTrack(samples, width int, valued bool) *PositionTrack {
	t := &PositionTrack{Width: width, Coords: make([]float64, 2*samples*width), Defined: make([]bool, samples)}
	if valued {
		t.Values = make([]float64, samples)
	}
	return t
}

func (t *PositionTrack) put(j int, value float64, points ...Vec) {
	t.Defined[j] = true
	for k, p := range points {
		i := 2 * (j*t.Width + k)
		t.Coords[i], t.Coords[i+1] = p.X, p.Y
	}
	if t.Values != nil {
		t.Values[j] = value
	}
}

// chain puts an Epicycles' joints and then its point at sample j.
func (t *PositionTrack) chain(j int, s Epicycles) {
	t.put(j, 0, s.Joints...)
	i := 2 * (j*t.Width + len(s.Joints))
	t.Coords[i], t.Coords[i+1] = s.Point.X, s.Point.Y
}

// Track runs a study's own sampling loop with tracking on: each moving
// construction is recorded at every sample, at the code point and under the
// conditions its representative positions are taken, so every shared sample
// agrees in every bit and a sample without a position stays a gap. Neither
// refinement, diagnostics nor a probe changes the samples, so the run leaves
// them out. The study's result is not returned and is not changed.
func Track(q Request) (ConstructionTrack, error) {
	q.Adaptive, q.AdaptiveFrame, q.Diagnostics, q.Probe, q.View = false, false, false, nil, nil
	q.tracking = true
	out, err := Compute(q)
	if err != nil {
		return ConstructionTrack{}, err
	}
	if out.track == nil {
		return ConstructionTrack{Samples: q.Samples}, nil
	}
	return *out.track, nil
}
