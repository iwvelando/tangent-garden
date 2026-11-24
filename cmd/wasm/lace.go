//go:build js && wasm

package main

import (
	"encoding/json"
	"syscall/js"
	"tangentgarden/engine"
)

// frozenLace is the one generated patch a motion's frames move: the
// latest frame request's source. A frame for other generation settings,
// or under a window for another window or static isometry, replaces it; it
// lives as long as the worker.
var frozenLace *engine.LaceSource

// Hyperbolic lace's tiles, edges and motif travel as lifted parallel
// arrays, like the garden's circles. tangentGardenLace generates a patch
// and places it under its isometry, retaining nothing.
// tangentGardenLaceFrame moves the frozen patch to one time of a motion
// and replies with the moved geometry alone.
func registerLace() {
	js.Global().Set("tangentGardenLace", js.FuncOf(func(this js.Value, args []js.Value) any {
		if len(args) != 1 || len(args[0].String()) > 4096 {
			return `{"error":"lace request is too large"}`
		}
		var q engine.LaceRequest
		if err := json.Unmarshal([]byte(args[0].String()), &q); err != nil {
			return refusal(err)
		}
		result, err := engine.ComputeLace(q)
		if err != nil {
			return refusal(err)
		}
		return liftReply(&result, `{"error":"nonfinite lace result"}`, nil, nil, map[string]map[string]any{})
	}))
	js.Global().Set("tangentGardenLaceFrame", js.FuncOf(func(this js.Value, args []js.Value) any {
		if len(args) != 1 || len(args[0].String()) > 4096 {
			return `{"error":"lace frame request is too large"}`
		}
		var f engine.LaceFrameRequest
		if err := json.Unmarshal([]byte(args[0].String()), &f); err != nil {
			return refusal(err)
		}
		if frozenLace == nil || !frozenLace.Matches(f.Lace) {
			source, err := engine.NewLaceSource(f.Lace)
			if err != nil {
				return refusal(err)
			}
			frozenLace = source
		}
		frame, err := frozenLace.Frame(f)
		if err != nil {
			return refusal(err)
		}
		return liftReply(&frame, `{"error":"nonfinite lace frame"}`, nil, nil, map[string]map[string]any{})
	}))
}
