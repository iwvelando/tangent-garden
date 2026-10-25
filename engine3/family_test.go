package engine3

import (
	"encoding/json"
	"math"
	"reflect"
	"testing"
)

// Use the public request/reply wire contract so these tests fail on behavior
// before the family fields exist, rather than failing to compile.
func familyConfig(t *testing.T, c Request, all, shadow bool) Request {
	t.Helper()
	b, _ := json.Marshal(c)
	var wire map[string]any
	json.Unmarshal(b, &wire)
	wire["allPaths"] = all
	if shadow {
		wire["shadow"] = map[string]any{"plane": "z", "at": -3, "allPaths": true, "grid": true}
	}
	b, _ = json.Marshal(wire)
	if err := json.Unmarshal(b, &c); err != nil {
		t.Fatal(err)
	}
	return c
}

func familyMembers(t *testing.T, r Result) []Result {
	t.Helper()
	b, err := json.Marshal(r)
	if err != nil {
		t.Fatal(err)
	}
	var wire struct {
		Members []Result `json:"members"`
	}
	if err := json.Unmarshal(b, &wire); err != nil {
		t.Fatal(err)
	}
	return wire.Members
}

func TestFamilyShowcasePresets(t *testing.T) {
	presets := spatialPresets(t)
	for _, name := range []string{"Six currents braided into a tower", "A crown chasing six shadows"} {
		t.Run(name, func(t *testing.T) {
			c, ok := presets[name]
			if !ok {
				t.Fatal("missing family showcase preset")
			}
			if !c.AllPaths {
				t.Fatal("showcase does not construct on every path")
			}
			r, err := Compute(c)
			if err != nil {
				t.Fatal(err)
			}
			if len(r.Members) != 5 {
				t.Fatalf("got %d additional constructions, want 5", len(r.Members))
			}
			for k, m := range append([]Result{r}, r.Members...) {
				if m.Unavailable != "" || m.Invalid != 0 {
					t.Fatalf("path %d is not regular: %s (%d invalid)", k+1, m.Unavailable, m.Invalid)
				}
			}
			one := c
			one.AllPaths = false
			one.Shadow = nil
			single, err := Compute(one)
			if err != nil {
				t.Fatal(err)
			}
			if len(single.Mesh.Triangles) == 0 || len(r.Mesh.Triangles) != 6*len(single.Mesh.Triangles) {
				t.Fatal("all six construction surfaces must contribute to the typed mesh")
			}
			if c.Format == "field" {
				// V=(-z,a,x): a rotation in xz with a constant climb in y.
				for k, path := range r.Field.Paths {
					for _, j := range []int{0, c.Samples / 2, c.Samples} {
						time := c.Field.Min + (c.Field.Max-c.Field.Min)*float64(j)/float64(c.Samples)
						seed := c.Field.Seeds[k]
						want := Vec3{seed.X*math.Cos(time) - seed.Z*math.Sin(time), seed.Y + c.Field.A*time, seed.X*math.Sin(time) + seed.Z*math.Cos(time)}
						if path[j] == nil || path[j].sub(want).norm() > 1e-7 {
							t.Fatalf("seed %d sample %d misses its analytic helix", k+1, j)
						}
					}
				}
			} else {
				if c.Shadow == nil || !c.Shadow.AllPaths || r.Shadow == nil || len(r.Shadow.Family) != 5 {
					t.Fatal("the crown must cast six independent shadows")
				}
				for k, shadow := range append([]*ShadowResult{r.Shadow}, r.Shadow.Family...) {
					for j, p := range shadow.Curve.Points {
						if p == nil || math.Abs(p.Y-c.Shadow.At) > 1e-12 || math.Abs(p.X-r.Pursuit.Paths[k][j].X) > 1e-12 || math.Abs(p.Z-r.Pursuit.Paths[k][j].Z) > 1e-12 {
							t.Fatalf("path %d sample %d is not projected onto its floor", k+1, j)
						}
					}
				}
			}
		})
	}
}

