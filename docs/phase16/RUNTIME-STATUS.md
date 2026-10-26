# Phase 1.6 runtime status

## Outcome

Runtime profile activation is implemented in this worktree. Compose pins `BEE_PROFILES_PATH=/data/bee-profiles.json` in the `bees-data` named volume, alongside `DB_PATH=/data/bees-{mode}.sqlite` and `SETTINGS_PATH=/data/settings.json`. Outside Compose, the owner profile file defaults to `./data/bee-profiles.json`. A valid v2 file activates its active profiles; when no file exists, the engine retains the original `bee1`, `bee2`, and `bee3` configuration. A v2 file must include `bee1`, `bee2`, and `bee3` as active profiles, plus any additional active or archived profiles. Profiles may be listed in any order. Profile edits take effect after restart.

The original three IDs remain stable and their existing SQLite ledger rows are loaded by those same IDs. Each new ID receives its own paper ledger with the configured starting equity (normally $333), strategy style, risk checks, and coin allowlist. Extra profiles use generic dashboard art. Instructions are displayed in the dashboard but are not interpreted by the deterministic chooser. There are no trading credentials or real-money execution paths in this runtime.

Archiving/removing a bee with a persisted open position fails startup with an actionable error. The engine also refuses to discard an open position for any stored bee ID omitted from the active profile set. Once flat, an archived profile is omitted from the runtime and snapshot; its closed ledger remains in SQLite.

One type-level item remains: the runtime ID list is dynamic, but the shared `BeeId` TypeScript alias still names the original three slots. The profile loader validates UUID IDs and the config boundary narrows them for existing engine collaborators. A compile-time generic ID/map refactor across those collaborators is not included, so type declarations for new IDs still require casts at boundaries.

The HTTP surface remains read-only for profiles and dashboard data. Profile changes are made through the owner shell CLI and filesystem only. No LAN write/admin route was added. The separate local System One decision-model lane was not changed.

## Migration and validation

No SQLite schema migration is needed: existing ledger tables already key rows by bee ID and accept additional IDs. Existing `bee1`–`bee3` state is not renamed or reset. To activate the CLI catalogue, restart the paper runtime with the same `DB_PATH` and profile path. Keep the original IDs in the profile file; generated IDs are stable after creation and should not be edited manually.

The loader validates the complete v2 schema, rejects unknown/nested fields, malformed JSON, credentials, duplicate IDs/names, reserved official names, invalid tickers, fewer than three active profiles, and missing or archived original IDs. Setup taglines and portrait flags map by legacy bee ID even when the profile list is reordered or contains an extra profile first. The profile path rejects symlinked files and parent directories. The CLI requires an absolute path when `--file` is supplied; writes use a private `0600` temporary file followed by atomic rename. Invalid profiles fail startup rather than falling back to three bees.

## Compose owner runbook

Run these commands from the coordinator checkout where `docker compose` addresses the paper runtime. The CLI command explicitly selects the same named volume path that the engine reads; do not edit a host checkout's `./data/bee-profiles.json` for the Compose runtime.

```sh
# Confirm the active catalogue and the container's configured path.
docker compose exec -u node -T engine sh -lc 'printf "BEE_PROFILES_PATH=%s\\n" "$BEE_PROFILES_PATH"'
docker compose exec -u node -T engine node dist/tools/owner-bees.js --file /data/bee-profiles.json list

# Back up the volume file before any edit (the timestamped copy stays in bees-data).
docker compose exec -u node -T engine sh -lc 'umask 077; if [ -f /data/bee-profiles.json ]; then cp /data/bee-profiles.json "/data/bee-profiles.json.bak.$(date -u +%Y%m%dT%H%M%SZ)"; else echo "No existing profile file to back up"; fi'

# Example edit. All owner commands must include this exact volume path.
docker compose exec -u node -T engine node dist/tools/owner-bees.js --file /data/bee-profiles.json create 'Clover' bizzy

# Re-read through the same CLI, then restart so the engine reloads the validated file.
docker compose exec -u node -T engine node dist/tools/owner-bees.js --file /data/bee-profiles.json list
docker compose restart engine

# Validate the public read-only snapshot after restart; confirm the expected bee IDs/count.
curl -fsS http://10.1.1.40:8080/snapshot
```

