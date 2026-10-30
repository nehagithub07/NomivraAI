begin;

alter table public.itinerary_versions
  add column generation_reason text not null default 'initial'
    check (generation_reason in ('initial','weather_adaptation')),
  add column parent_version_id uuid references public.itinerary_versions(id) on delete set null,
  add column weather_fetched_at timestamptz;
-- No raw forecasts or budget mutations. Existing versions retain their original contents.

-- Keep Step 9's full signed document/ID/date/capacity checks as a private implementation.
alter function public.complete_itinerary_generation(text,text,text) set schema nomvira_private;
revoke all on function nomvira_private.complete_itinerary_generation(text,text,text) from public,anon,authenticated;

create function public.complete_itinerary_generation(p_payload text,p_signature text,p_document text)
returns uuid language plpgsql security definer set search_path='' as $$
declare proof jsonb:=nomvira_private.verify_application_proof(p_payload,p_signature,'itinerary_version');
begin
  if exists (select 1 from public.itinerary_versions where id=(proof->>'version_id')::uuid
    and generation_reason<>'initial') then
    raise exception 'WEATHER_CONTEXT_CHANGED' using errcode='22023';
  end if;
  return nomvira_private.complete_itinerary_generation(p_payload,p_signature,p_document);
end;
$$;

create function public.begin_weather_adaptation(p_trip_id uuid,p_request_id uuid,p_parent_version_id uuid)
returns uuid language plpgsql security definer set search_path='' as $$
declare existing public.itinerary_versions%rowtype; target uuid;
begin
  perform 1 from public.trips where id=p_trip_id and owner_id=auth.uid() for update;
  if not found then raise exception 'Trip not found' using errcode='42501'; end if;
  select * into existing from public.itinerary_versions where trip_id=p_trip_id and request_id=p_request_id;
  if found then
    if existing.generation_reason<>'weather_adaptation' or existing.parent_version_id is distinct from p_parent_version_id then
      raise exception 'WEATHER_CONTEXT_CHANGED' using errcode='22023';
    end if;
    if existing.status='ready' then return existing.id; end if;
  end if;
  if not exists(select 1 from public.itinerary_versions where id=p_parent_version_id
    and trip_id=p_trip_id and is_current and status='ready') then
    raise exception 'WEATHER_CONTEXT_CHANGED' using errcode='22023';
  end if;
  target:=public.begin_itinerary_generation(p_trip_id,p_request_id,true);
  update public.itinerary_versions set generation_reason='weather_adaptation',parent_version_id=p_parent_version_id
    where id=target and status='generating';
  return target;
end;
$$;

create function public.complete_weather_adaptation(p_payload text,p_signature text,p_document text)
returns uuid language plpgsql security definer set search_path='' as $$
declare
  proof jsonb:=nomvira_private.verify_application_proof(p_payload,p_signature,'itinerary_version');
  target public.itinerary_versions%rowtype;
  parent public.itinerary_versions%rowtype;
  fetched timestamptz:=(proof->>'weather_fetched_at')::timestamptz;
  result uuid;
  digest text:=encode(extensions.digest(convert_to(p_document,'UTF8'),'sha256'),'hex');
begin
  perform 1 from public.trips where id=(proof->>'trip_id')::uuid and owner_id=auth.uid() for update;
  if not found then raise exception 'Trip not found' using errcode='42501'; end if;
  select * into target from public.itinerary_versions where id=(proof->>'version_id')::uuid
    and trip_id=(proof->>'trip_id')::uuid for update;
  if not found then raise exception 'Generation not found' using errcode='42501'; end if;
  if target.generation_reason<>'weather_adaptation' or proof->>'generation_reason' is distinct from 'weather_adaptation'
    or target.parent_version_id is distinct from (proof->>'parent_version_id')::uuid
    or proof->>'document_hash' is distinct from digest or fetched is null then
    raise exception 'WEATHER_CONTEXT_CHANGED' using errcode='22023';
  end if;
  if target.status='ready' and target.document_hash=digest and target.weather_fetched_at=fetched then
    return target.id;
  end if;
  select * into parent from public.itinerary_versions where id=target.parent_version_id
    and trip_id=target.trip_id and is_current and status='ready';
  if not found or parent.document_hash is distinct from proof->>'parent_document_hash'
    or fetched<now()-interval '60 minutes' or fetched>now()+interval '1 minute' then
    raise exception 'WEATHER_CONTEXT_CHANGED' using errcode='22023';
  end if;
  update public.itinerary_versions set weather_fetched_at=fetched where id=target.id;
  result:=nomvira_private.complete_itinerary_generation(p_payload,p_signature,p_document);
  return result;
end;
$$;
revoke all on function public.complete_itinerary_generation(text,text,text) from public,anon;
revoke all on function public.begin_weather_adaptation(uuid,uuid,uuid) from public,anon;
revoke all on function public.complete_weather_adaptation(text,text,text) from public,anon;
grant execute on function public.complete_itinerary_generation(text,text,text) to authenticated;
grant execute on function public.begin_weather_adaptation(uuid,uuid,uuid) to authenticated;
grant execute on function public.complete_weather_adaptation(text,text,text) to authenticated;
notify pgrst,'reload schema';
commit;
