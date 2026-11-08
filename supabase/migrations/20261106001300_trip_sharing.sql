begin;

-- Bearer tokens are hashed for lookup; only the owner can read the encrypted copy.
create table public.trip_shares (
  trip_id uuid primary key references public.trips(id) on delete cascade,
  owner_id uuid not null references auth.users(id) on delete cascade,
  revision uuid not null default gen_random_uuid(),
  request_id uuid,
  token_hash text unique check (token_hash ~ '^[a-f0-9]{64}$'),
  token_cipher text check (length(token_cipher) between 80 and 160),
  snapshot jsonb check (octet_length(snapshot::text) <= 100000),
  options jsonb,
  expires_at timestamptz,
  created_at timestamptz not null default now(),
  check ((token_hash is null) = (token_cipher is null)),
  check ((token_hash is null) = (snapshot is null)),
  check ((token_hash is null) = (expires_at is null))
);
create index trip_shares_owner on public.trip_shares(owner_id);
alter table public.trip_shares enable row level security;
create policy own_trip_shares on public.trip_shares for select to authenticated
  using (owner_id=(select auth.uid()) and exists(select 1 from public.trips t where t.id=trip_id and t.owner_id=(select auth.uid())));
revoke all on public.trip_shares from public,anon,authenticated;
grant select on public.trip_shares to authenticated;

create function nomvira_private.valid_trip_share_snapshot(p jsonb, o jsonb) returns boolean
language plpgsql immutable set search_path = '' as $$
declare d jsonb; i jsonb;
begin
  if jsonb_typeof(p) is distinct from 'object' or jsonb_typeof(o) is distinct from 'object'
    or not (p ?& array['version','exportedAt','destination','startDate','endDate','days','hotel','food','budget','notices'])
    or p-array['version','exportedAt','destination','startDate','endDate','days','hotel','food','budget','notices'] <> '{}'
    or not (o ?& array['hotel','food','budget']) or o-array['hotel','food','budget'] <> '{}'
    or p->>'version' is distinct from '1'
    or jsonb_typeof(p->'destination') is distinct from 'string'
    or length(p->>'destination') not between 1 and 160 then return false; end if;
  foreach i in array array[o->'hotel',o->'food',o->'budget'] loop
    if jsonb_typeof(i) is distinct from 'boolean' then return false; end if;
  end loop;
  if jsonb_typeof(p->'days') is distinct from 'array' or jsonb_typeof(p->'food') is distinct from 'array'
    or jsonb_typeof(p->'notices') is distinct from 'array' then return false; end if;
  if jsonb_array_length(p->'days')>14 or jsonb_array_length(p->'food')>50 or jsonb_array_length(p->'notices')>6
    or not (p->'notices' <@ '["itinerary_unavailable","hotel_unavailable","food_unavailable","budget_unavailable","stale_itinerary","demo_excluded"]'::jsonb) then return false; end if;
  if p->'hotel' <> 'null'::jsonb and (jsonb_typeof(p->'hotel') <> 'object' or (p->'hotel')-array['name','latitude','longitude'] <> '{}') then return false; end if;
  if p->'budget' <> 'null'::jsonb and (jsonb_typeof(p->'budget') <> 'object' or (p->'budget')-array['currency','total','planned','actual','remaining'] <> '{}') then return false; end if;
  if (o->>'hotel'='false' and p->'hotel'<>'null'::jsonb)
    or (o->>'food'='false' and p->'food'<>'[]'::jsonb)
    or (o->>'budget'='false' and p->'budget'<>'null'::jsonb) then return false; end if;
  for d in select value from jsonb_array_elements(p->'days') loop
    if jsonb_typeof(d) <> 'object' or d-array['dayNumber','date','theme','items'] <> '{}'
      or jsonb_typeof(d->'items') is distinct from 'array' then return false; end if;
    if jsonb_array_length(d->'items')>7 then return false; end if;
    for i in select value from jsonb_array_elements(d->'items') loop
      if jsonb_typeof(i) <> 'object' or i-array['type','title','period','latitude','longitude'] <> '{}'
        or (o->>'hotel'='false' and i->>'type'='hotel') or (o->>'food'='false' and i->>'type'='food') then return false; end if;
    end loop;
  end loop;
  for i in select value from jsonb_array_elements(p->'food') loop
    if jsonb_typeof(i) <> 'object' or i-array['name','category'] <> '{}' then return false; end if;
  end loop;
  return true;
