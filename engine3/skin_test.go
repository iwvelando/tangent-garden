package engine3

import (
	"math"
	"sort"
	"testing"
)

// skinOffset is p's distance from the mesh triangle under it, signed along
// the triangle's outward normal (the side its vertex normals face), among
// the triangles of the sample intervals beside at whose prism holds p
// within reach; ok is false when none does.
func skinOffset(m CurveMesh, bySample map[int32][]int, p Vec3, at, reach float64) (d float64, ok bool) {
	vertex := func(i int32) (Vec3, Vec3) {
		v := m.Vertices[7*i:]
		return Vec3{v[0], v[1], v[2]}, Vec3{v[3], v[4], v[5]}
	}
	best := math.Inf(1)
	for s := int32(math.Floor(at)); s <= int32(math.Ceil(at))+1; s++ {
		for _, j := range bySample[s] {
			a, na := vertex(m.Triangles[3*j])
			b, nb := vertex(m.Triangles[3*j+1])
			c, nc := vertex(m.Triangles[3*j+2])
			n := b.sub(a).cross(c.sub(a))
			if n.norm() == 0 {
				continue
			}
			n = n.mul(1 / n.norm())
			if n.dot(na.add(nb).add(nc)) < 0 {
				n = n.mul(-1)
			}
			h := p.sub(a).dot(n)
			// The foot's barycentric coordinates.
			e1, e2, f := b.sub(a), c.sub(a), p.sub(n.mul(h)).sub(a)
			d11, d12, d22 := e1.dot(e1), e1.dot(e2), e2.dot(e2)
			det := d11*d22 - d12*d12
			u := (d22*f.dot(e1) - d12*f.dot(e2)) / det
			v := (d11*f.dot(e2) - d12*f.dot(e1)) / det
			if u < -1e-9 || v < -1e-9 || u+v > 1+1e-9 || math.Abs(h) > reach {
				continue
			}
			if math.Abs(h) < best {
				best, d, ok = math.Abs(h), h, true
			}
		}
	}
	return d, ok
}

// A refined line drawn on a preset's sheet follows the curve between
// samples, so the sheet must be refined with it: on a flat triangle between
// two unrefined rings, a meridian on a tube's concave side passes behind the
// skin and the drawing hides it in dashes. Every refined preset that draws
// a sheet keeps its lines on it or, on a tube, outside it, to within
// rounding: no line point lies behind the skin by more than 10⁻⁹ of the
// study's size, nor off an open sheet by more.
func TestRefinedPresetLinesStayOnTheirSheets(t *testing.T) {
	names := []string{}
	for name := range spatialPresets(t) {
		names = append(names, name)
	}
	sort.Strings(names)
	checked := 0
	for _, name := range names {
		c := spatialPresets(t)[name]
		if !c.Adaptive {
			continue
		}
		out, err := Compute(c)
		if err != nil {
			t.Fatalf("%s: %v", name, err)
		}
		if len(out.Mesh.Triangles) == 0 {
			continue
		}
		checked++
		bySample := map[int32][]int{}
		for j, s := range out.Mesh.SampleIndex {
			bySample[s] = append(bySample[s], j)
		}
		a := out.Adaptive
		paths := append([]*RefinedPath{a.Base, a.Partner, a.Minus, a.Plus}, a.Meridians...)
		paths = append(paths, a.Strands...)
		size := fit(a.Base.Points).Radius
		tube := c.Construction == "canal"
		for k, path := range paths {
			if path == nil {
				continue
			}
			worst := 0.0
			for i, p := range path.Points {
				if p == nil {
					continue
				}
				d, ok := skinOffset(out.Mesh, bySample, *p, path.At[i], 0.01*size)
				if !ok {
					continue
				}
				if tube {
					d = math.Min(d, 0)
				}
				worst = math.Max(worst, math.Abs(d))
			}
			if worst > 1e-9*size {
				t.Errorf("%s: path %d strays %.3g (%.2g of the study's size) from its sheet", name, k, worst, worst/size)
			}
		}
	}
	if checked < 5 {
		t.Fatalf("checked %d refined presets with sheets, want at least 5", checked)
	}
}
