# Milestone A: Properties, Wallet Profiles, and Manual Sync

## What this adds

- Property-centric workspace model (`properties`, `property_wallets`).
- Stored wallet profiles per property.
- Persistent wallet snapshots (`wallet_snapshots`) for cached loading.
- Per-wallet sync status (`wallet_sync_state`) for manual sync visibility.
- Manual sync API that stores the fetched summary as a snapshot.

## Database migration

Run this SQL in Supabase:

- `supabase/migrations/20260301_milestone_a_properties.sql`

## Environment variables

If these are set, the app uses Supabase persistence:

- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`

If not set, it falls back to a local JSON store:

- default local file: `/.pulse-store.json` in repo root
- optional override: `PULSE_LOCAL_STORE_PATH`

## New API routes

- `GET /api/properties` list properties + wallets
- `POST /api/properties` create property
- `GET /api/properties/:propertyId/wallets` list wallets
- `POST /api/properties/:propertyId/wallets` upsert wallet profile
- `DELETE /api/properties/:propertyId/wallets?wallet=0x...` remove wallet
- `GET /api/properties/:propertyId/summary?wallet=0x...` load latest cached snapshot
- `POST /api/properties/:propertyId/sync` manual sync and snapshot persist

