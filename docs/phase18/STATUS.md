# Phase 1.8 status

## Implemented in this isolated branch

- Added an explicit validated `LOCAL_SHADOW_TRANSPORT` selector. Default shadow remains disabled, default transport remains pinned host loopback, model ID remains pinned, and container-bound engines require Unix socket transport if shadow is enabled.
- Added bounded Node HTTP over the fixed engine socket path `/run/beebots-decider/decider.sock`; request/response caps are 64 KiB, timeout is 12 seconds, redirect following is rejected, and errors stay on the observer path.
- Added the host-only relay source and a separate opt-in `docker-compose.shadow.yml` read-only socket mount. The ordinary compose file adds no socket, host port, or network exposure.
- Added config, transport, failure, redirect, bounds, timeout and paper-output parity tests. Existing four-profile parity coverage compares decisions, orders and positions with and without shadow observation.
- Added this architecture, risk review, runbook, validation gates and rollback notes.

## Validation results

- Pinned `pnpm typecheck`, `pnpm lint`, and `pnpm build`: passed.
- Scoped config and local shadow tests: 21 passed.
- Three UDS integration cases (mock server, bounded/error/timeout cases, redirect status): skipped because socket bind returned `EPERM`; rerun these under the project supervisor before transport qualification.
- `docker compose -f docker-compose.yml -f docker-compose.shadow.yml config`: passed. The output adds the engine's read-only socket bind and no additional host port.
- Relay `node --check` and `git diff --check`: passed.

This branch has not deployed the relay, model, compose override, or engine. There are no commits or pushes.

## Acceptance and rollback gates

Before any later opt-in use, review the full diff; pass static checks, focused tests and compose config; prove the model binds only to loopback; prove the relay directory/socket ownership and modes; and verify that four independent paper bee outputs are unchanged. A failed gate means leave the default compose invocation in place and shadow disabled. During a later paper observation, any unexpected listener, permission broadening, tick delay, or decision/order/position difference is a stop condition: stop the opt-in engine and relay, remove the override, and return to default compose. No model-selected paper orders are permitted.

**Host socket path correction:** the owner-writable host path is `/run/user/1000/beebots-decider`; it is mounted read-only into the engine at `/run/beebots-decider`. No privileged creation under `/run` is required.

## Host supervisor empirical qualification — 26 October 2026

- `COREPACK_HOME=/tmp/beebots-corepack-20261026 corepack pnpm`: typecheck PASS, lint PASS, build PASS, **387/387 tests across 30 files PASS**, dashboard build PASS. Docker Compose shadow override configuration and `node --check tools/decider-unix-relay.mjs` PASS.
- Corrected a real startup error: initial relay `umask(0177)` caused its owner-only directory to be created `0600` (without directory traversal permission), and the relay refused it. Updated relay to `umask(0077)`; verifies host directory `/run/user/1000/beebots-decider` is UID1000/mode0700 and socket mode0600. It no longer requires privileged root-owned `/run/beebots-decider` provisioning. Compose mounts host source read-only at the fixed container path.
- Started *temporary* host model Decider-4B v2.1, bound only to `127.0.0.1:18009`, using RTX 3060 (~8.3 GiB VRAM). Host-to-Unix-relay-to-loopback-model POST returned HTTP200 and a valid `WAIT`/probability distribution in 0.94 s.
- Built isolated `beebots-p18-qualification:local` Docker image, created a separate named qualification data volume, added a fourth bee through the owner CLI, and started **an unpublished Docker container** with Unix socket directory read-only, shadow explicitly enabled and `PAPER_CONTAINER_BIND=true`. Container runs as UID1000, sees socket mode0600, reported `mode=dry`, and healthy engine internal port only.
- Actual shadow outcomes persisted to the **qualification** SQLite from live anonymous public crypto data: `bee2` accepted an `ok` decision in 1.26 s, `bee3` accepted an `ok` decision in 11.48 s, and the fourth bee's first concurrent decision timed out at 12.00 s. This proves Docker-to-host-local Decider connectivity and fail-safe timeout recording, **not reliability, fairness or predictive performance**. Real paper decisions and orders continued; model outcomes were not used for execution. The baseline and risk controls remain deterministic.
- `ss -lnt` showed host model only on `127.0.0.1:18009` and existing production dashboard on `10.1.1.40:8080` — no additional LAN listening port. Production Beebots Compose/ledger was not altered and remained HTTP200 throughout.
- **Release status:** prototype E2E PASS for local transport, production enabling remains **NO GO** pending an independent security review, representative concurrent latency/availability soak, explicit model lifecycle/restart/runbook, backup/rollback and non-LAN access testing.

**Failure exercise:** after stopping the host model, a Docker-to-relay request returned HTTP502; the qualified engine remained healthy and later persisted an `unavailable` shadow result, with paper decisions/orders continuing. The isolated container, model, and relay were then shut down. SQLite integrity remained `ok` (92 paper decisions, 5 simulated orders at stop; shadow rows included `ok`, `skipped`, `timeout`, and `unavailable` across all four bee IDs). Production continued HTTP200.
**Review:** independent Cursor and Codex found no Critical/High issues blocking a default-off draft PR. Both explicitly reserved operational enabling pending representative concurrency/latency soak, lifecycle supervision, and owner acceptance of same-UID IPC/denial-of-service limitations. Capped relay connections at eight as a medium-priority defence-in-depth improvement.
