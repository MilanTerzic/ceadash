create table if not exists public.market_price_intervals (
  market text not null,
  datetime timestamptz not null,
  duration_minutes integer not null check (duration_minutes in (15, 30, 60)),
  price_eur_mwh numeric not null,
  source text not null default 'ENTSO-E',
  fetched_at timestamptz not null default now(),
  primary key (market, datetime)
);

create index if not exists market_price_intervals_market_datetime_idx
  on public.market_price_intervals (market, datetime);

create index if not exists market_price_intervals_fetched_at_idx
  on public.market_price_intervals (fetched_at desc);

alter table public.market_price_intervals enable row level security;

revoke all on public.market_price_intervals from anon, authenticated;
grant all on public.market_price_intervals to service_role;

comment on table public.market_price_intervals is
  'Canonical day-ahead interval prices. Preserves original MTU so 15-minute and hourly markets are not conflated.';
