alter table public.property_wallets
  add column if not exists sync_enabled boolean not null default true,
  add column if not exists sync_interval_minutes integer not null default 15,
  add column if not exists auto_heal_enabled boolean not null default true;

alter table public.property_wallets
  drop constraint if exists property_wallets_sync_interval_minutes_check;

alter table public.property_wallets
  add constraint property_wallets_sync_interval_minutes_check
  check (sync_interval_minutes >= 1 and sync_interval_minutes <= 1440);

alter table public.wallet_sync_state
  add column if not exists reliability_status text,
  add column if not exists reliability_checked_at timestamptz,
  add column if not exists reliability_trade_delta integer;

alter table public.wallet_sync_state
  drop constraint if exists wallet_sync_state_reliability_status_check;

alter table public.wallet_sync_state
  add constraint wallet_sync_state_reliability_status_check
  check (reliability_status in ('pass', 'pass_with_trade_drift', 'mismatch') or reliability_status is null);

create index if not exists property_wallets_sync_policy_idx
  on public.property_wallets (property_id, sync_enabled, sync_interval_minutes);

create index if not exists wallet_sync_state_reliability_idx
  on public.wallet_sync_state (property_id, reliability_status, updated_at desc);
