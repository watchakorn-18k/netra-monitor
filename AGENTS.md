# Netra Monitor — Agent Instructions

## Architecture

```
frontend/              ← Next.js source (edit UI here)
  src/app/page.tsx     ← Main dashboard component
cmd/server/static/     ← Generated frontend embed dir (ignored)
cmd/server/            ← Go entry point (embeds cmd/server/static/)
internal/              ← Go clean architecture (handler, service, repository, model)
```

## Build Flow

```
frontend/ → npm run build → cmd/server/static/ → go build → netra-monitor binary
```

**IMPORTANT: After ANY change to `frontend/` files, always rebuild before production build/commit:**

```bash
make frontend   # builds Next.js → cmd/server/static/
make build      # frontend + go build → netra-monitor binary
```

`static/` root is legacy and ignored. Do not edit or commit it. Dockerfile builds frontend itself and copies `frontend/out/*` directly into `cmd/server/static/` before Go build.

## Dev Mode

- Frontend dev server: `npx next dev --port 3000 --hostname 0.0.0.0`
- Go backend dev: `PORT=3001 $HOME/go/bin/go run ./cmd/server` (serves API on :3001)
- Next.js proxies `/api/*` → `localhost:3001` via `next.config.ts` rewrites in dev
- Production Go server default port: `20265` (`PORT` can override)
- After dev changes are verified, **always run `make build`** before committing production changes

## API

- `GET /api/stats` — Returns full system stats JSON
- `POST /api/login` — Auth with password
- `POST /api/logout` — Clear session
- `POST /api/kill/{pid}` — Kill process (requires auth)

## Key Rules

1. **Always rebuild after frontend changes** — `make build` for production-ready binary
2. **Do not commit generated root `static/`** — it is ignored legacy output
3. **Validate API data before use** — Check nested fields exist before accessing (e.g., `data?.memory?.total`)
4. **Use `useRef` for mutable values in hooks** — Not `useState` for values that shouldn't trigger re-renders
5. **Dev frontend port**: `3000`
6. **Dev backend port**: `3001`
7. **Production default port**: `20265`
8. **Go binary path**: `$HOME/go/bin/go` (not in default PATH)
