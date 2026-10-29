begin;

create table public.itinerary_versions (
  id uuid primary key default gen_random_uuid(),
  trip_id uuid not null references public.trips(id) on delete cascade,
  request_id uuid not null,
  version_number integer not null check (version_number > 0),
  status text not null default 'generating' check (status in ('generating','ready','failed')),
  is_current boolean not null default false,
  provider text check (provider in ('gemini','fixture')),
  model_name text check (char_length(model_name) between 1 and 100),
  prompt_version text check (char_length(prompt_version) between 1 and 32),
  demo boolean not null default false,
  title text check (char_length(title) between 1 and 200),
  summary text check (char_length(summary) <= 500),
  warnings text[] not null default '{}',
  trip_context jsonb not null,
  document_hash text,
  created_at timestamptz not null default now(),
  completed_at timestamptz,
  unique(trip_id,version_number), unique(trip_id,request_id),
  check (not is_current or status='ready'),
  check (status<>'ready' or (provider is not null and model_name is not null and prompt_version is not null
    and title is not null and summary is not null and document_hash is not null and completed_at is not null))
);
create unique index itinerary_one_current on public.itinerary_versions(trip_id) where is_current;
create unique index itinerary_one_generating on public.itinerary_versions(trip_id) where status='generating';

create table public.itinerary_days (
  id uuid primary key default gen_random_uuid(),
  itinerary_version_id uuid not null references public.itinerary_versions(id) on delete cascade,
  day_number integer not null check (day_number between 1 and 14),
  trip_date date not null,
  theme text not null check (char_length(theme) <= 80),
  unique(itinerary_version_id,day_number), unique(itinerary_version_id,trip_date)
);
create table public.itinerary_items (
  id uuid primary key default gen_random_uuid(),
  itinerary_day_id uuid not null references public.itinerary_days(id) on delete cascade,
  position integer not null check (position between 1 and 7),
  period text not null check (period in ('morning','afternoon','evening')),
  candidate_type text not null check (candidate_type in ('attraction','food','hotel','free_time')),
  candidate_provider text,
  candidate_id text check (char_length(candidate_id) between 1 and 512),
  place_id uuid references public.places(id) on delete set null,
  food_selection_id uuid references public.trip_food_selections(id) on delete set null,
  hotel_selection_id uuid references public.trip_accommodation_selections(id) on delete set null on update set null,
  title text not null check (char_length(title) between 1 and 500),
  reason text not null check (char_length(reason) <= 300),
  notes text check (char_length(notes) <= 500),
  category text check (char_length(category) <= 80),
  latitude double precision check (latitude between -90 and 90),
  longitude double precision check (longitude between -180 and 180),
  opening_hours text check (char_length(opening_hours) <= 500),
  unique(itinerary_day_id,position),
  check ((candidate_type='free_time' and candidate_provider is null and candidate_id is null)
    or (candidate_type='attraction' and candidate_provider is not null and candidate_provider='openstreetmap' and candidate_id is not null)
    or (candidate_type='food' and candidate_provider is not null and candidate_provider='geoapify' and candidate_id is not null)
    or (candidate_type='hotel' and candidate_provider is not null and candidate_provider='stayapi' and candidate_id is not null))
);
create unique index itinerary_no_daily_duplicate on public.itinerary_items(itinerary_day_id,candidate_type,candidate_id)
  where candidate_id is not null;

alter table public.itinerary_versions enable row level security;
alter table public.itinerary_days enable row level security;
alter table public.itinerary_items enable row level security;
create policy itinerary_versions_owned_read on public.itinerary_versions for select to authenticated
using (exists (select 1 from public.trips t where t.id=trip_id and t.owner_id=auth.uid()));
create policy itinerary_days_owned_read on public.itinerary_days for select to authenticated
using (exists (select 1 from public.itinerary_versions v where v.id=itinerary_version_id));
create policy itinerary_items_owned_read on public.itinerary_items for select to authenticated
using (exists (select 1 from public.itinerary_days d where d.id=itinerary_day_id));
revoke all on public.itinerary_versions,public.itinerary_days,public.itinerary_items from public,anon,authenticated;
grant select on public.itinerary_versions,public.itinerary_days,public.itinerary_items to authenticated;

