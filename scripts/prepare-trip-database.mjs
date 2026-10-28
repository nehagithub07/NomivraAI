import { readFile, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

function transactionBody(sql) {
  return sql.replace(/^\s*begin;\s*/i, "").replace(/\s*commit;\s*$/i, "");
}

export function buildTripDatabaseSetup(foundation, openProviders, internalKey) {
  if (typeof internalKey !== "string" || internalKey.length < 32) throw new Error("Configure NOMVIRA_INTERNAL_API_KEY in .env.local first.");
  if (foundation.includes("$nomvira_foundation$") || openProviders.includes("$nomvira_open_providers$")) throw new Error("Unexpected migration delimiter.");
  const secret = internalKey.replaceAll("'", "''");
  return `-- PRIVATE LOCAL FILE: contains the internal application secret. Do not share or commit.
-- Run once in your project's Supabase SQL Editor as database owner.
-- Atomic and safe to rerun against the supported Step 5/6 schema.
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
  const [foundation, openProviders] = await Promise.all([
    readFile(path.join(directory, "20261028000200_destination_intelligence.sql"), "utf8"),
    readFile(path.join(directory, "20261028000300_open_destination_providers.sql"), "utf8"),
  ]);
  const output = path.join(root, ".qa", "setup-trip-database.sql");
  await mkdir(path.dirname(output), { recursive: true });
  await writeFile(output, buildTripDatabaseSetup(foundation, openProviders, internalKey), { mode: 0o600 });
  return output;
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  prepareTripDatabase().then(output => {
    console.log(`Prepared ${path.relative(process.cwd(), output)}. Run this private file in Supabase SQL Editor to finish trip setup.`);
    console.log("It contains your internal key; values have not been printed. The file is ignored by Git.");
  }).catch(() => { console.error("Could not prepare trip setup. Check .env.local and the migration files."); process.exitCode = 1; });
}
