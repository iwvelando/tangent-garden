package lift

import (
	"encoding/json"
	"testing"

	"tangentgarden/engine3"
)

// BenchmarkLiftSurfaceTransport isolates packing and encoding from geometry
// evaluation and fixture restoration, at the maximum surface cell count.
func BenchmarkLiftSurfaceTransport(b *testing.B) {
	q := presetIn(b, "../../../engine3/testdata/presets.json", "The whole focal surface of an ellipsoid")
	q.Surface.USamples = 240
	q.Surface.VSamples = 60
	result, err := engine3.Compute(q)
	if err != nil {
		b.Fatal(err)
	}
	result.Mesh = engine3.CurveMesh{}
	raw, err := json.Marshal(result)
	if err != nil {
		b.Fatal(err)
	}
	b.Logf("whole JSON %d bytes", len(raw))
	for _, mode := range []string{"lift", "encode"} {
		b.Run(mode, func(b *testing.B) {
			b.ReportAllocs()
			for b.Loop() {
				b.StopTimer()
				var r engine3.Result
				if err := json.Unmarshal(raw, &r); err != nil {
					b.Fatal(err)
				}
				b.StartTimer()
				if mode == "lift" {
					_, _, err = Lift(&r)
				} else {
					_, _, err = Lift(&r)
					if err == nil {
						_, err = json.Marshal(r)
					}
				}
				if err != nil {
					b.Fatal(err)
				}
			}
		})
	}
}
