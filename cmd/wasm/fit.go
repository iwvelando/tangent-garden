//go:build js && wasm

package main

import (
	"bytes"
	"encoding/json"
	"fmt"
	"syscall/js"
	"tangentgarden/engine"
)

// One cache belongs to this disposable worker. Decode points into bounded
// storage before handing the request to Go's numerical fitting operation.
func registerFourierFit() {
	var current *engine.FourierFit
	fn := js.FuncOf(func(this js.Value, args []js.Value) any {
		if len(args) != 1 || len(args[0].String()) > 524288 {
			current = nil
			return `{"error":"outline request is too large"}`
		}
		var q struct {
			Points     json.RawMessage           `json:"points"`
			Closed     bool                      `json:"closed"`
			Close      bool                      `json:"close"`
			Count      int                       `json:"count"`
			Correction *engine.FourierCorrection `json:"correction"`
			Source     *struct {
				Curve engine.Curve `json:"curve"`
				Input string       `json:"input"`
			} `json:"source"`
		}
		if err := json.Unmarshal([]byte(args[0].String()), &q); err != nil {
			current = nil
			return refusal(err)
		}
		var outline *engine.FourierOutline
		var edited, closed []engine.Vec
		if q.Close && (q.Points == nil || q.Source != nil || !q.Closed || q.Correction != nil) {
			current = nil
			return refusal(fmt.Errorf("close needs one explicitly closed outline"))
		}
		if q.Correction != nil && (q.Points == nil || q.Source != nil || !q.Closed) {
			current = nil
			return refusal(fmt.Errorf("correction needs one explicitly closed outline"))
		}
		if q.Source != nil && q.Points != nil {
			current = nil
			return refusal(fmt.Errorf("choose one source outline"))
		}
		if q.Source != nil {
			current = nil
			o, err := engine.FourierCurveOutline(q.Source.Curve, q.Source.Input)
			if err != nil {
				return refusal(err)
			}
			// An open source waits for an explicit close: only its outline
			// returns, with no fit cached for a later term selection.
			if o.Open {
				b, err := json.Marshal(struct {
					Outline engine.FourierOutline `json:"outline"`
				}{o})
				if err != nil {
					return refusal(err)
				}
				return string(b)
			}
			current, err = engine.FitFourier(o.Points, true)
			if err != nil {
				return refusal(err)
			}
			outline = &o
			outline.PreviewRadius = current.PreviewRadius()
		} else if q.Points != nil {
			current = nil
			var points [engine.FourierFitMaxPoints]engine.Vec
			d := json.NewDecoder(bytes.NewReader(q.Points))
			if token, err := d.Token(); err != nil || token != json.Delim('[') {
				return refusal(fmt.Errorf("outline points must be an array"))
			}
			n := 0
			for d.More() {
				if n == len(points) {
					return refusal(fmt.Errorf("an outline accepts at most 4096 points"))
				}
				if err := d.Decode(&points[n]); err != nil {
					return refusal(err)
				}
				n++
			}
			var err error
			input := points[:n]
			if q.Correction != nil {
				edited, err = engine.CorrectFourierOutline(input, *q.Correction)
				if err != nil {
					return refusal(err)
				}
				input = edited
			}
			if q.Close {
				closed = engine.CloseFourierOutline(input)
				input = closed
			}
			current, err = engine.FitFourier(input, q.Closed)
			if err != nil {
				return refusal(err)
			}
		}
		if current == nil {
			return refusal(fmt.Errorf("close a valid outline before selecting terms"))
		}
		r, err := current.Select(q.Count)
		if err != nil {
			return refusal(err)
		}
		b, err := json.Marshal(struct {
			engine.FourierFitResult
			Outline       *engine.FourierOutline `json:"outline,omitempty"`
			EditedPoints  []engine.Vec           `json:"editedPoints,omitempty"`
			ClosedPoints  []engine.Vec           `json:"closedPoints,omitempty"`
			PreviewRadius float64                `json:"previewRadius"`
		}{r, outline, edited, closed, current.PreviewRadius()})
		if err != nil {
			return refusal(err)
		}
		return string(b)
	})
	js.Global().Set("tangentGardenFit", fn)
}
