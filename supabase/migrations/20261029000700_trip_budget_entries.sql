begin;

-- Only user-authored expenses are permanent. Provider quotes remain in expiring
-- server memory; this table cannot assert a provider price or booking/payment.
create table public.trip_budget_entries (
  id uuid primary key default gen_random_uuid(),
  trip_id uuid not null references public.trips(id) on delete cascade,
  category text not null check (category in ('accommodation','food','activities','transport','miscellaneous')),
  entry_type text not null check (entry_type in ('planned','actual')),
  description text not null check (
    char_length(description) between 1 and 160 and description=btrim(description)
    and description !~ '[[:cntrl:]]'
  ),
  -- Unconstrained numeric avoids PostgreSQL silently rounding excess decimals on insert.
  amount numeric not null check (amount >= 0 and amount <= 100000000 and amount=round(amount,2)),
  currency text not null check (currency in ('USD','EUR','GBP','INR','CAD','AUD','JPY')),
  source text not null default 'manual' check (source='manual'),
  expense_date date check (expense_date between date '1900-01-01' and date '9999-12-31'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index trip_budget_entries_trip_created_idx on public.trip_budget_entries(trip_id,created_at desc,id);

alter table public.trip_budget_entries enable row level security;
create policy budget_entries_owned on public.trip_budget_entries for all to authenticated
using (exists (select 1 from public.trips t where t.id=trip_id and t.owner_id=auth.uid()))
with check (exists (select 1 from public.trips t where t.id=trip_id and t.owner_id=auth.uid()));
revoke all on public.trip_budget_entries from public,anon,authenticated;
grant select,delete on public.trip_budget_entries to authenticated;
grant insert(id,trip_id,category,entry_type,description,amount,currency,expense_date)
  on public.trip_budget_entries to authenticated;
grant update(category,entry_type,description,amount,currency,expense_date)
  on public.trip_budget_entries to authenticated;

create function public.validate_trip_budget_entry() returns trigger
language plpgsql security invoker set search_path='' as $$
declare trip_currency text;
begin
  -- Serializes entries against trip currency edits and the bounded entry count.
  select currency into trip_currency from public.trips
    where id=new.trip_id and owner_id=auth.uid() for update;
  if not found then raise exception 'BUDGET_TRIP_NOT_FOUND' using errcode='42501'; end if;
  if new.currency<>trip_currency then
    raise exception 'BUDGET_CURRENCY_MISMATCH' using errcode='22023';
  end if;
  if tg_op='INSERT' and (select count(*) from public.trip_budget_entries where trip_id=new.trip_id)>=1000 then
    raise exception 'BUDGET_ENTRY_LIMIT' using errcode='22023';
  end if;
  new.updated_at:=now();
  return new;
end;
$$;
create trigger validate_budget_entry before insert or update on public.trip_budget_entries
for each row execute function public.validate_trip_budget_entry();

create function public.guard_budget_currency() returns trigger
language plpgsql security invoker set search_path='' as $$
begin
  if new.currency is distinct from old.currency and exists (
    select 1 from public.trip_budget_entries where trip_id=old.id
  ) then
    raise exception 'BUDGET_CURRENCY_HAS_ENTRIES' using errcode='22023';
  end if;
  return new;
end;
$$;
create trigger guard_budget_currency before update of currency on public.trips
for each row execute function public.guard_budget_currency();
revoke all on function public.validate_trip_budget_entry() from public,anon;
revoke all on function public.guard_budget_currency() from public,anon;
grant execute on function public.validate_trip_budget_entry() to authenticated;
grant execute on function public.guard_budget_currency() to authenticated;

notify pgrst,'reload schema';
commit;
