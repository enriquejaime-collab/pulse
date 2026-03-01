create extension if not exists pgcrypto;

create table if not exists public.properties (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  description text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.property_wallets (
  id uuid primary key default gen_random_uuid(),
  property_id uuid not null references public.properties(id) on delete cascade,
  wallet text not null,
  label text,
  strategy_tag text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint property_wallets_property_wallet_unique unique (property_id, wallet)
);

create table if not exists public.wallet_snapshots (
  id uuid primary key default gen_random_uuid(),
  property_id uuid not null references public.properties(id) on delete cascade,
  wallet text not null,
  source text not null default 'polymarket-data-api',
  summary_json jsonb not null,
  records_ingested integer not null default 0,
  created_at timestamptz not null default now()
);

create table if not exists public.wallet_sync_state (
  id uuid primary key default gen_random_uuid(),
  property_id uuid not null references public.properties(id) on delete cascade,
  wallet text not null,
  status text not null default 'idle',
  last_sync_at timestamptz,
  last_success_at timestamptz,
  last_error text,
  records_ingested integer not null default 0,
  updated_at timestamptz not null default now(),
  constraint wallet_sync_state_property_wallet_unique unique (property_id, wallet)
);

create index if not exists properties_created_at_idx on public.properties (created_at desc);
create index if not exists property_wallets_property_id_idx on public.property_wallets (property_id);
create index if not exists wallet_snapshots_property_wallet_created_idx
  on public.wallet_snapshots (property_id, wallet, created_at desc);
create index if not exists wallet_sync_state_property_wallet_idx
  on public.wallet_sync_state (property_id, wallet);

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists properties_set_updated_at on public.properties;
create trigger properties_set_updated_at
before update on public.properties
for each row
execute function public.set_updated_at();

drop trigger if exists property_wallets_set_updated_at on public.property_wallets;
create trigger property_wallets_set_updated_at
before update on public.property_wallets
for each row
execute function public.set_updated_at();

drop trigger if exists wallet_sync_state_set_updated_at on public.wallet_sync_state;
create trigger wallet_sync_state_set_updated_at
before update on public.wallet_sync_state
for each row
execute function public.set_updated_at();

alter table public.properties enable row level security;
alter table public.property_wallets enable row level security;
alter table public.wallet_snapshots enable row level security;
alter table public.wallet_sync_state enable row level security;

