# Phase 1.9: Decider latency qualification

## Scope and payload assumptions

This is an opt-in, read-only request benchmark. Start the local model service manually and only after the supervisor approves the run. The script has no endpoint flag or environment override: HTTP traffic goes to `127.0.0.1:18009/v1/systemone`; `--socket` accepts only `/run/user/1000/beebots-decider/decider.sock`. Optional `/stats` collection is available only on the same loopback host. There is no cloud path. The harness records choices for measurement and never submits them to Engine or paper execution.

The request envelope follows `LocalShadow.call` in `src/local-shadow.ts`: pinned model `decider-4b-v2.1`, snapshot `state`, and native System One `questions.action` choice plus `questions.conviction` score. The state/menu assumptions follow `Engine.decide` and `buildSnapshot` in `src/engine.ts` and `src/snapshot.ts`, and the contract exercised by `test/local-shadow.test.ts`. Synthetic bee IDs rotate through `bee1`–`bee4`. The realistic fixture includes a plausible flat bee line, four liquid-coin indicator summaries, three action choices, and generic strategy/profile text. The minimal fixture has one coin and two choices. Both use fixed timestamps and values; neither reads the machine, market feed, owner profiles, or credentials. They are representative payloads, not exact captured production snapshots. Their serialized byte sizes are reported; token counts should be taken from the model service's own tokenizer/metrics where available.

## Hypothesis ledger

| ID | Hypothesis | Evidence to collect | Discriminator |
| --- | --- | --- | --- |
| H1 | With `DECIDER_WARMUP=0`, the serving engine seals an empty CUDA graph cache and routes every forward through eager PyTorch. | First-request latency, graph capture/replay counters, startup logs, subsequent latency. | Compare cold first call with warm calls; repeat isolated starts using graphs=0, graphs=1 + warmup=0, and graphs=1 + warmup=1. Record startup and first-call separately. |
| H2 | Large prompts cross the 8192-token threshold and cause eager execution. | Server-reported prompt token count, eager-fallback counters/logs, graph hit/capture counters. | Compare minimal and four-bee realistic fixed prompts; if available, add a locally generated prompt below and above 8192 tokens without changing other settings. Do not infer token count from bytes. |
| H3 | Three simultaneous requests queue or batch, and the reported `causal_conv1d` fallback adds model compute time. | Per-request latency by concurrency, active/queued/batch metrics, GPU utilization, and startup fallback warning. | Run concurrency 1, then 3, with identical fixture/settings; inspect server queue/batch metrics. A compatible causal-conv1d build is a separate controlled experiment only after checking model/runtime/CUDA/PyTorch compatibility. |

The earlier isolated observation (1.26 s, 11.48 s, and a 12 s timeout under three concurrent observations) is a signal to investigate, not proof of any one hypothesis. With warmup and image handling disabled and a slower causal-conv1d fallback reported, cold graph capture, prompt path, contention, and kernel fallback may overlap.

## Discriminating run matrix

Keep the same model revision, GPU, prompt fixture, count, timeout, and service limits within each comparison. Use one manually started server at a time; capture its effective settings and startup logs before requests. Suggested sequence:

1. Cold service, one request, minimal fixture; then one warm request. Repeat this pair after each server restart.
2. Cold service with `DECIDER_WARMUP=0`, graphs=0; then separately graphs=1 and warmup=0; then graphs=1 and warmup=1. Do not combine changes in one comparison.
3. At a settled warm state, compare minimal vs bee-realistic with concurrency=1, then concurrency=3. Keep the sample count small enough to fit the script's 30-second hard run limit.
4. Only if service metrics show memory headroom and stable utilization, evaluate smaller fixed `DECIDER_T_BUCKETS` and `DECIDER_B_BUCKETS` in separate runs. Record effective bucket values, VRAM peak, and latency; do not reduce VRAM protections to force a result.
5. Consider a compatible causal-conv1d installation only after checking the exact serving framework, PyTorch, CUDA, Python, and wheel/build compatibility. No package installation or model-code change is part of this qualification harness.

For each run collect the harness JSON plus startup/shutdown logs and `/stats` (if that endpoint is implemented). Useful API counters, where exposed by the serving stack, include request count and duration, prompt-token count, active/queued requests, batch size, CUDA graph capture/replay counts, eager/fallback requests, model load/warmup duration, GPU memory allocated/reserved/peak, and CUDA utilization. Counter names vary by server; record actual names and units rather than assuming availability. If graph/eager counters are absent, use explicit server logs or tracing and label the cause unconfirmed.

## Operational bounds and rollback

- Service startup is manual and outside the script. Do not launch a GPU/model process as part of a benchmark run.
- Run on an otherwise idle, single-GPU host with exclusive model access. Do not overlap model starts, training, or other inference jobs. Confirm sufficient VRAM headroom before any configuration experiment.
- The harness allows 1–10 requests per round, 1–3 in flight, 1–30 rounds, and a per-request timeout no greater than 20 seconds. Its total request loop has a 30-second wall-clock cap; it reads at most 64 KiB per response. Avoid maximum values unless a supervisor explicitly requests them.
- Keep the existing model/service memory cap and host safeguards. Record current settings before changes. Revert only the experiment's service configuration to the recorded baseline, then stop the manually started service and verify the GPU is idle. This work does not edit service configuration, Compose, model code, risk logic, owner profiles, or provider identity.
- No benchmark choice is actionable. The program is an isolated measurement client and has no connection to Engine, databases, orders, or paper-trade submission.

## Results

See `RESULTS.md` for measured eager vs constrained CUDA graph timings and a short isolated 16-bee model-shadow run. The hypothesis ledger above was written before the controlled tests; H1 is now confirmed and the remaining H2/H3 factors are only partially explained.

**Review follow-up:** benchmark schema v2 records `truncated` and exits non-zero on a partial 30-second window. `p50Ms` / `p95Ms` / `p99Ms` include failures and timeouts (end-to-end availability); the new `p50OkMs` / `p95OkMs` / `p99OkMs` report valid-model responses only, while `summary.ok`, `modelAccepted`, and `statusCounts` avoid confusing acceptance with matching a model string. Host-only fixed URLs remain unchanged. The `state.bee` field is a synthetic-fixture marker not sent by actual `Engine.buildSnapshot`; keep fixture bytes identical when comparing runs. Relative-path CLI invocation is supported using resolved module file URLs.