-- No provider payloads, tokens or expiring hotel facts belong in this snapshot.
create function nomvira_private.itinerary_trip_context(p_trip_id uuid)
returns jsonb language sql stable security definer set search_path='' as $$
  select jsonb_build_object(
    'destination_provider',t.destination_provider,'destination_provider_id',t.destination_provider_id,
    'destination_name',t.destination_name,'destination_country',t.destination_country,
    'destination_latitude',t.destination_latitude,'destination_longitude',t.destination_longitude,
    'destination_timezone',t.destination_timezone,'start_date',t.start_date,'end_date',t.end_date,
    'travelers_count',t.travelers_count,'budget_total',t.budget_total,'currency',t.currency,
    'budget_style',t.budget_style,'travel_pace',t.travel_pace,
    'accommodation_preferences',t.accommodation_preferences,'dietary_preferences',t.dietary_preferences,
    'special_requests',t.special_requests,
    'interests',coalesce((select jsonb_agg(i.interest order by i.interest) from public.trip_interests i where i.trip_id=t.id),'[]'::jsonb)
  ) from public.trips t where t.id=p_trip_id and t.owner_id=auth.uid();
$$;
revoke all on function nomvira_private.itinerary_trip_context(uuid) from public,anon,authenticated;

create function public.begin_itinerary_generation(p_trip_id uuid,p_request_id uuid,p_regenerate boolean default false)
returns uuid language plpgsql security definer set search_path='' as $$
declare
  trip public.trips%rowtype;
  existing public.itinerary_versions%rowtype;
  version_id uuid;
begin
  select * into trip from public.trips t where t.id=p_trip_id and t.owner_id=auth.uid() for update;
  if not found then raise exception 'Trip not found' using errcode='42501'; end if;
  if p_request_id is null or trip.destination_provider is distinct from 'open_meteo'
    or trip.end_date-trip.start_date not between 0 and 13 then
    raise exception 'ITINERARY_INVALID_TRIP' using errcode='22023';
  end if;
  -- Recover abandoned requests without background workers. Current ready versions stay intact.
  update public.itinerary_versions set status='failed' where trip_id=p_trip_id
    and status='generating' and created_at < now()-interval '3 minutes';
  select * into existing from public.itinerary_versions where trip_id=p_trip_id and request_id=p_request_id;
  if found then
    if existing.status='ready' then return existing.id; end if;
    if existing.status='generating' then raise exception 'ITINERARY_IN_PROGRESS' using errcode='40001'; end if;
    raise exception 'ITINERARY_ATTEMPT_FAILED' using errcode='22023';
  end if;
  if not p_regenerate then
    select id into version_id from public.itinerary_versions where trip_id=p_trip_id and is_current;
    if found then return version_id; end if;
  end if;
  if exists (select 1 from public.itinerary_versions where trip_id=p_trip_id and status='generating') then
    raise exception 'ITINERARY_IN_PROGRESS' using errcode='40001';
  end if;
  if exists (select 1 from public.itinerary_versions where trip_id=p_trip_id and created_at > now()-interval '30 seconds') then
    raise exception 'ITINERARY_RATE_LIMITED' using errcode='P0001';
  end if;
  insert into public.itinerary_versions(trip_id,request_id,version_number,trip_context)
  select p_trip_id,p_request_id,coalesce(max(v.version_number),0)+1,nomvira_private.itinerary_trip_context(p_trip_id)
  from public.itinerary_versions v where v.trip_id=p_trip_id returning id into version_id;
  return version_id;
end;
$$;

