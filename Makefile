.PHONY: build run clean dev frontend docker

# ═══════════════════════════════════════════════════
# Netra Monitor — Build System
#
# Source files:
#   frontend/          ← Next.js source (edit UI here)
#   cmd/server/static/ ← Generated frontend embed dir (ignored)
#   cmd/server/        ← Go entry point
#   internal/          ← Go clean architecture
#
# Build flow:
#   frontend/ → npm run build → cmd/server/static/ → go build
# ═══════════════════════════════════════════════════

GO ?= $(HOME)/go/bin/go

# Build everything: frontend + Go binary
build: frontend
	$(GO) build -o netra-monitor ./cmd/server/

# Build frontend directly into Go embed path
frontend:
	cd frontend && npm ci && npm run build
	rm -rf cmd/server/static
	mkdir -p cmd/server/static
	cp -r frontend/out/* cmd/server/static/

# Build and run production binary (default :20265)
run: build
	./netra-monitor

# Dev mode: frontend dev server still runs separately on :3000
# Backend API uses :3001 for Next.js rewrites.
dev:
	PORT=3001 $(GO) run ./cmd/server

# Clean all build artifacts
clean:
	rm -f netra-monitor
	rm -rf cmd/server/static
	rm -rf frontend/out
	rm -rf frontend/.next

# Docker build
docker:
	docker build -t netra-monitor .
