# Phase 1 supervisor validation — 26 October 2026 (Australia/Perth)

**Current accepted deployment:** `http://10.1.1.40:8080` accessible from `10.1.1.0/24` only (the original localhost Docker publish was removed). Dad-PC GET `/snapshot` 200, off-LAN 403, spoofed forwarded header 403, local paper mode and three bees; 357/357 tests passed. Final independent Cursor LAN review: GO. The older loopback-only sections below are retained as historical validation, superseded by the final LAN acceptance section at the end.

Project: `fredheathcote007/beebots-local-lab`, worktree `/srv/project-coordinator/projects/beebots-local-lab`, development branch `feature/paper-only-live-feed-foundation`.

## Owner-approved Phase 1 LAN availability change — pending supervisor validation

The LAN change is implemented on the branch above; it has not been deployed by Codex. Compose binds the dashboard to `10.1.1.40:8080` and retains `127.0.0.1:8080`; the engine remains unpublished. Caddy permits raw socket peers from `10.1.1.0/24` and loopback, does not use `X-Forwarded-For` for access control, and no longer proxies POST routes. The `scripts/validate-lan.sh` smoke check is intended to run from a PC on the permitted LAN.

Before supervisor approval/deployment, record these checks:

- `docker compose -p beebots-local-lab config` resolves both exact host bindings and publishes no engine port.
- Rebuild under controlled validation, then confirm `docker inspect` shows the `10.1.1.40:8080` and loopback bindings only; do not configure public DNS or forwarding.
- From a separate `10.1.1.0/24` PC, run `./scripts/validate-lan.sh`; confirm dashboard root, static assets, `/health`, `/snapshot`, dry mode, three bees, fresh market data, and 405 on the old POST paths.
- Confirm Caddy sees and accepts the actual LAN client source. From a source outside `10.1.1.0/24` that can route to the host, confirm HTTP 403, including when it sends `X-Forwarded-For: 10.1.1.x`. If Docker rewrites inbound peers so LAN requests are rejected or non-LAN clients are indistinguishable, stop: do not permit a broad Docker range. Use a source-aware authenticated host reverse proxy or separately approved network control.
- Verify `127.0.0.1:8080` still works on the host, and the engine has no host-published port.
- Confirm publicly visible output contains no credentials; no model endpoint, chooser, Dad-PC, firewall, or other application network policy was changed.

LAN access is unauthenticated: any client permitted by the subnet rule can see the paper dashboard. This is not approval for Internet exposure. The local-model idea remains a recommendation requiring separate owner approval.

The evidence below records the earlier loopback-only baseline and predates this LAN change.

Code-side checks after this change: Compose config, typecheck, lint, Node build, `bash -n scripts/validate-lan.sh`, and `git diff --check` passed. The full Vitest attempt timed out in localhost integration suites in this sandbox and was interrupted; dashboard build could not run because dashboard dependencies are absent and Corepack/pnpm's default cache path is read-only here. Prior supervisor evidence records 357/357 tests and both image builds for the pre-LAN baseline. Cursor independent review of this LAN change: pending. Do not merge or push until Cursor review and supervisor LAN validation are recorded.

## User requirements

- Locally hosted 3-bee simulation against live anonymous public crypto prices, with no real orders, account/API trading keys, remote LLM keys or remote Beekeeper/hive connections.
- Extensible model/bee/forex/share interfaces are future phases. Owner-approved historical backtesting and realistic execution simulator are specifically **Phase 2**, not required for Phase 1.

## Independently executed evidence (host supervisor, not Codex sandbox)

- Pinned pnpm 10.34.5 via `COREPACK_HOME=/tmp/beebots-corepack-20261026 corepack pnpm` installed and frozen lockfile resolved.
- **Tests: PASS — 25 test files, 357 tests passed, 0 failed.** Exact run `/tmp/beebots-final-full-suite.log` on Project Coordinator after stale-fill and clock-fixture corrections.
- **Typecheck, lint and Node build: PASS**. Host logs `/tmp/beebots-final-typecheck.log`, `/tmp/beebots-final-lint.log`, `/tmp/beebots-final-build.log`.
- **Docker Compose build: PASS**, both engine and dashboard images built from this checkout (no upstream runtime images). Logs `/tmp/beebots-phase1-docker-build.log` and `/tmp/beebots-final-deploy.log`.
- **Docker Compose deploy: PASS**, isolated project `beebots-local-lab`, with local named volumes; after engine startup both containers healthy, API `/health` and `/snapshot` HTTP 200, dashboard root HTTP 200, Caddy-to-engine `http://engine:8080/health` HTTP 200.
- **Live public-market feed: PASS**, `/snapshot` shows populated crypto instrument universe, recent refreshedAt and running deterministic decisions across Bizzy/Breezy/Boozy. Latest runtime observed dry mode, 3 bees, model `code`, 19 market universe symbols, approx US$333 paper starting equity each. One sample paper portfolio had $332.34 after simulated trading.
- **No account trading capability shipped by default:** Engine Docker image lacks `@okx_ai/okx-trade-cli` package; container environment has only `DRY_RUN`, `MODE`, `PAPER_CONTAINER_BIND` among examined execution/model-key names. The CLI wrapper itself rejects all actions. Runtime uses only `SimExecutor` and anonymous public REST.
- **Host exposure:** `docker inspect` confirms dashboard port mapping only `127.0.0.1:8080->80`; engine exposes `8080` inside Docker and does not publish a host port. No public domain, real broker account, hosted AI provider or trading credential was configured.
- **Freshness regression:** `test/sim-executor-freshness.test.ts` rejects stale/malformed per-instrument quotes at the simulated order fill boundary even when another instrument refreshes, including reduce-only closes; under stale data no fake fill is created.

