begin;

-- The connected project has a pre-Step-5 table (user_id, destination) with no
-- dates/budget fields. Keep those records intact, outside the exposed schema.
-- They cannot be imported truthfully without the missing trip requirements.
-- A compatible Step 5 schema is retained when this script is rerun.
-- An unrecognized schema fails without committing changes.
do $$
begin
  if to_regclass('public.trips') is not null then
    if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'trips' and column_name = 'owner_id')
      and exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'trips' and column_name = 'destination_name') then
      -- Validate the full column signatures below before replacing any helpers.
      null;
    elsif exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'trips' and column_name = 'user_id')
      and exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'trips' and column_name = 'destination')
      and not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'trips' and column_name in ('owner_id', 'start_date'))
      and to_regclass('nomvira_legacy.trips') is null then
      create schema if not exists nomvira_legacy;
      revoke all on schema nomvira_legacy from public, anon, authenticated;
      alter table public.trips set schema nomvira_legacy;
      revoke all on table nomvira_legacy.trips from public, anon, authenticated;
    else
      raise exception 'Existing trips table is incompatible with Step 5. No changes were committed. Inspect its columns before migrating.';
    end if;
  end if;
end;
$$;

create table if not exists public.trips (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  destination_name text not null,
  destination_place_id text,
  destination_latitude double precision,
  destination_longitude double precision,
  destination_timezone text,
  start_date date not null,
  end_date date not null,
  travelers_count integer not null,
  budget_total numeric(12,2) not null,
  currency text not null,
  budget_style text not null default 'balanced',
  travel_pace text not null default 'balanced',
  accommodation_preferences text[] not null default array['hotel']::text[],
  dietary_preferences text[] not null default '{}'::text[],
  special_requests text,
  status text not null default 'planning',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint trips_destination_check check (
    char_length(destination_name) between 2 and 160
    and destination_name = btrim(destination_name)
    and destination_name !~ '[[:cntrl:]]'
  ),
  constraint trips_dates_check check (end_date >= start_date and start_date >= date '0001-01-01' and end_date <= date '9999-12-31'),
  constraint trips_travelers_check check (travelers_count between 1 and 20),
  constraint trips_budget_check check (budget_total > 0 and budget_total <= 100000000),
  constraint trips_currency_check check (currency in ('USD', 'EUR', 'GBP', 'INR', 'CAD', 'AUD', 'JPY')),
  constraint trips_budget_style_check check (budget_style in ('budget', 'balanced', 'premium')),
  constraint trips_pace_check check (travel_pace in ('relaxed', 'balanced', 'packed')),
  constraint trips_status_check check (status in ('planning', 'active', 'completed', 'cancelled')),
  constraint trips_accommodation_check check (
    cardinality(accommodation_preferences) between 1 and 5
    and accommodation_preferences <@ array['hotel', 'hostel', 'homestay', 'apartment', 'resort']::text[]
    and array_position(accommodation_preferences, null) is null
  ),
  constraint trips_dietary_check check (
    cardinality(dietary_preferences) <= 5
    and dietary_preferences <@ array['vegetarian', 'vegan', 'halal', 'kosher', 'gluten_free']::text[]
    and array_position(dietary_preferences, null) is null
  ),
  constraint trips_requests_check check (special_requests is null or char_length(special_requests) <= 500),
  constraint trips_latitude_check check (destination_latitude is null or destination_latitude between -90 and 90),
  constraint trips_longitude_check check (destination_longitude is null or destination_longitude between -180 and 180)
);

create table if not exists public.trip_interests (
  id uuid primary key default gen_random_uuid(),
  trip_id uuid not null references public.trips(id) on delete cascade,
  interest text not null,
  created_at timestamptz not null default now(),
  constraint trip_interests_unique unique (trip_id, interest),
  constraint trip_interests_interest_check check (interest in (
    'food', 'history', 'culture', 'nature', 'adventure', 'art', 'shopping',
    'nightlife', 'beaches', 'relaxation', 'photography', 'local_experiences'
  ))
);
-- The UNIQUE(trip_id, interest) B-tree already indexes trip_id; no duplicate index.

-- IF NOT EXISTS must not silently accept a different table under the same name.
-- This validates both fresh and previously installed tables without changing rows.
do $$
declare
  incompatible_columns text;
