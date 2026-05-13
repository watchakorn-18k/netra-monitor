# ── Stage 1: Build Frontend ────────────────────────
FROM node:22-alpine AS frontend

WORKDIR /build
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci
COPY frontend/ ./
RUN npm run build

# ── Stage 2: Build Go Binary ──────────────────────
FROM golang:1.24-alpine AS backend

RUN apk add --no-cache git

WORKDIR /build
COPY go.mod go.sum ./
RUN go mod download

COPY . .

# Copy built frontend into Go embed path
COPY --from=frontend /build/out ./cmd/server/static/

RUN CGO_ENABLED=0 GOOS=linux go build -ldflags="-s -w" -o /netra-monitor ./cmd/server/

# ── Stage 3: Runtime ───────────────────────────────
FROM alpine:3.21

# Install podman client so the app can talk to the host's Podman via socket
RUN apk add --no-cache ca-certificates tzdata podman

COPY --from=backend /netra-monitor /usr/local/bin/netra-monitor

# Must run as root to access host podman socket and system info
EXPOSE 20265

HEALTHCHECK --interval=10s --timeout=3s --start-period=5s --retries=3 \
  CMD wget -qO- http://localhost:20265/api/stats || exit 1

ENTRYPOINT ["netra-monitor"]
