.PHONY: build run clean dev frontend static docker

# ═══════════════════════════════════════════════════
# Netra Monitor — Build System
#
# Source files:
#   frontend/     ← Next.js source (edit UI here)
#   static/       ← Built frontend (committed, source of truth for Go embed)
#   cmd/server/   ← Go entry point
#   internal/     ← Go clean architecture
#
# Build flow:
#   frontend/ → npm run build → static/ → go build → netra-monitor binary
# ═══════════════════════════════════════════════════

# Build everything: frontend + Go binary
build: static
	CGO_ENABLED=0 go build -ldflags="-s -w" -o netra-monitor ./cmd/server/

# Build frontend from Next.js source, output to static/
frontend:
	cd frontend && npm install && npm run build
	rm -rf static/*
	cp -r frontend/out/* static/

# Copy static/ to Go embed path (used by both build targets)
static:
	@mkdir -p cmd/server/static
	@cp static/index.html cmd/server/static/index.html 2>/dev/null || true

# Build and run
run: build
	./netra-monitor

# Dev mode (no auth)
dev: build
	./netra-monitor

# Clean all build artifacts
clean:
	rm -f netra-monitor
	rm -rf cmd/server/static
	rm -rf frontend/out
	rm -rf frontend/.next

# Docker build
docker:
	docker build -t netra-monitor .
