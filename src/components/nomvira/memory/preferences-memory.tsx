"use client";

import { useRef, useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { SurfaceCard } from "@/components/nomvira/surface-card";
import { accommodationTypes, budgetStyles, dietaryPreferences, optionLabel, travelPaces, tripInterests } from "@/lib/trips/options";
import { memoryCommandSchema, type MemoryState, type Preferences } from "@/lib/memory/validation";
import type { z } from "zod";

type Command = z.infer<typeof memoryCommandSchema>;
const selectClass = "mt-2 min-h-11 w-full rounded-lg border border-border bg-card px-3 text-sm";

export function PreferencesMemory({ initialState, trips }: { initialState: MemoryState; trips: { id: string; destination_name: string }[] }) {
  const [state, setState] = useState(initialState);
  const [preferences, setPreferences] = useState(initialState.preferences);
  const [enabled, setEnabled] = useState(initialState.memoryEnabled);
  const [feedback, setFeedback] = useState<"prefer" | "avoid">("prefer");
  const [tripId, setTripId] = useState(trips[0]?.id ?? "");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [failed, setFailed] = useState(false);
  const lock = useRef(false);

  async function run(command: Command) {
    if (lock.current) return;
    lock.current = true; setBusy(true); setMessage(""); setFailed(false);
    try {
      if (!memoryCommandSchema.safeParse(command).success) throw new Error("Choose up to 8 interests and at least one accommodation type.");
      const response = await fetch("/api/memory", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(command) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error?.message ?? "Could not save this change.");
      setState(result); setPreferences(result.preferences); setEnabled(result.memoryEnabled);
      setMessage(command.action === "reset" ? "Preferences reset and all memories deleted."
        : command.action === "delete" || command.action === "clear" ? "Memories deleted."
        : command.action === "preferences" ? command.memoryEnabled ? "Preferences saved. Memory is enabled; add approved memories below." : "Preferences saved. Memory is off and all memories were deleted."
        : "Memory saved. Search uses it once indexing is available.");
    } catch (error) { setFailed(true); setMessage(error instanceof Error ? error.message : "Could not save this change. Please try again."); }
    finally { lock.current = false; setBusy(false); }
  }
  function save(event: FormEvent) { event.preventDefault(); void run({ action: "preferences", preferences, memoryEnabled: enabled }); }
  function choices(key: "interests" | "dietaryPreferences" | "accommodationPreferences", title: string, options: readonly string[]) {
    const selected: readonly string[] = preferences[key];
    return <fieldset className="min-w-0">
      <legend className="type-small mb-3 font-medium">{title}</legend>
      <div className="flex flex-wrap gap-2">{options.map(value => {
        const checked = selected.includes(value);
        return <label key={value} className={`flex min-h-11 cursor-pointer items-center gap-2 rounded-lg border px-3 text-sm ${checked ? "border-nomvira-orange bg-accent-card" : "border-border bg-card"}`}>
          <input type="checkbox" className="accent-primary" checked={checked}
            disabled={key === "interests" && !checked && selected.length >= 8}
            onChange={() => setPreferences(p => ({ ...p, [key]: checked ? selected.filter(v => v !== value) : [...selected, value] }) as Preferences)} />
          {optionLabel(value)}
        </label>;
      })}</div>
    </fieldset>;
  }
  return <div className="mx-auto w-full max-w-4xl space-y-6" aria-busy={busy}>
    {!state.available && <p role="alert" className="rounded-lg bg-accent-card p-4 text-sm">Preferences &amp; Memory is temporarily unavailable. Existing travel planning is still available. Reload after database setup or service recovery.</p>}
    {message && <p role={failed ? "alert" : "status"} className={`rounded-lg border p-4 text-sm ${failed ? "border-destructive text-destructive" : "border-border bg-accent-card"}`}>{message}</p>}
    <SurfaceCard size="panel" className="p-5 sm:p-8">
      <h2 className="type-section">Preferences &amp; Memory</h2>
      <p className="type-small mt-3 text-muted-foreground">Save the travel choices you approve as defaults for new trips. You can change them for each trip.</p>
      <form onSubmit={save} className="mt-6 space-y-6">
        <fieldset disabled={busy || !state.available} className="space-y-6 disabled:opacity-60">
          <legend className="sr-only">Travel preferences</legend>
          {choices("interests", "Interests (up to 8)", tripInterests)}
          <div className="grid gap-5 sm:grid-cols-2">
            <label className="text-sm font-medium">Travel pace<select className={selectClass} value={preferences.travelPace} onChange={e => setPreferences(p => ({ ...p, travelPace: e.target.value as Preferences["travelPace"] }))}>{travelPaces.map(v => <option key={v} value={v}>{optionLabel(v)}</option>)}</select></label>
            <label className="text-sm font-medium">Budget style<select className={selectClass} value={preferences.budgetStyle} onChange={e => setPreferences(p => ({ ...p, budgetStyle: e.target.value as Preferences["budgetStyle"] }))}>{budgetStyles.map(v => <option key={v} value={v}>{optionLabel(v)}</option>)}</select></label>
          </div>
          {choices("dietaryPreferences", "Dietary preferences (optional)", dietaryPreferences)}
          {choices("accommodationPreferences", "Accommodation preferences", accommodationTypes)}
          <div className="rounded-xl border border-nomvira-orange/30 bg-accent-card p-4">
            <label className="flex items-start gap-3 text-sm font-medium"><input type="checkbox" className="mt-1 accent-primary" checked={enabled} onChange={e => setEnabled(e.target.checked)} />Use my approved memories for future recommendations</label>
            <p className="mt-3 text-sm text-muted-foreground">When enabled, only choices you explicitly remember below are saved and sent to Gemini for indexing and relevant itinerary or Companion context. Chat text, special requests, API keys, travel dates and locations are excluded. Turning this off and saving deletes all memories and their stored embeddings.</p>
          </div>
          <div className="flex flex-wrap gap-3">
            <Button type="submit">Save preferences &amp; consent</Button>
            <Button variant="secondary" onClick={() => void run({ action: "reset" })}>Reset preferences &amp; delete memories</Button>
          </div>
        </fieldset>
      </form>
    </SurfaceCard>
    <SurfaceCard size="panel" className="p-5 sm:p-8">
      <h2 className="type-section">Approved memories</h2>
      <p className="type-small mt-3 text-muted-foreground">Remember the choices selected above, or give explicit feedback on a saved trip’s interests, pace, budget style, dietary and accommodation choices. Historical choices never override the current trip.</p>
      <fieldset disabled={busy || !state.available || !state.memoryEnabled} className="mt-5 space-y-4 disabled:opacity-60">
        <legend className="sr-only">Add a memory</legend>
        <label className="block max-w-sm text-sm">My feedback<select className={selectClass} value={feedback} onChange={e => setFeedback(e.target.value as "prefer" | "avoid")}><option value="prefer">Prefer these choices</option><option value="avoid">Avoid these choices</option></select></label>
        <div className="flex flex-wrap gap-3">
          <Button variant="secondary" onClick={() => void run({ action: "remember", kind: "preference", preferences, feedback: "prefer" })}>Remember selected preferences</Button>
          <Button variant="secondary" onClick={() => void run({ action: "remember", kind: "feedback", preferences, feedback })}>Save explicit feedback</Button>
        </div>
        {trips.length > 0 && <div className="flex flex-wrap items-end gap-3">
          <label className="min-w-0 flex-1 text-sm">Saved trip<select className={selectClass} value={tripId} onChange={e => setTripId(e.target.value)}>{trips.map(t => <option key={t.id} value={t.id}>{t.destination_name}</option>)}</select></label>
          <Button variant="secondary" onClick={() => void run({ action: "trip", tripId, feedback })}>Remember trip choices</Button>
        </div>}
      </fieldset>
      {!state.memoryEnabled && <p className="mt-4 text-sm text-muted-foreground">Enable memory and save your consent above to add memories.</p>}
      <div className="mt-6 space-y-3">
        {state.memories.length === 0 ? <p className="text-sm text-muted-foreground">No memories saved.</p> : state.memories.map(m => <div key={m.id} className="flex items-start justify-between gap-4 rounded-xl border border-border p-4">
          <div className="min-w-0 text-sm"><p className="font-medium">{optionLabel(m.kind)} · {m.feedback === "prefer" ? "Prefer" : "Avoid"}</p>
            <p className="mt-2 text-muted-foreground">{[...m.preferences.interests, m.preferences.travelPace, m.preferences.budgetStyle, ...m.preferences.dietaryPreferences, ...m.preferences.accommodationPreferences].map(optionLabel).join(" · ")}</p>
            <p className="mt-2 text-xs text-muted-foreground">Saved {new Date(m.created_at).toISOString().slice(0, 10)}{m.source_trip_id ? ` · ${trips.find(t => t.id === m.source_trip_id)?.destination_name ?? "Saved trip choices"}` : ""}</p>
          </div>
          <Button size="sm" variant="ghost" disabled={busy} onClick={() => void run({ action: "delete", id: m.id })}>Delete</Button>
        </div>)}
      </div>
      {state.memories.length > 0 && <Button className="mt-5" variant="secondary" disabled={busy} onClick={() => void run({ action: "clear" })}>Delete all memories</Button>}
    </SurfaceCard>
  </div>;
}
