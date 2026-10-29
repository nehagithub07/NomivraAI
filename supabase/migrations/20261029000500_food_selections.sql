begin;

-- Search results remain transient. Only saved associations and their display names persist.
-- Geoapify Places uses OSM data and permits caching/storage; retain source attribution.
create table public.trip_food_selections (
  id uuid primary key default gen_random_uuid(),
  trip_id uuid not null references public.trips(id) on delete cascade,
  provider text not null check (provider in ('geoapify','fixture')),
  provider_place_id text not null check (char_length(provider_place_id) between 1 and 512 and provider_place_id !~ '[[:cntrl:]]'),
  name text not null check (char_length(name) between 1 and 300 and name !~ '[[:cntrl:]]'),
  category text not null check (category in ('restaurant','cafe','bar','pub','fast_food','food_court','dessert','other')),
  saved_at timestamptz not null default now(),
  unique(trip_id,provider,provider_place_id)
);

alter table public.trip_food_selections enable row level security;
create policy food_selection_owned_read on public.trip_food_selections
for select to authenticated using (exists (
  select 1 from public.trips t where t.id=trip_id and t.owner_id=auth.uid()
));
create policy food_selection_owned_delete on public.trip_food_selections
for delete to authenticated using (exists (
  select 1 from public.trips t where t.id=trip_id and t.owner_id=auth.uid()
));
revoke all on public.trip_food_selections from public,anon,authenticated;
grant select,delete on public.trip_food_selections to authenticated;

create function public.save_trip_food(p_payload text,p_signature text)
returns uuid language plpgsql security definer set search_path='' as $$
declare
  proof jsonb := nomvira_private.verify_application_proof(p_payload,p_signature,'food_selection');
  trip public.trips%rowtype;
  saved_id uuid;
  expected_context jsonb;
begin
  select * into trip from public.trips t
    where t.id=(proof->>'trip_id')::uuid and t.owner_id=auth.uid() for update;
  if not found then raise exception 'Trip not found' using errcode='42501'; end if;
  expected_context := jsonb_build_object(
    'destination_provider',trip.destination_provider,'destination_provider_id',trip.destination_provider_id,
    'destination_latitude',trip.destination_latitude,'destination_longitude',trip.destination_longitude,
    'dietary_preferences',trip.dietary_preferences
  );
  if proof->'context' is distinct from expected_context or trip.destination_provider is distinct from 'open_meteo'
    or trip.destination_latitude is null or trip.destination_longitude is null
    or (proof->>'expires_at')::bigint > extract(epoch from now())::bigint + 1800 then
    raise exception 'Trip changed; search food again' using errcode='22023';
  end if;
  insert into public.trip_food_selections(trip_id,provider,provider_place_id,name,category)
  values(trip.id,proof->>'provider',proof->>'provider_place_id',proof->>'name',proof->>'category')
  on conflict(trip_id,provider,provider_place_id) do nothing
  returning id into saved_id;
  if saved_id is null then
    select id into saved_id from public.trip_food_selections
      where trip_id=trip.id and provider=proof->>'provider' and provider_place_id=proof->>'provider_place_id';
  end if;
  return saved_id;
end;
$$;
revoke all on function public.save_trip_food(text,text) from public,anon;
grant execute on function public.save_trip_food(text,text) to authenticated;

notify pgrst,'reload schema';
commit;
