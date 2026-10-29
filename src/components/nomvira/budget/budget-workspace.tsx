"use client";

import { useRef, useState, type FormEvent } from "react";
import { Plus, Wallet } from "lucide-react";
import { Button } from "@/components/ui/button";
import { SurfaceCard } from "@/components/nomvira/surface-card";
import { formatTripBudget } from "@/lib/travel-format";
import {
  budgetCategories, categoryLabels, budgetEntrySchema, budgetSummarySchema, createBudgetEntrySchema,
  type BudgetEntry, type CreateBudgetEntry, type TripBudgetSummary,
} from "@/lib/budget/validation";

const control = "type-small mt-2 min-h-11 w-full rounded-xl border bg-background px-3 py-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring";
const messages: Record<string, string> = {
  unauthorized: "Sign in again to view your budget.",
  BUDGET_SETUP_REQUIRED: "Budget tracking needs a database setup update. Apply the Step 10 migration.",
  BUDGET_CURRENCY_MISMATCH: "Use your trip's currency for every expense.",
  BUDGET_DUPLICATE_ENTRY: "This expense was already added. Refresh your budget before adding another.",
  BUDGET_ENTRY_LIMIT: "This trip has reached the 1,000 expense limit.",
  BUDGET_INVALID_ENTRY: "Check the expense amount, currency and description.",
  invalid_request: "Check the expense amount, currency and description.",
  not_found: "This trip or expense is no longer available. Refresh your budget.",
};

function ExpenseForm({ currency, entry, pending, onSave, onCancel }: {
  currency: CreateBudgetEntry["currency"]; entry: BudgetEntry | null; pending: boolean;
  onSave: (body: CreateBudgetEntry) => Promise<boolean>; onCancel: () => void;
}) {
  const [description, setDescription] = useState(entry?.description ?? "");
  const [category, setCategory] = useState<CreateBudgetEntry["category"]>(entry?.category ?? "transport");
  const [entryType, setEntryType] = useState<CreateBudgetEntry["entry_type"]>(entry?.entry_type ?? "planned");
  const [amount, setAmount] = useState(entry?.amount ?? ""), [date, setDate] = useState(entry?.expense_date ?? "");
  const [error, setError] = useState("");
  const identity = useRef(entry?.id ?? null), submitting = useRef(false);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending || submitting.current) return;
    identity.current ??= crypto.randomUUID();
    const parsed = createBudgetEntrySchema.safeParse({ id: identity.current, description, category, entry_type: entryType, amount, currency, expense_date: date || null });
    if (!parsed.success) { setError("Use a description and a non-negative amount up to 100,000,000 with at most two decimal places."); return; }
    submitting.current = true; setError("");
    try { await onSave(parsed.data); } finally { submitting.current = false; }
  }
  return <SurfaceCard className="p-5 sm:p-6"><form onSubmit={submit} className="space-y-5" aria-label={entry ? "Edit expense" : "Add expense"}>
    <div><h2 className="type-card">{entry ? "Edit expense" : "Add expense"}</h2>
      <p className="type-small mt-2 text-muted-foreground">Change a planned expense to actual when paid. Enter a separate expense only for a different cost.</p></div>
    <div className="grid gap-4 sm:grid-cols-2">
      <label className="type-small font-medium">Description<input className={control} value={description} onChange={event => setDescription(event.target.value)} required maxLength={160} placeholder="Airport train" disabled={pending} /></label>
      <label className="type-small font-medium">Category<select className={control} value={category} onChange={event => setCategory(event.target.value as typeof category)} disabled={pending}>{budgetCategories.map(key => <option key={key} value={key}>{categoryLabels[key]}</option>)}</select></label>
      <label className="type-small font-medium">Amount ({currency})<input className={control} value={amount} onChange={event => setAmount(event.target.value)} required inputMode="decimal" pattern="[0-9]{1,9}([.][0-9]{1,2})?" placeholder="28.00" disabled={pending} /></label>
      <label className="type-small font-medium">Expense type<select className={control} value={entryType} onChange={event => setEntryType(event.target.value as typeof entryType)} disabled={pending}><option value="planned">Planned</option><option value="actual">Actual</option></select></label>
      <label className="type-small font-medium">Date (optional)<input className={control} type="date" min="1900-01-01" max="9999-12-31" value={date} onChange={event => setDate(event.target.value)} disabled={pending} /></label>
    </div>
    {category === "accommodation" && <p className="type-small rounded-xl border bg-muted p-4">Manual accommodation entries replace the entire automatic hotel quote. Include the full accommodation cost; add any unpaid balance as a separate planned expense.</p>}
    {error && <p role="alert" className="type-small text-destructive">{error}</p>}
    <div className="flex flex-wrap gap-3"><Button type="submit" loading={pending}>{pending ? "Saving expense..." : "Save expense"}</Button><Button type="button" variant="secondary" onClick={onCancel} disabled={pending}>Cancel</Button></div>
  </form></SurfaceCard>;
}

