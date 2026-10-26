# Phase 1.6: owner-managed bee profiles

## Current scope

`pnpm owner:bees` is an owner-only shell CLI intended for an authorised shell on the Project Coordinator. It writes `data/bee-profiles.json` (override with `BEE_PROFILES_PATH` or `--file`) as version 2 JSON using an atomic rename and mode `0600`. It accepts no provider credentials or remote provider flags. The public `10.1.1.0/24` dashboard remains read-only; this change adds no HTTP routes.

The paper runtime reads `bee-profiles.json` at startup and activates its configured active IDs. Edits require a restart. The natural-language instructions remain display-only; the deterministic chooser does not interpret them. Coin allowlists are enforced by the existing strategy filters. No model dependency is introduced here.

## Validation and safety

Version 2 profiles have stable IDs (`bee1`–`bee3` for the original three, UUID-derived opaque IDs for new profiles), a separate style (`bizzy`, `breezy`, `boozy`), bounded names/instructions/coins, unique IDs and names, a maximum of 16 profiles, and 3–16 active profiles. Original identities cannot be archived and reserved original bee names cannot be reused. Invalid or unknown fields fail closed. Each active profile has an independent paper ledger; original IDs and balances remain in place.

Examples (on the coordinator, with the repo checkout as the working directory):

```sh
pnpm owner:bees list
pnpm owner:bees show bee2
pnpm owner:bees create Clover breezy
pnpm owner:bees clone bee2 Sprout
pnpm owner:bees edit-instructions bee_<uuid> 'Prefer patient entries and avoid chasing sharp moves.'
pnpm owner:bees update-coins bee_<uuid> BTC,ETH,SOL
pnpm owner:bees update-coins bee_<uuid> any
pnpm owner:bees update-style bee_<uuid> boozy
pnpm owner:bees archive bee_<uuid>
```

The CLI says to restart after an edit. The runtime refuses startup if an archived or removed bee has an open persisted position. Keep a backup before editing the profile file. With the file absent, the runtime uses the original three IDs. Never place credentials in profile files.

## Runtime integration

The configured active list drives engine ticks, held-position reservations, paper execution, risk, persistence, equity snapshots, and the dashboard. The existing additive SQLite schema stores arbitrary bee IDs; no migration or ID reassignment is required. The first three keep their portraits and extras use a generic mark. Archive/open-position checks and restart behavior are described in [RUNTIME-STATUS.md](./RUNTIME-STATUS.md).
