# Milestone C: Scheduled Sync Automation and Wallet Sync Policy

## What this adds

- Wallet-level sync policy in persistence:
  - `sync_enabled`
  - `sync_interval_minutes`
  - `auto_heal_enabled`
- Reliability fields in sync state:
  - `reliability_status`
  - `reliability_checked_at`
  - `reliability_trade_delta`
- Settings UX for:
  - Due-wallet automation visibility
  - Per-wallet sync policy controls
  - Reliability diagnostics (moved out of operator Trades view)
- Scheduler APIs:
  - `GET /api/ops/sync-due` (preview due queue)
  - `POST /api/ops/sync-due` (run due queue manually from UI)
  - `GET /api/ops/sync-due/cron` (cron-safe trigger endpoint)

## Database migration

Run this SQL in Supabase:

- `supabase/migrations/20260302_milestone_c_scheduler.sql`

## Scheduling options

Vercel Hobby plans have strict cron limits. If cron is unavailable, use `Run Due Sync Now` from Settings or trigger the cron endpoint from an external scheduler.

### Required environment variable (for protected cron endpoint)

Set at least one secret in Project → Settings → Environment Variables:

- `CRON_SECRET` (recommended)

Optional backward-compatibility alias:

- `SYNC_CRON_SECRET`

The cron route accepts either secret via:

- `Authorization: Bearer <secret>`
- or `x-sync-cron-secret: <secret>`

## Runtime behavior

When a wallet is due:

1. Run incremental sync.
2. Run reliability check.
3. If reliability is mismatch and `auto_heal_enabled = true`, run full sync and re-check.

`Run Due Sync Now` in Settings uses the same scheduler logic, but does not require cron authorization.
