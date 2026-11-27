package physical

import (
	"archive/zip"
	"bytes"
	"encoding/xml"
	"errors"
	"io"
	"strconv"
	"strings"
	"time"
)

// PackageInfo is what a 3MF package carries beside its mesh: a title,
// the reproducible settings as JSON, in the model's tg:settings metadata,
// and the build item's translation, placing the object on a printer's bed.
type PackageInfo struct {
	Title     string
	Settings  []byte
	Translate [2]float64
}

// ReadInfo is what Read3MF finds beside the mesh.
type ReadInfo struct {
	Unit, Transform, Title, Settings string
}

const (
	coreNamespace = "http://schemas.microsoft.com/3dmanufacturing/core/2015/02"
	tgNamespace   = "https://tangent-garden.isaacvelando.com/3mf/2026"
	contentTypes  = `<?xml version="1.0" encoding="UTF-8"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="model" ContentType="application/vnd.ms-package.3dmanufacturing-3dmodel+xml"/></Types>`
	relationships = `<?xml version="1.0" encoding="UTF-8"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Target="/3D/3dmodel.model" Id="rel0" Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel"/></Relationships>`
)

// Write3MF writes a core 3MF package: one mesh object in millimeters, its
// coordinates written in the shortest decimal form that reads back as the
// same float64, so nothing is rounded or snapped, and one build item. The
// zip entries carry a fixed date, so equal input gives equal bytes. A
// package larger than lim.Package is refused.
func Write3MF(w io.Writer, m *Mesh, info PackageInfo, lim Limits) error {
	var model bytes.Buffer
	model.WriteString(`<?xml version="1.0" encoding="UTF-8"?>` + "\n")
	model.WriteString(`<model unit="millimeter" xml:lang="en-US" xmlns="` + coreNamespace + `" xmlns:tg="` + tgNamespace + `">`)
	meta := func(name, value string) {
		model.WriteString(`<metadata name="` + name + `">`)
		model.WriteString(escape(value))
		model.WriteString(`</metadata>`)
	}
	if info.Title != "" {
		meta("Title", info.Title)
	}
	meta("Application", "Tangent Garden")
	if len(info.Settings) > 0 {
		meta("tg:settings", string(info.Settings))
	}
	model.WriteString(`<resources><object id="1" type="model"`)
	if info.Title != "" {
		model.WriteString(` name="` + escape(info.Title) + `"`)
	}
	model.WriteString(`><mesh><vertices>`)
	num := func(v float64) {
		b := strconv.AppendFloat(model.AvailableBuffer(), v, 'f', -1, 64)
		model.Write(b)
	}
	for i := 0; i < len(m.V); i += 3 {
		model.WriteString(`<vertex x="`)
		num(m.V[i])
		model.WriteString(`" y="`)
		num(m.V[i+1])
		model.WriteString(`" z="`)
		num(m.V[i+2])
		model.WriteString(`"/>`)
		if model.Len() > lim.Package {
			return limitError{"package size"}
		}
	}
	model.WriteString(`</vertices><triangles>`)
	for i := 0; i < len(m.T); i += 3 {
		model.WriteString(`<triangle v1="` + strconv.Itoa(int(m.T[i])) + `" v2="` + strconv.Itoa(int(m.T[i+1])) + `" v3="` + strconv.Itoa(int(m.T[i+2])) + `"/>`)
		if model.Len() > lim.Package {
			return limitError{"package size"}
		}
	}
	model.WriteString(`</triangles></mesh></object></resources><build><item objectid="1" transform="1 0 0 0 1 0 0 0 1 `)
	num(info.Translate[0])
	model.WriteString(" ")
	num(info.Translate[1])
	model.WriteString(` 0"/></build></model>`)

	var out bytes.Buffer
	z := zip.NewWriter(&out)
	when := time.Date(1980, 1, 1, 0, 0, 0, 0, time.UTC)
	for _, part := range []struct {
		name string
		body []byte
	}{
		{"[Content_Types].xml", []byte(contentTypes)},
		{"_rels/.rels", []byte(relationships)},
		{"3D/3dmodel.model", model.Bytes()},
	} {
		f, err := z.CreateHeader(&zip.FileHeader{Name: part.name, Method: zip.Deflate, Modified: when})
		if err != nil {
			return err
		}
		if _, err := f.Write(part.body); err != nil {
			return err
		}
	}
	if err := z.Close(); err != nil {
		return err
	}
	if out.Len() > lim.Package {
		return limitError{"package size"}
	}
	_, err := w.Write(out.Bytes())
	return err
}

// escape writes text for an attribute or element with the five named
// entities only. Go's encoder writes numeric references such as &#34;,
// valid XML that lib3mf's reader refuses; control characters other than
// tab and newline, which XML 1.0 cannot carry, are dropped.
var escaper = strings.NewReplacer("&", "&amp;", "<", "&lt;", ">", "&gt;", `"`, "&quot;", "'", "&apos;")

func escape(s string) string {
	s = strings.Map(func(r rune) rune {
		if r < 0x20 && r != '\t' && r != '\n' || r == 0xFFFE || r == 0xFFFF {
			return -1
		}
		return r
	}, s)
	return escaper.Replace(s)
}

// Read3MF reads back a package Write3MF wrote: its one mesh object, unit,
// build transform, title and settings. It is the Go side of the
// round-trip; the independent reader is scripts/read-3mf.py.
func Read3MF(data []byte) (*Mesh, ReadInfo, error) {
	z, err := zip.NewReader(bytes.NewReader(data), int64(len(data)))
	if err != nil {
		return nil, ReadInfo{}, err
	}
	var body []byte
	for _, f := range z.File {
		if f.Name == "3D/3dmodel.model" {
			r, err := f.Open()
			if err != nil {
				return nil, ReadInfo{}, err
			}
			body, err = io.ReadAll(r)
			r.Close()
			if err != nil {
				return nil, ReadInfo{}, err
			}
		}
	}
	if body == nil {
		return nil, ReadInfo{}, errors.New("no 3D/3dmodel.model part")
	}
	var info ReadInfo
	m := &Mesh{}
	d := xml.NewDecoder(bytes.NewReader(body))
	var metaName string
	var text strings.Builder
	attr := func(e xml.StartElement, name string) string {
		for _, a := range e.Attr {
			if a.Name.Local == name {
				return a.Value
			}
		}
		return ""
	}
	for {
		tok, err := d.Token()
		if err == io.EOF {
			break
		}
		if err != nil {
			return nil, ReadInfo{}, err
		}
		switch e := tok.(type) {
		case xml.StartElement:
			switch e.Name.Local {
			case "model":
				info.Unit = attr(e, "unit")
			case "metadata":
				metaName = attr(e, "name")
				text.Reset()
			case "vertex":
				for _, n := range []string{"x", "y", "z"} {
					v, err := strconv.ParseFloat(attr(e, n), 64)
					if err != nil {
						return nil, ReadInfo{}, err
					}
					m.V = append(m.V, v)
				}
			case "triangle":
				for _, n := range []string{"v1", "v2", "v3"} {
					v, err := strconv.Atoi(attr(e, n))
					if err != nil {
						return nil, ReadInfo{}, err
					}
					m.T = append(m.T, int32(v))
				}
			case "item":
				info.Transform = attr(e, "transform")
			}
		case xml.CharData:
			if metaName != "" {
				text.Write(e)
			}
		case xml.EndElement:
			if e.Name.Local == "metadata" {
				switch metaName {
				case "Title":
					info.Title = text.String()
				case "tg:settings":
					info.Settings = text.String()
				}
				metaName = ""
			}
		}
	}
	return m, info, nil
}
