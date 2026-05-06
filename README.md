# xZone

xZone is a custom Xbox 360 NXE-era service backend and experiment harness. The repo contains the Node/Express backend, service stubs, request discovery tools, a small browser control panel, and smoke tests.

The original dashboard binaries and local runtime data are intentionally not tracked in git.

## What Is In This Repo

- `xzone/server.js` - Express service host.
- `xzone/routes/` - social, Famestar, titles, avatar, marketplace, ops, and dead-service stubs.
- `xzone/db/schema.js` - sql.js-backed SQLite wrapper and schema setup.
- `xzone-index.html` - browser control panel for checking the backend.
- `xzone/test/smoke.test.js` - smoke tests for core service behavior.

## What Stays Local

These are ignored on purpose:

- `dash.xex`
- `shrdres.xzp`
- `xzone/db/xzone.db`
- `xzone/logs/`
- `xzone/node_modules/`

## Setup

```powershell
cd xzone
npm install
npm start
```

The backend listens on `0.0.0.0:3000` by default.

Useful local URLs:

- `http://localhost:3000/` - health check
- `http://localhost:3000/dashboard` - browser control panel
- `http://localhost:3000/probe.txt` - plain text probe for console/browser testing
- `http://localhost:3000/probe.xml` - XML probe for NXE-era callers
- `http://localhost:3000/stats` - service stats
- `http://localhost:3000/ops/health` - ops health
- `http://localhost:3000/ops/routes` - route inventory
- `http://localhost:3000/ops/requests?limit=200` - recent request summary
- `http://localhost:3000/ops/requests?status=404` - filtered request summary
- `http://localhost:3000/ops/requests?host=xboxlive` - host-filtered request summary
- `http://localhost:3000/ops/unhandled` - recent errors and missing routes
- `http://localhost:3000/ops/export` - JSON export of local service tables

## Request Discovery

Run the backend while the real dashboard is pointed at xZone. The server writes:

- `xzone/logs/all-requests.log` - human-readable request log
- `xzone/logs/all-requests.jsonl` - machine-readable request log

Use `/ops/unhandled` after opening dashboard blades to see which service paths still need proper stubs.
Use `DELETE /ops/requests` from localhost to clear discovery logs before a fresh blade test.

`/ops/*` is available from localhost by default. If you set `XZONE_ADMIN_TOKEN`, remote ops callers must send `X-Admin-Token`.

## Proto / Metro Quick Probe

While the console is still on Proto or Metro, you can sanity-check xZone without NXE installed:

```text
http://YOUR_PC_IP:3000/probe.txt
http://YOUR_PC_IP:3000/probe.xml
http://YOUR_PC_IP:3000/social/heartbeat?gamertag=Colin&xuid=proto-colin&status=Metro
http://YOUR_PC_IP:3000/social/online
```

`X-Gamertag` and `X-XUID` headers still take priority, but query/body auth is enabled by default so simple Neighborhood scripts, launchers, or browser hits can register presence. Set `XZONE_ALLOW_SIMPLE_AUTH=false` if this server is ever exposed outside your LAN.

## Configuration

Environment variables:

- `PORT` - server port, default `3000`
- `HOST` - bind address, default `0.0.0.0`
- `DB_PATH` - SQLite database path
- `REQUEST_BODY_LIMIT` - request body limit, default `128kb`
- `XZONE_CORS_ORIGIN` - CORS origin list or `*`, default `*`
- `XZONE_ADMIN_TOKEN` - optional token required by admin routes
- `XZONE_REQUEST_LOG` - enable request logging, default `true`
- `XZONE_LOG_DIR` - request log directory, default `xzone/logs`
- `XZONE_LOG_MAX_BODY_CHARS` - max logged body size, default `4000`
- `XZONE_ALLOW_SIMPLE_AUTH` - allow query/body gamertag and XUID fallback, default `true`
- `XZONE_ONLINE_WINDOW_SECONDS` - presence window, default `300`
- `XZONE_HEARTBEAT_POINT_COOLDOWN_SECONDS` - Famestar heartbeat cooldown, default `300`
- `XZONE_TRUST_PROXY` - trust one proxy hop, default `false`

## Checks

```powershell
npm run validate
```

`npm run validate` runs JavaScript syntax checks, smoke tests, and production dependency audit.

A GitHub Actions example lives at `docs/github-actions-ci.example.yml`. Copy it to `.github/workflows/ci.yml` after your GitHub token/session has `workflow` scope.
