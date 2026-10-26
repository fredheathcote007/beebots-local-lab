# Phase 1: local paper lab foundation

## Scope

Phase 1 runs the existing three fixed crypto strategy slots against current anonymous OKX EEA public market data. Orders are simulated locally, with paper balances, estimated taker fees, and a local SQLite ledger. The dashboard is published on host loopback by Docker Compose; direct Node runs also bind to loopback.

The runtime uses the deterministic code chooser and requires no cloud model, broker account, or API credential. Configuration rejects demo/live intent, any `BEE*_OKX_*` key/secret/passphrase, Gemini/TypeSafe/OpenAI credentials, webhook destinations, and legacy Setup files that contain those keys. Diagnostics report setting names only. The runnable engine uses `SimExecutor`; the compatibility OKX CLI rejects every request before spawning a process. The CLI package and its installer are not included in the runtime image.

The Compose file builds the engine and dashboard from this checkout. It does not pull an upstream BeeBots runtime image. The engine listens on its private Compose network interface so Caddy can reach it; its port is not published to the host. Caddy listens in its container and Docker publishes it only on `127.0.0.1`. Set `LOCAL_DASHBOARD_PORT` to choose another host loopback port. Use a distinct Compose project name to avoid sharing volumes or containers with another installation.

Optional Hive, Beekeeper, alert webhook, lab overlay, Setup, and update routes are not wired into the local runtime. No cloud model endpoint, telemetry, or update service is contacted. The sole planned outbound runtime traffic is anonymous public market data to OKX.

## Market-data freshness

`MarketFeed` accepts public ticker observations only when their timestamps are current (no more than 120 seconds old and no more than 30 seconds in the future) and their prices are positive and finite. If the source returns an empty or stale ticker set, the last good ticker map and its original timestamps remain in place, and the refresh fails. This lets the engine's stale-data risk check reject new paper actions. Focused regression coverage is in `test/market-data.test.ts`; public REST request behavior is covered in `test/okx-rest.test.ts`.

## Reproducible local run

With Docker available, build and run this checkout under a distinct project name:

```sh
LOCAL_DASHBOARD_PORT=18088 docker compose -p beebots-local-lab up -d --build
```

Then open `http://127.0.0.1:18088/`. Stop without deleting paper history with:

```sh
docker compose -p beebots-local-lab down
```

For direct Node development, use Node 22.13+ and the package manager pinned in `package.json`:

```sh
corepack pnpm install --frozen-lockfile
ENGINE_PORT=18088 DB_PATH=/tmp/beebots-paper.sqlite corepack pnpm dev
```

The direct runtime binds to `127.0.0.1`. No Setup flow or credential is required. Remove a prior `.env` or settings file containing old secret keys before startup; this fork deliberately refuses to load those settings.

## Deliberate boundaries

- Three fixed bee slots and the existing strategies remain in place.
- Current crypto prices are not historical backtesting. Realistic historical fills, slippage modeling, and backtest reporting are future work.
- Forex and shares, dynamically sized bee populations, reinforcement learning, and a local model interface are future phases.
- No public deployment, broker connection, real order, or demo order is part of this branch.
