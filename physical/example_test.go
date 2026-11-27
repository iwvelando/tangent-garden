package physical_test

import (
	"bytes"
	"fmt"

	"tangentgarden/physical"
)

// A raised ring and bar on a 40 mm plaque, through every step a consumer
// uses: plan, sample, clean, contour, solid, check and package.
func Example() {
	lim := physical.DefaultLimits
	plan := physical.Plan{
		Strokes: append(physical.Circle(0, 12, 1),
			physical.Stroke{A: -12, B: 12, Straight: true, Half: 1}),
		Outer: 18,
	}
	g, err := physical.Sample(plan, 0.2, 4, lim)
	if err != nil {
		panic(err)
	}
	g.Clean()
	c, err := g.Contour(lim)
	if err != nil {
		panic(err)
	}
	m, err := physical.SolidifyWithin(c, physical.Base{Radius: 20, Segments: 256},
		physical.Levels{Plan: 2.8, Rest: 1.6}, lim)
	if err != nil {
		panic(err)
	}
	r := physical.Check(m, lim)
	var pkg bytes.Buffer
	if err := physical.Write3MF(&pkg, m, physical.PackageInfo{Title: "Ring and bar"}, lim); err != nil {
		panic(err)
	}
	back, info, err := physical.Read3MF(pkg.Bytes())
	if err != nil {
		panic(err)
	}
	fmt.Println("valid:", r.Valid(), "bodies:", r.Components)
	fmt.Printf("height: %.1f mm\n", r.Max[2]-r.Min[2])
	fmt.Println("read back:", info.Unit, len(back.T) == len(m.T))
	// Output:
	// valid: true bodies: 1
	// height: 2.8 mm
	// read back: millimeter true
}
