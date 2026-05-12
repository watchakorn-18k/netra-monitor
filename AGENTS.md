# Netra Monitor — Agent Instructions

## Architecture

```
frontend/          ← Next.js source (edit UI here)
  src/app/page.tsx ← Main dashboard component
static/            ← Built frontend (Go embed source of truth)
cmd/server/        ← Go entry point (embeds static/)
internal/          ← Go clean architecture (handler, service, repository, model)
```

## Build Flow

```
frontend/ → npm run build → static/ → go build → netra-monitor binary
```

**IMPORTANT: After ANY change to `frontend/` files, always rebuild and deploy to `static/`:**

```bash
cd frontend && npm run build
rm -rf ../static/*
cp -r out/* ../static/
```

Or use Makefile:

```bash
make frontend   # builds Next.js → copies to static/
make build       # frontend + go build → netra-monitor binary
```

**Never skip this step.** The Go binary serves files from `static/` via embed. Changes to `frontend/` won't take effect in production until rebuilt and copied.

## Dev Mode

- Frontend dev server: `npx next dev --port 3000 --hostname 0.0.0.0`
- Go backend dev: `PORT=3001 $HOME/go/bin/go run ./cmd/server` (serves API on :3001)
- Next.js proxies `/api/*` → `localhost:3001` via `next.config.ts` rewrites in dev
- Production Go server default port: `20265` (`PORT` can override)
- After dev changes are verified, **always run `make frontend`** before committing

## API

- `GET /api/stats` — Returns full system stats JSON
- `POST /api/login` — Auth with password
- `POST /api/logout` — Clear session
- `POST /api/kill/{pid}` — Kill process (requires auth)

## Key Rules

1. **Always rebuild after frontend changes** — `make frontend` or manual build+copy
2. **Validate API data before use** — Check nested fields exist before accessing (e.g., `data?.memory?.total`)
3. **Use `useRef` for mutable values in hooks** — Not `useState` for values that shouldn't trigger re-renders
4. **Dev frontend port**: `3000`
5. **Dev backend port**: `3001`
6. **Production default port**: `20265`
7. **Go binary path**: `$HOME/go/bin/go` (not in default PATH)