begin
  select string_agg(expected.table_name || '.' || expected.column_name, ', ' order by expected.table_name, expected.column_name)
  into incompatible_columns
  from (values
    ('trips', 'id', 'uuid', 'NO'),
    ('trips', 'owner_id', 'uuid', 'NO'),
    ('trips', 'destination_name', 'text', 'NO'),
    ('trips', 'destination_place_id', 'text', 'YES'),
    ('trips', 'destination_latitude', 'float8', 'YES'),
    ('trips', 'destination_longitude', 'float8', 'YES'),
    ('trips', 'destination_timezone', 'text', 'YES'),
    ('trips', 'start_date', 'date', 'NO'),
    ('trips', 'end_date', 'date', 'NO'),
    ('trips', 'travelers_count', 'int4', 'NO'),
    ('trips', 'budget_total', 'numeric', 'NO'),
    ('trips', 'currency', 'text', 'NO'),
    ('trips', 'budget_style', 'text', 'NO'),
    ('trips', 'travel_pace', 'text', 'NO'),
    ('trips', 'accommodation_preferences', '_text', 'NO'),
    ('trips', 'dietary_preferences', '_text', 'NO'),
    ('trips', 'special_requests', 'text', 'YES'),
    ('trips', 'status', 'text', 'NO'),
    ('trips', 'created_at', 'timestamptz', 'NO'),
    ('trips', 'updated_at', 'timestamptz', 'NO'),
    ('trip_interests', 'id', 'uuid', 'NO'),
    ('trip_interests', 'trip_id', 'uuid', 'NO'),
    ('trip_interests', 'interest', 'text', 'NO'),
    ('trip_interests', 'created_at', 'timestamptz', 'NO')
  ) as expected(table_name, column_name, udt_name, is_nullable)
  left join information_schema.columns actual
    on actual.table_schema = 'public'
    and actual.table_name = expected.table_name
    and actual.column_name = expected.column_name
  where actual.udt_name is distinct from expected.udt_name
    or actual.is_nullable is distinct from expected.is_nullable
    or (expected.column_name = 'budget_total' and (actual.numeric_precision is distinct from 12 or actual.numeric_scale is distinct from 2));

  if incompatible_columns is not null then
    raise exception 'Incompatible Step 5 columns: %. No changes were committed.', incompatible_columns;
  end if;

  -- A same-shaped interest table must not reference an archived/other trip table.
  if not exists (
    select 1 from pg_catalog.pg_constraint
    where conrelid = 'public.trips'::regclass and contype = 'f'
      and confrelid = 'auth.users'::regclass and confdeltype = 'c'
      and conkey = array[(select attnum from pg_catalog.pg_attribute where attrelid = 'public.trips'::regclass and attname = 'owner_id')]
      and confkey = array[(select attnum from pg_catalog.pg_attribute where attrelid = 'auth.users'::regclass and attname = 'id')]
  ) or not exists (
    select 1 from pg_catalog.pg_constraint
    where conrelid = 'public.trip_interests'::regclass and contype = 'f'
      and confrelid = 'public.trips'::regclass and confdeltype = 'c'
      and conkey = array[(select attnum from pg_catalog.pg_attribute where attrelid = 'public.trip_interests'::regclass and attname = 'trip_id')]
      and confkey = array[(select attnum from pg_catalog.pg_attribute where attrelid = 'public.trips'::regclass and attname = 'id')]
  ) then
    raise exception 'Step 5 ownership/interest foreign keys are incompatible. No changes were committed.';
  end if;
end;
$$;

-- This also covers owner-only queries through the index's leftmost column.
create index if not exists trips_owner_start_date_idx on public.trips (owner_id, start_date);

create or replace function public.set_trip_updated_at()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

revoke all on function public.set_trip_updated_at() from public, anon, authenticated;
drop trigger if exists trips_set_updated_at on public.trips;
create trigger trips_set_updated_at before update on public.trips
for each row execute function public.set_trip_updated_at();

alter table public.trips enable row level security;
alter table public.trip_interests enable row level security;

revoke all on table public.trips, public.trip_interests from public, anon, authenticated;
grant select, insert, update, delete on table public.trips, public.trip_interests to authenticated;

