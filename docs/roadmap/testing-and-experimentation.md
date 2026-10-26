# BeeBots Local Lab — Approved Testing and Experimentation Roadmap

**Project:** BeeBots Local Lab — fork of `imikerussell/beebots`  
**Status:** Approved direction; future capabilities are **not yet implemented**  
**Approved:** 26 October 2026 (Australia/Perth)  
**Source:** Owner agreement in project conversation, with explicit strong preference for historical backtesting and realistic trade simulation  
**Repository:** https://github.com/fredheathcote007/beebots-local-lab

## 1. Strategic decision

Build a **local AI trading research and experimentation platform**, not merely a three-bot profit leaderboard. The system must establish which strategies work, when they work, why they fail, and whether apparent improvements generalise to unseen market conditions after realistic execution costs.

**Owner's top priorities for the next capability phase:**
1. **Historical backtesting**: run strategy versions over reproducible years/periods of market history, with strict information-availability timing and held-out data.
2. **Realistic trade simulator**: use the **same execution and risk semantics** for historical backtests, recorded-market replay and live-data paper trading. Model costs and market friction rather than assuming frictionless fills.

A historical backtest showing a profit must never be presented as proof of live profitability.

## 2. Approved boundaries

- **No real-money trading**: no brokerage/exchange account connectivity, trading keys, private order endpoints or executable real-order pathway. Refuse unsafe modes rather than only relying on a DRY_RUN default.
- **Live public market prices are required** for initial crypto experiments. No Jev/Gemini/Zapier dependencies for normal operation. Local models are optional and can be run through LM Studio or similar.
- Run simulation, storage, models, tests and dashboard locally on Project Coordinator and optional local Dad-PC inference hardware. No mandatory external SaaS/hosted trading orchestration.
- Start with crypto; architect data-provider and asset semantics to allow forex and shares later, mindful of market hours, corporate actions, price-source rights and costs.
- Different bees can use deterministic strategies, local financial models, specialist skill workflows, and (later) optional RL policies. Every bee receives isolated simulated funds and fair shared feed inputs.
- Codex may implement strategy variations and improvements, but changes must be versioned, evaluated on untrained data and approved before promotion. No uncontrolled live policy rewriting or auto-promotion.
- Hard-coded risk enforcement, safe failure on stale/broken feeds, clear audit and rollback.
- Retain upstream MIT attribution. Do not overwrite ongoing independent Phase 1 work or other projects.

## 3. Prioritised features

| Order | Priority | Feature | Required outcome |
|---|---|---|---|
| **1** | **P1 / Owner favourite** | **Historical backtesting** | Deterministic replay across multiple years/market regimes; versioned datasets, time-ordered input, walk-forward/out-of-sample runs, avoidance of lookahead and survivorship bias |
| **2** | **P1 / Owner favourite** | **Realistic trade simulator** | Single paper execution core modelling bid/ask spreads, fees, slippage, funding, available liquidity, execution latency, partial fills, rejections, position sizing, margin/leverage where relevant, and failure modes |
| 3 | P1 | Live feed recorder and time machine | Public market data recorded with exchange timestamps, reception timestamps, gaps, source, quality and suitable order-book/liquidity samples; replay same session to any bee |
| 4 | P1 | Controlled experiment and A/B evaluation harness | Repeated comparable runs; equal initial capital and risk rules; independent bee state; varied prompts/models/strategies with tracked versions and seeds |
| 5 | P1 | Performance and statistical analytics | Net and risk-adjusted returns, max drawdown, Sortino/Sharpe where appropriate, turnover, cost attribution, exposure, win/loss distributions, confidence/variance; buy-and-hold and simple-rule controls |
| 6 | P2 | Market-regime evaluation | Performance under bullish, bearish, range-bound, high-volatility, low-liquidity and crash periods |
| 7 | P2 | Champion versus challenger promotion | Codex produces candidate improvements; rigorous backtest, regression/holdout, live-paper shadow trial, explicit approval and rollback |
| 8 | P2 | Stress and fault injection | Flash crashes, widened spreads, price gaps, API outages, stale/corrupt data, model refusal/timeouts, restart recovery |
| 9 | P2 | Decision explanation and audit | Why each bee opened, sized, held or exited; timestamped data, policy, model, prompt, strategy version, risk outcome and simulated fill |
| 10 | P3 | Financial-model tournaments | Multiple local Qwen/finance-oriented LLMs, classifiers, hybrid approaches and financial skills, with speed/resource usage and trading evaluation |
| 11 | P3 | Optional RL / evolutionary optimisation | Offline simulation training, reproducible policy artefacts, gated promotion to paper-only; see [RL roadmap](rl-bees.md) |
| 12 | P3 | Multi-asset expansion | Forex, shares and cross-asset portfolio comparison via provider/asset-specific adapters |

