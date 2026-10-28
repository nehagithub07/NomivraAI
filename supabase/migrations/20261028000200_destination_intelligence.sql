begin;

create schema if not exists extensions;
create extension if not exists pgcrypto with schema extensions;
create schema if not exists nomvira_private;
revoke all on schema nomvira_private from public, anon, authenticated;
create table nomvira_private.application_secrets (
  name text primary key,
  value text not null check (char_length(value) >= 32)
);
revoke all on nomvira_private.application_secrets from public, anon, authenticated;
-- Populate internal_api_key as database owner, using the same value as the BFF.
-- Never place a real key in a migration. See backend/README.md.

alter table public.trips
  add column destination_formatted_address text,
  add column destination_types text[] not null default '{}',
  add column destination_utc_offset_minutes integer,
  add column destination_enriched_at timestamptz,
  add column destination_content_expires_at timestamptz;
alter table public.trips add constraint trips_utc_offset_check
  check (destination_utc_offset_minutes between -840 and 840);

-- Provider coordinates/IDs must not be writable through the browser's own
-- Supabase credentials after resolution. Preserve owner-scoped normal edits.
revoke insert, update on public.trips from authenticated;
grant update (
  destination_name, start_date, end_date, travelers_count, budget_total, currency,
  budget_style, travel_pace, accommodation_preferences, dietary_preferences,
  special_requests, status
) on public.trips to authenticated;

-- Conservative Google policy: only provider IDs and expiring coordinates are
-- persisted. Metadata columns support providers with storage rights; Google
-- writes always leave name/address/type metadata empty.
create table public.places (
  id uuid primary key default gen_random_uuid(),
  provider text not null check (provider = 'google'),
  provider_place_id text not null check (provider_place_id ~ '^[A-Za-z0-9_-]{1,255}$'),
  name text,
  formatted_address text,
  latitude double precision check (latitude between -90 and 90),
  longitude double precision check (longitude between -180 and 180),
  primary_type text,
  types text[] not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  last_refreshed_at timestamptz not null default now(),
  content_expires_at timestamptz not null,
  constraint places_provider_unique unique (provider, provider_place_id),
  constraint places_google_metadata_check check (
    provider <> 'google' or (name is null and formatted_address is null and primary_type is null and types = '{}')
  ),
  constraint places_expiry_check check (content_expires_at <= last_refreshed_at + interval '30 days')
);
create index places_expiry_idx on public.places(content_expires_at)
  where latitude is not null;

create table public.trip_place_candidates (
  id uuid primary key default gen_random_uuid(),
  trip_id uuid not null references public.trips(id) on delete cascade,
  place_id uuid not null references public.places(id) on delete cascade,
  candidate_category text not null check (candidate_category = 'attraction'),
  source text not null check (source = 'nearby_search'),
  created_at timestamptz not null default now(),
  constraint trip_place_candidates_unique unique (trip_id, place_id, candidate_category)
);
create index trip_place_candidates_place_idx on public.trip_place_candidates(place_id);
alter table public.places enable row level security;
alter table public.trip_place_candidates enable row level security;
revoke all on public.places, public.trip_place_candidates from public, anon, authenticated;
grant select on public.places, public.trip_place_candidates to authenticated;
create policy candidates_read_own on public.trip_place_candidates for select to authenticated
  using (exists (select 1 from public.trips t where t.id = trip_id and t.owner_id = (select auth.uid())));
create policy places_read_candidates on public.places for select to authenticated
  using (exists (select 1 from public.trip_place_candidates c where c.place_id = places.id));
-- No browser INSERT/UPDATE/DELETE grants or policies on either table.

