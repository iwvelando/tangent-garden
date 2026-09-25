.PHONY: install wasm test test-go test-wasm test-browser test-webkit typecheck vet format format-check build dev preview check clean share-card

install:
	npm ci
wasm:
	npm run wasm
test-go:
	go test -race -cover ./...
test-wasm: wasm
	node scripts/test-wasm.mjs
typecheck:
	npx tsc --noEmit
vet:
	go vet ./...
	GOOS=js GOARCH=wasm go vet ./cmd/wasm
format:
	gofmt -w engine cmd
	npm run format
format-check:
	@files=$$(gofmt -l engine cmd); if [ -n "$$files" ]; then printf 'Run gofmt on:\n%s\n' "$$files"; exit 1; fi
	npm run format:check
test: test-go test-wasm typecheck
test-browser: build
	npx playwright test
test-webkit: build
	WEBKIT=1 npx playwright test --project=webkit
build:
	npm run build
share-card: build
	node scripts/build-share-card.mjs
check: format-check vet test build
dev:
	npm run dev
preview:
	npm run preview
clean:
	rm -rf dist public/engine.wasm public/wasm_exec.js public/GO-LICENSE.txt public/LICENSE.txt public/THIRD-PARTY-NOTICES.txt
