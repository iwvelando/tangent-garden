.PHONY: install wasm bench test test-go test-wasm test-browser test-webkit typecheck vet format format-check build dev dev-lan preview check clean share-card thumbnails

install:
	npm ci
wasm:
	npm run wasm
# engine3 alone takes 6–9 minutes under -race on CI's runners, close to
# go test's default 10-minute limit.
test-go:
	go test -race -cover -timeout 20m ./...
test-wasm: wasm
	node scripts/test-wasm.mjs
	node scripts/test-dev-worker.mjs
# Times large implicit surfaces; ARGS="--compare <site or directory>" adds another engine.
bench: wasm
	node scripts/bench-implicit.mjs $(ARGS)
typecheck:
	npx tsc --noEmit
vet:
	go vet ./...
	GOOS=js GOARCH=wasm go vet ./cmd/wasm
format:
	gofmt -w engine engine3 engine4 cmd
	npm run format
format-check:
	@files=$$(gofmt -l engine engine3 engine4 cmd); if [ -n "$$files" ]; then printf 'Run gofmt on:\n%s\n' "$$files"; exit 1; fi
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
# Reachable from other devices on the local network, such as a phone.
dev-lan:
	npm run dev:lan
preview:
	npm run preview
clean:
	rm -rf dist public/engine.wasm public/wasm_exec.js public/GO-LICENSE.txt public/LICENSE.txt public/THIRD-PARTY-NOTICES.txt
thumbnails: build
	node scripts/build-thumbnails.mjs
