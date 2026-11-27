package physical

import (
	"bytes"
	"crypto/sha256"
	"encoding/json"
	"errors"
	"fmt"
	"runtime"
	"strings"
	"testing"
)

func requestJSON(t *testing.T, q LaceSolidRequest) []byte {
	t.Helper()
	b, err := json.Marshal(q)
	if err != nil {
		t.Fatal(err)
	}
	return b
}

// ParseLaceSolidRequest reads exactly one request of known fields, within
// the size budget, and names the field of a version it cannot read.
func TestParseLaceSolidRequest(t *testing.T) {
	good := solidRequest(starLace(2, 1000), 80, 2, Raised, RimMotif)
	good.Version = SettingsVersion
	q, err := ParseLaceSolidRequest(requestJSON(t, good))
	if err != nil {
		t.Fatal(err)
	}
	if q.Diameter != 80 || q.Profile.ID != good.Profile.ID {
		t.Fatalf("read %+v", q)
	}
	field := func(name string, data []byte, want string) {
		t.Helper()
		_, err := ParseLaceSolidRequest(data)
		var fe *FieldError
		if !errors.As(err, &fe) || fe.Field != want {
			t.Errorf("%s: %v, want a refusal of %q", name, err, want)
		}
	}
	refused := func(name string, data []byte, says string) {
		t.Helper()
		_, err := ParseLaceSolidRequest(data)
		if err == nil || !strings.Contains(err.Error(), says) {
			t.Errorf("%s: %v, want %q", name, err, says)
		}
	}
	future := good
	future.Version = SettingsVersion + 1
	field("future settings", requestJSON(t, future), "version")
	futureProfile := good
	futureProfile.Profile.Version = ProfileVersion + 1
	field("future profile", requestJSON(t, futureProfile), "profile.version")
	long := good
	long.Profile.Name = strings.Repeat("x", 121)
	field("long name", requestJSON(t, long), "profile.name")
	long = good
	long.Profile.ID = strings.Repeat("x", 65)
	field("long id", requestJSON(t, long), "profile.id")
	many := good
	many.Profile.Sources = make([]Source, 9)
	field("many sources", requestJSON(t, many), "profile.sources")

	text := requestJSON(t, good)
	refused("unknown field", bytes.Replace(text, []byte(`"diameter"`), []byte(`"diametre":1,"diameter"`), 1), "unknown field")
	refused("trailing data", append(append([]byte{}, text...), []byte(` {}`)...), "one set of settings")
	refused("corrupted", text[:len(text)/2], "settings")
	refused("wrong type", bytes.Replace(text, []byte(`"diameter":80`), []byte(`"diameter":"80"`), 1), "settings")
	padded := append(append([]byte{}, text[:len(text)-1]...), []byte(`,"border":0`+strings.Repeat(" ", MaxRequestBytes)+`}`)...)
	refused("oversized", padded, "too large")
}

// Profile refusals name the field the workshop shows them under, in its
// own words, one bed axis at a time.
func TestProfileFieldErrors(t *testing.T) {
	for _, c := range []struct {
		field, says string
		edit        func(*Profile)
	}{
		{"profile.envelope.0", "Bed width", func(p *Profile) { p.Envelope[0] = 0 }},
		{"profile.envelope.1", "Bed depth", func(p *Profile) { p.Envelope[1] = 3000 }},
		{"profile.envelope.2", "Build height", func(p *Profile) { p.Envelope[2] = -1 }},
		{"profile.nozzle", "Nozzle", func(p *Profile) { p.Nozzle = 0 }},
		{"profile.extrusionWidth", "Extrusion width", func(p *Profile) { p.ExtrusionWidth = 9 }},
		{"profile.layerHeight", "Layer height", func(p *Profile) { p.LayerHeight = 0 }},
		{"profile.firstLayer", "First layer", func(p *Profile) { p.FirstLayer = 3 }},
		{"profile.xyDetail", "Finest wall", func(p *Profile) { p.XYDetail = 0 }},
		{"profile.xyGap", "Finest gap", func(p *Profile) { p.XYGap = 0 }},
		{"profile.zDetail", "Finest height step", func(p *Profile) { p.ZDetail = 0 }},
		{"profile.wall", "Minimum wall", func(p *Profile) { p.Wall = 0 }},
		{"profile.strut", "Minimum raised line", func(p *Profile) { p.Strut = 0 }},
		{"profile.floor", "Minimum floor", func(p *Profile) { p.Floor = 0 }},
		{"profile.gap", "Minimum gap", func(p *Profile) { p.Gap = 0 }},
	} {
		p := DefaultProfiles()[0]
		c.edit(&p)
		var fe *FieldError
		if err := p.Validate(); !errors.As(err, &fe) || fe.Field != c.field || !strings.HasPrefix(fe.Message, c.says+" must be") {
			t.Errorf("%s: %v", c.field, err)
		}
	}
}

