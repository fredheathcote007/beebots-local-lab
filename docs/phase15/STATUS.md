# Phase 1.5 isolated worktree status

## Implemented

- Optional local System One shadow remains disabled by default. Immutable runtime config pins host loopback `http://127.0.0.1:18009/v1/systemone` and model ID `decider-4b-v2.1`; config rejects alternate model IDs and rejects enabling shadow when `PAPER_CONTAINER_BIND=true`.
- The Project Coordinator's recorded Decider-4B v2.1 response is checked in as a fixture. Contract coverage validates `answers.action.choice` and complete menu probabilities. Action confidence and the secondary conviction result are intentionally ignored for Phase 1.5.
- Requests use SDK `Choice` and `Score` question constructors. Shadow submission is fire-and-forget, capped at three concurrent requests, queued fairly across 3–16 active bee IDs, paced to at most one request per bee per minute, and records bounded `paused`, `paced`, `busy`, and `circuit` coverage skips.
- Network errors, timeouts, and HTTP 5xx count toward the circuit. Malformed replies and non-5xx HTTP errors are rejected without counting as transport failures. Per-outcome logs include status and skip reason.
- Shadow age matches paper risk's `3 * DATA_REFRESH_MS + 30s` threshold. Results persist in isolated `shadow_decisions` with a nullable skip reason and a 10,000-row retention bound.
- Engine wiring only submits the deterministic baseline and snapshot. Shadow result is never consumed by chooser, risk, paper decisions, or orders. Paused engine/bee cases write rate-limited coverage markers.

## Runtime facts and topology

- Project Coordinator runs Decider-4B v2.1 on host loopback port 18009. The listener must remain loopback-only; it is not exposed to LAN.
- RTX 3060 resident memory reported at 8.9 GB. Twenty warm requests: median 312.5 ms, p95 313.6 ms, maximum 339.8 ms, zero HTTP errors. The cold first request took over 20 seconds, so the model must already be warm for E2E.
- Host-native engine is the only current supported route. Default Compose does not connect to the host model; setting `LOCAL_SHADOW_ENABLED=true` with Compose's `PAPER_CONTAINER_BIND=true` fails early. A Docker sidecar/private-network adapter is future work and has not been implemented.

## Validation and review gates

- Prior host-side run: 363/363 tests passed (`/tmp/beebots-p15-host-test.log`). Independent Cursor review was NO GO; its blockers are captured in `/tmp/beebots-p15-cursor-review.log` and are being addressed in this worktree.
- Host-native live-data shadow E2E remains open: host reviewer must rerun listener suites, verify every active bee produces useful rows/status coverage against live market snapshots, soak the warm model under concurrent refresh, and review latency/memory and representative baseline comparison.
- Default Docker shadow E2E remains unavailable until a separately reviewed fixed private-network Decider service/adapter exists and passes topology, LAN isolation, contract, and live-data E2E checks.
- No activation by default; no commit, push, merge, deployment, model-server operation, or production Phase 1 Docker operation was performed.


**Host E2E correction (26 October):** the first actual bee market-state request timed out at the initial 1.5-second timeout even though synthetic 285-token requests completed at median 312.5 ms. The default shadow-only timeout was raised to 12 seconds; this cannot delay the deterministic chooser. Pending repeat E2E, model-payload latency measurements and independent review.


## Host supervisor verification (26 October 2026)

- Project Coordinator RTX 3060 12 GB: open-source Decider-4B release config reports model `decider-4b-v2.1`, Hugging Face revision `585473dec4fa93f0325c2bf02dda7273b61f44c1`, running locally with Python 3.12, PyTorch CUDA and the project's native System One server. The host server was bound only to `127.0.0.1:18009`.
- Model benchmark: 20 warm synthetic requests, median 312.5 ms, p95 313.6 ms, max 339.8 ms, 0 errors; about 8.9 GiB resident GPU memory. First cold request exceeded 20 s. Financial/trading predictive accuracy has **not** been evaluated.
- **Real adapter E2E:** compiled `LocalShadow` contacted the host Decider server and returned `status=ok`, model `decider-4b-v2.1`, choice `WAIT`, legal probabilities `WAIT=0.9935`, `BUY_BTC=0.0049`, `SELL_BTC=0.0017` (rounding), 290 ms. It did not create orders. This is a synthetic scenario, not a measured trading edge.
- Separate host-native live public market-data engine started at `127.0.0.1:18088`, used isolated SQLite at `/tmp/beebots-p15-live-shadow-20261026`, and retained deterministic code chooser. Initial full bee payload timed out under the former 1.5s default; changed shadow-only default to **12 seconds**, which cannot delay actual paper decisions. The live-market run did not capture enough successful shadow rows for a conclusive performance comparison; its full E2E remains a future acceptance gate.
- Supervisor reran typecheck, lint, build, and **368/368 tests across 26 files** on host outside sandbox; all passed. No default production Docker model integration was added; enabling shadow in Compose fails closed.
- The model and two isolated experimental engines were shut down after testing to avoid occupying ~8.9 GiB VRAM continuously. Current primary BeeBots Docker service on `10.1.1.40:8080` was verified healthy throughout.
- To re-run the **host-native model server manually** (not production), use the reviewed checkout `/srv/project-coordinator/projects/beebots-decider-eval`, Python environment `.venv`, set `DECIDER_IMAGES=0`, `DECIDER_MODEL=Mapika/decider-4b`, and launch `.venv/bin/uvicorn decider.serve:app --host 127.0.0.1 --port 18009`. Its model weights are stored under that checkout's `hf-cache` and the `HF_HOME` environment variable must reference it to avoid downloads. Never bind 0.0.0.0.
- Independent Cursor final review is GO for **disabled-by-default host-only shadow plumbing**; NO GO for declaring default Docker-based model operation or genuine live-trading comparison accepted.
