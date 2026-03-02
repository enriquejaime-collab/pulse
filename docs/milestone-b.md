# Milestone B: Incremental Sync, Raw Endpoint Storage, and Sync Telemetry

## What this adds

- Incremental wallet sync mode with overlap window (default 24h) after first full sync.
- Raw endpoint persistence per wallet:
  - `raw_trades`
  - `raw_closed_positions`
  - `raw_positions`
  - `raw_activity`
- Sync run tracking (`wallet_sync_runs`) with mode, status, duration window, and ingested row counts.
- Extended sync state (`wallet_sync_state`) with:
  - `last_run_id`
  - `consecutive_failures`
- Summary rebuild from persisted raw datasets, then snapshot write.
- New sync telemetry APIs:
  - `GET /api/properties/:propertyId/sync-state?wallet=0x...`
  - `GET /api/properties/:propertyId/sync-state` (all wallets in property)
  - `GET /api/properties/:propertyId/sync-runs?wallet=0x...&limit=10`

## Database migration

Run this SQL in Supabase:

- `supabase/migrations/20260301_milestone_b_sync_raw.sql`

## Sync API behavior

`POST /api/properties/:propertyId/sync` now:

1. Resolves mode (`full` for first run, otherwise `incremental`, unless `forceFull=true`).
2. Creates a sync run and marks wallet state as `syncing`.
3. Fetches Polymarket datasets.
4. Upserts raw endpoint records.
5. Rebuilds summary from persisted raw rows.
6. Stores a snapshot and marks run/state as `success`.
7. On error, marks run/state as `error` and increments `consecutive_failures`.
