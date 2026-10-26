# BeeBots local decisions and bee management plan

## Phase 1.5: local model shadow (implemented in this lane)

The deterministic code chooser remains authoritative for the paper simulation. An optional `LocalShadow` receives the same strategy, state snapshot, legal menu, conviction scale, per-bee ID, decision timestamp, and source market timestamp. It sends native System One semantics (`model`, `state`, and `questions.action` choice plus `questions.conviction` score) to the immutable host-local endpoint `http://127.0.0.1:18009/v1/systemone`, with exact model ID `decider-4b-v2.1`. The request uses the SDK's `Choice` and `Score` question constructors. No user-supplied URL or key is supported. The model listener must remain bound to host loopback; no LAN exposure is intended.

Shadow is disabled by default (`LOCAL_SHADOW_ENABLED=false`). It fails during config load if enabled with Compose's `PAPER_CONTAINER_BIND=true`: container loopback is not host loopback. The default Compose runtime therefore does not connect to Decider. Run the engine natively on the Project Coordinator host for shadow E2E. A Docker sidecar/service is future work requiring a private-network design, LAN exposure review, and a fixed in-network adapter; there is no current Docker connection path.

When enabled on the host, it permits up to three concurrent requests and fairly queues up to 16 dynamic bee IDs in FIFO order, paces each bee at one request per minute, times out after 12 seconds, and opens a 60 second circuit after three network, timeout, or HTTP 5xx failures. Duplicate queued submissions refresh the snapshot without moving a bee's queue position. Invalid model/schema replies are recorded as `rejected` and do not count as transport failures. Skipped coverage (`paused`, `paced`, `busy`, `circuit`) is recorded at most once per bee/reason/minute. Replies validate exact model ID, menu label, and complete finite probability distribution. Profile instructions are passed only as text data in the shadow prompt. The action `confidence` and secondary `conviction` answer are intentionally ignored in Phase 1.5; conviction comparison is a known limitation. A recorded Decider-4B v2.1 response fixture protects the action contract. Rows include skip reason and the table retains the newest 10,000 rows. Shadow is a fire-and-forget observer: no task is awaited by paper decision execution and shadow output is never read by chooser, risk, or executor code.

The Project Coordinator reports Decider-4B v2.1 warm performance on an RTX 3060 with 8.9 GB resident: 20 warm requests had median 312.5 ms, p95 313.6 ms, maximum 339.8 ms, and zero HTTP errors. The cold first request took over 20 seconds; do not depend on a cold model. Shadow staleness uses the same `3 * DATA_REFRESH_MS + 30s` limit as paper risk. `marketTs` remains the feed refresh timestamp, so comparisons are refresh-aligned rather than exchange-event aligned.

### Runtime acceptance still required

1. Host-native live-data E2E remains pending: run with the already-running, warm host listener; confirm `shadow_decisions` rows and statuses for all active bee IDs (3–16) while public market refresh continues; then soak requests and review data coverage. Never use a cold start as an availability assumption.
2. The recorded fixture contract and host listener suite must pass in the host reviewer environment. Review RTX 3060 memory/latency/contention under concurrent refresh and shadow load; the reported warm baseline is 8.9 GB resident and 20 requests at median 312.5 ms, p95 313.6 ms, max 339.8 ms, zero HTTP errors.
3. Compare recorded model choice/probabilities against each deterministic baseline over a reviewed sample. Shadow output must not flow into `JevResult`, risk proposals, executable `decisions`, or `orders`.
4. Default Docker runtime remains unsupported for shadow. A future Docker sidecar/service requires a fixed private-network endpoint, explicit LAN isolation review, and separate E2E acceptance. No adapter or host-gateway route is currently configured.

## Phase 1.6: edit initial bee instructions

The later Phase 1.6/1.7 work implements owner-managed profiles and dynamic bee IDs in the isolated integration branch; see [Phase 1.7 status](../phase17/STATUS.md) for current integrated acceptance gates. The public LAN dashboard remains read-only.

Proposed staged change: add a versioned bee-profile registry table and migrate the three existing slots transactionally from current settings/defaults, preserving IDs, strategy styles, rule text, and every `bee_state` row. Keep existing `bee1`/`bee2`/`bee3` identifiers stable. Add validated per-bee settings (display name, initial instructions, style, permitted coins, enabled state) with explicit limits and audit rows. A migration must be additive and idempotent, must never drop/reset live paper database rows, and must support rollback by retaining the prior settings representation until verified.

Safe owner management path: bind management routes only to loopback and require an owner session with CSRF protection; do not expose writes through the unauthenticated LAN API or dashboard proxy. For initial deployment, an offline CLI that edits a validated settings file and requires engine restart is the simplest safe path. Any later web editor must be separately authenticated on the host, not reachable through the 10.1.1.0/24 read-only dashboard. Audit who/when/which profile fields changed without recording credentials.

Acceptance gates:

- Migration of a copy of an existing database preserves all bee state, fills, decisions, orders, caps, and profiles byte-for-byte where applicable.
- Editing a profile changes the next generated strategy prompt/menu only; current risk checks, size bounds, deterministic exits, and paper-only executor guards remain unchanged.
- Invalid or oversized rules, coin values, IDs, duplicate names, and attempted broker/model credentials are rejected.
- Unauthenticated requests from loopback and LAN cannot mutate profiles; the dashboard remains read-only.

## Phase 1.7: dynamic bees

Only after Phase 1.6 passes review, replace fixed slots with a registry-backed set and explicit per-bee runtime settings. Add a bee transaction that creates profile, state, counters, and default risk state atomically; removal should first disable a bee, settle/close any simulated position through the existing paper engine, then archive rather than delete history. Every runtime loop, event payload, dashboard response, cap, and database query must use stable bee IDs and handle zero or many bees.

Acceptance gates:

- Add, disable, archive, and restore bees without restarting market data or corrupting existing `bee1..3` rows.
- Each bee has independent strategy settings, paper state, caps, chooser pacing, and shadow logs.
- No new API credentials or execution modes can be attached to a bee; all actions stay with the deterministic paper executor and hard risk layer.
- Read-only dashboard lists the registry dynamically; all profile writes remain owner-only and unavailable on the LAN.
- Migration, concurrent management/engine ticks, archive/restore, and full paper-order invariants pass isolated tests before any deployment.
