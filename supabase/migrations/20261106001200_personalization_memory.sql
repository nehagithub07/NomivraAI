begin;
create schema if not exists extensions;
grant usage on schema extensions to authenticated;
create extension if not exists vector with schema extensions;

-- Closed vocabulary only: no chat, credentials, special requests or provider facts.
create function public.valid_travel_preferences(p jsonb) returns boolean
language plpgsql immutable set search_path = '' as $$
declare k text; allowed jsonb;
begin
  if jsonb_typeof(p) is distinct from 'object'
    or not (p ?& array['interests','travelPace','budgetStyle','dietaryPreferences','accommodationPreferences'])
    or p - array['interests','travelPace','budgetStyle','dietaryPreferences','accommodationPreferences'] <> '{}'::jsonb
    or p->>'travelPace' not in ('relaxed','balanced','packed')
    or p->>'budgetStyle' not in ('budget','balanced','premium')
    or jsonb_typeof(p->'travelPace') <> 'string'
    or jsonb_typeof(p->'budgetStyle') <> 'string' then return false; end if;
  foreach k in array array['interests','dietaryPreferences','accommodationPreferences'] loop
    if jsonb_typeof(p->k) is distinct from 'array' then return false; end if;
    allowed := case k
      when 'interests' then '["food","history","culture","nature","adventure","art","shopping","nightlife","beaches","relaxation","photography","local_experiences"]'::jsonb
      when 'dietaryPreferences' then '["vegetarian","vegan","halal","kosher","gluten_free"]'::jsonb
      else '["hotel","hostel","homestay","apartment","resort"]'::jsonb end;
    if not (p->k <@ allowed) or jsonb_array_length(p->k) > (case when k='interests' then 8 else 5 end)
      or exists(select 1 from jsonb_array_elements(p->k) v where jsonb_typeof(v) <> 'string')
      or (select count(*) <> count(distinct value) from jsonb_array_elements(p->k))
      or (k='accommodationPreferences' and jsonb_array_length(p->k)=0) then return false; end if;
  end loop;
  return true;
end $$;

create table public.travel_preferences (
  user_id uuid primary key references auth.users(id) on delete cascade,
  preferences jsonb not null check (public.valid_travel_preferences(preferences)),
  memory_enabled boolean not null default false,
  updated_at timestamptz not null default now()
);
create table public.travel_memories (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.travel_preferences(user_id) on delete cascade,
  kind text not null check (kind in ('preference','feedback','trip')),
  feedback text not null check (feedback in ('prefer','avoid')),
  preferences jsonb not null check (public.valid_travel_preferences(preferences)),
  source_trip_id uuid references public.trips(id) on delete cascade,
  content text not null check (length(content) <= 2000),
  embedding extensions.vector(768),
  embedding_model text check (embedding_model = 'gemini-embedding-001'),
  embedding_retry_after timestamptz,
  created_at timestamptz not null default now(),
  unique(user_id, content),
  check ((kind='trip') = (source_trip_id is not null)),
  check ((embedding is null) = (embedding_model is null))
);
create index travel_memories_owner on public.travel_memories(user_id, created_at desc);
create index travel_memories_source on public.travel_memories(source_trip_id) where source_trip_id is not null;
alter table public.travel_preferences enable row level security;
alter table public.travel_memories enable row level security;
create policy own_preferences on public.travel_preferences for select to authenticated using (user_id=(select auth.uid()));
create policy own_memories on public.travel_memories for select to authenticated using (user_id=(select auth.uid()));
revoke all on public.travel_preferences, public.travel_memories from anon, authenticated;
grant select on public.travel_preferences, public.travel_memories to authenticated;

-- All mutations serialize per user, including consent revocation and in-flight indexing.
create function public.update_travel_preferences(p_preferences jsonb, p_enabled boolean) returns void
language plpgsql security definer set search_path = '' as $$
declare u uuid := auth.uid();
begin
  if u is null or p_enabled is null or not public.valid_travel_preferences(p_preferences) then raise exception 'Invalid preferences' using errcode='22023'; end if;
  perform pg_advisory_xact_lock(hashtextextended(u::text, 14));
  insert into public.travel_preferences(user_id,preferences,memory_enabled) values(u,p_preferences,p_enabled)
    on conflict(user_id) do update set preferences=excluded.preferences, memory_enabled=excluded.memory_enabled, updated_at=now();
  if not p_enabled then delete from public.travel_memories where user_id=u; end if;
end $$;

