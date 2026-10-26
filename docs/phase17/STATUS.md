# Phase 1.7 integration status

## Done in this isolated integration worktree

- Combined Phase 1.6 owner-managed profiles with the Phase 1.5 local System One shadow implementation while retaining dynamic `cfg.beeIds` in engine iteration and dashboard state.
- Shadow is disabled by default. The endpoint is immutable host loopback `127.0.0.1:18009/v1/systemone`; the model ID is pinned to `decider-4b-v2.1`. Config refuses a non-pinned model or enabled shadow when `PAPER_CONTAINER_BIND=true`.
- Shadow work is fire-and-forget and cannot supply a paper decision, risk proposal, or executable order. The deterministic code chooser remains authoritative. Shadow outcomes live in their own bounded 10,000-row table.
- Dynamic shadow scheduling has at most three in-flight requests, a FIFO queue for up to 16 unique bee IDs, per-bee one-minute pacing, and a 12-second request timeout. Queue entries are refreshed with the latest snapshot without changing their place.
- Owner profile instructions are carried only as plain-text prompt data for the shadow call. There is no configurable endpoint, model URL, LAN listener, Docker host-gateway, sidecar, or broker path.
- README documents safe owner CLI use against the Docker volume path `/data/bee-profiles.json` and the host-native model setup boundary.
- Focused tests cover a dynamic fourth profile ID, model contract, off-by-default config, queue fairness, instruction prompt data, deterministic baseline equality for the original three, and no broker/order effects.

## Host supervisor verification (26 October 2026)

- Installed the pinned pnpm lockfile **offline from the existing local cache** after Codex's restricted sandbox could not contact the npm registry; no dependency version or lockfile changes.
- Verified **380/380 Vitest tests across 29 files**, TypeScript typecheck, ESLint, Node build, dashboard TypeScript/Vite build, and `git diff --check` PASS on Project Coordinator host. The initial full run exposed two integration-test assertions: `rows.find()` selected a deliberately recorded `skipped/busy` coverage event before its later successful shadow outcome; another compared filtered original-bee rows with an unfiltered four-bee baseline and asserted legitimate paper orders must be zero. Corrected tests to assert eventual `status=ok`, matching original IDs in both datasets, and equality of shadow-on/off paper orders. No production safety check was disabled.
- **Data-migration rehearsal:** took a SQLite online backup of active production **read-only**, copied to a dedicated qualification directory and verified `PRAGMA integrity_check=ok`. Before test: 1584 decisions, 1 order, 1 fill and 3 `bee_state` records. Added a fourth owner profile through the CLI with mode `0600`, ran the combined build using ONLY the copied SQLite on `127.0.0.1:18107`, with `LOCAL_SHADOW_ENABLED=false`. Result: HTTP 200, `mode=dry`, four active bee IDs, 20 anonymous public crypto instruments; the three original IDs remained, and SQLite integrity stayed `ok`. After the short isolated test: 1604 decisions, 3 orders, 3 fills and four bee state records in the **copy**, all original records retained. The isolated process was stopped. The production LAN service still returned HTTP 200 and its DB was not modified by this test.
- **Local model boundary:** current Docker GPU runtime has only `runc`; NVIDIA Container Toolkit / `nvidia-container-runtime` is not installed. Host-native Decider-4B was demonstrated separately on the RTX 3060 (12 GB), but Docker cannot call host-loopback Decider with its current config; fail-closed is intentional. Do not enable shadow on production Compose. Secure GPU sidecar or Unix-domain-socket design is a separately gated task.
- Cursor architecture reviewer found the same model-hosting limitation and noted dynamic shadow fairness and type/legacy Beekeeper limitations. Cursor final static reviewer found no Critical or High code defects for accepting default-off integration as a draft PR (see `/tmp/beebots-p17-final-cursor.log`); it explicitly did NOT approve enabling Docker GPU inference or declaring model performance validated. Host supervisor independently verified 380 tests and the cloned DB migration above, satisfying the code/plumbing checks the reviewer could not execute. Further review may identify medium improvements before release.

## Not done

- The native Decider listener and real live-data host-native engine were not contacted from this worktree.
- No production Docker deployment was performed. The supervisor performed read-only production database backup and isolated copy-based runtime acceptance; no production database writes were made as part of the rehearsal.
- A Docker-accessible model architecture is intentionally absent and requires a separately reviewed private-network design.
- Codex sandbox initially lacked dependencies and registry DNS failed (`EAI_AGAIN`). The host supervisor installed dependencies offline from the pinned lockfile and reran all required tests successfully (see Host supervisor verification above).
- The isolated integration branch remains separate from production. Publication/PR is governed by the supervisor and may be recorded in a subsequent commit; it is not evidence of deployment.

## Acceptance gates

1. Independent Cursor review of this worktree and the combined diff.
2. Host rerun of typecheck, lint, build, Vitest, and dashboard build; investigate every failure without weakening tests.
3. On the Project Coordinator only, confirm the existing warmed Decider remains bound to host loopback and run a host-native shadow E2E with public market data. Verify all active IDs including a fourth bee, per-bee pacing, request timeout, and bounded persisted outcomes.
4. Compare shadow choices/probabilities to deterministic baselines over a reviewed sample. Confirm shadow rows never enter executable `decisions`, risk state, or orders, and original bees' paper outcomes remain identical with shadow enabled.
5. Review profile restart behavior, stable original IDs, 0600 mode, legacy settings mapping by ID, and rejection of archival/removal while a bee has an open position.
6. Confirm the existing read-only `10.1.1.40:8080` dashboard behavior and Compose profile path remain unchanged. Do not add unauthenticated writable LAN routes or expose the model listener.

## Release boundaries

- **Safe to review as draft PR:** combined dynamic paper-bee profiles + shadow observer OFF, no change to live docker service. The model host is currently shut down; no GPU port is published.
- **Not approved for operational model enablement:** present Docker topology refuses local shadow activation; a private inference service/network or UDS architecture plus GPU runtime validation, warm-up, fault tests and full live-paper A/B comparison remain mandatory.
- **Not approved to silently replace the production database:** require backup/restore evidence, correct named volume, confirmation of original IDs and current open positions, and an explicit controlled restart, with rollback to the prior image/worktree.
- **Medium technical debt:** type alias `BeeId` still names original three, legacy Beekeeper overlay path not dynamic, eventual shutdown drain for queued shadow records, per-bee coverage sampling under 16-bee load, and a readonly shadow-result viewer/report.
