//go:build js && wasm

package main

import (
	"encoding/json"
	"syscall/js"
	"tangentgarden/engine"
)

// Hyperbolic lace's tiles, edges and motif travel as lifted parallel
// arrays, like the garden's circles. The adapter retains nothing between
// requests.
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
}