func TestAllPathConstructions(t *testing.T) {
	presets := spatialPresets(t)
	for _, name := range []string{"A rising vortex", "A chase untangling a trefoil"} {
		for _, kind := range []string{"developable", "involute", "tangent-foot", "orthotomic", "inversion", "framed", "ruled", "canal"} {
			t.Run(name+"/"+kind, func(t *testing.T) {
				c := presets[name]
				c.AllPaths = false
				c.Construction, c.Samples, c.Lines = kind, 240, 12
				legacy, err := Compute(c)
				if err != nil {
					t.Fatal(err)
				}
				unchanged, err := Compute(familyConfig(t, c, false, false))
				if err != nil {
					t.Fatal(err)
				}
				if !reflect.DeepEqual(legacy, unchanged) {
					t.Fatal("off changed the existing study")
				}
				out, err := Compute(familyConfig(t, c, true, false))
				if err != nil {
					t.Fatal(err)
				}
				paths := legacy.Field
				n := 0
				var ps [][]*Vec3
				if paths != nil {
					ps = paths.Paths
				} else {
					ps = legacy.Pursuit.Paths
				}
				n = len(ps)
				members := familyMembers(t, out)
				if len(members) != n-1 {
					t.Fatalf("got %d additional construction members, want %d", len(members), n-1)
				}
				if !reflect.DeepEqual(out.Base, legacy.Base) {
					t.Fatal("first path changed")
				}
				if len(out.Mesh.Triangles) < len(legacy.Mesh.Triangles) {
					t.Fatal("lost first mesh")
				}
				for k, m := range members {
					for i, p := range m.Base {
						if p != nil && (ps[k+1][i] == nil || p.sub(*ps[k+1][i]).norm() > 1e-12) {
							t.Fatalf("member %d sample %d follows another path", k+2, i)
						}
					}
					switch kind {
					case "canal":
						if m.Canal == nil || len(m.Canal.Circles) == 0 {
							t.Fatal("missing member canal")
						}
						for _, g := range m.Canal.Circles {
							if g.Real && (math.Abs(g.Radius-c.Canal.Radius) > 1e-12 || g.Center.sub(*ps[k+1][g.SampleIndex]).norm() > 1e-12) {
								t.Fatal("canal not centered on its member")
							}
						}
					case "involute":
						if m.Involute == nil || len(m.Involute.Members[0].Points) == 0 {
							t.Fatal("missing involute")
						}
					case "tangent-foot", "orthotomic":
						if m.Projection == nil {
							t.Fatal("missing projection")
						}
					case "inversion":
						if m.Inversion == nil {
							t.Fatal("missing inversion")
						}
					case "framed":
						if m.Frame == nil {
							t.Fatal("missing frame")
						}
					case "ruled":
						if m.Ruled == nil {
							t.Fatal("missing rulings")
						}
					case "developable":
						if len(m.Rulings) == 0 {
							t.Fatal("missing tangents")
						}
					}
					for _, r := range m.Rulings {
						if c.Format == "pursuit" && kind == "developable" {
							i := r.SampleIndex
							a, b := ps[k+1][i], ps[(k+2)%n][i]
							if a != nil && b != nil && r.To.sub(r.From).unit().sub(b.sub(*a).unit()).norm() > 1e-10 {
								t.Fatal("pursuer tangent does not point at its own target")
							}
						}
					}
				}
			})
		}
	}
}

func TestAllPathsKeepMovingMembersBesideRestingAndEscapedSeeds(t *testing.T) {
	c := spatialPresets(t)["A rising vortex"]
	c.Construction, c.Samples, c.Lines = "canal", 240, 12
	c.Field.Z = "0"
	c.Field.Seeds = []Vec3{{}, {1, 0, 0}, {100, 0, 0}}
	out, err := Compute(familyConfig(t, c, true, true))
	if err != nil {
		t.Fatal(err)
	}
	m := familyMembers(t, out)
	if len(m) != 2 || m[0].Canal == nil || len(m[0].Canal.Circles) == 0 {
		t.Fatal("resting first seed hid the moving tube")
	}
	if len(out.Mesh.Triangles) == 0 {
		t.Fatal("no tube mesh")
	}
	if m[1].Canal != nil {
		t.Fatal("invented a tube for an escaped seed")
	}
}

