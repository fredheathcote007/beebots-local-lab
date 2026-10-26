# BeeBots Local Lab — Phase 1

This checkout runs a local paper trading dashboard for three fixed crypto strategy bots. It fetches anonymous public OKX market prices, simulates fills and fees, and keeps the paper ledger on this machine.

**Paper trading only.** The runtime rejects demo/live mode flags, OKX trading credentials, remote model keys, webhook addresses, and legacy settings files containing those keys. It uses the deterministic code chooser. It does not contact a broker, place orders, use a paid model, report to the Hive, or check for updates. The only intended external requests are anonymous public market data requests to OKX.

## Run with Docker Compose

Docker builds the engine and dashboard from this checkout. Compose publishes the dashboard on host loopback only. Use a distinct project name so this lab has separate containers and volumes from any other BeeBots installation:

```sh
LOCAL_DASHBOARD_PORT=18088 docker compose -p beebots-local-lab up -d --build
```

Open <http://127.0.0.1:18088/>. To stop this lab and keep its paper data:

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