## Historical failures and remediation

- Initial pinned package-manager bootstrap failed under default Corepack cache/registry conditions; resolved through writable `COREPACK_HOME` and successful registry access.
- Cursor initial review flagged upstream image references and incorrect container loopback listener; corrected by local compose build contexts, controlled internal Docker bind, loopback host publish.
- Initial typecheck/build errors and 3 then 6 old configuration/setup test failures were corrected with paper-only assertions instead of bypassing security checks.
- New stale-quote simulated-fill enforcement broke ten test fixtures because their system clock used current time while ticker timestamps were a fixed September date. Tests were corrected to pass their simulated clock (`() => NOW`) into `SimExecutor`; all full-suite tests now pass, without weakening the production guard.
- First cold-start health returned HTTP 502 while engine initialising; later health/snapshot returned HTTP 200 and Docker engine reported healthy. Test readiness only after engine health passes.

## Review and release status

- Cursor independent review #1 and #2 completed and found genuine high/critical issues, recorded at `/tmp/beebots-cursor-review1.log` and `/tmp/beebots-cursor-review2.log`. These findings drove code and test fixes.
- A final Cursor post-fix review was requested. Final verdict must be recorded before declaring Phase 1 fully accepted or merging to main.
- The repo remains the user's own local fork. No real-money transaction, broker setup or new remote service authorisation was performed.

## Remaining limitations

- Phase 1 sim fills use the current bid/ask plus fees but are not yet a complete realistic execution simulator. Historical replay, slippage/partial-fill models, data-provider abstraction for forex/shares, dynamic bee counts, local specialist model adapters and RL are future roadmap items.
- Engine's source tree retains some dormant upstream exchange-execution-related TypeScript utilities that cannot sign through the fork's disabled CLI; eventual removal is technical debt, not a claim of live broker access.
- In the earlier baseline, the dashboard was localhost-only; that evidence predates the LAN change above.

## Final independent review and release gate

- **Cursor independent post-fix review: GO** for Phase 1 default runtime and Compose localhost lab, with no substantiated Critical or High findings. Evidence: `/tmp/beebots-cursor-final-retry.log`, completed on 26 October 2026. Cursor did not personally rerun tests or Docker; host-supervisor evidence above covers those checks.
- Remaining **Medium** review notes: Caddy contains unused proxy POST handlers even though engine returns 405, `Access-Control-Allow-Origin: *` in the read-only API, dormant upstream demo/executor tools and TypeSafe SDK dependency, and marketing/provenance copy. These should be removed or documented in a subsequent focused hardening change; not treated as a Phase 1 acceptance blocker by Cursor.
- Rejection of legacy `settings.json` with Jev/Gemini/OpenAI keys is intentional and requires manual removal/migration before using any previously saved upstream settings with this paper-only fork.
- A further limitation: simulated exits cannot invent a fill on stale prices; the exit intent may be recorded/rejected until valid quotes resume. This favours correctness and safety over unrealistic immediate execution.

**Earlier baseline readiness: Phase 1 PASS for the loopback-only paper lab**, conditional on keeping its tested image, paper-only configuration and loopback binding. The LAN change above has separate pending review and validation gates. Do not treat either result as approval to enable real-money trading or Internet exposure.


## 26 October 2026 — LAN supervisor acceptance (supersedes prior loopback-only host publishing)

**Final deployment state: PASS for availability on 10.1.1.0/24 with enforced source restriction.**

- The Project Coordinator is `10.1.1.40/24`. Docker publishes only `10.1.1.40:8080->80` for web; the engine exposes `8080/tcp` **only inside the Compose network**. Docker localhost publishing was intentionally removed; use `http://10.1.1.40:8080` even from the host itself.
- A **real LAN client** Dad-PC `10.1.1.50` requested `/snapshot`: HTTP 200, `mode=dry`, 3 bees, and a current crypto instrument universe.
- From Project Coordinator, `bash scripts/validate-lan.sh http://10.1.1.40:8080` passed: root assets, health, snapshot, fresh market timestamp, three bees, and all tested upstream legacy POST methods returned HTTP 405.
- A request sourced from the host's non-LAN `172.17.0.1` interface to `http://10.1.1.40:8080/health` returned HTTP **403**.
- A request from the separate engine container attempting to spoof `X-Forwarded-For: 10.1.1.50` returned HTTP **403**. Caddy access control uses the **socket peer**, never a spoofable forwarded header.
- An intermediate test proved that adding the Docker gateway `172.20.0.1` to the Caddy allow-list allowed host-local `127.0.0.1` traffic but also wrongly allowed requests originating from `172.17.0.1` (HTTP 200). This unsafe exception was **removed**. Do not re-add Docker gateway or wide bridge CIDRs to the allow-list.
- The final `Caddyfile` allow-list contains **only `10.1.1.0/24`**; the Compose LAN bind is fixed to the exact approved host IP `10.1.1.40` rather than accepting `0.0.0.0` through environment substitution. No public DNS, Internet ingress or port-forwarding was configured.
- Host test suite after initial LAN configuration: 25 test files, **357/357 tests passed**. The final gateway-exception removal affected only the Caddyfile/port binding/docs, validated by Docker Compose re-build and live smoke checks, not application TypeScript logic.
- LAN dashboard is **unauthenticated and HTTP**. Every host within the permitted LAN can see market and paper portfolio data. This is suitable for the owner-directed private LAN lab, **not** for Internet exposure or a less-trusted network.

The preceding historical localhost-only statements document the former Phase 1 state and are superseded by this section. Local-only `pnpm dev` remains loopback-bound and is not the LAN deployment.
