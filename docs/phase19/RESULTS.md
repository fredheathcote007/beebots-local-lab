# Phase 1.9: Decider latency and scale qualification — 26 October 2026

## Scope and safe state

Project Coordinator (RTX 3060 12 GB; driver 595.91.07) ran the **same cached** `Mapika/decider-4b` (System One response model `decider-4b-v2.1`) via host-only `127.0.0.1:18009`. The model code was not modified and no Python/CUDA packages were installed. Only a separate Docker paper-engine qualification container, owner-only Unix relay, and isolated named test volume were used. No private exchange API, real trading, or production Docker modification occurred.

The model was stopped after tests, the temporary Unix relay and qualification container were stopped, host TCP `:18009` was closed, and production `10.1.1.40:8080/health` still returned HTTP 200. Qualification volumes were retained for inspection. Decisions and orders discussed here are **simulated**.

## Reproducible model settings

Baseline was started with `DECIDER_WARMUP=0`, `DECIDER_COMPILE=0`, `DECIDER_DEVICE=cuda`, `DECIDER_IMAGES=0`, with CUDA graphs enabled by the server's default. The server sealed its empty graph set, so **no requests could use graph replay**; `/stats` confirmed `graphs=0`, `graph_captures=0`, `eager_forwards=15`, `replays=0` after baseline measurements. This is a confirmed latency mechanism, not first-request graph capture.

A constrained warmup was then tested **without changing model weights or packages**:

```bash
HF_HOME=/srv/project-coordinator/projects/beebots-decider-eval/hf-cache \
HF_HUB_OFFLINE=1 HF_HUB_DISABLE_TELEMETRY=1 \
DECIDER_MODEL=Mapika/decider-4b DECIDER_DEVICE=cuda \
DECIDER_IMAGES=0 DECIDER_COMPILE=0 DECIDER_WARMUP=1 \
DECIDER_T_BUCKETS=192,512,640,768 DECIDER_B_BUCKETS=1,4 \
DECIDER_GRAPH_TOKEN_BUDGET=3072 \
.venv/bin/uvicorn decider.serve:app --host 127.0.0.1 --port 18009
```

This captured **8 CUDA graphs in 17 seconds** and reported `graph_captures=8`, `replays>0`, `eager_forwards=0` during subsequent tested requests. Initially ~9,599 MiB of 11,911 MiB usable GPU memory was allocated; under 16-bee operation it increased to ~10,309 MiB, leaving ~1,603 MiB free. The full default grid (89 graph configurations, approximately 25 GB according to upstream serving documentation) was **not** attempted on this 12 GB card.

## Fixed synthetic request comparison

Harness: `node scripts/benchmark-decider-shadow.mjs` with `--fixture bee-realistic --count 3 --samples 2 --timeout 12000`, comparing `--concurrency 1` and `--concurrency 3`. Six bounded, identical-structure synthetic System One requests per cell. The harness never calls the paper engine. Values are observed request timings, not a statistical SLA: with six samples p95/p99 effectively show the slowest sample.

| Model configuration | Concurrency | Successful | Timeout | p50 (ms) | p95 (ms) |
|---|---:|---:|---:|---:|---:|
| Warmup 0 / eager | 1 | 6/6 | 0 | 1,225.25 | 1,244.54 |
| Warmup 0 / eager | 3 | 6/6 | 0 | 4,374.13 | 10,037.66 |
| Warmup 1 / 8 graphs | 1 | 6/6 | 0 | 1,007.45 | 1,087.70 |
| Warmup 1 / 8 graphs | 3 | 6/6 | 0 | 2,380.98 | 3,380.11 |

For concurrency 3, p95 improved by about **66%**, from 10.04 to 3.38 seconds; p50 improved by about 46%. No conclusions about long-run tail behaviour or financial predictive accuracy follow from a six-sample benchmark.

## Isolated 16-bee Docker model-shadow qualification

A new `beebots-p19-qual-16bees-20261026` named Docker volume held profiles for the three original bees and 13 independently created bees, all distinct and active. An unpublished Docker engine (UID1000) ran with `MODE=dry`, local shadow enabled via a read-only private Unix socket mount, and the pre-captured host GPU model. This test did not use or modify the production BeeBots volume.

- All **16** paper bee states existed in SQLite; all 16 produced deterministic paper decisions.
- **15** different bees yielded at least one successful local shadow evaluation; 15 successful model rows, zero shadow timeouts, 12 coverage/queue `skipped` rows in the recorded sample. Successful model response latency averaged **3,466.9 ms**, maximum **4,364 ms**.
- The remaining `bee1` had `menu_json=[]` on recent decisions: **no selectable model question**, so it correctly did not submit a shadow request. This is not a dropped eligible request or fairness defect. A separate synthetic benchmark exercises all 4 model IDs, and queue unit tests cover fairness; an explicit sixteen-eligible-bee stress test remains useful.
- The engine generated **256 deterministic paper decisions** and **15 simulated orders**; `PRAGMA integrity_check` returned `ok`.
- Under test load, model stats still showed eight graphs captured, graph replays, and zero eager forwards. Neither the host model nor private relay published a LAN TCP service. The existing production dashboard remained healthy.

## Findings and remaining gates

1. **Confirmed performance cause:** `DECIDER_WARMUP=0` sealed zero graphs, forcing eager forwards and materially worsening concurrent latency. Restricted graph warmup is a working mitigation demonstrated on RTX3060.
2. **Other contributing conditions remain unresolved:** missing optional `causal_conv1d` extension produces a documented slower PyTorch convolution fallback on CUDA, but we have not isolated its effect or verified an extension build compatible with this exact Torch/CUDA/Python environment. Do **not** install a speculative CUDA extension on the host.
3. **Production model enabling is still NO GO:** validated benchmark and 16-bee smoke are too short for an operational SLA, graph memory headroom is only ~1.6 GiB at peak, long-run recovery after restarts is not yet proven, and model outputs remain shadow observations only. A safe deployment/change plan needs explicit approval.
4. **Do not confuse shadow comparison with model-driven trading.** Model decisions have never been allowed to create paper or real orders. Promotion to simulated trading authority is a separate architectural and safety evaluation with rollback gates.
5. Preserve exact model revision, runtime environment, fixed security endpoints, current production data volume, read-only LAN and paper-only restrictions in every further test.

## Evidence locations

- Portable, unredacted synthetic-only benchmark JSON: `docs/phase19/evidence/baseline-real-serial.json`, `baseline-real-concurrent.json`, `warm-serial.json`, and `warm-concurrent.json`; those original v1 runs are preserved verbatim, including model outcomes and `/stats` responses. They contain synthetic prompts, not private account data.
- Baseline: `/tmp/beebots-p19-baseline-real-serial.json`, `/tmp/beebots-p19-baseline-real-concurrent.json`, `/tmp/beebots-p19-model-baseline.log`.
- Warmed model: `/tmp/beebots-p19-warm-serial.json`, `/tmp/beebots-p19-warm-concurrent.json`, `/tmp/beebots-p19-model-warmup-small.log`.
- Soak data: Docker named volume `beebots-p19-qual-16bees-20261026` (isolated, retained, **not** a production backup).
- Security: model bound only to host loopback and all test services stopped after validation.

**Benchmark interpretation:** The above p95 values came from v1 harness output and all observations in those four cells were accepted as valid, so all-request and valid-only latency populations coincide. Future v2 benchmark outputs include both metrics, explicit status counts and truncation detection. The fixed fixture contains one synthetic `state.bee` tag not present in actual snapshots; this is disclosed and held constant across baseline and warmed comparisons.