create function nomvira_private.verify_application_proof(p_payload text, p_signature text, p_kind text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  secret text;
  document jsonb;
  current_seconds bigint := extract(epoch from now())::bigint;
begin
  if auth.uid() is null or octet_length(p_payload) > 25000 or p_signature !~ '^[a-f0-9]{64}$' then
    raise exception 'Invalid application proof' using errcode = '28000';
  end if;
  select value into secret from nomvira_private.application_secrets where name = 'internal_api_key';
  if secret is null or p_payload is null or p_signature is null or
    encode(extensions.hmac(convert_to(p_payload, 'UTF8'), convert_to(secret, 'UTF8'), 'sha256'), 'hex') <> p_signature then
    raise exception 'Invalid application proof' using errcode = '28000';
  end if;
  document := p_payload::jsonb;
  if document->>'kind' is distinct from p_kind or document->>'user_id' is distinct from auth.uid()::text
    or coalesce((document->>'expires_at')::bigint, 0) < current_seconds
    or (document->>'expires_at')::bigint > current_seconds + 86400 then
    raise exception 'Expired or invalid application proof' using errcode = '28000';
  end if;
  return document;
end;
$$;
revoke all on function nomvira_private.verify_application_proof(text,text,text) from public, anon, authenticated;

create function public.create_resolved_trip(p_form jsonb, p_payload text, p_signature text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  proof jsonb := nomvira_private.verify_application_proof(p_payload, p_signature, 'destination');
  destination jsonb := proof->'destination';
  resolved_at timestamptz := to_timestamp((proof->>'resolved_at')::double precision);
  trip_id uuid;
  zone text := destination->>'timezone_id';
begin
  if resolved_at is null or resolved_at > now() + interval '1 minute' or resolved_at < now() - interval '1 day'
    or destination->>'provider' is distinct from 'google'
    or coalesce(destination->>'place_id', '') !~ '^[A-Za-z0-9_-]{1,255}$'
    or destination->>'latitude' is null or destination->>'longitude' is null then
    raise exception 'Select a resolved destination' using errcode = '22023';
  end if;
  if zone is not null and not exists (select 1 from pg_catalog.pg_timezone_names where name = zone) then
    zone := null;
  end if;
  -- Reuse Step 5's atomic validation/creation; it derives owner_id from auth.uid().
  trip_id := public.create_trip_with_interests(
    p_form->>'p_destination_name', (p_form->>'p_start_date')::date, (p_form->>'p_end_date')::date,
    (p_form->>'p_travelers_count')::integer, (p_form->>'p_budget_total')::numeric,
    p_form->>'p_currency', p_form->>'p_budget_style', p_form->>'p_travel_pace',
    array(select jsonb_array_elements_text(p_form->'p_accommodation_preferences')),
    array(select jsonb_array_elements_text(p_form->'p_dietary_preferences')),
    p_form->>'p_special_requests', array(select jsonb_array_elements_text(p_form->'p_interests')),
    p_form->>'p_time_zone'
  );
  update public.trips set
    destination_place_id = destination->>'place_id',
    destination_latitude = (destination->>'latitude')::double precision,
    destination_longitude = (destination->>'longitude')::double precision,
    destination_timezone = zone,
    -- Compute date-specific DST offset using IANA rules once dates are known.
    destination_utc_offset_minutes = case when zone is null then null else
      (extract(epoch from (((((p_form->>'p_start_date')::date + time '12:00') at time zone 'UTC') at time zone zone)
        - ((p_form->>'p_start_date')::date + time '12:00'))) / 60)::integer end,
    destination_enriched_at = resolved_at,
    destination_content_expires_at = resolved_at + interval '30 days'
  where id = trip_id and owner_id = auth.uid();
  return trip_id;
end;
$$;
revoke all on function public.create_resolved_trip(jsonb,text,text) from public, anon, authenticated;
grant execute on function public.create_resolved_trip(jsonb,text,text) to authenticated;
-- Old trips remain readable/editable. New trip creation requires a server proof.
revoke execute on function public.create_trip_with_interests(text,date,date,integer,numeric,text,text,text,text[],text[],text,text[],text) from authenticated;

create function public.persist_trip_place_candidates(p_payload text, p_signature text)
returns integer language plpgsql security definer set search_path = '' as $$
declare
  proof jsonb := nomvira_private.verify_application_proof(p_payload, p_signature, 'nearby');
  trip_id uuid := (proof->>'trip_id')::uuid;
  item jsonb;
  saved_place_id uuid;
  refreshed_at timestamptz := to_timestamp((proof->>'refreshed_at')::double precision);
  count_saved integer := 0;
begin
  if not exists (select 1 from public.trips t where t.id = trip_id and t.owner_id = auth.uid()) then
    raise exception 'Trip not found' using errcode = '42501';
  end if;
  if jsonb_typeof(proof->'places') is distinct from 'array' or jsonb_array_length(proof->'places') > 20
    or refreshed_at is null or refreshed_at > now() + interval '1 minute' or refreshed_at < now() - interval '5 minutes' then
    raise exception 'Invalid candidate batch' using errcode = '22023';
  end if;
  for item in select value from jsonb_array_elements(proof->'places') loop
    insert into public.places(provider, provider_place_id, latitude, longitude, last_refreshed_at, content_expires_at)
    values ('google', item->>'provider_place_id', (item->>'latitude')::double precision,
      (item->>'longitude')::double precision, refreshed_at, refreshed_at + interval '30 days')
    on conflict (provider, provider_place_id) do update set
      latitude = excluded.latitude, longitude = excluded.longitude,
      last_refreshed_at = excluded.last_refreshed_at, content_expires_at = excluded.content_expires_at, updated_at = now()
    returning id into saved_place_id;
    insert into public.trip_place_candidates(trip_id, place_id, candidate_category, source)
      values (trip_id, saved_place_id, 'attraction', 'nearby_search')
      on conflict on constraint trip_place_candidates_unique do nothing;
    count_saved := count_saved + 1;
  end loop;
  return count_saved;
end;
$$;
revoke all on function public.persist_trip_place_candidates(text,text) from public, anon, authenticated;
grant execute on function public.persist_trip_place_candidates(text,text) to authenticated;

-- Install the documented hourly pg_cron job before enabling provider calls.
create function nomvira_private.purge_expired_provider_content()
returns void language plpgsql security definer set search_path = '' as $$
begin
  update public.places set latitude = null, longitude = null, updated_at = now()
    where content_expires_at <= now() + interval '1 hour' and latitude is not null;
  update public.trips set destination_latitude = null, destination_longitude = null,
    destination_timezone = null, destination_utc_offset_minutes = null
    where destination_content_expires_at <= now() + interval '1 hour' and destination_latitude is not null;
end;
$$;
revoke all on function nomvira_private.purge_expired_provider_content() from public, anon, authenticated;

notify pgrst, 'reload schema';
commit;
