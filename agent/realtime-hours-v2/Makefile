.PHONY: test build-windows verify

test:
	go test -race ./...

build-windows:
	mkdir -p dist
	GOOS=windows GOARCH=amd64 CGO_ENABLED=0 go build -trimpath -ldflags "-s -w -H=windowsgui" -o dist/RealtimeHoursAgentV2.exe ./cmd/realtime-hours-agent

verify: test build-windows
	node --check extension/background.js
	node -e 'JSON.parse(require("fs").readFileSync("extension/manifest.json","utf8"))'
	./scripts/verify-no-secrets.sh .
