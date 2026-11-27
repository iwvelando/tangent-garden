package physical

import (
	"archive/zip"
	"bytes"
	"encoding/xml"
	"io"
	"strings"
	"testing"
)

func cubePackage(t *testing.T, lim Limits) ([]byte, *Mesh) {
	t.Helper()
	var m Mesh
	cube(&m, -1.25, 0.1, 0, 2.5)
	// Values that need every digit to round-trip.
	m.V[0] = -1.2500000000000002
	var buf bytes.Buffer
	err := Write3MF(&buf, &m, PackageInfo{
		Title:     "Cube & <fixture>",
		Settings:  []byte(`{"version":1,"note":"a \"quoted\" <tag>"}`),
		Translate: [2]float64{128, 128},
	}, lim)
	if err != nil {
		t.Fatal(err)
	}
	return buf.Bytes(), &m
}

func TestThreeMFRoundTripsExactly(t *testing.T) {
	data, m := cubePackage(t, DefaultLimits)
	got, info, err := Read3MF(data)
	if err != nil {
		t.Fatal(err)
	}
	if info.Unit != "millimeter" {
		t.Errorf("unit %q", info.Unit)
	}
	if info.Transform != "1 0 0 0 1 0 0 0 1 128 128 0" {
		t.Errorf("transform %q", info.Transform)
	}
	if info.Title != "Cube & <fixture>" || !strings.Contains(info.Settings, `"note":"a \"quoted\" <tag>"`) {
		t.Errorf("metadata %q %q", info.Title, info.Settings)
	}
	if len(got.V) != len(m.V) || len(got.T) != len(m.T) {
		t.Fatalf("sizes %d %d", len(got.V), len(got.T))
	}
	for k := range m.V {
		if got.V[k] != m.V[k] {
			t.Fatalf("coordinate %d: %v, wrote %v", k, got.V[k], m.V[k])
		}
	}
	for k := range m.T {
		if got.T[k] != m.T[k] {
			t.Fatalf("index %d", k)
		}
	}
	if r := Check(got, DefaultLimits); !r.Valid() {
		t.Errorf("read back invalid: %+v", r)
	}
}

// The package holds exactly the three core parts, with their content
// types and the start relationship, and every part is well-formed XML.
func TestThreeMFPackageParts(t *testing.T) {
	data, _ := cubePackage(t, DefaultLimits)
	z, err := zip.NewReader(bytes.NewReader(data), int64(len(data)))
	if err != nil {
		t.Fatal(err)
	}
	names := map[string]string{}
	for _, f := range z.File {
		r, _ := f.Open()
		b, _ := io.ReadAll(r)
		names[f.Name] = string(b)
		d := xml.NewDecoder(bytes.NewReader(b))
		for {
			if _, err := d.Token(); err == io.EOF {
				break
			} else if err != nil {
				t.Fatalf("%s: %v", f.Name, err)
			}
		}
	}
	for _, want := range []string{"[Content_Types].xml", "_rels/.rels", "3D/3dmodel.model"} {
		if _, ok := names[want]; !ok {
			t.Errorf("missing %s", want)
		}
	}
	if len(names) != 3 {
		t.Errorf("parts %v", len(names))
	}
	if !strings.Contains(names["[Content_Types].xml"], `ContentType="application/vnd.ms-package.3dmanufacturing-3dmodel+xml"`) {
		t.Error("model content type")
	}
	if !strings.Contains(names["_rels/.rels"], `Target="/3D/3dmodel.model"`) ||
		!strings.Contains(names["_rels/.rels"], `Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel"`) {
		t.Error("start relationship")
	}
	if !strings.Contains(names["3D/3dmodel.model"], `xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02"`) {
		t.Error("core namespace")
	}
}

func TestThreeMFIsDeterministicAndBounded(t *testing.T) {
	a, _ := cubePackage(t, DefaultLimits)
	b, _ := cubePackage(t, DefaultLimits)
	if !bytes.Equal(a, b) {
		t.Error("two writes differ")
	}
	var m Mesh
	cube(&m, 0, 0, 0, 1)
	lim := DefaultLimits
	lim.Package = 200
	if err := Write3MF(io.Discard, &m, PackageInfo{}, lim); err == nil {
		t.Error("package ceiling not enforced")
	}
}

// Text and attributes escape only with the five named entities:
// lib3mf's reader refuses numeric character references such as &#34;,
// which Go's encoder writes for quotes.
func TestThreeMFUsesNamedEntitiesOnly(t *testing.T) {
	data, _ := cubePackage(t, DefaultLimits)
	z, err := zip.NewReader(bytes.NewReader(data), int64(len(data)))
	if err != nil {
		t.Fatal(err)
	}
	for _, f := range z.File {
		r, _ := f.Open()
		b, _ := io.ReadAll(r)
		if i := bytes.Index(b, []byte("&#")); i >= 0 {
			t.Errorf("%s holds a numeric character reference: %q", f.Name, b[i:min(len(b), i+8)])
		}
		if !strings.Contains(string(b), "&quot;") && f.Name == "3D/3dmodel.model" {
			t.Errorf("%s: the settings' quotes are not escaped as &quot;", f.Name)
		}
	}
}
