# Netra Monitor — Project Instructions

## Overview

Real-time VPS resource monitoring dashboard.
Go backend (Clean Architecture) + Next.js frontend, compiled into a single binary (~9 MB, ~10 MB RAM).

## Project Structure

```
netra-monitor/
├── frontend/                          # Next.js source (edit UI here)
│   ├── src/app/
│   │   ├── page.tsx                   # Dashboard page (React)
│   │   ├── layout.tsx                 # Root layout
│   │   └── globals.css                # Tailwind + shadcn/ui theme
│   ├── next.config.ts                 # output: "export"
│   └── package.json
│
├── static/                            # Built frontend (source of truth for Go embed)
│   └── index.html                     # ← npm run build outputs here
│
├── cmd/server/
│   ├── main.go                        # Entry point, embeds static/
│   └── static/                        # Go embed target (auto-copied by Makefile)
│       └── index.html                 # DO NOT EDIT — copied from static/
│
├── internal/
│   ├── domain/
│   │   └── stats.go                   # Entities + SystemRepository interface
│   ├── repository/
│   │   └── system/
│   │       └── gopsutil.go            # gopsutil adapter (CPU, mem, disk, net, process, kill)
│   ├── usecase/
│   │   └── monitor/
│   │       └── monitor.go             # Business logic: Collect() + Kill() + history buffer
│   └── delivery/
│       └── http/
│           ├── handler.go             # HTTP handlers (stats, login, logout, kill)
│           └── router.go              # Route definitions
│
├── Makefile                           # Build system
├── Dockerfile                         # Multi-stage (Node → Go → Alpine)
├── .github/workflows/docker.yml      # CI: build + push to GHCR
└── README.md
```

## Architecture

```
Clean Architecture dependency rule:

delivery/http  →  usecase/monitor  →  domain  ←  repository/system
```

- **domain** — pure Go types + `SystemRepository` interface
- **repository/system** — gopsutil implementation (adapter)
- **usecase/monitor** — `Collect()` gathers stats, `Kill(pid)` terminates process, history ring buffer
- **delivery/http** — HTTP handlers + router, auth middleware

## Build Flow

```
frontend/  →  npm run build  →  static/index.html  →  cp →  cmd/server/static/  →  go build  →  netra-monitor
```

**Always edit frontend source in `frontend/`, never edit `cmd/server/static/` directly.**

## Commands

```bash
# Full build (frontend + Go)
make build

# Build and run
make run

# Build frontend only
make frontend

# Run with auth
AUTH_PASSWORD=mys3cret ./netra-monitor

# Run without auth (public, kill blocked)
./netra-monitor

# Docker
make docker
docker run -p 3001:3001 -e AUTH_PASSWORD=mys3cret --cap-add SYS_PTRACE netra-monitor
```

## API Endpoints

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/api/stats` | No | System metrics + auth status |
| POST | `/api/login` | No | Login with `{password}` |
| POST | `/api/logout` | No | Clear session |
| POST | `/api/kill/{pid}` | **Yes** | Kill process by PID |

## Auth System

- Env var: `AUTH_PASSWORD`
- **Not set** = viewing public, kill PID is **blocked**
- **Set** = must login to kill processes
- Session: HMAC-signed cookie, 7 day expiry
- No database — key generated on startup

## Frontend (Next.js)

- Located in `frontend/`
- Uses shadcn/ui + Tailwind CSS
- `next.config.ts` has `output: "export"` — builds to static HTML
- Icons: Lucide SVG (inline)
- Theme: pure black (`#09090b`), no glow
- Auto-refresh every 2 seconds via polling `/api/stats`

## Key Dependencies

**Go:**
- `github.com/shirou/gopsutil/v3` — system metrics

**Frontend:**
- Next.js, React, Tailwind CSS, shadcn/ui

## Environment Variables

| Name | Default | Description |
|------|---------|-------------|
| `PORT` | `3001` | HTTP listen port |
| `AUTH_PASSWORD` | (empty) | Password for kill access. Empty = auth disabled, kill blocked |

## Notes

- Go embed uses `//go:embed all:static` in `cmd/server/main.go`
- `fs.Sub(staticFS, "static")` strips prefix so `/` serves `index.html`
- Docker needs `--cap-add SYS_PTRACE` for process metrics
- History is in-memory ring buffer (60 points, lost on restart)
- HMAC key is random per restart — all sessions invalidated on restart
