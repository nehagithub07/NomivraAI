begin;

-- Forward migration: keep installed migration history and all user trips intact.
alter table public.trips rename column destination_place_id to destination_provider_id;
alter table public.trips rename column destination_formatted_address to destination_display_name;
alter table public.trips
  add column destination_provider text,
  add column destination_country text,
  add column destination_country_code text check (destination_country_code ~ '^[A-Z]{2}$'),
  add column destination_admin1 text,
  add column destination_admin2 text,
  add column destination_feature_code text,
  add column destination_population bigint check (destination_population between 0 and 9007199254740991);
update public.trips set destination_provider = 'google' where destination_provider_id is not null;
-- Old Google IDs remain identifiable; they are never passed to the new providers.
alter table public.trips drop constraint trips_destination_check;
alter table public.trips add constraint trips_destination_check check (
  char_length(destination_name) between 1 and 160 and destination_name=btrim(destination_name)
  and destination_name !~ '[[:cntrl:]]'
);

alter table public.places drop constraint places_provider_check;
alter table public.places drop constraint places_provider_place_id_check;
alter table public.places rename column primary_type to category;
alter table public.places add column metadata jsonb;
alter table public.places alter column content_expires_at drop not null;
alter table public.places add constraint places_provider_format check (provider ~ '^[a-z][a-z0-9_]{1,40}$');
alter table public.places add constraint places_openstreetmap_fields check (
  provider <> 'openstreetmap' or (
    name is not null and char_length(btrim(name)) between 1 and 500 and name !~ '[[:cntrl:]]'
    and latitude is not null and longitude is not null
    and provider_place_id ~ '^(node|way|relation)/[1-9][0-9]{0,18}$'
    and category is not null and category in ('attraction','museum','viewpoint','historic','monument','park','gallery','arts_centre')
    and (metadata is null or jsonb_typeof(metadata) = 'object')
    and content_expires_at is null
  )
);
-- Nullable fields allow existing expired Google reference rows to survive.
-- All new OSM rows require name and coordinates through the conditional check.
alter table public.trip_place_candidates add column distance_km numeric(10,3) check (distance_km between 0 and 40080);
alter table public.trip_place_candidates drop constraint trip_place_candidates_source_check;
alter table public.trip_place_candidates add constraint trip_place_candidates_source_check check (source in ('nearby_search','overpass'));

