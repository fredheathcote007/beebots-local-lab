# Future option: reinforcement-learning trading bees

Status: **Backlog — requested, not implemented**  
Project: [BeeBots Local Lab](https://github.com/fredheathcote007/beebots-local-lab)  
Source: owner request, 26 October 2026 (Australia/Perth)  
Priority: Future phase, after the paper-only live-feed platform and multi-bee framework are proven.

## Intent

Allow an owner to optionally create a reinforcement-learning (RL) bee, or use RL to improve an existing bee, with **no exchange accounts, broker connection, live orders or live money**. An RL bee competes against deterministic and locally hosted financial-model bees using the same live public market data and equivalent starting conditions. Default is **off**.

RL is a *learning method*, not necessarily an LLM. Keep policy training, inference and Codex software changes separate:

- RL trains a policy from historical/replayed market observations and simulated outcomes.
- The running bee applies an approved, versioned policy only through the existing paper simulation and hard-coded risk layer.
- Codex can implement new features/experiments and evaluate results; it should not arbitrarily apply unvalidated policies or tune against the final test window.

## Candidate future design (requires research and approval)

1. Add a policy-provider interface: deterministic strategy, local LM Studio model, and RL policy (per bee, opt-in).
2. Add historical feed recording and deterministic replay, with exchange/market timestamps and gap/delay flags; live data can be collected but **training happens offline**.
3. Define a gym-style local simulation interface: observations (price features, liquidity, position/risk state); allowed actions (hold, enter, size, reduce, exit); reward based on returns after realistic fees, spreads, slippage and funding, penalised for drawdown, losses and unnecessary turnover.
4. Evaluate simpler contextual bandits before adopting a full algorithm such as PPO, DQN or SAC. Select the algorithm based on held-out empirical performance, not the model label.
5. Run walk-forward and out-of-sample evaluations, different market regimes and multiple random seeds; guard against lookahead and survivorship bias.
6. Log datasets, code commit, hyperparameters, model/policy checksum, reward formula, training and evaluation windows, decisions and results.
7. Promote only after explicit approval and tests against the incumbent and baseline bees. Keep rollback available. RL must not be able to bypass trade/risk checks or insert live order credentials.
8. Expose training progress, experiment comparisons, drawdown, Sharpe-like risk-adjusted metrics, turnover and decision attribution in the local dashboard.

## Dependencies

- Permanently paper-only deployment with reliable live *public* crypto feed and stale-data handling.
- Support for multiple independent bees, portfolios, strategy versions and controlled experiment cohorts.
- Replay/historical-data pipeline and fair comparison framework.
- Local model-provider interface and experiment registry.
- Later market providers may add forex and shares; each requires data-rights, session, funding, transaction-cost and instrument modelling.

## Future acceptance criteria

- RL can be enabled or disabled per bee; it is not required for ordinary trading bees.
- Trained policies are reproducible and versioned, with distinct training and held-out test windows.
- Evidence is sufficient to compare net returns and risk against meaningful deterministic and buy-and-hold baselines.
- RL cannot send real orders, request broker credentials, bypass risk controls or change itself during live-paper execution.
- Failed, stale or corrupted data/model inputs cause a safe hold/stop and preserve existing portfolio state.
- Policy changes are gated, reversible, logged and explicitly approved.
- Training remains local and isolated from real-time price ingestion so experimentation cannot affect other bees.

**Not in scope now:** automatic policy promotion, online reinforcement learning against a live brokerage, algorithm selection without evidence, real-money trading, or expanding Phase 1 implementation.
