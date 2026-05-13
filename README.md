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

### Podman (Rootless) — Recommended for VPS

```bash
podman run -d \
  --name netra-monitor \
  --restart unless-stopped \
  --pid=host \
  --network=host \
  -e AUTH_PASSWORD=mys3cret \
  -e CONTAINER_HOST=unix:///run/podman/podman.sock \
  -v /run/user/$(id -u)/podman/podman.sock:/run/podman/podman.sock \
  -v /proc:/host_proc:ro \
  -v /sys:/host_sys:ro \
  -v /etc:/host_etc:ro \
  -v /var/log:/var/log:ro \
  ghcr.io/watchakorn-18k/netra-monitor:latest
```

> **Note:** `--network=host` makes the app see real host network stats and listen directly on port 20265 (no `-p` needed).

<details>
<summary>🐳 Podman (Rootful)</summary>

```bash
podman run -d \
  --name netra-monitor \
  --restart unless-stopped \
  --pid=host \
  --network=host \
  -e AUTH_PASSWORD=mys3cret \
  -e CONTAINER_HOST=unix:///run/podman/podman.sock \
  -v /run/podman/podman.sock:/run/podman/podman.sock \
  -v /proc:/host_proc:ro \
  -v /sys:/host_sys:ro \
  -v /etc:/host_etc:ro \
  -v /var/log:/var/log:ro \
  ghcr.io/watchakorn-18k/netra-monitor:latest
```
</details>

<details>
<summary>🐳 Docker</summary>

```bash
docker run -d \
  --name netra-monitor \
  --restart unless-stopped \
  --pid=host \
  --network=host \
  -e AUTH_PASSWORD=mys3cret \
  --cap-add SYS_PTRACE \
  -v /run/docker.sock:/run/docker.sock \
  -v /proc:/host_proc:ro \
  -v /sys:/host_sys:ro \
  -v /etc:/host_etc:ro \
  -v /var/log:/var/log:ro \
  ghcr.io/watchakorn-18k/netra-monitor:latest
```
</details>

<details>
<summary>⚙️ systemd service (auto-start on boot)</summary>

Create `~/.config/systemd/user/container-netra-monitor.service`:

```ini
[Unit]
Description=Netra Monitor Container
After=podman.service

[Service]
Type=simple
ExecStartPre=-/usr/bin/podman rm -f netra-monitor
ExecStart=/usr/bin/podman run \
  --name netra-monitor \
  --pid=host \
  --network=host \
  -e AUTH_PASSWORD=mys3cret \
  -e CONTAINER_HOST=unix:///run/podman/podman.sock \
  -v /run/user/%U/podman/podman.sock:/run/podman/podman.sock \
  -v /proc:/host_proc:ro \
  -v /sys:/host_sys:ro \
  -v /etc:/host_etc:ro \
  -v /var/log:/var/log:ro \
  --restart unless-stopped \
  ghcr.io/watchakorn-18k/netra-monitor:latest
ExecStop=/usr/bin/podman stop -t 10 netra-monitor

[Install]
WantedBy=default.target
```

Then:
```bash
systemctl --user daemon-reload
systemctl --user enable --now container-netra-monitor
```
</details>

### Binary (bare metal)

```bash
make build
AUTH_PASSWORD=mys3cret ./netra-monitor
```

Open `http://your-vps-ip:20265`

### Why the extra flags?

Since Netra Monitor runs **inside a container**, it needs access to the host to collect metrics:

| Flag / Mount | Purpose |
|---|---|
| `--pid=host` | See host processes (top processes, kill/restart) |
| `--network=host` | See real host network interfaces & traffic stats |
| `-v /proc:/host_proc:ro` | Read host CPU, RAM, Swap stats |
| `-v /sys:/host_sys:ro` | Read host hardware & disk info |
| `-v /etc:/host_etc:ro` | Show correct OS name, version, hostname |
| `-v /var/log:/var/log:ro` | File browser can read host logs |
| `-v .../podman.sock` | Manage Podman containers & images |
| `-e CONTAINER_HOST=...` | Tell podman client where the socket is |
| `-e AUTH_PASSWORD=...` | Set login password for management actions |

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
| `CONTAINER_HOST` | — | Podman/Docker socket path (e.g. `unix:///run/podman/podman.sock`) |
| `SSL_DOMAINS` | — | Comma-separated domains for SSL certificate expiry monitoring (e.g. `example.com,api.example.com`) |
| `COMPOSE_DIR` | `/opt/stacks` | Directory to scan for compose stacks |
| `UPTIME_URLS` | — | Comma-separated URLs for uptime health checks (e.g. `https://example.com,https://api.example.com/health`) |

## Performance

| Metric | Value |
|--------|-------|
| Binary size | ~9 MB |
| RAM usage | ~10-15 MB |
| Docker image | ~120 MB (Alpine + podman client) |

## Tech Stack

- **Backend**: Go 1.24 + [gopsutil](https://github.com/shirou/gopsutil)
- **Frontend**: Next.js 16 + shadcn/ui + Tailwind CSS + Lucide icons
- **Deploy**: Single binary or Docker (multi-stage build)

## License

MIT
