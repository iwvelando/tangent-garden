package engine3

import (
	"fmt"
	"math"
)

// The shared solution is request-local. Each construction uses its own
// evaluator, units, frames and gaps; no integration or result is retained.
type integratedFamily struct {
	flow  *flowCurve
	chase *spatialChase
}

func (f *integratedFamily) evaluation(c Request, k int) evaluation {
	if f.flow != nil {
		return f.flow.flows[k].evaluation(f.flow.f, c.Field.Max-c.Field.Min)
	}
	return f.chase.evaluationAt(k)
}

func (f *integratedFamily) position(c Request, k int, t float64) Vec3 {
	if f.flow != nil {
		if p, ok := f.flow.flows[k].at(t); ok {
			return p
		}
	} else if ps := f.chase.positions(t); ps != nil {
		return ps[k]
	}
	return Vec3{math.NaN(), math.NaN(), math.NaN()}
}

func computeFamily(c Request) (Result, error) {
	f := &integratedFamily{}
	n := 0
	var err error
	if c.Format == "field" {
		f.flow, err = c.Field.compile()
		n = len(c.Field.Seeds)
	} else {
		f.chase, err = c.Pursuit.compile()
		n = len(c.Pursuit.Pursuers)
	}
	if err != nil {
		return Result{}, err
	}
	q := c
	q.integrated = f
	q.allowEmpty = c.AllPaths && c.Construction != "none"
	out, err := computeSingle(q)
	if err != nil {
		return Result{}, err
	}
	families, reach := append([][]*Vec3{}, out.families...), append([][]Vec3{}, out.reach...)
	available := out.Unavailable == ""
	for k := 1; k < n; k++ {
		q = c
		q.integrated = f
		q.member = k
		q.allowEmpty = true
		// Readouts and probes describe path 1; the other members keep only
		// their drawing and construction diagnostics.
		q.Probe, q.SurfaceProbe, q.Diagnostics, q.SurfaceDiagnostics = nil, nil, false, false
		if !c.AllPaths || c.Construction == "none" {
			q.Construction = "none"
			q.Input = "base"
		}
		if !c.shadowed() || !c.Shadow.AllPaths {
			q.Shadow = nil
		}
		m, e := computeSingle(q)
		if e != nil {
			return Result{}, e
		}
		available = available || m.Unavailable == ""
		families = append(families, m.families...)
		// Keep family/reach indices aligned even for an unavailable member.
		for len(reach) < len(families)-len(m.families) {
			reach = append(reach, nil)
		}
		reach = append(reach, m.reach...)
		for len(reach) < len(families) {
			reach = append(reach, nil)
		}
		if c.AllPaths && c.Construction != "none" {
			out.Mesh.append(m.Mesh)
			m.Mesh = emptyMesh()
			// The root's shadow below owns the whole shadow family.
			member := m
			member.Shadow = nil
			out.Members = append(out.Members, member)
		}
		if out.Shadow != nil && m.Shadow != nil {
			out.Shadow.Family = append(out.Shadow.Family, m.Shadow)
		}
	}
	if !available {
		return Result{}, fmt.Errorf("no path has a regular input sample; change the field, starts, or construction input")
	}
	if out.Shadow != nil {
		shadows := append([]*ShadowResult{out.Shadow}, out.Shadow.Family...)
		var projected [][]*Vec3
		for _, s := range shadows {
			projected = append(projected, s.Curve.Points)
			for _, p := range append(append([]ShadowPath{}, s.Planar...), s.Cast...) {
				projected = append(projected, p.Points)
			}
		}
		out.Shadow.Corners = c.Shadow.window(projected)
		corners := make([]*Vec3, 4)
		for k := range corners {
			corners[k] = &out.Shadow.Corners[k]
		}
		families = append(families, append(projected, corners)...)
	}
	out.families, out.reach = families, reach
	out.Bounds = fitReach(families, reach)
	out.Radius = out.Bounds.Radius
	return out, nil
}