func TestFamilyShadowsEveryPath(t *testing.T) {
	for _, name := range []string{"A rising vortex", "A chase untangling a trefoil", "Spirals into a tiny sink"} {
		c := spatialPresets(t)[name]
		c.Samples, c.Lines, c.Construction = 240, 12, "none"
		out, err := Compute(familyConfig(t, c, false, true))
		if err != nil {
			t.Fatal(err)
		}
		b, _ := json.Marshal(out.Shadow)
		var wire struct {
			Family []*ShadowResult `json:"family"`
		}
		json.Unmarshal(b, &wire)
		var ps [][]*Vec3
		if out.Field != nil {
			ps = out.Field.Paths
		} else {
			ps = out.Pursuit.Paths
		}
		if len(wire.Family) != len(ps)-1 {
			t.Fatalf("%s: shadow has %d additional paths, want %d", name, len(wire.Family), len(ps)-1)
		}
		for k, s := range wire.Family {
			for i, p := range ps[k+1] {
				got := s.Curve.Points[i]
				if p == nil {
					if got != nil {
						t.Fatal("joined a missing path")
					}
					continue
				}
				want := *p
				want.Z = -3
				if got == nil || *got != want {
					t.Fatalf("%s member %d sample %d: shadow does not project that path", name, k+2, i)
				}
			}
		}
	}
}

func TestTinySinkConstructionDefaults(t *testing.T) {
	c := spatialPresets(t)["Spirals into a tiny sink"]
	c.Construction = "canal"
	out, err := Compute(c)
	if err != nil {
		t.Fatal(err)
	}
	if out.Canal.Folded != 0 || out.Bounds.Radius > 2e-12 {
		t.Fatalf("default tube dwarfs the tiny curve: radius %g, folded %d", out.Bounds.Radius, out.Canal.Folded)
	}
}

func TestAllPathMeshesAndComposedInputsMatchIndependentSeeds(t *testing.T) {
	for _, input := range []string{"base", "tangent-foot", "orthotomic", "involute", "coil"} {
		for _, kind := range []string{"developable", "involute", "framed", "ruled", "canal"} {
			t.Run(input+"/"+kind, func(t *testing.T) {
				c := spatialPresets(t)["A rising vortex"]
				c.Samples, c.Lines, c.Construction, c.Input = 240, 12, kind, input
				c.Field.Seeds = c.Field.Seeds[:2]
				out, err := Compute(familyConfig(t, c, true, false))
				if err != nil {
					t.Fatal(err)
				}
				if len(out.Members) != 1 {
					t.Fatal("missing second input")
				}
				vertex, triangle := 0, 0
				for k, seed := range c.Field.Seeds {
					q := c
					q.AllPaths = false
					q.Field.Seeds = []Vec3{seed}
					want, err := Compute(q)
					if err != nil {
						t.Fatal(err)
					}
					got := out
					if k > 0 {
						got = out.Members[k-1]
					}
					if !reflect.DeepEqual(got.Base, want.Base) {
						t.Fatal("composed base differs from independent trajectory")
					}
					if !reflect.DeepEqual(out.Mesh.Vertices[vertex:vertex+len(want.Mesh.Vertices)], want.Mesh.Vertices) {
						t.Fatal("member mesh vertices differ")
					}
					for j, v := range want.Mesh.Triangles {
						if out.Mesh.Triangles[triangle+j] != v+int32(vertex/7) {
							t.Fatal("mesh joined members or lost an index")
						}
					}
					if !reflect.DeepEqual(out.Mesh.SampleIndex[triangle/3:triangle/3+len(want.Mesh.SampleIndex)], want.Mesh.SampleIndex) {
						t.Fatal("member reveal indices differ")
					}
					vertex += len(want.Mesh.Vertices)
					triangle += len(want.Mesh.Triangles)
				}
				if vertex != len(out.Mesh.Vertices) || triangle != len(out.Mesh.Triangles) {
					t.Fatal("duplicated mesh storage")
				}
				if out.Members[0].Field != nil || out.Members[0].Pursuit != nil || len(out.Members[0].Mesh.Vertices) != 0 {
					t.Fatal("duplicated the family or mesh in each member")
				}
			})
		}
	}
}