create or replace function nomvira_private.verify_application_proof(p_payload text, p_signature text, p_kind text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  secret text;
  document jsonb;
  current_seconds bigint := extract(epoch from now())::bigint;
begin
  if auth.uid() is null or p_payload is null or octet_length(p_payload) > 200000
    or p_signature is null or p_signature !~ '^[a-f0-9]{64}$' then
    raise exception 'Invalid application proof' using errcode = '28000';
  end if;
  select value into secret from nomvira_private.application_secrets where name = 'internal_api_key';
  if secret is null or encode(extensions.hmac(convert_to(p_payload,'UTF8'),convert_to(secret,'UTF8'),'sha256'),'hex') <> p_signature then
    raise exception 'Invalid application proof' using errcode = '28000';
  end if;
  document := p_payload::jsonb;
  if document->>'kind' is distinct from p_kind or document->>'user_id' is distinct from auth.uid()::text
    or coalesce((document->>'expires_at')::bigint,0) < current_seconds
    or (document->>'expires_at')::bigint > current_seconds + 86400 then
    raise exception 'Expired or invalid application proof' using errcode = '28000';
  end if;
  return document;
end;
$$;

create or replace function public.create_resolved_trip(p_form jsonb, p_payload text, p_signature text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  proof jsonb := nomvira_private.verify_application_proof(p_payload,p_signature,'destination');
  destination jsonb := proof->'destination';
  resolved_at timestamptz := to_timestamp((proof->>'resolved_at')::double precision);
  created_trip uuid;
  zone text := destination->>'timezone';
begin
  if resolved_at is null or resolved_at > now() + interval '1 minute' or resolved_at < now() - interval '1 day'
    or destination->>'provider' is distinct from 'open_meteo'
    or coalesce(destination->>'provider_location_id','') !~ '^[1-9][0-9]{0,14}$'
    or coalesce(char_length(destination->>'name'),0) not between 1 and 160
    or destination->>'latitude' is null or destination->>'longitude' is null then
    raise exception 'Select a resolved destination' using errcode = '22023';
  end if;
  if zone is not null and not exists (select 1 from pg_catalog.pg_timezone_names where name=zone) then zone := null; end if;
  -- Canonical name comes from the signed provider result, not from p_form.
  created_trip := public.create_trip_with_interests(
    destination->>'name', (p_form->>'p_start_date')::date, (p_form->>'p_end_date')::date,
    (p_form->>'p_travelers_count')::integer, (p_form->>'p_budget_total')::numeric,
    p_form->>'p_currency', p_form->>'p_budget_style', p_form->>'p_travel_pace',
    array(select jsonb_array_elements_text(p_form->'p_accommodation_preferences')),
    array(select jsonb_array_elements_text(p_form->'p_dietary_preferences')),
    p_form->>'p_special_requests',array(select jsonb_array_elements_text(p_form->'p_interests')),p_form->>'p_time_zone'
  );
  update public.trips set
    destination_provider = 'open_meteo', destination_provider_id = destination->>'provider_location_id',
    destination_display_name = destination->>'display_name', destination_country = destination->>'country',
    destination_country_code = destination->>'country_code', destination_admin1 = destination->>'admin1',
    destination_admin2 = destination->>'admin2', destination_feature_code = destination->>'feature_code',
    destination_population = (destination->>'population')::bigint,
    destination_latitude = (destination->>'latitude')::double precision,
    destination_longitude = (destination->>'longitude')::double precision, destination_timezone = zone,
    destination_enriched_at = resolved_at, destination_content_expires_at = null,
    destination_utc_offset_minutes = case when zone is null then null else
      (extract(epoch from (((((p_form->>'p_start_date')::date+time '12:00') at time zone 'UTC') at time zone zone)
      - ((p_form->>'p_start_date')::date+time '12:00'))) / 60)::integer end
  where id = created_trip and owner_id = auth.uid();
  return created_trip;
end;
$$;

create or replace function public.persist_trip_place_candidates(p_payload text,p_signature text)
returns integer language plpgsql security definer set search_path = '' as $$
declare
  proof jsonb := nomvira_private.verify_application_proof(p_payload,p_signature,'discovery');
  parent_trip uuid := (proof->>'trip_id')::uuid;
  refreshed_at timestamptz := to_timestamp((proof->>'refreshed_at')::double precision);
  item jsonb;
  saved_place uuid;
  saved_count integer := 0;
  safe_metadata jsonb;
begin
  -- A row lock also serializes concurrent saves for this trip.
  perform id from public.trips where id = parent_trip and owner_id = auth.uid() and destination_provider='open_meteo' for update;
  if not found then raise exception 'Trip not found' using errcode='42501'; end if;
  if jsonb_typeof(proof->'places') is distinct from 'array' or jsonb_array_length(proof->'places') > 30
    or refreshed_at is null or refreshed_at > now()+interval '1 minute' or refreshed_at < now()-interval '5 minutes' then
    raise exception 'Invalid candidate batch' using errcode='22023';
  end if;
  for item in select value from jsonb_array_elements(proof->'places') loop
    if item->>'provider' is distinct from 'openstreetmap' or item->>'distance_km' is null then
      raise exception 'Invalid place provider' using errcode='22023';
    end if;
    select coalesce(jsonb_object_agg(key,left(value,500)),'{}'::jsonb) into safe_metadata
      from jsonb_each_text(coalesce(item->'tags','{}'::jsonb))
      where key in ('historic','tourism','leisure','website','opening_hours','wikidata','wikipedia','amenity');
    insert into public.places(provider,provider_place_id,name,category,latitude,longitude,metadata,last_refreshed_at,content_expires_at)
    values ('openstreetmap',item->>'provider_place_id',item->>'name',item->>'category',
      (item->>'latitude')::double precision,(item->>'longitude')::double precision,safe_metadata,refreshed_at,null)
    on conflict (provider,provider_place_id) do update set name=excluded.name,category=excluded.category,
      latitude=excluded.latitude,longitude=excluded.longitude,metadata=excluded.metadata,last_refreshed_at=excluded.last_refreshed_at,updated_at=now()
    returning id into saved_place;
    insert into public.trip_place_candidates(trip_id,place_id,candidate_category,source,distance_km)
      values(parent_trip,saved_place,'attraction','overpass',(item->>'distance_km')::numeric)
      on conflict on constraint trip_place_candidates_unique do update set source='overpass',distance_km=excluded.distance_km;
    saved_count := saved_count+1;
  end loop;
  return saved_count;
end;
$$;

-- Preserve existing Google cache expiry without ever expiring open-provider data.
create or replace function nomvira_private.purge_expired_provider_content()
returns void language plpgsql security definer set search_path = '' as $$
begin
  update public.places set latitude=null,longitude=null,updated_at=now()
    where provider='google' and content_expires_at<=now()+interval '1 hour' and latitude is not null;
  update public.trips set destination_latitude=null,destination_longitude=null,destination_timezone=null,destination_utc_offset_minutes=null
    where destination_provider='google' and destination_content_expires_at<=now()+interval '1 hour' and destination_latitude is not null;
end;
$$;

-- Supabase may have default privileges for newly added columns: retain the
-- explicit user-edit column grants and protect all provider enrichment columns.
revoke insert, update on public.trips from authenticated;
grant update(destination_name,start_date,end_date,travelers_count,budget_total,currency,budget_style,travel_pace,
  accommodation_preferences,dietary_preferences,special_requests,status) on public.trips to authenticated;
revoke all on public.places,public.trip_place_candidates from public,anon,authenticated;
grant select on public.places,public.trip_place_candidates to authenticated;
revoke all on function public.create_resolved_trip(jsonb,text,text), public.persist_trip_place_candidates(text,text) from public,anon,authenticated;
grant execute on function public.create_resolved_trip(jsonb,text,text), public.persist_trip_place_candidates(text,text) to authenticated;
revoke all on function nomvira_private.verify_application_proof(text,text,text),nomvira_private.purge_expired_provider_content() from public,anon,authenticated;
-- Existing ownership RLS policies, uniqueness indexes and cascade FKs are retained.
notify pgrst,'reload schema';
commit;
