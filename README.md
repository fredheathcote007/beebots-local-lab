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

### Owner-managed bee profiles

Use the owner CLI from an authorised shell. It writes version 2 profiles atomically with mode `0600`; the Compose runtime reads `/data/bee-profiles.json` from its named volume. In Docker, always give the CLI that exact volume path:

```sh
docker compose exec -u node -T engine node dist/tools/owner-bees.js --file /data/bee-profiles.json list
docker compose exec -u node -T engine node dist/tools/owner-bees.js --file /data/bee-profiles.json create 'Clover' bizzy
```

The original `bee1`, `bee2`, and `bee3` profiles stay active with stable IDs. The runtime supports 3–16 active bees, keeps separate paper portfolios by ID, and refuses to remove a bee with an open position. Profile instruction notes are plain text; the deterministic paper chooser does not interpret them. The LAN dashboard remains read-only.

### Optional local model shadow

Shadow is off by default and observes deterministic decisions without changing choices, risk, portfolios, or simulated execution. The owner profile's plain-language instructions are sent as prompt data when shadow is enabled. The runtime pins the native System One endpoint to `http://127.0.0.1:18009/v1/systemone` and model ID `decider-4b-v2.1`; it accepts no endpoint override. To use a warmed, already-running host-local Decider, enable `LOCAL_SHADOW_ENABLED=true` only for a host-native engine process. Docker Compose intentionally fails closed if shadow is enabled because container loopback cannot reach the host service. Do not expose the model listener beyond host loopback. A Docker model path needs a separately reviewed private-network design.

Shadow accepts at most three in-flight requests, queues active bee IDs fairly, paces each bee to one request per minute, and times out each request after 12 seconds. Outcomes are stored separately from decisions and orders, with history bounded to 10,000 rows. This is a comparison tool; completing deployment acceptance still requires the host-side model and runtime gates in [Phase 1.7 status](docs/phase17/STATUS.md).

## Local checks

```sh
corepack pnpm typecheck
corepack pnpm test
corepack pnpm lint
corepack pnpm build
docker compose config
```

See [Phase 1 design and boundaries](docs/local-lab/PHASE1.md) and [implementation status](docs/local-lab/PHASE1-STATUS.md) for current details and validation outcomes.

## Phase status

See [Phase 1.6 runtime status](docs/phase16/RUNTIME-STATUS.md) for owner-managed bees and [Phase 1.7 integration status](docs/phase17/STATUS.md) for the local shadow gates. The LAN dashboard stays read-only and paper-only.

### Optional local Decider shadow via private Unix socket (experimental)

Phase 1.8 adds an **opt-in, disabled-by-default** Unix-socket transport for Docker-to-host local Decider-4B observations. On the Project Coordinator, the host relay uses `/run/user/1000/beebots-decider/decider.sock` (UID1000-owned 0700 parent / 0600 socket), which the separate `docker-compose.shadow.yml` override mounts **read-only** at `/run/beebots-decider/decider.sock` inside the engine. The model itself stays on host `127.0.0.1:18009` only. **Do not use the override for normal production** until the documented security, latency, restart, and rollback gates pass. All paper decisions remain deterministic; model results are shadow observations only. See `docs/phase18/ARCHITECTURE.md` and `docs/phase18/STATUS.md`.
