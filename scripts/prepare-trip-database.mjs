import { readFile, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

function transactionBody(sql) {
  return sql.replace(/^\s*begin;\s*/i, "").replace(/\s*commit;\s*$/i, "");
}

export function buildTripDatabaseSetup(foundation, openProviders, internalKey, accommodations = "", food = "", itinerary = "", budget = "", weather = "") {
  if (typeof internalKey !== "string" || internalKey.length < 32) throw new Error("Configure NOMVIRA_INTERNAL_API_KEY in .env.local first.");
  if (foundation.includes("$nomvira_foundation$") || openProviders.includes("$nomvira_open_providers$") || accommodations.includes("$nomvira_accommodations$") || food.includes("$nomvira_food$") || itinerary.includes("$nomvira_itinerary$") || budget.includes("$nomvira_budget$")) throw new Error("Unexpected migration delimiter.");
  const secret = internalKey.replaceAll("'", "''");
  if (weather.includes("$nomvira_weather$")) throw new Error("Unexpected migration delimiter.");
  return `-- PRIVATE LOCAL FILE: contains the internal application secret. Do not share or commit.
-- Run once in your project's Supabase SQL Editor as database owner.
-- Atomic and safe to rerun against the supported Step 5/6/7/8/9/10/11 schema.
begin;
do $nomvira_setup$
begin
  if to_regclass('public.trips') is null or to_regclass('public.trip_interests') is null
    or not exists (select 1 from information_schema.columns where table_schema='public' and table_name='trips' and column_name='owner_id') then
    raise exception 'The Step 5 trip schema must be installed first. No setup changes were committed.';
  end if;
  if to_regclass('public.places') is null then
    execute $nomvira_foundation$${transactionBody(foundation)}$nomvira_foundation$;
  end if;
  if not exists (select 1 from information_schema.columns where table_schema='public' and table_name='trips' and column_name='destination_provider') then
    execute $nomvira_open_providers$${transactionBody(openProviders)}$nomvira_open_providers$;
  end if;
  ${accommodations ? `if to_regclass('public.trip_accommodation_selections') is null then
    execute $nomvira_accommodations$${transactionBody(accommodations)}$nomvira_accommodations$;
  end if;` : ""}
  ${food ? `if to_regclass('public.trip_food_selections') is null then
    execute $nomvira_food$${transactionBody(food)}$nomvira_food$;
  end if;` : ""}
  ${itinerary ? `if to_regclass('public.itinerary_versions') is null then
    execute $nomvira_itinerary$${transactionBody(itinerary)}$nomvira_itinerary$;
  end if;
  if to_regclass('public.itinerary_days') is null or to_regclass('public.itinerary_items') is null
    or to_regprocedure('public.complete_itinerary_generation(text,text,text)') is null then
    raise exception 'Itinerary schema is incomplete. No setup changes were committed.';
  end if;` : ""}
  ${budget ? `if to_regclass('public.trip_budget_entries') is null then
    execute $nomvira_budget$${transactionBody(budget)}$nomvira_budget$;
  end if;
  if to_regprocedure('public.validate_trip_budget_entry()') is null
    or to_regprocedure('public.guard_budget_currency()') is null then
    raise exception 'Budget schema is incomplete. No setup changes were committed.';
  end if;` : ""}
  ${weather ? `if not exists (select 1 from information_schema.columns where table_schema='public' and table_name='itinerary_versions' and column_name='generation_reason') then
    execute $nomvira_weather$${transactionBody(weather)}$nomvira_weather$;
  end if;
  if to_regprocedure('public.complete_weather_adaptation(text,text,text)') is null then
    raise exception 'Weather adaptation schema is incomplete. No setup changes were committed.';
  end if;` : ""}
  if to_regclass('nomvira_private.application_secrets') is null
    or to_regprocedure('public.create_resolved_trip(jsonb,text,text)') is null then
    raise exception 'Trip schema is incomplete. No setup changes were committed.';
  end if;
end;
$nomvira_setup$;
insert into nomvira_private.application_secrets(name,value)
values ('internal_api_key','${secret}')
on conflict(name) do update set value=excluded.value;
notify pgrst,'reload schema';
commit;
`;
}

export async function prepareTripDatabase(root = process.cwd()) {
  const envText = await readFile(path.join(root, ".env.local"), "utf8");
  const match = envText.match(/^\s*NOMVIRA_INTERNAL_API_KEY\s*=\s*(?:"([^"\r\n]*)"|'([^'\r\n]*)'|([^#\r\n]*))/m);
  const internalKey = match && (match[1] ?? match[2] ?? match[3]).trim();
  const directory = path.join(root, "supabase", "migrations");
  const [foundation, openProviders, accommodations, food, itinerary, budget, weather] = await Promise.all([
    readFile(path.join(directory, "20261028000200_destination_intelligence.sql"), "utf8"),
    readFile(path.join(directory, "20261028000300_open_destination_providers.sql"), "utf8"),
    readFile(path.join(directory, "20261028000400_accommodation_selections.sql"), "utf8"),
    readFile(path.join(directory, "20261029000500_food_selections.sql"), "utf8"),
    readFile(path.join(directory, "20261029000600_itinerary_versions.sql"), "utf8"),
    readFile(path.join(directory, "20261029000700_trip_budget_entries.sql"), "utf8"),
    readFile(path.join(directory, "20261030000800_weather_adaptation.sql"), "utf8"),
  ]);
  const output = path.join(root, ".qa", "setup-trip-database.sql");
  await mkdir(path.dirname(output), { recursive: true });
  await writeFile(output, buildTripDatabaseSetup(foundation, openProviders, internalKey, accommodations, food, itinerary, budget, weather), { mode: 0o600 });
  return output;
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  prepareTripDatabase().then(output => {
    console.log(`Prepared ${path.relative(process.cwd(), output)}. Run this private file in Supabase SQL Editor to finish trip setup.`);
    console.log("It contains your internal key; values have not been printed. The file is ignored by Git.");
  }).catch(() => { console.error("Could not prepare trip setup. Check .env.local and the migration files."); process.exitCode = 1; });
}
