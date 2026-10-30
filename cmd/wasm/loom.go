//go:build js && wasm

package main

import (
	"encoding/json"
	"syscall/js"
	"tangentgarden/engine"
)

func registerLoom() {
	for _, pointOnly := range []bool{false, true} {
		fn := js.FuncOf(func(this js.Value, args []js.Value) any {
			if len(args) != 1 || len(args[0].String()) > 65536 {
				return `{"error":"loom request is too large"}`
			}
			var q engine.LoomRequest
			if err := json.Unmarshal([]byte(args[0].String()), &q); err != nil {
				return refusal(err)
			}
			if pointOnly {
				marker, err := engine.LoomPoint(q)
				if err != nil {
					return refusal(err)
				}
				b, err := json.Marshal(map[string]any{"marker": marker})
				if err != nil {
					return refusal(err)
				}
				return string(b)
			}
			result, err := engine.ComputeLoom(q)
			if err != nil {
				return refusal(err)
			}
			return liftReply(&result, `{"error":"nonfinite loom result"}`, nil, nil, map[string]map[string]any{})
		})
		name := "tangentGardenLoom"
		if pointOnly {
			name += "Point"
		}
		js.Global().Set(name, fn)
	}
}