drop policy if exists trips_select_own on public.trips;
create policy trips_select_own on public.trips for select to authenticated
using ((select auth.uid()) = owner_id);
drop policy if exists trips_insert_own on public.trips;
create policy trips_insert_own on public.trips for insert to authenticated
with check ((select auth.uid()) = owner_id);
drop policy if exists trips_update_own on public.trips;
create policy trips_update_own on public.trips for update to authenticated
using ((select auth.uid()) = owner_id) with check ((select auth.uid()) = owner_id);
drop policy if exists trips_delete_own on public.trips;
create policy trips_delete_own on public.trips for delete to authenticated
using ((select auth.uid()) = owner_id);

drop policy if exists trip_interests_select_own on public.trip_interests;
create policy trip_interests_select_own on public.trip_interests for select to authenticated
using (exists (select 1 from public.trips where trips.id = trip_id and trips.owner_id = (select auth.uid())));
drop policy if exists trip_interests_insert_own on public.trip_interests;
create policy trip_interests_insert_own on public.trip_interests for insert to authenticated
with check (exists (select 1 from public.trips where trips.id = trip_id and trips.owner_id = (select auth.uid())));
drop policy if exists trip_interests_update_own on public.trip_interests;
create policy trip_interests_update_own on public.trip_interests for update to authenticated
using (exists (select 1 from public.trips where trips.id = trip_id and trips.owner_id = (select auth.uid())))
with check (exists (select 1 from public.trips where trips.id = trip_id and trips.owner_id = (select auth.uid())));
drop policy if exists trip_interests_delete_own on public.trip_interests;
create policy trip_interests_delete_own on public.trip_interests for delete to authenticated
using (exists (select 1 from public.trips where trips.id = trip_id and trips.owner_id = (select auth.uid())));

-- Invoker security keeps all table permissions and RLS in force. The RPC supplies
-- atomicity only: an interest failure rolls the trip insert back automatically.
create or replace function public.create_trip_with_interests(
  p_destination_name text,
  p_start_date date,
  p_end_date date,
  p_travelers_count integer,
  p_budget_total numeric,
  p_currency text,
  p_budget_style text,
  p_travel_pace text,
  p_accommodation_preferences text[],
  p_dietary_preferences text[],
  p_special_requests text,
  p_interests text[],
  p_time_zone text default 'UTC'
)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  current_owner uuid := auth.uid();
  created_trip uuid;
begin
  if current_owner is null then
    raise exception 'Authentication required' using errcode = '28000';
  end if;
  if p_time_zone is null or not exists (select 1 from pg_catalog.pg_timezone_names where name = p_time_zone) then
    raise exception 'Invalid time zone' using errcode = '22023';
  end if;
  if p_start_date < (now() at time zone p_time_zone)::date then
    raise exception 'Start date cannot be in the past' using errcode = '22023';
  end if;
  if p_budget_total is null or scale(p_budget_total) > 2 then
    raise exception 'Invalid budget precision' using errcode = '22023';
  end if;
  if p_interests is null or cardinality(p_interests) not between 1 and 8 then
    raise exception 'Choose between one and eight interests' using errcode = '22023';
  end if;
  if cardinality(p_accommodation_preferences) <> (select count(distinct value) from unnest(p_accommodation_preferences) value)
    or cardinality(p_dietary_preferences) <> (select count(distinct value) from unnest(p_dietary_preferences) value) then
    raise exception 'Duplicate preferences' using errcode = '22023';
  end if;

  insert into public.trips (
    owner_id, destination_name, start_date, end_date, travelers_count,
    budget_total, currency, budget_style, travel_pace,
    accommodation_preferences, dietary_preferences, special_requests, status
  ) values (
    current_owner, btrim(p_destination_name), p_start_date, p_end_date, p_travelers_count,
    p_budget_total, p_currency, p_budget_style, p_travel_pace,
    p_accommodation_preferences, p_dietary_preferences, nullif(btrim(p_special_requests), ''), 'planning'
  ) returning id into created_trip;

  insert into public.trip_interests (trip_id, interest)
  select created_trip, value from unnest(p_interests) value;
  return created_trip;
end;
$$;

revoke all on function public.create_trip_with_interests(text, date, date, integer, numeric, text, text, text, text[], text[], text, text[], text) from public, anon, authenticated;
grant execute on function public.create_trip_with_interests(text, date, date, integer, numeric, text, text, text, text[], text[], text, text[], text) to authenticated;

notify pgrst, 'reload schema';

commit;