create function public.save_travel_memory(p_kind text, p_preferences jsonb, p_feedback text, p_trip_id uuid default null) returns uuid
language plpgsql security definer set search_path = '' as $$
declare u uuid := auth.uid(); p jsonb := p_preferences; doc text; result uuid; t public.trips; k text;
begin
  if u is null then raise exception 'Authentication required' using errcode='42501'; end if;
  perform pg_advisory_xact_lock(hashtextextended(u::text, 14));
  if not exists(select 1 from public.travel_preferences where user_id=u and memory_enabled) then raise exception 'Memory consent required' using errcode='42501'; end if;
  if p_kind is null or p_kind not in ('preference','feedback','trip') or p_feedback is null or p_feedback not in ('prefer','avoid')
    or (p_kind='trip') <> (p_trip_id is not null) then raise exception 'Invalid memory' using errcode='22023'; end if;
  if p_trip_id is not null then
    select * into t from public.trips where id=p_trip_id and owner_id=u;
    if not found then raise exception 'Trip not found' using errcode='42501'; end if;
    -- Read owned, saved choices. Do not copy destinations, dates, chat or special requests.
    p := jsonb_build_object('interests', (select coalesce(jsonb_agg(interest order by interest),'[]'::jsonb) from public.trip_interests where trip_id=t.id),
      'travelPace',t.travel_pace,'budgetStyle',t.budget_style,
      'dietaryPreferences',to_jsonb(t.dietary_preferences),'accommodationPreferences',to_jsonb(t.accommodation_preferences));
  end if;
  if not public.valid_travel_preferences(p) then raise exception 'Invalid preferences' using errcode='22023'; end if;
  foreach k in array array['interests','dietaryPreferences','accommodationPreferences'] loop
    p := jsonb_set(p,array[k],(select coalesce(jsonb_agg(value order by value),'[]'::jsonb) from jsonb_array_elements(p->k)));
  end loop;
  doc := p_kind || ' ' || p_feedback || ' ' || coalesce(p_trip_id::text,'') || ' ' || p::text;
  select id into result from public.travel_memories where user_id=u and content=doc;
  if result is not null then return result; end if;
  if (select count(*) from public.travel_memories where user_id=u) >= 200 then raise exception 'Memory limit reached' using errcode='22023'; end if;
  insert into public.travel_memories(user_id,kind,feedback,preferences,source_trip_id,content)
    values(u,p_kind,p_feedback,p,p_trip_id,doc) returning id into result;
  return result;
end $$;

create function public.delete_travel_memory(p_id uuid default null, p_reset boolean default false) returns void
language plpgsql security definer set search_path = '' as $$
declare u uuid := auth.uid();
begin
  if u is null then raise exception 'Authentication required' using errcode='42501'; end if;
  perform pg_advisory_xact_lock(hashtextextended(u::text, 14));
  if p_reset then delete from public.travel_preferences where user_id=u;
  else delete from public.travel_memories where user_id=u and (p_id is null or id=p_id); end if;
end $$;

create function public.index_travel_memory(p_id uuid, p_content text, p_embedding extensions.vector) returns void
language plpgsql security definer set search_path = '' as $$
declare u uuid := auth.uid();
begin
  if u is null then raise exception 'Authentication required' using errcode='42501'; end if;
  perform pg_advisory_xact_lock(hashtextextended(u::text, 14));
  if extensions.vector_dims(p_embedding) <> 768 or extensions.vector_norm(p_embedding) <= 0 then raise exception 'Invalid embedding' using errcode='22023'; end if;
  update public.travel_memories set embedding=p_embedding, embedding_model='gemini-embedding-001'
    where id=p_id and user_id=u and content=p_content and embedding is null
    and exists(select 1 from public.travel_preferences where user_id=u and memory_enabled);
end $$;

create function public.claim_travel_memory_index(p_id uuid default null)
returns table(id uuid, content text)
language plpgsql security definer set search_path = '' as $$
declare u uuid := auth.uid();
begin
  if u is null then raise exception 'Authentication required' using errcode='42501'; end if;
  perform pg_advisory_xact_lock(hashtextextended(u::text, 14));
  return query update public.travel_memories m set embedding_retry_after=now()+interval '5 minutes'
    where m.id in (select x.id from public.travel_memories x where x.user_id=u and x.embedding is null
      and (p_id is null or x.id=p_id) and (x.embedding_retry_after is null or x.embedding_retry_after<=now())
      and exists(select 1 from public.travel_preferences p where p.user_id=u and p.memory_enabled)
      order by x.created_at limit 3)
    returning m.id,m.content;
end $$;

create function public.match_travel_memories(p_embedding extensions.vector, p_limit integer default 5)
returns table(id uuid, kind text, feedback text, preferences jsonb, source_trip_id uuid, content text, created_at timestamptz, similarity double precision)
language sql stable security invoker set search_path = '' as $$
  -- At most 200 rows per owner: exact cosine search avoids ANN post-filter underfetch.
  with owned as materialized (
    select * from public.travel_memories where user_id=(select auth.uid())
  )
  select m.id,m.kind,m.feedback,m.preferences,m.source_trip_id,m.content,m.created_at,
    1 - (m.embedding operator(extensions.<=>) p_embedding) as similarity
  from owned m
  where m.user_id=(select auth.uid()) and m.embedding_model='gemini-embedding-001'
    and exists(select 1 from public.travel_preferences p where p.user_id=(select auth.uid()) and p.memory_enabled)
    and (m.source_trip_id is null or exists(select 1 from public.trips t where t.id=m.source_trip_id and t.owner_id=(select auth.uid())))
    and (m.embedding operator(extensions.<=>) p_embedding) < 0.7
  order by m.embedding operator(extensions.<=>) p_embedding, m.id
  limit least(greatest(coalesce(p_limit,5),1),5)
$$;

revoke all on function public.valid_travel_preferences(jsonb), public.update_travel_preferences(jsonb,boolean), public.save_travel_memory(text,jsonb,text,uuid), public.delete_travel_memory(uuid,boolean), public.index_travel_memory(uuid,text,extensions.vector), public.claim_travel_memory_index(uuid), public.match_travel_memories(extensions.vector,integer) from public, anon;
grant execute on function public.valid_travel_preferences(jsonb), public.update_travel_preferences(jsonb,boolean), public.save_travel_memory(text,jsonb,text,uuid), public.delete_travel_memory(uuid,boolean), public.index_travel_memory(uuid,text,extensions.vector), public.claim_travel_memory_index(uuid), public.match_travel_memories(extensions.vector,integer) to authenticated;
notify pgrst, 'reload schema';
commit;
