begin;

-- Keep the source identity when saving rated Google Maps venues via StayAPI.
-- Ratings, reviews and temporary search payloads remain outside durable storage.
alter table public.trip_food_selections
  drop constraint if exists trip_food_selections_provider_check;
alter table public.trip_food_selections
  add constraint trip_food_selections_provider_check
  check (provider in ('geoapify', 'google_maps', 'fixture'));

-- All itinerary creation paths share this private, signed-document writer.
-- Preserve its ownership/proof checks while matching the saved venue's source.
do $$
declare
  item record;
  writer regprocedure := coalesce(
    to_regprocedure('nomvira_private.complete_itinerary_generation(text,text,text)'),
    to_regprocedure('public.complete_itinerary_generation(text,text,text)')
  );
  definition text;
begin
  for item in select conname from pg_constraint
    where conrelid='public.itinerary_items'::regclass and contype='c'
      and pg_get_constraintdef(oid) like '%candidate_provider%'
  loop
    execute format('alter table public.itinerary_items drop constraint %I', item.conname);
  end loop;
  if writer is null then raise exception 'Itinerary schema must be installed first'; end if;
  definition := pg_get_functiondef(writer);
  definition := replace(definition,
    'provider=''geoapify'' and provider_place_id=item->>''candidate_id''',
    'provider=item->>''candidate_provider'' and provider in (''geoapify'',''google_maps'') and provider_place_id=item->>''candidate_id''');
  execute definition;
end;
$$;

alter table public.itinerary_items add constraint itinerary_items_source_check check (
  (candidate_type='free_time' and candidate_provider is null and candidate_id is null)
  or (candidate_type='attraction' and candidate_provider is not null and candidate_provider='openstreetmap' and candidate_id is not null)
  or (candidate_type='food' and candidate_provider is not null and candidate_provider in ('geoapify','google_maps') and candidate_id is not null)
  or (candidate_type='hotel' and candidate_provider is not null and candidate_provider='stayapi' and candidate_id is not null)
);

notify pgrst, 'reload schema';
commit;
