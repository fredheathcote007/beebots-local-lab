# Phase 1: local paper lab foundation

## Scope

Phase 1 runs the existing three fixed crypto strategy slots against current anonymous OKX EEA public market data. Orders are simulated locally, with paper balances, estimated taker fees, and a local SQLite ledger. Docker Compose publishes the dashboard only on the designated `10.1.1.40` LAN address. Caddy permits socket peers in `10.1.1.0/24` only, without trusting forwarded address headers. The former Docker localhost mapping was removed after negative testing identified a source-NAT bypass; direct Node runs still bind to loopback.

The runtime uses the deterministic code chooser and requires no cloud model, broker account, or API credential. Configuration rejects demo/live intent, any `BEE*_OKX_*` key/secret/passphrase, Gemini/TypeSafe/OpenAI credentials, webhook destinations, and legacy Setup files that contain those keys. Diagnostics report setting names only. The runnable engine uses `SimExecutor`; the compatibility OKX CLI rejects every request before spawning a process. The CLI package and its installer are not included in the runtime image.

The Compose file builds the engine and dashboard from this checkout. It does not pull an upstream BeeBots runtime image. The engine listens on its private Compose network interface so Caddy can reach it; its port is not published to the host. Caddy serves plain HTTP on container port 80. Docker publishes it only on `10.1.1.40`; set `LAN_DASHBOARD_PORT` to change the published port; `10.1.1.40` is fixed to prevent wildcard binding. Use a distinct Compose project name to avoid sharing volumes or containers with another installation.

The LAN dashboard has no authentication. Any permitted LAN client can read the dashboard, live public market feed, and paper-trading state. The LAN bind and Caddy source-address check are not approval for Internet exposure: do not configure public DNS, port forwarding, or a wider network allowlist. Validate from a PC on `10.1.1.0/24` with `./scripts/validate-lan.sh`. Docker's published-port path must preserve the original peer address for the Caddy rule to accept LAN clients; if it does not, the rule fails closed. Do not allow a broad Docker bridge range. A source-aware authenticated host reverse proxy or a separately approved network control is the safe fallback.

The existing deterministic code chooser remains active. A local model integration is only a recommendation for a separately approved future change; this Phase 1 LAN change does not enable a model, connect to LM Studio, change the chooser, or modify any other PC.

Optional Hive, Beekeeper, alert webhook, lab overlay, Setup, and update routes are not wired into the local runtime. No cloud model endpoint, telemetry, or update service is contacted. The sole planned outbound runtime traffic is anonymous public market data to OKX.

## Market-data freshness

`MarketFeed` accepts public ticker observations only when their timestamps are current (no more than 120 seconds old and no more than 30 seconds in the future) and their prices are positive and finite. If the source returns an empty or stale ticker set, the last good ticker map and its original timestamps remain in place, and the refresh fails. This lets the engine's stale-data risk check reject new paper actions. Focused regression coverage is in `test/market-data.test.ts`; public REST request behavior is covered in `test/okx-rest.test.ts`.

## Reproducible local run

With Docker available, build and run this checkout under a distinct project name:

```sh
docker compose -p beebots-local-lab up -d --build
```

Then open `http://10.1.1.40:8080/` from the approved LAN, including from the host (the Docker localhost port is not published). Stop without deleting paper history with:

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
