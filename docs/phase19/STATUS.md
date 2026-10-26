# BeeBots Phase 1.9 — Supervisor checkpoint (2026-10-26)

**Project:** beebots-local-lab. **Workstream:** local Decider-4B v2.1 performance qualification. **Proposed branch:** `feature/decider-latency-qualification`, based on Phase 1.8 `fb30a7e`. **Priority:** P1 for model-observer availability, not a release authorisation.

## Goal and invariant

Make the local GPU Decider service fast and reliable enough to observe 3–16 independent paper bees through the already-approved private Unix relay. **The model is shadow-only**: its outputs cannot choose paper orders, change positions, bypass risk limits, or reach a real broker. Keep the production Docker deployment, live paper ledger, firewall and user services unchanged.

## What is implemented and measured

- Bounded, pinned-local benchmark harness with synthetic System One fixture, CLI guards, per-request status and distributions, separate all-attempt and valid-only latency metrics, explicit run truncation handling, 30-second qualification window, and tests.
- Confirmed baseline `DECIDER_WARMUP=0` seals zero CUDA graphs; all forwards eager. Measured concurrent-3 realistic six-request p95 10.04s.
- Tested small startup graph warmup: `DECIDER_WARMUP=1`, `DECIDER_T_BUCKETS=192,512,640,768`, `DECIDER_B_BUCKETS=1,4`, `DECIDER_GRAPH_TOKEN_BUDGET=3072`. Eight graphs captured at startup (~17s), tested requests replayed all captures, no eager forwards. Concurrent-3 realistic six-request p95 improved to 3.38s, no timeout.
- A separate unpublished Docker paper engine was configured with 16 active profiles and the private UDS relay. All 16 paper portfolios generated deterministic decisions; 15 model-eligible bees produced 15 successful shadow outcomes, zero timeouts; `bee1` had no selectable menu and correctly did not call the model. 256 simulated decisions, 15 simulated orders; SQLite integrity `ok`. Peak GPU memory ~10.3GiB / 11.9GiB usable.
- No causal-convolution kernel package was installed; the PyTorch fallback remains a contributing/unknown performance factor. Production `http://10.1.1.40:8080/health` stayed HTTP200 throughout.
- At the end of qualification, the host model, relay and isolated 16-bee container were stopped; host port18009 was not listening and GPU memory was idle. Test data remains in a separate Docker volume; original `beebots-local-lab_bees-data` untouched.

See `LATENCY-PLAN.md` for hypotheses and `RESULTS.md` for commands, measured results, limitations and evidence paths.

## Validation and review

- Host `pnpm` lockfile installed offline without dependency changes. `typecheck`, `lint`, application build, dashboard build and a full **392/392 test suite over 31 files** passed after adding benchmark validation and review fixes. Node entrypoint and ESLint passed.
- Cursor independent review identified benchmark CLI/metric/partial-run interpretation gaps; these were corrected or explicitly disclosed (relative-file entry guard, valid-only tails, status counts, truncated runs, synthetic state.bee marker). A final independent Codex read-only review is requested before draft PR publication.

## Release gates and next tasks

1. Independent final code review + any acceptance-blocking fixes, then complete full tests and publish only a **draft PR**, with parent Phase 1.8 PR #5. Preserve PR4/PR5 as draft and keep their dependencies unmerged until the approved release gates are complete.
2. Longer representative live-data soak with per-bee fairness/timeout/VRAM telemetry, restart interruption and recovery, and independent comparison of shadow vs deterministic decisions. Concurrency 3, 16 bees and 12-second budget are *not* yet a proven SLA.
3. Operational hardening for warm model lifecycle, resident GPU memory constraints and fail-closed socket path. On the RTX3060 the measured peak leaves roughly 1.6GiB for other GPU work; model sharing needs explicit capacity planning.
4. **Owner decision required** before production rollout, enabling shadow by default or allowing model outputs to become authoritative for paper trading. No production change is authorised by these model benchmarks alone.

## Stop condition

If the GPU or Project Coordinator becomes unavailable, if the model begins binding to a LAN address, if production paper orders diverge from deterministic expectations, or if VRAM headroom becomes unsafe, stop the isolated experiment, retain evidence, and escalate with the precise failure. Do not alter the production data volume during qualification.

## Review outcome

An independent final Codex reviewer gave **GO for publishing a DRAFT PR**, with no Critical/High issues found. It flagged small six-request sample size and earlier lack of portable raw evidence as Medium. These limitations are now disclosed and the four synthetic-only raw benchmark JSON runs have been retained under `docs/phase19/evidence/`. This PR does not approve model operational enablement or a production restart.
