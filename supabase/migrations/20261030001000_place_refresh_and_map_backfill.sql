begin;


create or replace function public.persist_trip_place_candidates(
  p_payload text,
  p_signature text
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  proof jsonb :=
    nomvira_private.verify_application_proof(
      p_payload,
      p_signature,
      'discovery'
    );

  parent_trip uuid :=
    (proof->>'trip_id')::uuid;

  refreshed_at timestamptz :=
    to_timestamp(
      (proof->>'refreshed_at')::double precision
    );

  item jsonb;
  saved_place uuid;
  saved_count integer := 0;
  safe_metadata jsonb;

begin
  perform id
  from public.trips
  where id = parent_trip
    and owner_id = auth.uid()
    and destination_provider = 'open_meteo'
  for update;

  if not found then
    raise exception 'Trip not found'
      using errcode='42501';
  end if;


  if
    jsonb_typeof(proof->'places')
      is distinct from 'array'
    or
    jsonb_array_length(
      proof->'places'
    ) > 30
    or refreshed_at is null
    or refreshed_at >
      now() + interval '1 minute'
    or refreshed_at <
      now() - interval '5 minutes'
  then
    raise exception
      'Invalid candidate batch'
      using errcode='22023';
  end if;


  -- Replace the previous discovery set.
  delete from
    public.trip_place_candidates
  where trip_id = parent_trip
    and source = 'overpass';


  for item in
    select value
    from jsonb_array_elements(
      proof->'places'
    )
  loop

    if
      item->>'provider'
        is distinct from
        'openstreetmap'
      or
      item->>'distance_km'
        is null
    then
      raise exception
        'Invalid place provider'
        using errcode='22023';
    end if;


    select
      coalesce(
        jsonb_object_agg(
          key,
          left(value,500)
        ),
        '{}'::jsonb
      )
    into safe_metadata
    from jsonb_each_text(
      coalesce(
        item->'tags',
        '{}'::jsonb
      )
    )
    where key in (
      'historic',
      'tourism',
      'leisure',
      'website',
      'opening_hours',
      'wikidata',
      'wikipedia',
      'amenity'
    );


    insert into public.places(
      provider,
      provider_place_id,
      name,
      category,
      latitude,
      longitude,
      metadata,
      last_refreshed_at,
      content_expires_at
    )
    values (
      'openstreetmap',
      item->>'provider_place_id',
      item->>'name',
      item->>'category',
      (item->>'latitude')::double precision,
      (item->>'longitude')::double precision,
      safe_metadata,
      refreshed_at,
      null
    )

    on conflict (
      provider,
      provider_place_id
    )

    do update set
      name =
        excluded.name,

      category =
        excluded.category,

      latitude =
        excluded.latitude,

      longitude =
        excluded.longitude,

      metadata =
        excluded.metadata,

      last_refreshed_at =
        excluded.last_refreshed_at,

      updated_at =
        now()

    returning id
      into saved_place;


    insert into
      public.trip_place_candidates(
        trip_id,
        place_id,
        candidate_category,
        source,
        distance_km
      )
    values (
      parent_trip,
      saved_place,
      'attraction',
      'overpass',
      (item->>'distance_km')::numeric
    )

    on conflict
      on constraint
      trip_place_candidates_unique

    do update set
      source = 'overpass',
      distance_km =
        excluded.distance_km;


    saved_count :=
      saved_count + 1;

  end loop;


  return saved_count;
end;
$$;


-- Repair old itinerary attraction coordinates.
update public.itinerary_items i
set
  latitude = p.latitude,
  longitude = p.longitude,
  opening_hours =
    p.metadata->>'opening_hours'
from public.places p
where
  i.place_id = p.id
  and
  i.candidate_type =
    'attraction'
  and (
    i.latitude is null
    or
    i.longitude is null
  );


revoke all on function
  public.persist_trip_place_candidates(
    text,
    text
  )
from public, anon;

grant execute on function
  public.persist_trip_place_candidates(
    text,
    text
  )
to authenticated;


notify pgrst,'reload schema';

commit;