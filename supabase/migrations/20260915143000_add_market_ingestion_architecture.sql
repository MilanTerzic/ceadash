-- Power Pulse style market-data architecture for CEA Dash.
-- Interactive pages read persisted observations; scheduled/manual ingestion owns upstream calls.

alter table if exists public.cross_border_flows_hourly
  add column if not exists duration_minutes integer not null default 60
    check (duration_minutes in (15, 30, 60));

alter table if exists public.cross_border_flows_hourly
  add column if not exists fetched_at timestamptz not null default now();

create table if not exists public.capacity_observations (
  delivery_date date not null,
  from_zone text not null,
  to_zone text not null,
  product text not null,
  price_eur_mwh numeric,
  offered_mw numeric,
  allocated_mw numeric,
  unit_warning text,
  source text not null default 'ENTSO-E',
  fetched_at timestamptz not null default now(),
  primary key (delivery_date, from_zone, to_zone, product)
);

create index if not exists capacity_observations_delivery_idx
  on public.capacity_observations (delivery_date desc, from_zone, to_zone, product);

alter table public.capacity_observations enable row level security;
revoke all on public.capacity_observations from anon, authenticated;
grant select on public.capacity_observations to anon, authenticated;
grant all on public.capacity_observations to service_role;

drop policy if exists "public read capacity observations" on public.capacity_observations;
create policy "public read capacity observations"
  on public.capacity_observations for select
  using (true);

create table if not exists public.data_ingestion_status (
  dataset text primary key,
  status text not null check (status in ('ok', 'partial', 'error')),
  last_attempt_at timestamptz not null default now(),
  last_success_at timestamptz,
  rows_written integer not null default 0,
  source text,
  error text,
  details jsonb not null default '{}'::jsonb
);

alter table public.data_ingestion_status enable row level security;
revoke all on public.data_ingestion_status from anon, authenticated;
grant select on public.data_ingestion_status to anon, authenticated;
grant all on public.data_ingestion_status to service_role;

drop policy if exists "public read ingestion status" on public.data_ingestion_status;
create policy "public read ingestion status"
  on public.data_ingestion_status for select
  using (true);

comment on table public.capacity_observations is
  'Canonical persisted explicit-allocation/capacity observations. UI reads this table; ingestion jobs own ENTSO-E refreshes.';

comment on table public.data_ingestion_status is
  'Public-safe health metadata for background ingestion pipelines. Never store credentials or raw provider payloads here.';
