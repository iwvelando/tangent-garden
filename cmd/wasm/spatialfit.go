//go:build js && wasm

package main

import (
	"encoding/json"
	"errors"
	"fmt"
	"syscall/js"
	"tangentgarden/engine3"
)

// One fit belongs to this disposable worker, as in registerFourierFit. A
// request naming a source replaces it, returning the source's outline once for
// a transient comparison; a count alone selects from it. An open source waits
// for an explicit close: without one, only its outline returns, and no fit is
// kept for a later selection. Numerical decisions are Go's. The outline leaves
// the JSON, as every spatial array does.
func registerSpatialFit() {
	var current *engine3.HarmonicFit
	js.Global().Set("tangentGardenSpatialFit", js.FuncOf(func(this js.Value, args []js.Value) any {
		if len(args) != 1 || len(args[0].String()) > 524288 {
			current = nil
			return `{"error":"spatial fit request is too large"}`
		}
		var q struct {
			Source    *engine3.Request `json:"source"`
			Parameter string           `json:"parameter"`
			Count     int              `json:"count"`
			Close     bool             `json:"close"`
		}
		if err := json.Unmarshal([]byte(args[0].String()), &q); err != nil {
			current = nil
			return refusal(err)
		}
		var outline *engine3.HarmonicOutline
		if q.Source != nil {
			current = nil
			fit := engine3.FitHarmonicSource
			if q.Close {
				fit = engine3.CloseHarmonicSource
			}
			f, err := fit(*q.Source, q.Parameter)
			var open *engine3.HarmonicOpenError
			if errors.As(err, &open) {
				return liftReply(&struct {
					Outline engine3.HarmonicOutline `json:"outline"`
				}{open.Outline}, `{"error":"nonfinite spatial fit"}`, nil, nil, map[string]map[string]any{})
			}
			if err != nil {
				return refusal(err)
			}
			current = f
			o := f.Outline()
			outline = &o
		}
		if current == nil {
			return refusal(fmt.Errorf("choose a source before selecting terms"))
		}
		result, err := current.Select(q.Count)
		if err != nil {
			return refusal(err)
		}
		return liftReply(&struct {
			engine3.HarmonicFitResult
			Outline *engine3.HarmonicOutline `json:"outline,omitempty"`
		}{result, outline}, `{"error":"nonfinite spatial fit"}`, nil, nil, map[string]map[string]any{})
	}))
}

// A harmonic study's chain at every sample, asked for only when a reveal needs
// it, so the study's own reply is what it always was.
func registerHarmonicChains() {
	js.Global().Set("tangentGardenHarmonicChains", js.FuncOf(func(this js.Value, args []js.Value) any {
		if len(args) != 1 || len(args[0].String()) > 524288 {
			return `{"error":"harmonic chain request is too large"}`
		}
		var q engine3.Request
		if err := json.Unmarshal([]byte(args[0].String()), &q); err != nil {
			return refusal(err)
		}
		track, err := engine3.HarmonicChains(q)
		if err != nil {
			return refusal(err)
		}
		return liftReply(&track, `{"error":"nonfinite harmonic chain"}`, nil, nil, map[string]map[string]any{})
	}))
}
