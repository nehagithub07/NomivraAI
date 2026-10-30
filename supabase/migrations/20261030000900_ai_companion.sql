begin;

create table public.companion_conversations (
  id uuid primary key default gen_random_uuid(),
  trip_id uuid not null unique references public.trips(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  active_request uuid, active_until timestamptz,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table public.companion_messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.companion_conversations(id) on delete cascade,
  role text not null check(role in ('user','assistant')),
  content text not null check(length(content) between 1 and 2000),
  reply_to uuid unique references public.companion_messages(id) on delete cascade,
  metadata jsonb not null default '{}'::jsonb check(octet_length(metadata::text)<=180000),
  created_at timestamptz not null default now()
);
create index companion_messages_recent on public.companion_messages(conversation_id,created_at desc,id);
create table public.companion_pending_actions (
  id uuid primary key,
  trip_id uuid not null references public.trips(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  tool_name text not null check(tool_name in ('add_budget_entry','move_itinerary_activity',
    'replace_itinerary_activity','create_itinerary_version','adapt_itinerary_for_weather',
    'select_hotel','save_food_selection')),
  arguments jsonb not null check(octet_length(arguments::text)<=4000),
  snapshot jsonb not null,
  preview jsonb not null check(octet_length(preview::text)<=4000),
  status text not null default 'pending' check(status in ('pending','confirmed','executed','cancelled','expired','failed')),
  result jsonb, expires_at timestamptz not null,
  created_at timestamptz not null default now(), confirmed_at timestamptz, completed_at timestamptz
);
create index companion_actions_trip on public.companion_pending_actions(trip_id,created_at desc);

alter table public.companion_conversations enable row level security;
alter table public.companion_messages enable row level security;
alter table public.companion_pending_actions enable row level security;
create policy companion_conversation_owner on public.companion_conversations for select to authenticated
  using(user_id=auth.uid() and exists(select 1 from public.trips t where t.id=trip_id and t.owner_id=auth.uid()));
create policy companion_message_owner on public.companion_messages for select to authenticated
  using(exists(select 1 from public.companion_conversations c join public.trips t on t.id=c.trip_id
    where c.id=conversation_id and c.user_id=auth.uid() and t.owner_id=auth.uid()));
create policy companion_action_owner on public.companion_pending_actions for select to authenticated
  using(user_id=auth.uid() and exists(select 1 from public.trips t where t.id=trip_id and t.owner_id=auth.uid()));
revoke all on public.companion_conversations,public.companion_messages,public.companion_pending_actions from public,anon,authenticated;
grant select on public.companion_conversations,public.companion_messages,public.companion_pending_actions to authenticated;

create function public.begin_companion_message(p_trip_id uuid,p_request_id uuid,p_content text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare c public.companion_conversations%rowtype; answer jsonb;
begin
  -- Serialize per verified user as well as per trip. Other users remain independent.
  perform 1 from auth.users where id=auth.uid() for update;
  perform 1 from public.trips where id=p_trip_id and owner_id=auth.uid() for update;
  if not found then raise exception 'Trip not found' using errcode='42501'; end if;
  if p_request_id is null or length(trim(p_content)) not between 1 and 2000 then
    raise exception 'COMPANION_INVALID_MESSAGE' using errcode='22023'; end if;
  insert into public.companion_conversations(trip_id,user_id) values(p_trip_id,auth.uid()) on conflict(trip_id) do nothing;
  select * into c from public.companion_conversations where trip_id=p_trip_id for update;
  if exists(select 1 from public.companion_messages where id=p_request_id) then
    if not exists(select 1 from public.companion_messages where id=p_request_id and conversation_id=c.id
      and role='user' and content=p_content) then raise exception 'COMPANION_CONFLICT' using errcode='22023'; end if;
    select metadata->'response' into answer from public.companion_messages where reply_to=p_request_id;
    return jsonb_build_object('conversation_id',c.id,'duplicate',true,'response',answer);
  end if;
  if c.active_until>now() or exists(select 1 from public.companion_messages m where m.conversation_id=c.id
    and m.role='user' and m.created_at>now()-interval '3 seconds') or
    (select count(*) from public.companion_messages m join public.companion_conversations v on v.id=m.conversation_id
      where v.user_id=auth.uid() and m.role='user' and m.created_at>now()-interval '1 minute')>=6 then
    raise exception 'COMPANION_RATE_LIMITED' using errcode='P0001';
  end if;
  insert into public.companion_messages(id,conversation_id,role,content) values(p_request_id,c.id,'user',p_content);
  update public.companion_conversations set active_request=p_request_id,active_until=now()+interval '100 seconds',updated_at=now() where id=c.id;
  return jsonb_build_object('conversation_id',c.id,'duplicate',false);
end;
$$;

create function public.finish_companion_message(p_payload text,p_signature text,p_document text)
returns uuid language plpgsql security definer set search_path='' as $$
declare proof jsonb:=nomvira_private.verify_application_proof(p_payload,p_signature,'companion_message');
  c public.companion_conversations%rowtype; doc jsonb; result_id uuid;
begin
  select * into c from public.companion_conversations where trip_id=(proof->>'trip_id')::uuid and user_id=auth.uid() for update;
  if not found or not exists(select 1 from public.trips where id=c.trip_id and owner_id=auth.uid()) then
    raise exception 'Trip not found' using errcode='42501'; end if;
  select id into result_id from public.companion_messages where reply_to=(proof->>'request_id')::uuid and conversation_id=c.id;
  if found then return result_id; end if;
  if c.active_request is distinct from (proof->>'request_id')::uuid or octet_length(p_document)>180000
    or encode(extensions.digest(convert_to(p_document,'UTF8'),'sha256'),'hex')<>proof->>'document_hash' then
    raise exception 'COMPANION_CONFLICT' using errcode='22023'; end if;
  doc:=p_document::jsonb;
  insert into public.companion_messages(conversation_id,role,content,reply_to,metadata)
    values(c.id,'assistant',doc->>'message',(proof->>'request_id')::uuid,jsonb_build_object('response',doc)) returning id into result_id;
  update public.companion_conversations set active_request=null,active_until=null,updated_at=now() where id=c.id;
  return result_id;
end;
$$;

create function public.prepare_companion_action(p_payload text,p_signature text,p_document text)
returns uuid language plpgsql security definer set search_path='' as $$
declare proof jsonb:=nomvira_private.verify_application_proof(p_payload,p_signature,'companion_action'); doc jsonb;
begin
  perform 1 from public.trips where id=(proof->>'trip_id')::uuid and owner_id=auth.uid() for update;
  if not found then raise exception 'Trip not found' using errcode='42501'; end if;
  if octet_length(p_document)>16000 or encode(extensions.digest(convert_to(p_document,'UTF8'),'sha256'),'hex')<>proof->>'document_hash' then
    raise exception 'COMPANION_INVALID_ACTION' using errcode='22023'; end if;
  doc:=p_document::jsonb;
  if doc->'snapshot'->'trip_context' is distinct from nomvira_private.itinerary_trip_context((proof->>'trip_id')::uuid) then
    raise exception 'COMPANION_CONTEXT_CHANGED' using errcode='22023'; end if;
  insert into public.companion_pending_actions(id,trip_id,user_id,tool_name,arguments,snapshot,preview,expires_at)
    values((proof->>'action_id')::uuid,(proof->>'trip_id')::uuid,auth.uid(),doc->>'tool_name',doc->'arguments',
      doc->'snapshot',doc->'preview',now()+interval '5 minutes');
  return (proof->>'action_id')::uuid;
end;
$$;

create function public.claim_companion_action(p_payload text,p_signature text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare proof jsonb:=nomvira_private.verify_application_proof(p_payload,p_signature,'companion_claim'); a public.companion_pending_actions%rowtype;
begin
  -- All companion operations acquire the trip lock before the action lock.
  perform 1 from public.trips where id=(proof->>'trip_id')::uuid and owner_id=auth.uid() for update;
  if not found then raise exception 'Trip not found' using errcode='42501'; end if;
  select * into a from public.companion_pending_actions where id=(proof->>'action_id')::uuid
    and trip_id=(proof->>'trip_id')::uuid and user_id=auth.uid() for update;
  if not found then raise exception 'Action not found' using errcode='42501'; end if;
  if a.status<>'pending' then return jsonb_build_object('claimed',false,'action',to_jsonb(a)); end if;
  if a.expires_at<=now() then
    update public.companion_pending_actions set status='expired',completed_at=now() where id=a.id;
    a.status:='expired';
    return jsonb_build_object('claimed',false,'action',to_jsonb(a));
  end if;
  if proof->>'operation'='cancel' then
    update public.companion_pending_actions set status='cancelled',completed_at=now() where id=a.id;
    a.status:='cancelled';
    return jsonb_build_object('claimed',false,'action',to_jsonb(a));
  end if;
  if proof->>'operation' is distinct from 'confirm' or
    a.snapshot->'trip_context' is distinct from nomvira_private.itinerary_trip_context(a.trip_id) then
    raise exception 'COMPANION_CONTEXT_CHANGED' using errcode='22023'; end if;
  if a.snapshot->>'itinerary_id' is distinct from (select id::text from public.itinerary_versions where trip_id=a.trip_id and is_current and status='ready')
    or a.snapshot->>'hotel_id' is distinct from (select id::text from public.trip_accommodation_selections where trip_id=a.trip_id) then
    raise exception 'COMPANION_CONTEXT_CHANGED' using errcode='22023'; end if;
  update public.companion_pending_actions set status='confirmed',confirmed_at=now() where id=a.id;
  a.status:='confirmed';
  return jsonb_build_object('claimed',true,'action',to_jsonb(a));
end;
$$;

create function public.finish_companion_action(p_payload text,p_signature text)
returns void language plpgsql security definer set search_path='' as $$
declare proof jsonb:=nomvira_private.verify_application_proof(p_payload,p_signature,'companion_result');
begin
  if proof->>'status' not in ('executed','failed') or octet_length((proof->'result')::text)>4000 then
    raise exception 'COMPANION_INVALID_ACTION' using errcode='22023'; end if;
  update public.companion_pending_actions set status=proof->>'status',result=proof->'result',completed_at=now()
    where id=(proof->>'action_id')::uuid and trip_id=(proof->>'trip_id')::uuid and user_id=auth.uid()
    and status='confirmed' and exists(select 1 from public.trips where id=(proof->>'trip_id')::uuid and owner_id=auth.uid());
end;
$$;

alter table public.itinerary_versions drop constraint itinerary_versions_generation_reason_check;
alter table public.itinerary_versions add constraint itinerary_versions_generation_reason_check
  check(generation_reason in ('initial','weather_adaptation','companion_edit'));
create function public.begin_companion_itinerary_edit(p_trip_id uuid,p_request_id uuid,p_parent_version_id uuid)
returns uuid language plpgsql security definer set search_path='' as $$
declare target uuid;
begin
  perform 1 from public.trips where id=p_trip_id and owner_id=auth.uid() for update;
  if not found then raise exception 'Trip not found' using errcode='42501'; end if;
  select id into target from public.itinerary_versions where trip_id=p_trip_id and request_id=p_request_id
    and parent_version_id=p_parent_version_id and generation_reason='companion_edit' and status='ready';
  if found then return target; end if;
  if not exists(select 1 from public.itinerary_versions where id=p_parent_version_id and trip_id=p_trip_id and is_current and status='ready') then
    raise exception 'COMPANION_CONTEXT_CHANGED' using errcode='22023'; end if;
  target:=public.begin_itinerary_generation(p_trip_id,p_request_id,true);
  update public.itinerary_versions set generation_reason='companion_edit',parent_version_id=p_parent_version_id where id=target and status='generating';
  return target;
end;
$$;
create function public.complete_companion_itinerary_edit(p_payload text,p_signature text,p_document text)
returns uuid language plpgsql security definer set search_path='' as $$
declare proof jsonb:=nomvira_private.verify_application_proof(p_payload,p_signature,'itinerary_version'); target public.itinerary_versions%rowtype;
begin
  perform 1 from public.trips where id=(proof->>'trip_id')::uuid and owner_id=auth.uid() for update;
  if not found then raise exception 'Trip not found' using errcode='42501'; end if;
  select * into target from public.itinerary_versions where id=(proof->>'version_id')::uuid and trip_id=(proof->>'trip_id')::uuid for update;
  if target.generation_reason is distinct from 'companion_edit' or target.parent_version_id is distinct from (proof->>'parent_version_id')::uuid then
    raise exception 'COMPANION_CONTEXT_CHANGED' using errcode='22023'; end if;
  if target.status='ready' then return target.id; end if;
  if not exists(select 1 from public.itinerary_versions where id=target.parent_version_id and trip_id=target.trip_id and is_current
    and document_hash=proof->>'parent_document_hash') then raise exception 'COMPANION_CONTEXT_CHANGED' using errcode='22023'; end if;
  return nomvira_private.complete_itinerary_generation(p_payload,p_signature,p_document);
end;
$$;

revoke all on function public.begin_companion_message(uuid,uuid,text),public.finish_companion_message(text,text,text),
  public.prepare_companion_action(text,text,text),public.claim_companion_action(text,text),public.finish_companion_action(text,text),
  public.begin_companion_itinerary_edit(uuid,uuid,uuid),public.complete_companion_itinerary_edit(text,text,text) from public,anon,authenticated;
grant execute on function public.begin_companion_message(uuid,uuid,text),public.finish_companion_message(text,text,text),
  public.prepare_companion_action(text,text,text),public.claim_companion_action(text,text),public.finish_companion_action(text,text),
  public.begin_companion_itinerary_edit(uuid,uuid,uuid),public.complete_companion_itinerary_edit(text,text,text) to authenticated;

notify pgrst,'reload schema';
commit;
