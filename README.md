# BeeBots Local Lab — Phase 1

This checkout runs a local paper trading dashboard for three fixed crypto strategy bots. It fetches anonymous public OKX market prices, simulates fills and fees, and keeps the paper ledger on this machine.

**Paper trading only.** The runtime rejects demo/live mode flags, OKX trading credentials, remote model keys, webhook addresses, and legacy settings files containing those keys. It uses the deterministic code chooser. It does not contact a broker, place orders, use a paid model, report to the Hive, or check for updates. The only intended external requests are anonymous public market data requests to OKX.

## Run with Docker Compose

Docker builds the engine and dashboard from this checkout. Compose publishes the dashboard only on `10.1.1.40:8080` for the designated LAN. Caddy checks the actual socket peer address and permits only `10.1.1.0/24`; Docker gateway sources are intentionally not trusted; it does not trust `X-Forwarded-For`. The engine port remains private to Compose. Use a distinct project name so this lab has separate containers and volumes from any other BeeBots installation:

```sh
docker compose -p beebots-local-lab up -d --build
```

Open <http://10.1.1.40:8080/> from a PC on `10.1.1.0/24`, including from the Project Coordinator host itself. The LAN address is deliberately fixed to `10.1.1.40` to prevent accidental wildcard binding. Override only `LAN_DASHBOARD_PORT` if necessary. The previous localhost Docker binding was intentionally removed because Docker gateway translation could allow a non-LAN source through the LAN allowlist. LAN HTTP has no authentication: every permitted LAN client can view the paper trading dashboard and its live market data. Do not forward this port from the Internet.

The application-level rule depends on Caddy receiving the client's original source IP through Docker port publishing. The Phase 1 supervisor validation must confirm this from a LAN PC. If Docker rewrites the source to a bridge/proxy address, access fails closed; do not broaden the allowlist to a Docker private range. Use an authenticated, source-aware host reverse proxy or a supervisor-approved network control in that case.

To smoke-check the deployment from a permitted LAN PC (also checks read-only POST rejection):

```sh
./scripts/validate-lan.sh
```

To stop this lab and keep its paper data:

```sh
docker compose -p beebots-local-lab down
```

Remove the `-p beebots-local-lab` project volumes only if you intend to delete that lab's local paper history.

## Run directly with Node

Node.js 22.13+ and the pinned pnpm version from `package.json` are required:

```sh
corepack pnpm install --frozen-lockfile
ENGINE_PORT=18088 DB_PATH=/tmp/beebots-paper.sqlite corepack pnpm dev
```

Direct Node runs bind to `127.0.0.1`. The dashboard is at <http://127.0.0.1:18088/>. No `.env`, Setup flow, market key, broker account, or model key is needed.

## Local checks

```sh
corepack pnpm typecheck
corepack pnpm test
corepack pnpm lint
corepack pnpm build
docker compose config
```

See [Phase 1 design and boundaries](docs/local-lab/PHASE1.md) and [implementation status](docs/local-lab/PHASE1-STATUS.md) for current details and validation outcomes.

## Later phases

Historical backtesting with realistic execution, forex and share feeds, a local model interface, and dynamic bee counts or reinforcement learning are outside Phase 1. The future direction is recorded in [Phase 1 design](docs/local-lab/PHASE1.md).

A local language model has only been discussed as a recommendation for a separately approved future change. Phase 1 keeps the existing deterministic code chooser and does not connect to LM Studio or any model service.
