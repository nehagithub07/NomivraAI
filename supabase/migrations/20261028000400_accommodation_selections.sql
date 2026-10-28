begin;

-- Permanent rows hold identifiers and user-owned selection context only.
-- Live names, photos, reviews, prices and availability stay in expiring server memory.
create table public.trip_accommodation_selections (
  id uuid primary key default gen_random_uuid(),
  trip_id uuid not null unique references public.trips(id) on delete cascade,
  provider text not null check (provider in ('stayapi','fixture')),
  provider_accommodation_id text not null check (
    char_length(provider_accommodation_id) between 1 and 160
    and provider_accommodation_id !~ '[[:cntrl:]]'
    and (provider <> 'stayapi' or provider_accommodation_id ~ '^[1-9][0-9]{0,19}$')
  ),
  selected_name text check (
    selected_name is null or (provider='fixture' and char_length(selected_name) between 1 and 300
      and selected_name !~ '[[:cntrl:]]')
  ),
  search_context jsonb not null check (jsonb_typeof(search_context)='object'),
  selected_at timestamptz not null default now()
);

alter table public.trip_accommodation_selections enable row level security;
create policy accommodation_selection_owned_read on public.trip_accommodation_selections
for select to authenticated using (exists (
  select 1 from public.trips t where t.id=trip_id and t.owner_id=auth.uid()
));
create policy accommodation_selection_owned_delete on public.trip_accommodation_selections
for delete to authenticated using (exists (
  select 1 from public.trips t where t.id=trip_id and t.owner_id=auth.uid()
));
revoke all on public.trip_accommodation_selections from public,anon,authenticated;
grant select,delete on public.trip_accommodation_selections to authenticated;

create function public.select_trip_accommodation(
  p_payload text, p_signature text, p_expected_id uuid default null
) returns uuid language plpgsql security definer set search_path='' as $$
declare
  proof jsonb := nomvira_private.verify_application_proof(p_payload,p_signature,'accommodation_selection');
  trip public.trips%rowtype;
  current_id uuid;
  selected_id uuid;
  expected_context jsonb;
  source text := proof->>'provider';
  property_id text := proof->>'provider_accommodation_id';
begin
  select * into trip from public.trips t
    where t.id=(proof->>'trip_id')::uuid and t.owner_id=auth.uid() for update;
  if not found then raise exception 'Trip not found' using errcode='42501'; end if;
  if (proof->>'expires_at')::bigint <= extract(epoch from now())::bigint
    or (proof->>'expires_at')::bigint > extract(epoch from now())::bigint + 1800
    or source is null or source not in ('stayapi','fixture')
    or property_id is null or char_length(property_id) not between 1 and 160 then
    raise exception 'Invalid accommodation selection' using errcode='22023';
  end if;
  expected_context := jsonb_build_object(
    'destination_provider',trip.destination_provider,
    'destination_provider_id',trip.destination_provider_id,
    'destination_latitude',trip.destination_latitude,
    'destination_longitude',trip.destination_longitude,
    'start_date',trip.start_date,'end_date',trip.end_date,
    'travelers_count',trip.travelers_count,'currency',trip.currency,
    'budget_total',trip.budget_total,'budget_style',trip.budget_style,
    'accommodation_preferences',trip.accommodation_preferences
  );
  if proof->'context' is distinct from expected_context
    or trip.end_date <= trip.start_date then
    raise exception 'Trip changed; search hotels again' using errcode='22023';
  end if;
  select id into current_id from public.trip_accommodation_selections where trip_id=trip.id;
  if current_id is distinct from p_expected_id then
    raise exception 'Selection changed; reload before replacing it' using errcode='40001';
  end if;
  insert into public.trip_accommodation_selections(
    trip_id,provider,provider_accommodation_id,selected_name,search_context
  ) values (
    trip.id,source,property_id,
    case when source='fixture' then proof->>'selected_name' else null end,
    expected_context
  ) on conflict(trip_id) do update set
    id=gen_random_uuid(),provider=excluded.provider,
    provider_accommodation_id=excluded.provider_accommodation_id,
    selected_name=excluded.selected_name,search_context=excluded.search_context,selected_at=now()
  returning id into selected_id;
  return selected_id;
end;
$$;
revoke all on function public.select_trip_accommodation(text,text,uuid) from public,anon;
grant execute on function public.select_trip_accommodation(text,text,uuid) to authenticated;

notify pgrst,'reload schema';
commit;