-- The small existing application proof signs an exact document digest, so long plans
-- don't require weakening verify_application_proof's 25KB limit.
create function public.complete_itinerary_generation(p_payload text,p_signature text,p_document text)
returns uuid language plpgsql security definer set search_path='' as $$
declare
  proof jsonb := nomvira_private.verify_application_proof(p_payload,p_signature,'itinerary_version');
  trip public.trips%rowtype;
  version public.itinerary_versions%rowtype;
  document jsonb;
  day jsonb;
  item jsonb;
  day_id uuid;
  day_no integer := 0;
  pos integer;
  cap integer;
  count_attractions integer;
  count_food integer;
  count_hotel integer;
  seen text[] := '{}';
  source_place public.places%rowtype;
  source_food public.trip_food_selections%rowtype;
  hotel_id uuid;
  kind text;
  digest text;
  last_period integer;
  next_period integer;
begin
  if p_document is null or octet_length(p_document)>150000 then
    raise exception 'Invalid itinerary document' using errcode='22023';
  end if;
  digest := encode(extensions.digest(convert_to(p_document,'UTF8'),'sha256'),'hex');
  if proof->>'document_hash' is distinct from digest then
    raise exception 'Invalid itinerary digest' using errcode='28000';
  end if;
  select * into trip from public.trips t where t.id=(proof->>'trip_id')::uuid and t.owner_id=auth.uid() for update;
  if not found then raise exception 'Trip not found' using errcode='42501'; end if;
  select * into version from public.itinerary_versions where id=(proof->>'version_id')::uuid and trip_id=trip.id for update;
  if not found then raise exception 'Generation not found' using errcode='42501'; end if;
  if version.status='ready' and version.document_hash=digest then return version.id; end if;
  if version.status<>'generating' or version.created_at < now()-interval '3 minutes'
    or proof->'trip_context' is distinct from version.trip_context
    or version.trip_context is distinct from nomvira_private.itinerary_trip_context(trip.id) then
    raise exception 'ITINERARY_CONTEXT_CHANGED' using errcode='22023';
  end if;
  if proof->>'provider' is null or proof->>'provider' not in ('gemini','fixture')
    or proof->>'demo' is null or (proof->>'demo')::boolean is distinct from (proof->>'provider'='fixture') then
    raise exception 'Invalid itinerary provider' using errcode='22023';
  end if;
  document := p_document::jsonb;
  if jsonb_typeof(document->'days') is distinct from 'array'
    or jsonb_array_length(document->'days') <> trip.end_date-trip.start_date+1
    or jsonb_typeof(document->'warnings') is distinct from 'array' or jsonb_array_length(document->'warnings')>20 then
    raise exception 'Invalid itinerary days' using errcode='22023';
  end if;
  cap := case trip.travel_pace when 'relaxed' then 2 when 'packed' then 4 else 3 end;
  for day in select value from jsonb_array_elements(document->'days') loop
    day_no := day_no+1;
    if (day->>'day_number')::integer is distinct from day_no
      or (day->>'date')::date is distinct from trip.start_date+day_no-1
      or jsonb_typeof(day->'items') is distinct from 'array'
      or jsonb_array_length(day->'items') not between 1 and 7 then
      raise exception 'Invalid itinerary day' using errcode='22023';
    end if;
    insert into public.itinerary_days(itinerary_version_id,day_number,trip_date,theme)
    values(version.id,day_no,(day->>'date')::date,day->>'theme') returning id into day_id;
    pos:=0; count_attractions:=0; count_food:=0; count_hotel:=0; last_period:=-1;
    for item in select value from jsonb_array_elements(day->'items') loop
      pos:=pos+1; kind:=item->>'candidate_type';
      next_period:=case item->>'period' when 'morning' then 0 when 'afternoon' then 1 when 'evening' then 2 end;
      if next_period is null or next_period<last_period then
        raise exception 'Invalid itinerary period order' using errcode='22023';
      end if;
      last_period:=next_period;
      source_place:=null; source_food:=null; hotel_id:=null;
      if kind='attraction' then
        select p.* into source_place from public.places p join public.trip_place_candidates c on c.place_id=p.id
          where c.trip_id=trip.id and c.source='overpass' and p.provider='openstreetmap' and p.provider_place_id=item->>'candidate_id';
        if not found or source_place.name is distinct from item->>'title' or item->>'candidate_id'=any(seen) then
          raise exception 'Invalid itinerary attraction' using errcode='22023';
        end if;
        if source_place.category is distinct from item->>'category'
          or source_place.latitude is distinct from (item->>'latitude')::double precision
          or source_place.longitude is distinct from (item->>'longitude')::double precision
          or source_place.metadata->>'opening_hours' is distinct from item->>'opening_hours' then
          raise exception 'ITINERARY_CONTEXT_CHANGED' using errcode='22023';
        end if;
        seen:=array_append(seen,item->>'candidate_id'); count_attractions:=count_attractions+1;
      elsif kind='food' then
        select * into source_food from public.trip_food_selections where trip_id=trip.id
          and provider='geoapify' and provider_place_id=item->>'candidate_id';
        if not found or source_food.name is distinct from item->>'title' then
          raise exception 'Invalid itinerary food' using errcode='22023';
        end if;
        count_food:=count_food+1;
      elsif kind='hotel' then
        select id into hotel_id from public.trip_accommodation_selections where trip_id=trip.id
          and provider='stayapi' and id=(item->>'candidate_id')::uuid;
        if not found or item->>'title' is distinct from 'Selected accommodation' then
          raise exception 'Invalid itinerary hotel' using errcode='22023';
        end if;
        count_hotel:=count_hotel+1;
      elsif kind is distinct from 'free_time' or item->>'title' is distinct from 'Free time' then
        raise exception 'Invalid itinerary item' using errcode='22023';
      end if;
      if count_attractions>cap or count_food>2 or count_hotel>1 then
        raise exception 'Invalid itinerary capacity' using errcode='22023';
      end if;
      insert into public.itinerary_items(itinerary_day_id,position,period,candidate_type,candidate_provider,candidate_id,
        place_id,food_selection_id,hotel_selection_id,title,reason,notes,category,latitude,longitude,opening_hours)
      values(day_id,pos,item->>'period',kind,item->>'candidate_provider',item->>'candidate_id',
        source_place.id,source_food.id,hotel_id,item->>'title',item->>'reason',item->>'notes',
        case when kind='attraction' then source_place.category when kind='food' then source_food.category end,
        case when kind='attraction' then source_place.latitude end,
        case when kind='attraction' then source_place.longitude end,
        case when kind='attraction' then source_place.metadata->>'opening_hours' end);
    end loop;
  end loop;
  if cardinality(seen)=0 then raise exception 'Itinerary needs a real attraction' using errcode='22023'; end if;
  update public.itinerary_versions set is_current=false where trip_id=trip.id and is_current;
  update public.itinerary_versions set status='ready',is_current=true,provider=proof->>'provider',
    model_name=proof->>'model_name',prompt_version=proof->>'prompt_version',demo=(proof->>'demo')::boolean,
    title=document->>'title',summary=document->>'summary',warnings=array(select jsonb_array_elements_text(document->'warnings')),
    document_hash=digest,completed_at=now() where id=version.id;
  return version.id;
end;
$$;

create function public.fail_itinerary_generation(p_payload text,p_signature text)
returns void language plpgsql security definer set search_path='' as $$
declare proof jsonb := nomvira_private.verify_application_proof(p_payload,p_signature,'itinerary_failure');
begin
  update public.itinerary_versions v set status='failed'
  where v.id=(proof->>'version_id')::uuid and v.trip_id=(proof->>'trip_id')::uuid and v.status='generating'
    and exists (select 1 from public.trips t where t.id=v.trip_id and t.owner_id=auth.uid());
end;
$$;
revoke all on function public.begin_itinerary_generation(uuid,uuid,boolean) from public,anon;
revoke all on function public.complete_itinerary_generation(text,text,text) from public,anon;
revoke all on function public.fail_itinerary_generation(text,text) from public,anon;
grant execute on function public.begin_itinerary_generation(uuid,uuid,boolean) to authenticated;
grant execute on function public.complete_itinerary_generation(text,text,text) to authenticated;
grant execute on function public.fail_itinerary_generation(text,text) to authenticated;
notify pgrst,'reload schema';
commit;