## 4. Essential design for backtesting and simulation

**One common engine** should handle action validation, fees, fill modelling, bookkeeping, risk enforcement, positions and P&L for all operating modes. Live *data* paper trading, recorded replay and historical backtesting are different feed inputs into the same simulator. No private trading API is needed or permitted.

**Data provenance:** track data vendor/source, instrument, market/exchange time, ingestion time, data revisions, missing intervals, timezone/session, fees and data entitlements. Use only observations available at the simulated decision timestamp. Store backtest dataset manifest/checksum, strategy code commit, policy version, model settings, seed, market calendar and simulator configuration.

**Execution realism:** support explicit configurable models rather than a single optimistic fill assumption: market/limit orders; taker/maker charges; spreads; impact/slippage vs liquidity; queue/partial-fill approximations when data supports them; delayed fills; gaps; funding/borrow costs, margin, leverage and liquidation as appropriate for the asset type. Clearly report assumptions where tick/order-book data is unavailable.

**Validation:** unit and property-based accounting tests (conservation/invariants), sample independent price calculations, fee/slippage edge cases, same-feed deterministic replay, stop-loss and daily loss enforcement, stale/no-data halt, gap recovery, no lookahead leakage, restart and data-consistency checks. A fee-aware strategy must outperform meaningful baselines on unseen regimes, not only show high profit on training history.

**Evaluation cohorts:** baseline buy-and-hold, random/simple rule, original bees, local LLM bees, challenger code, future RL bees. Separate development, diagnostic, held-out release and forward live-paper datasets. Do not repeatedly tune against the final holdout. Use repeated seeds/confidence intervals where stochastic behaviour materially affects selection.

**Promotion:** strategy/model updates are paper-only and manual-approval gated. A champion's active configuration must remain immutable during a comparison. Rollback to the prior version must preserve experiment history.

## 5. Staged delivery

| Phase | Focus | Acceptance gate |
|---|---|---|
| Phase 1 — In progress | Paper-only fail-closed local runtime, validated live public crypto prices, local baseline | Verified public live feed + paper ledger; every trading credential and live/demo mode rejected; tests pass |
| **Phase 2 — Owner priority** | **Historical backtester + realistic execution simulator + dataset recorder** | Repeatable market replay; historical net-P&L and cost accounting tested; stale/bad data fail closed; no lookahead |
| Phase 3 | Arbitrary configurable bees, local-model adapters, tournaments and rich scorecards | Multiple independently isolated bees compete on exactly matched feeds and risk conditions |
| Phase 4 | Codex experiment manager and champion/challenger workflow | Versioned challengers, automated evaluation, held-out checks, approval and rollback |
| Phase 5 | Optional RL/evolutionary policy research and stress/regime testing | Reproducible offline training; valid held-out improvement; safe shadow paper trial |
| Phase 6 | Forex, shares and multi-asset portfolio research | Provider contract and market-specific calendars, fees and corporate-action adjustments validated |

**Final vision — Bee Factory:** user specifies a trading idea, chooses local financial model(s)/skills and portfolio/risk rules, creates a bee, runs controlled historical/stress/forward paper tests, and compares it to the full population without using live money.

## 6. Implementation and scope discipline

- This document is the **approved product and evaluation roadmap**, not authorisation to deploy unreviewed code or turn on any live order feature.
- The ongoing Phase 1 Codex workstream remains separate. Do not modify Phase 1 concurrently from this roadmap update.
- Future implementation details, candidate frameworks and specific algorithm selection require research, implementation design and empirical validation.
- Do not equate a passing build with validated trading-engine accuracy.
