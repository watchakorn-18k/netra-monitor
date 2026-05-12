# Netra Monitor

Real-time VPS resource monitoring dashboard — Go backend + Next.js frontend, single binary, ~10 MB RAM.

![Go](https://img.shields.io/badge/Go-1.24-00ADD8?logo=go)
![Next.js](https://img.shields.io/badge/Next.js-16-000000?logo=next.js)
![Docker](https://img.shields.io/badge/Docker-Ready-2496ED?logo=docker)
![RAM](https://img.shields.io/badge/RAM-~10_MB-10B981)

## Features

- **CPU** — total usage, per-core bars, sparkline history
- **Memory** — RAM + Swap with progress bars
- **Disk** — partition usage + I/O counters
- **Network** — download/upload speed + sparkline history
- **Processes** — top 8 by CPU usage, **kill PID** with auth
- **Auth** — password-protected kill access, public viewing
- Auto-refresh every 2 seconds. Pure black theme, zero glow.

## Quick Start

### Docker

```bash
docker run -d \
  --name netra-monitor \
  --restart unless-stopped \
  -p 3001:3001 \
  -e AUTH_PASSWORD=mys3cret \
  --cap-add SYS_PTRACE \
  ghcr.io/watchakorn-18k/netra-monitor:latest
```

### Binary

```bash
make build
AUTH_PASSWORD=mys3cret ./netra-monitor
```

Open `http://your-vps-ip:3001`

## Auth & Kill Process

| AUTH_PASSWORD | View Dashboard | Kill PID |
|---------------|----------------|----------|
| Not set | ✅ Public | ❌ Blocked |
| Set | ✅ Public | 🔐 Login required |

Login via the UI to unlock the **Kill** button on each process.

## Architecture

```
Clean Architecture (Go)
┌─────────────────────────────────────────────┐
│ cmd/server/main.go          ← Entry point   │
│ internal/                                    │
│ ├── domain/stats.go         ← Entities      │
│ ├── repository/system/      ← Data source   │
│ ├── usecase/monitor/        ← Business logic│
│ └── delivery/http/          ← HTTP + Auth   │
│ frontend/                   ← Next.js UI    │
│ static/                     ← Built frontend│
└─────────────────────────────────────────────┘
```

## Build from Source

```bash
# Requires Go 1.24+ and Node.js 22+
make build          # build frontend + Go binary
make run            # build and run
make frontend       # build frontend only
make docker         # docker build
```

## API

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/api/stats` | No | System metrics |
| POST | `/api/login` | No | `{ "password": "..." }` |
| POST | `/api/logout` | No | Clear session |
| POST | `/api/kill/{pid}` | Yes | Kill process |

## Environment Variables

| Name | Default | Description |
|------|---------|-------------|
| `PORT` | `3001` | HTTP listen port |
| `AUTH_PASSWORD` | (empty) | Password for kill access |

## Performance

| Metric | Value |
|--------|-------|
| Binary size | ~9 MB |
| RAM usage | ~10-15 MB |
| Docker image | ~15 MB (Alpine) |

## Tech Stack

- **Backend**: Go 1.24 + [gopsutil](https://github.com/shirou/gopsutil)
- **Frontend**: Next.js 16 + shadcn/ui + Tailwind CSS + Lucide icons
- **Deploy**: Single binary or Docker (multi-stage build)

## License

MIT