The CLI is compiled to `dist/tools/owner-bees.js` by `pnpm build`; the engine Dockerfile copies `/app/dist` into the runtime image. There is no LAN profile write API. Archiving remains limited to generated profiles: close that bee's paper position, run `archive <id>` with the explicit `/data` path, validate with `list`, and restart. The startup check refuses to omit an ID with an open position.

## Rollback

Back up the current volume file, then restore a chosen `/data/bee-profiles.json.bak.<timestamp>` over `/data/bee-profiles.json` using `docker compose exec -u node -T engine cp ...`; validate it with the explicit-path CLI `list`, then restart. Do not remove the v2 file to roll back: v2 validation requires all three original profiles. If any extra bee has an open paper position, startup intentionally refuses a rollback that omits it. Closed extra-bee ledger rows remain in SQLite and can be reactivated by restoring the profile file.

## Checks and production gates

- This remediation: root typecheck, lint, and build passed; scoped profile/config/runtime/dashboard metadata tests passed (13 tests); dashboard TypeScript/Vite build passed with pinned dependencies present.
- Independent host report: full suite passed, 364/364; isolated runtime E2E reported four bees including QuantBee with separate decisions/orders from the public live feed at `127.0.0.1:18089`. That test runtime was stopped. This is supplied evidence, not a rerun in this worktree.
- Production status: **NO GO / not deployed**. Before production approval, run the volume-backed list/restart/snapshot smoke check in the runbook. No change was made to the host binding `10.1.1.40`, the `10.1.1.0/24` allowlist, or Caddy's paper-only read surface. The engine remains paper-only; there was no real-money activity.
- No production container was restarted or changed. No commit, push, merge, or deployment was performed.


## Supervisor independent Docker qualification — 26 October 2026

- Docker image `beebots-p16-qualification:local` built successfully from this branch. Tested on a **separate Docker named volume** (`beebots-p16-qualification-data-20261026`) and an **unpublished** qualification container; the existing `beebots-local-lab` Compose services were not updated or restarted.
- The dedicated test container inherited `USER node` (`uid=1000`, `gid=1000`) and created `/data/bee-profiles.json` with mode `0600`, owner `1000:1000`. Explicit `docker exec -u node ... list` and `create` both worked. The runbook pins `docker compose exec -u node -T` to ensure profile-file ownership remains consistent even if user settings change.
- First Docker snapshot: HTTP 200, `mode=dry`, **4 active bees** including generated `QualificationBee`. Public crypto market feed continued to refresh. The original `bee1`, `bee2`, `bee3` portfolio IDs were retained.
- Backed up the live **qualification** profile file to `/data/bee-profiles.json.bak.smoke`; created a fifth bee `StrategyTestBee` and changed its `rules` with `edit-instructions`; original and backup files remained owner-private `0600`.
- Restarted **only the qualification container**, which recovered healthy; new snapshot HTTP 200, `mode=dry`, **5 active bees**, stable IDs across restart. The created instructions were persisted on the volume. This validates that the owner CLI and runtime target the same file in the actual Docker topology.
- Host qualification: `367/367` Vitest tests across 28 files, TypeScript typecheck, lint, root build, dashboard TypeScript/Vite build, Docker Compose configuration and Git diff check all passed. Cursor's independent review found earlier Docker path, settings-index and core-three-IDs blockers corrected. Remaining note: safe owner commands must use the explicit `-u node` runbook convention.
- **Production is unchanged:** the LAN dashboard remained `http://10.1.1.40:8080`, HTTP 200, paper mode and original three bees. This Docker qualification does not constitute production deployment or an accepted financial-performance result.