func TestAllPathShadowsIncludeAStationaryFirstSeed(t *testing.T) {
	c := spatialPresets(t)["A rising vortex"]
	c.Samples, c.Lines, c.Construction = 240, 12, "canal"
	c.Field.Z = "0"
	c.Field.Seeds = []Vec3{{}, {1, 0, 0}}
	out, err := Compute(familyConfig(t, c, true, true))
	if err != nil {
		t.Fatal(err)
	}
	for _, p := range out.Shadow.Curve.Points {
		if p == nil || *p != (Vec3{0, 0, -3}) {
			t.Fatal("a stationary path still needs its point shadow")
		}
	}
	c = familyConfig(t, c, true, true)
	c.Shadow.AllPaths = false
	single, err := Compute(c)
	if err != nil {
		t.Fatal(err)
	}
	if len(single.Shadow.Family) != 0 || len(single.Members) != 1 {
		t.Fatal("shadow scope changed construction scope")
	}
	for _, p := range single.Shadow.Corners {
		if p.sub(single.Bounds.Center).norm() > single.Bounds.Radius*(1+1e-12) {
			t.Fatal("first-path shadow fell outside all-path framing")
		}
	}
	c = familyConfig(t, c, true, false)
	c.Field.Seeds = []Vec3{{}, {}}
	if _, err = Compute(c); err == nil {
		t.Fatal("accepted a construction with no regular member")
	}
}

func TestAllPathPursuitUsesEachPursuersSpeed(t *testing.T) {
	c := spatialPresets(t)["A crown of six with a tangent ribbon"]
	c.Samples, c.Lines, c.Pursuit.Max = 240, 12, .5
	for k := range c.Pursuit.Pursuers {
		c.Pursuit.Pursuers[k].Speed = .5 + float64(k)/5
	}
	out, err := Compute(familyConfig(t, c, true, false))
	if err != nil {
		t.Fatal(err)
	}
	for k, m := range append([]Result{out}, out.Members...) {
		for _, r := range m.Rulings {
			i := r.SampleIndex
			ps := out.Pursuit.Paths
			want := ps[(k+1)%len(ps)][i].sub(*ps[k][i]).unit()
			if r.To.sub(r.From).unit().sub(want).norm() > 1e-12 {
				t.Fatal("a member chases the wrong target")
			}
		}
	}
	// On a coil, the input's tangent also depends on acceleration. Compare
	// each returned ruling with a fourth-order derivative of its returned
	// centerline, independently of the pursuit derivative implementation.
	c.Input, c.Coil.Radius, c.Coil.Turns = "coil", .15, 1
	coiled, err := Compute(familyConfig(t, c, true, false))
	if err != nil {
		t.Fatal(err)
	}
	for k, m := range append([]Result{coiled}, coiled.Members...) {
		checked := 0
		for _, r := range m.Rulings {
			i := r.SampleIndex
			if i < 2 || i+2 >= len(m.Base) {
				continue
			}
			p := m.Base
			if p[i-2] == nil || p[i-1] == nil || p[i+1] == nil || p[i+2] == nil {
				continue
			}
			d := p[i-2].sub(p[i-1].mul(8)).add(p[i+1].mul(8)).sub(*p[i+2]).unit()
			if d.sub(r.To.sub(r.From).unit()).norm() > 2e-5 {
				t.Fatalf("member %d: coil tangent disagrees with its centerline", k+1)
			}
			checked++
		}
		if checked < 5 {
			t.Fatal("too few regular coil rulings were checked")
		}
	}
}

func TestAllPathUnwindingSkipsUnavailableAnchors(t *testing.T) {
	c := spatialPresets(t)["A rising vortex"]
	c.Samples, c.Lines, c.Construction, c.Input = 240, 12, "canal", "involute"
	c.Field.Z = "0"
	c.Field.Seeds = []Vec3{{}, {1, 0, 0}, {100, 0, 0}}
	out, err := Compute(familyConfig(t, c, true, true))
	if err != nil {
		t.Fatal(err)
	}
	if out.Unavailable == "" || out.Members[0].Canal == nil || out.Members[1].Unavailable == "" {
		t.Fatal("an unavailable anchor stopped a different path")
	}
	c.Unwinding.Anchor = -1
	_, err = Compute(familyConfig(t, c, true, true))
	if field, ok := err.(*FieldError); !ok || field.Field != "unwinding.anchor" {
		t.Fatalf("invalid common anchor was hidden: %v", err)
	}
}
