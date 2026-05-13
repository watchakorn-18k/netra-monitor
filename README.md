# Netra Monitor

Real-time VPS resource monitoring dashboard — Go backend + Next.js frontend, single binary, ~10 MB RAM.

![Go](https://img.shields.io/badge/Go-1.24-00ADD8?logo=go)
![Next.js](https://img.shields.io/badge/Next.js-16-000000?logo=next.js)
![Docker](https://img.shields.io/badge/Docker-Ready-2496ED?logo=docker)
![RAM](https://img.shields.io/badge/RAM-~10_MB-10B981)

## Features

- **CPU** — total usage, per-core bars, sparkline history
- **Memory** — RAM + Swap with progress bars, top 5 memory consumers
- **Disk** — partition usage + I/O counters
- **Network** — download/upload speed + sparkline history
- **Processes** — top 20 by CPU, top 5 by memory, service name detection
  - **Kill** / **Restart** process (auth required)
- **Podman Containers** — list all containers (running + stopped)
  - **Start** / **Stop** / **Restart** buttons (visible to all, requires auth)
  - **Remove** stopped containers (auth required)
  - Show port mappings and memory limits
- **Podman Images** — list all images with size
  - **Remove** individual images (auth required)
  - **Prune** dangling/unused images (auth required, safe — never removes images used by containers)
- **Auth** — password-protected management, public dashboard viewing
  - Default password: `123456`
  - Change via `AUTH_PASSWORD` env or `.env` file
  - Remember password option (localStorage)
- Auto-refresh every 2 seconds. Pure black theme, zero glow.

## Quick Start

### Docker

```bash
docker run -d \
  --name netra-monitor \
  --restart unless-stopped \
  -p 20265:20265 \
  -e AUTH_PASSWORD=mys3cret \
  --cap-add SYS_PTRACE \
  -v /run/podman/podman.sock:/run/podman/podman.sock:ro \
  ghcr.io/watchakorn-18k/netra-monitor:latest
```

### Binary

```bash
make build
AUTH_PASSWORD=mys3cret ./netra-monitor
```

Open `http://your-vps-ip:20265`

## Auth System

| AUTH_PASSWORD | View Dashboard | Start/Stop/Restart Container | Kill/Restart PID | Remove Container | Remove/Prune Image |
|---------------|----------------|------------------------------|------------------|------------------|---------------------|
| Not set       | ✅ Public       | ❌ Blocked                   | ❌ Blocked        | ❌ Blocked        | ❌ Blocked           |
| Set           | ✅ Public       | 🔐 Login required            | 🔐 Login required | 🔐 Login required | 🔐 Login required    |

> **Default password:** `123456` — change by setting `AUTH_PASSWORD` in env or `.env` file

Login via the **Admin Login** button in the header to unlock management actions.

## API

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/api/stats` | No | Full system metrics (CPU, RAM, disk, network, processes, containers, images) |
| POST | `/api/login` | No | `{ "password": "..." }` — set cookie |
| POST | `/api/logout` | No | Clear session cookie |
| POST | `/api/kill/{pid}` | Yes | Kill process by PID |
| POST | `/api/restart/{pid}` | Yes | Restart service owning PID |
| POST | `/api/container/start/{id}` | Yes | Start container |
| POST | `/api/container/stop/{id}` | Yes | Stop container |
| POST | `/api/container/restart/{id}` | Yes | Restart container |
| POST | `/api/container/remove/{id}` | Yes | Remove stopped container |
| POST | `/api/image/remove/{id}` | Yes | Remove image |
| POST | `/api/image/prune` | Yes | Prune dangling images (safe) |

## Architecture

```
Clean Architecture (Go)
┌─────────────────────────────────────────────┐
│ cmd/server/main.go          ← Entry point   │
│ internal/                                    │
│ ├── model/stats.go          ← Entities      │
│ ├── repository/system/      ← Data source   │
│ ├── service/monitor/        ← Business logic│
│ └── handler/http/           ← HTTP + Auth   │
│ frontend/                   ← Next.js UI    │
│ cmd/server/static/          ← Generated embed│
└─────────────────────────────────────────────┘
```

## Build from Source

```bash
# Requires Go 1.24+ and Node.js 22+
make build          # build frontend + Go binary
make run            # build and run
make frontend       # build frontend into cmd/server/static/
make docker         # docker build
```

## Development

```bash
# terminal 1: backend API
PORT=3001 go run ./cmd/server

# terminal 2: frontend dev server
cd frontend
npx next dev --port 3000 --hostname 0.0.0.0
```

Open `http://localhost:3000` for dev. Production binary defaults to port `20265`.

## Environment Variables

| Name | Default | Description |
|------|---------|-------------|
| `PORT` | `20265` | HTTP listen port |
| `AUTH_PASSWORD` | `123456` | Password for management actions |

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
