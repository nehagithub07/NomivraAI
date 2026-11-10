-- READ ONLY. Run in the intended project's Supabase SQL Editor before migrations.
-- Match its project reference to NEXT_PUBLIC_SUPABASE_URL yourself.
-- Reads catalogs only: no user records, secrets, writes, or schema changes.

with expected(table_name) as (values
  ('trips'), ('trip_interests'), ('trip_place_candidates'),
  ('trip_accommodation_selections'), ('trip_food_selections'),
  ('itinerary_versions'), ('trip_budget_entries'),
  ('companion_conversations'), ('companion_messages'), ('companion_pending_actions'),
  ('travel_preferences'), ('travel_memories'), ('trip_shares')
)
select e.table_name,
       c.oid is not null as table_present,
       coalesce(c.relrowsecurity, false) as rls_enabled,
       exists(select 1 from pg_policies p
              where p.schemaname='public' and p.tablename=e.table_name) as policy_present
from expected e
left join pg_class c on c.oid=to_regclass('public.' || e.table_name)
order by e.table_name;

with expected(function_name) as (values
  ('create_resolved_trip'), ('persist_trip_places'),
  ('begin_companion_message'), ('finish_companion_message'),
  ('prepare_companion_action'), ('claim_companion_action'), ('finish_companion_action'),
  ('begin_companion_itinerary_edit'), ('complete_companion_itinerary_edit'),
  ('update_travel_preferences'), ('save_travel_memory'), ('delete_travel_memory'),
  ('claim_travel_memory_index'), ('index_travel_memory'), ('match_travel_memories'),
  ('create_trip_share'), ('revoke_trip_share'), ('get_shared_trip')
)
select e.function_name,
       p.oid is not null as function_present,
       pg_get_function_identity_arguments(p.oid) as arguments,
       p.prosecdef as security_definer,
       case when p.oid is not null then has_function_privilege('anon',p.oid,'EXECUTE') end
         as anonymous_execute
from expected e
left join pg_namespace n on n.nspname='public'
left join pg_proc p on p.pronamespace=n.oid and p.proname=e.function_name
order by e.function_name, arguments;
-- get_shared_trip intentionally permits anonymous execution; write RPCs must not.

select extname, extversion from pg_extension where extname in ('vector','pgcrypto');

select to_regclass('nomvira_private.application_secrets') is not null as signing_table_present,
       to_regclass('supabase_migrations.schema_migrations') is not null as cli_history_present;
-- A present signing table does not establish that the key matches the application.

select conname, pg_get_constraintdef(oid) as definition
from pg_constraint
where conrelid=to_regclass('public.trip_food_selections')
  and conname='trip_food_selections_provider_check';
-- Google Maps selection support requires google_maps in the provider constraint.