// A package's recorded settings rebuild the very same package: they are
// the request as Go resolved it, automatic grid step included.
func TestSettingsReproduceThePackage(t *testing.T) {
	for _, q := range fingerprintRequests() {
		s, err := BuildLaceSolid(q, DefaultLimits)
		if err != nil {
			t.Fatal(err)
		}
		_, info, err := Read3MF(s.Package)
		if err != nil {
			t.Fatal(err)
		}
		again, err := ParseLaceSolidRequest([]byte(info.Settings))
		if err != nil {
			t.Fatalf("recorded settings: %v", err)
		}
		if again.Version != SettingsVersion || again.Grid == 0 {
			t.Errorf("recorded version %d, grid %g", again.Version, again.Grid)
		}
		r, err := BuildLaceSolid(again, DefaultLimits)
		if err != nil {
			t.Fatal(err)
		}
		if !bytes.Equal(r.Package, s.Package) {
			t.Errorf("%s: the recorded settings build a different package", info.Title)
		}
	}
}

// Representative plaques for the pinned fingerprints: raised whole tiles,
// a recessed clean rim, openwork, and a face-down crop.
func fingerprintRequests() []LaceSolidRequest {
	raised := solidRequest(starLace(2, 1000), 80, 2, Raised, RimMotif)
	recessed := solidRequest(starLace(2, 1000), 80, 2, Recessed, RimClean)
	recessed.Clip = 0.8
	openwork := solidRequest(starLace(2, 1000), 80, 2, Raised, RimMotif)
	openwork.Design.Floor = 0
	down := solidRequest(starLace(3, 1000), 80, 2, Recessed, RimCrop)
	down.Clip = 0.7
	down.Design.FaceDown = true
	down.Design.Simplify = true
	down.Lines = LinesBoth
	return []LaceSolidRequest{raised, recessed, openwork, down}
}

// The packages' bits, recorded on each architecture. WebAssembly, as the
// browser runs it, matches amd64; arm64 fuses multiply-adds, so its last
// digits differ. A change that moves any of them changes saved files.
var packageGolden = map[string][]string{
	"amd64": {"337879dc5bd59c10", "c322e01d5b795924", "212b055350c94ae6", "cdc7b10313453635"},
	"wasm":  {"337879dc5bd59c10", "c322e01d5b795924", "212b055350c94ae6", "cdc7b10313453635"},
	"arm64": {"f91c1a7748b02256", "99fc6ce3079e7fae", "856de70f1d9d202e", "c49a79568310c2fc"},
}

func TestPackageFingerprints(t *testing.T) {
	want, ok := packageGolden[runtime.GOARCH]
	if !ok {
		t.Skipf("no fingerprints recorded for %s", runtime.GOARCH)
	}
	var got []string
	for _, q := range fingerprintRequests() {
		s, err := BuildLaceSolid(q, DefaultLimits)
		if err != nil {
			t.Fatal(err)
		}
		got = append(got, fmt.Sprintf("%x", sha256.Sum256(s.Package))[:16])
	}
	if fmt.Sprint(got) != fmt.Sprint(want) {
		t.Errorf("%s fingerprints %q, recorded %q", runtime.GOARCH, got, want)
	}
}
