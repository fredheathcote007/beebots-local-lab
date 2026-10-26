# Phase 1.6 status

## Implemented

- A local shell CLI and versioned (`version: 2`) staged profile catalogue.
- Atomic owner-only (`0600`) writes; no LAN management endpoint.
- Default profile IDs and names retain Bizzy/Breezy/Boozy as `bee1`/`bee2`/`bee3`.
- Create, clone, show, list, edit instructions, update coin restrictions/style, and archive profiles.
- Validation for unique IDs/names, reserved original names, 3–16 count bounds, bounded user text, ticker syntax, and strict schema fields.
- Runtime reads a valid profile file on startup, ticks configured active IDs, and publishes dynamic snapshots/profile metadata.
- Coin allowlists feed existing strategy filters; instruction text remains display-only and is not interpreted by the code chooser.
- No brokerage credentials, real-money execution, HTTP profile writes, or model dependency were added.

## Validation and limits

Profiles require 3–16 active IDs. Existing `bee1`–`bee3` SQLite state is loaded under the same IDs; new IDs get independent paper ledgers. Runtime edits require restart. Startup refuses to omit any stored bee with an open position, including archived IDs. The dashboard shows dynamic IDs and uses generic art for extras. The separate local System One model lane remains separate and untouched.

See [RUNTIME-STATUS.md](./RUNTIME-STATUS.md) for the migration, validation, rollback procedure, and checks run.

The engine's runtime ID list is dynamic, while the shared compile-time `BeeId` alias remains the original three IDs; config validates and narrows generated IDs at the boundary. A full generic-ID type refactor remains outstanding. The dashboard bundle build also remains unverified because its dependencies were unavailable offline.