end $$;
revoke all on function nomvira_private.valid_trip_share_snapshot(jsonb,jsonb) from public,anon,authenticated;

create function public.create_trip_share(p_payload text, p_signature text, p_document text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare proof jsonb := nomvira_private.verify_application_proof(p_payload,p_signature,'trip_share');
  t public.trips; s public.trip_shares; doc jsonb; deadline timestamptz;
begin
  if p_document is null or octet_length(p_document)>100000
    or proof->>'document_hash' is distinct from encode(extensions.digest(convert_to(p_document,'UTF8'),'sha256'),'hex') then
    raise exception 'Invalid share document' using errcode='22023'; end if;
  select * into t from public.trips where id=(proof->>'trip_id')::uuid and owner_id=auth.uid() for update;
  if not found then raise exception 'Trip not found' using errcode='42501'; end if;
  select * into s from public.trip_shares where trip_id=t.id;
  if s.request_id=(proof->>'request_id')::uuid and s.token_hash is not null then return to_jsonb(s); end if;
  if s.revision is distinct from (proof->>'revision')::uuid then raise exception 'SHARE_CONTEXT_CHANGED' using errcode='40001'; end if;
  doc := p_document::jsonb;
  deadline := (proof->>'share_expires_at')::timestamptz;
  if not nomvira_private.valid_trip_share_snapshot(doc,proof->'options')
    or proof->>'request_id' is null or proof->>'token_hash' is null or proof->>'token_cipher' is null
    or deadline is null or deadline<=now() or deadline>now()+interval '30 days'
    or t.updated_at is distinct from (proof->>'trip_updated_at')::timestamptz then
    raise exception 'Invalid share document' using errcode='22023'; end if;
  insert into public.trip_shares(trip_id,owner_id,request_id,token_hash,token_cipher,snapshot,options,expires_at)
    values(t.id,auth.uid(),(proof->>'request_id')::uuid,proof->>'token_hash',proof->>'token_cipher',doc,proof->'options',deadline)
    on conflict(trip_id) do update set revision=gen_random_uuid(),request_id=excluded.request_id,
      token_hash=excluded.token_hash,token_cipher=excluded.token_cipher,snapshot=excluded.snapshot,
      options=excluded.options,expires_at=excluded.expires_at,created_at=now()
    returning * into s;
  return to_jsonb(s);
end $$;

create function public.revoke_trip_share(p_trip_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform 1 from public.trips where id=p_trip_id and owner_id=auth.uid() for update;
  if not found then raise exception 'Trip not found' using errcode='42501'; end if;
  -- Keep a revision tombstone: a stale in-flight create cannot undo revocation.
  insert into public.trip_shares(trip_id,owner_id) values(p_trip_id,auth.uid())
    on conflict(trip_id) do update set revision=gen_random_uuid(),request_id=null,
      token_hash=null,token_cipher=null,snapshot=null,options=null,expires_at=null;
end $$;

create function public.get_shared_trip(p_token text) returns jsonb
language sql stable security definer set search_path = '' as $$
  select s.snapshot from public.trip_shares s join public.trips t on t.id=s.trip_id and t.owner_id=s.owner_id
  where p_token ~ '^[A-Za-z0-9_-]{43}$'
    and s.token_hash=encode(extensions.digest(convert_to(p_token,'UTF8'),'sha256'),'hex')
    and s.expires_at>now()
  limit 1
$$;
revoke all on function public.create_trip_share(text,text,text),public.revoke_trip_share(uuid),public.get_shared_trip(text) from public,anon,authenticated;
grant execute on function public.create_trip_share(text,text,text),public.revoke_trip_share(uuid) to authenticated;
grant execute on function public.get_shared_trip(text) to anon,authenticated;
notify pgrst,'reload schema';
commit;
