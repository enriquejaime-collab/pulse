alter table public.wallet_sync_state
  add column if not exists last_run_id uuid,
  add column if not exists consecutive_failures integer not null default 0;

create table if not exists public.wallet_sync_runs (
  id uuid primary key default gen_random_uuid(),
  property_id uuid not null references public.properties(id) on delete cascade,
  wallet text not null,
  mode text not null default 'incremental',
  status text not null default 'syncing',
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  records_ingested integer not null default 0,
  error text
);

create table if not exists public.raw_trades (
  id uuid primary key default gen_random_uuid(),
  property_id uuid not null references public.properties(id) on delete cascade,
  wallet text not null,
  record_id text not null,
  event_timestamp timestamptz,
  payload_json jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint raw_trades_property_wallet_record_unique unique (property_id, wallet, record_id)
);

create table if not exists public.raw_closed_positions (
  id uuid primary key default gen_random_uuid(),
  property_id uuid not null references public.properties(id) on delete cascade,
  wallet text not null,
  record_id text not null,
  event_timestamp timestamptz,
  payload_json jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint raw_closed_positions_property_wallet_record_unique unique (property_id, wallet, record_id)
);

create table if not exists public.raw_positions (
  id uuid primary key default gen_random_uuid(),
  property_id uuid not null references public.properties(id) on delete cascade,
  wallet text not null,
  record_id text not null,
  event_timestamp timestamptz,
  payload_json jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint raw_positions_property_wallet_record_unique unique (property_id, wallet, record_id)
);

create table if not exists public.raw_activity (
  id uuid primary key default gen_random_uuid(),
  property_id uuid not null references public.properties(id) on delete cascade,
  wallet text not null,
  record_id text not null,
  event_timestamp timestamptz,
  payload_json jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint raw_activity_property_wallet_record_unique unique (property_id, wallet, record_id)
);

create index if not exists wallet_sync_runs_property_wallet_started_idx
  on public.wallet_sync_runs (property_id, wallet, started_at desc);
create index if not exists raw_trades_property_wallet_timestamp_idx
  on public.raw_trades (property_id, wallet, event_timestamp desc);
create index if not exists raw_closed_positions_property_wallet_timestamp_idx
  on public.raw_closed_positions (property_id, wallet, event_timestamp desc);
create index if not exists raw_positions_property_wallet_timestamp_idx
  on public.raw_positions (property_id, wallet, event_timestamp desc);
create index if not exists raw_activity_property_wallet_timestamp_idx
  on public.raw_activity (property_id, wallet, event_timestamp desc);

alter table public.wallet_sync_runs enable row level security;
alter table public.raw_trades enable row level security;
alter table public.raw_closed_positions enable row level security;
alter table public.raw_positions enable row level security;
alter table public.raw_activity enable row level security;

drop trigger if exists raw_trades_set_updated_at on public.raw_trades;
create trigger raw_trades_set_updated_at
before update on public.raw_trades
for each row
execute function public.set_updated_at();

drop trigger if exists raw_closed_positions_set_updated_at on public.raw_closed_positions;
create trigger raw_closed_positions_set_updated_at
before update on public.raw_closed_positions
for each row
execute function public.set_updated_at();

drop trigger if exists raw_positions_set_updated_at on public.raw_positions;
create trigger raw_positions_set_updated_at
before update on public.raw_positions
for each row
execute function public.set_updated_at();

drop trigger if exists raw_activity_set_updated_at on public.raw_activity;
create trigger raw_activity_set_updated_at
before update on public.raw_activity
for each row
execute function public.set_updated_at();
