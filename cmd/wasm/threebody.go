//go:build js && wasm

package main

import (
	"encoding/json"
	"syscall/js"
	"tangentgarden/engine/threebody"
)

// A three-body request: the reference corpus, or a history
// prepared and sampled once at the request's physical times, or with a
// twin that history and its twin prepared together and compared, their
// samples lifted (docs/architecture.md). Nothing is retained between
// requests: playback seeks among the samples, so it never integrates
// again.
type threeBodyRequest struct {
	Corpus  bool              `json:"corpus"`
	Request threebody.Request `json:"request"`
	Twin    *threebody.Twin   `json:"twin"`
}

type threeBodyCorpus struct {
	Cases []threebody.Case `json:"cases"`
}

func registerThreeBody() {
	js.Global().Set("tangentGardenThreeBody", js.FuncOf(func(this js.Value, args []js.Value) any {
		if len(args) != 1 || len(args[0].String()) > 8192 {
			return `{"error":"three-body request is too large"}`
		}
		var q threeBodyRequest
		if err := json.Unmarshal([]byte(args[0].String()), &q); err != nil {
			return refusal(err)
		}
		if q.Corpus {
			out, err := json.Marshal(threeBodyCorpus{Cases: threebody.Corpus()})
			if err != nil {
				return refusal(err)
			}
			return string(out)
		}
		if q.Twin != nil {
			p, err := threebody.PairRequest{Request: q.Request, Twin: *q.Twin}.Prepare()
			if err != nil {
				return refusal(err)
			}
			return liftReply(p, `{"error":"nonfinite three-body result"}`, nil, nil, map[string]map[string]any{})
		}
		p, err := q.Request.Prepare()
		if err != nil {
			return refusal(err)
		}
		return liftReply(p, `{"error":"nonfinite three-body result"}`, nil, nil, map[string]map[string]any{})
	}))
}