export function BudgetWorkspace({ tripId, initialSummary, currency }: {
  tripId: string; initialSummary: TripBudgetSummary | null; currency: CreateBudgetEntry["currency"];
}) {
  const [summary, setSummary] = useState(initialSummary), [pending, setPending] = useState(false);
  const [error, setError] = useState(initialSummary ? "" : "We couldn't load your budget. Your trip is saved. Try refreshing below.");
  const [notice, setNotice] = useState(""), [formOpen, setFormOpen] = useState(false), [editing, setEditing] = useState<BudgetEntry | null>(null);
  const active = useRef(false);
  const base = `/api/trips/${tripId}/budget`;
  const money = (value: string) => formatTripBudget(value, currency);
  async function request(url: string, method = "GET", body?: unknown) {
    const response = await fetch(url, { method, cache: "no-store", signal: AbortSignal.timeout(20_000),
      ...(body === undefined ? {} : { headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }) });
    const result = await response.json().catch(() => null);
    if (!response.ok) throw new Error(messages[result?.error?.code] ?? "We couldn't confirm this request. Refresh your budget before trying again.");
    return result;
  }
  async function refresh() {
    if (active.current) return;
    active.current = true; setPending(true); setError(""); setNotice("");
    try { setSummary(budgetSummarySchema.parse(await request(base))); }
    catch (failure) { setError(failure instanceof Error && Object.values(messages).includes(failure.message) ? failure.message : "We couldn't load your budget. Please try again."); }
    finally { active.current = false; setPending(false); }
  }
  async function mutate(method: "POST" | "PATCH" | "DELETE", body: unknown, entryId?: string) {
    if (active.current) return false;
    active.current = true; setPending(true); setError(""); setNotice("");
    let saved = false;
    try {
      const result = await request(`${base}/entries${entryId ? `/${entryId}` : ""}`, method, body);
      if (method !== "DELETE") budgetEntrySchema.parse(result.entry);
      saved = true; setFormOpen(false); setEditing(null);
      setNotice(method === "DELETE" ? "Expense removed." : "Expense saved.");
      setSummary(null); // Never display old totals after a confirmed mutation.
      setSummary(budgetSummarySchema.parse(await request(base)));
      return true;
    } catch (failure) {
      setError(saved ? "Your change is saved. Refresh to load the updated totals." : failure instanceof Error && Object.values(messages).includes(failure.message) ? failure.message : "We couldn't confirm the change. Refresh your budget before submitting again.");
      return false;
    } finally { active.current = false; setPending(false); }
  }
  return <div className="min-w-0 space-y-6 [overflow-wrap:anywhere]">
    <div className="flex flex-wrap items-center justify-between gap-4"><div className="flex items-center gap-2"><Wallet className="size-4" aria-hidden="true" /><p className="type-small text-muted-foreground">All amounts in {currency}. No currency conversion.</p></div>
      <div className="flex flex-wrap gap-3"><Button type="button" variant="secondary" onClick={refresh} disabled={pending}>Refresh budget</Button><Button type="button" onClick={() => { setEditing(null); setFormOpen(true); }} disabled={pending || !summary}><Plus className="size-4" aria-hidden="true" />Add expense</Button></div></div>
    {pending && <p role="status" className="type-small text-muted-foreground">Updating your budget...</p>}
    {error && <p role="alert" className="type-small rounded-xl border p-4 text-destructive">{error}</p>}
    {notice && <p role="status" className="type-small text-muted-foreground">{notice}</p>}
    {formOpen && <ExpenseForm key={editing?.id ?? "new"} currency={currency} entry={editing} pending={pending}
      onSave={body => { if (!editing) return mutate("POST", body); const { id, ...patch } = body; return mutate("PATCH", patch, id); }}
      onCancel={() => { setFormOpen(false); setEditing(null); }} />}
    {summary && <>
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">{[
        ["Trip budget", summary.total_budget, `${summary.trip_days} trip days · ${summary.hotel_nights} hotel nights`],
        ["Known + planned + actual", summary.committed_costs, `${summary.percent_used}% of total budget`],
        ["Actual spending", summary.actual_costs, "User-recorded payments only"],
        ["Remaining after commitments", summary.remaining_budget, "After known quotes, plans and actuals"],
      ].map(([label, value, detail]) => <SurfaceCard key={label} className="p-5"><p className="type-small text-muted-foreground">{label}</p><p className="type-section mt-3">{money(value)}</p><p className="type-meta mt-2 text-muted-foreground">{detail}</p></SurfaceCard>)}</div>
      <SurfaceCard className="p-5 sm:p-6"><div className="flex flex-wrap items-center justify-between gap-3"><h2 className="type-card">Budget outlook</h2><span className="type-small rounded-full border bg-muted px-4 py-1.5">{({ healthy: "Within budget", watch: "Keep an eye on spending", over_budget: "Above budget" })[summary.budget_status]}</span></div>
        <ul className="type-small mt-4 space-y-2 text-muted-foreground">{summary.insights.map(text => <li key={text}>{text}</li>)}</ul>
        <dl className="mt-5 grid gap-4 border-t pt-5 sm:grid-cols-3"><div><dt className="type-meta text-muted-foreground">Budget per traveler (derived)</dt><dd className="type-small mt-1 font-medium">{money(summary.budget_per_traveler)}</dd></div>
          <div><dt className="type-meta text-muted-foreground">Recommended daily flexible spend</dt><dd className="type-small mt-1 font-medium">{summary.recommended_daily_flexible_spend === null ? "Trip has ended" : money(summary.recommended_daily_flexible_spend)}</dd></div>
          <div><dt className="type-meta text-muted-foreground">Daily flexible spend per traveler</dt><dd className="type-small mt-1 font-medium">{summary.daily_flexible_spend_per_traveler === null ? "Not applicable" : money(summary.daily_flexible_spend_per_traveler)}</dd></div></dl>
        <p className="type-meta mt-4 text-muted-foreground">Daily guidance divides unassigned funds across {summary.remaining_days} remaining trip days. Estimates are reserved, and unpriced costs still need to be added.</p>
      </SurfaceCard>
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">{summary.categories.map(category => <SurfaceCard key={category.category} className="p-5">
        <h2 className="type-card">{categoryLabels[category.category]}</h2><p className="type-small mt-3">{money(category.committed)} <span className="text-muted-foreground">/ {money(category.allocated)} allocated</span></p>
        {category.percent_used === null ? <p className="type-meta mt-3 text-muted-foreground">No category allocation at this budget.</p> : <div role="progressbar" aria-label={`${categoryLabels[category.category]} allocation used`} aria-valuenow={Math.min(100, Number(category.percent_used))} aria-valuemin={0} aria-valuemax={100} className="mt-3 h-1.5 overflow-hidden rounded-full bg-muted"><div className="h-full rounded-full bg-foreground/70" style={{ width: `${Math.min(100, Number(category.percent_used))}%` }} /></div>}
        <dl className="type-small mt-4 space-y-2 text-muted-foreground">{[["Known quote", category.known], ["Planned", category.planned], ["Actual", category.actual], ["Remaining allocation", category.remaining]].map(([label, value]) => <div key={label} className="flex flex-wrap justify-between gap-2"><dt>{label}</dt><dd className="text-foreground">{money(value)}</dd></div>)}</dl>
      </SurfaceCard>)}</div>
      <SurfaceCard className="p-5 sm:p-6"><h2 className="type-card">Selected accommodation</h2>
        <p className="type-small mt-3">{summary.hotel.included && summary.hotel.amount !== null ? `Current StayAPI quote: ${money(summary.hotel.amount)}` : summary.hotel.exclusion_reason === "manual_replacement" ? "Using your manual accommodation expenses in place of the automatic quote." : "No current comparable hotel quote is included."}</p>
        <p className="type-meta mt-2 text-muted-foreground">Source: hotel selection{summary.hotel.provider ? ` · ${summary.hotel.provider}` : ""}. Prices are not stored as bookings. Refresh hotel results for a current quote, then refresh this budget.</p>
      </SurfaceCard>
      <SurfaceCard className="p-5 sm:p-6"><h2 className="type-card">Your expenses</h2><p className="type-small mt-2 text-muted-foreground">Planned amounts are expected costs. Actual amounts are recorded payments. Mark an existing plan as actual to replace it.</p>
        {!summary.entries.length ? <p className="type-small mt-6 rounded-xl border border-dashed p-6 text-center text-muted-foreground">No manual expenses yet. Add an estimate or payment to start tracking.</p> : <ul className="mt-4 divide-y">{summary.entries.map(entry => <li key={entry.id} className="flex flex-wrap items-center justify-between gap-4 py-4"><div className="min-w-0"><h3 className="type-small font-medium">{entry.description}</h3><p className="type-meta mt-1 text-muted-foreground">{categoryLabels[entry.category]} · {entry.entry_type === "actual" ? "Actual" : "Planned"}{entry.expense_date ? ` · ${entry.expense_date}` : ""}</p><p className="type-small mt-2">{money(entry.amount)}</p></div>
          <div className="flex flex-wrap gap-2">{entry.entry_type === "planned" && <Button type="button" variant="secondary" size="sm" disabled={pending} onClick={() => mutate("PATCH", { entry_type: "actual" }, entry.id)}>Mark actual</Button>}<Button type="button" variant="secondary" size="sm" disabled={pending} onClick={() => { setEditing(entry); setFormOpen(true); }}>Edit<span className="sr-only"> {entry.description}</span></Button><Button type="button" variant="ghost" size="sm" disabled={pending} onClick={() => mutate("DELETE", {}, entry.id)}>Remove<span className="sr-only"> {entry.description}</span></Button></div>
        </li>)}</ul>}
      </SurfaceCard>
      <SurfaceCard className="p-5"><h2 className="type-small font-semibold">What these totals include</h2><ul className="type-small mt-3 list-disc space-y-2 pl-5 text-muted-foreground">{summary.warnings.map(text => <li key={text}>{text}</li>)}</ul><p className="type-meta mt-3 text-muted-foreground">Food and attraction provider amounts are unknown. All allocations and calculations are deterministic; no AI prices are used.</p></SurfaceCard>
    </>}
  </div>;
}
