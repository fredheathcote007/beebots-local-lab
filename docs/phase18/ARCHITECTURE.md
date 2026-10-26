# Phase 1.8: private Decider shadow transport

## Purpose and decision boundary

Decider-4B v2.1 is an optional observer for the paper engine. `LOCAL_SHADOW_ENABLED` remains false by default and the model identity remains pinned to `decider-4b-v2.1`. The only accepted transports are `host-loopback` and `unix-socket`. Host-native loopback remains the default and calls only `http://127.0.0.1:18009/v1/systemone`. When `PAPER_CONTAINER_BIND=true`, config rejects an enabled loopback shadow and accepts only explicit Unix socket transport.

Shadow requests contain the paper state, available action labels, strategy text, and owner profile instructions. They do not contain broker keys. The model's answer is validated and stored in the append-only shadow outcome table. `Engine` does not read that answer to pick an action, calculate risk, submit orders, or update positions. Local market data and dry simulations do not depend on model availability. Calls are fire-and-forget, bounded, circuit guarded, and failures are recorded without waiting in the paper tick.

## Socket and relay boundary

The engine's socket path is fixed at `/run/beebots-decider/decider.sock`. Runtime config does not accept a URL, socket path, relay host, or destination port. The in-process HTTP client uses Node's built-in HTTP client over `socketPath`; it posts only `/v1/systemone`. Redirects are never followed. Request and response bodies are capped at 64 KiB and calls time out after 12 seconds. The existing loopback path has the same request and response bounds and uses fetch redirect rejection.

`tools/decider-unix-relay.mjs` listens only on that Unix socket. It requires UID 1000, a UID 1000 parent directory with mode 0700, and creates a mode 0600 socket. It has no TCP listener, cloud route, command-line destination, or user-provided upstream. It proxies only POST `/v1/systemone` to `127.0.0.1:18009`, limits both directions to 64 KiB, applies 12 second timeouts, rejects other paths/methods, and removes its socket on shutdown. Existing live sockets and unexpected filesystem entries are not removed.

The host model must itself be manually started on loopback only. The relay does not start, configure, or supervise the model. A host process with UID 1000 can access the socket; the socket is private from other unprivileged local users. The compose mount is read-only in the engine container. Linux host/container UID mapping must preserve UID 1000 for socket access.

## Opt-in runbook (not executed by this change)

1. Review the branch diff and complete all validation gates below.
2. The owner confirms `/run/user/1000` exists, is owned by UID 1000 with mode 0700, and the UID 1000 relay creates `/run/user/1000/beebots-decider` with mode 0700 without privileged writes. This source is bind-mounted read-only at `/run/beebots-decider` inside the engine.
3. Start the already-reviewed Decider service manually with a listener on `127.0.0.1:18009` only. Confirm no LAN listener exists. Do not configure a wildcard or LAN bind.
4. As UID 1000, start `node tools/decider-unix-relay.mjs` on the host. Check that `decider.sock` is a socket owned by UID 1000 and mode 0600.
5. Opt in only for a deliberate paper observation session: `docker compose -f docker-compose.yml -f docker-compose.shadow.yml up -d --build`. This adds no host port. Do not use the shadow override for any mode other than the paper-only engine.
6. Inspect engine logs and shadow outcome rows for success/failure status. Confirm dry paper decisions, orders, and positions remain the deterministic engine outputs.

## Validation gates

- `COREPACK_HOME=/tmp/beebots-corepack-20261026 corepack pnpm typecheck`
- `COREPACK_HOME=/tmp/beebots-corepack-20261026 corepack pnpm lint`
- `COREPACK_HOME=/tmp/beebots-corepack-20261026 corepack pnpm build`
- Scoped config and local shadow transport tests, including the existing four-profile paper-output parity test.
- `docker compose -f docker-compose.yml -f docker-compose.shadow.yml config` only. Do not deploy as part of validation.
- On hosts where sandbox policy blocks Unix socket bind/connect with `EPERM`, rerun the focused UDS tests under the project supervisor. A sandbox pass without real socket tests is not a transport qualification.
- Before any later host use, independently inspect relay ownership/modes, socket locality, model listener locality, and dry paper output parity. No model or service deployment is authorized by this implementation.

## Risk review

Residual risks include malicious or malformed model output (schema and menu validation reject it), local denial of service (limits, timeout, concurrency cap, and circuit breaker bound impact), a compromised UID 1000 process (can use the private socket), and deployment-specific UID mapping or `/run` lifecycle issues. The Unix socket is local host IPC, not cryptographic authentication. The relay trusts the fixed loopback model service and does not verify model provenance. These risks do not grant the model any order or risk authority.

## Rollback

For a paper engine using this opt-in transport, stop that engine through its normal operator process, remove the shadow compose override from its invocation, and stop the relay with SIGTERM. Verify the socket path is removed. The default `docker-compose.yml` is unchanged, shadow remains disabled unless explicitly enabled, and the existing host-native loopback transport remains selectable for a host-native engine. This change does not install or remove the model service.

**Host mapping:** the user-owned host socket is `/run/user/1000/beebots-decider/decider.sock`; the fixed container socket is `/run/beebots-decider/decider.sock`. The user runtime directory is ephemeral and must be re-created on reboot. No privileged creation in `/run` is required.

**Relay resource limit:** the host relay caps simultaneous Unix socket connections at eight (`server.maxConnections=8`) while the engine permits at most three in-flight shadow calls. Requests and responses are bounded to 64 KiB and 12 seconds. A compromised local UID1000 process can still attempt denial of service; do not treat the Unix socket as an authentication boundary.
