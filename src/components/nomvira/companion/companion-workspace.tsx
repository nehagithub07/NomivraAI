"use client";

import { useEffect, useRef, useState } from "react";
import { ArrowUp, Compass } from "lucide-react";
import { SurfaceCard } from "@/components/nomvira/surface-card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { companionError, type ChatState } from "@/lib/companion/validation";
import { CompanionConfirmation, CompanionResultCard } from "./companion-cards";

const suggestions = ["What's my itinerary?", "Will weather affect my trip?", "How much budget do I have left?", "Show my saved food spots.", "What can I change on Day 2?"];
export function CompanionWorkspace({ tripId, destination }: { tripId: string; destination: string }) {
  const [state, setState] = useState<ChatState>({ messages: [], actions: [] });
  const [draft, setDraft] = useState(""), [busy, setBusy] = useState(false), [loading, setLoading] = useState(true), [error, setError] = useState("");
  const active = useRef(false), retry = useRef<{ request_id: string; message: string } | null>(null);
  const bottom = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const controller = new AbortController();
    void fetch(`/api/trips/${tripId}/companion/messages`, { cache: "no-store", signal: controller.signal }).then(async response => {
      const body = await response.json();
      if (!response.ok) throw new Error(body?.error?.code);
      if (!controller.signal.aborted) setState(body);
    }).catch(error => { if (!controller.signal.aborted) setError(companionError(error.message)); }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [tripId]);
  useEffect(() => { bottom.current?.scrollIntoView({ behavior: "smooth", block: "nearest" }); }, [state.messages.length, busy]);
  async function send(value = draft) {
    const message = value.trim();
    if (!message || message.length > 2000 || active.current || loading) return;
    active.current = true; setBusy(true); setError("");
    if (retry.current?.message !== message) retry.current = { request_id: crypto.randomUUID(), message };
    try {
      const response = await fetch(`/api/trips/${tripId}/companion/messages`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(retry.current), signal: AbortSignal.timeout(115_000) });
      const body = await response.json().catch(() => null);
      if (!response.ok) { setError(companionError(body?.error?.code)); return; }
      setState(body); setDraft(""); retry.current = null;
    } catch { setError(companionError("TIMEOUT")); }
    finally { active.current = false; setBusy(false); }
  }
  async function act(id: string, operation: "confirm" | "cancel") {
    if (active.current) return;
    active.current = true; setBusy(true); setError("");
    try {
      const response = await fetch(`/api/trips/${tripId}/companion/actions/${id}/${operation}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}", signal: AbortSignal.timeout(115_000) });
      const body = await response.json().catch(() => null);
      if (!response.ok) { setError(companionError(body?.error?.code)); return; }
      setState(s => ({ ...s, actions: s.actions.map(a => a.id === id ? body.action : a) }));
    } catch { setError(companionError("TIMEOUT")); }
    finally { active.current = false; setBusy(false); }
  }
  const attached = new Set(state.messages.map(m => m.pending_action_id));
  return <section className="mx-auto max-w-4xl space-y-5 [overflow-wrap:anywhere]" aria-label="Trip companion">
    <SurfaceCard className="overflow-hidden p-5 sm:p-8"><div className="flex items-start gap-4"><div className="flex size-11 shrink-0 items-center justify-center rounded-2xl bg-primary/10"><Compass className="size-5" aria-hidden="true" /></div><div><h2 className="type-card">A little guidance for {destination}.</h2><p className="type-small mt-2 max-w-xl text-muted-foreground">Explore your saved plan, understand the forecast, and keep an eye on your budget. Review and confirm any changes here.</p></div></div>
      {loading && <p className="type-small mt-6 text-muted-foreground" role="status">Loading your private trip chat…</p>}
      {!loading && !state.messages.length && <div className="mt-6 flex flex-wrap gap-2">{suggestions.map(prompt => <Button key={prompt} type="button" variant="secondary" disabled={busy} onClick={() => { setDraft(prompt); void send(prompt); }} className="h-auto min-h-11 whitespace-normal text-left">{prompt}</Button>)}</div>}
      <div role="log" aria-label="Conversation" aria-live="polite" aria-relevant="additions" className="mt-6 max-h-[60vh] space-y-7 overflow-y-auto pr-1">
        {state.messages.map(message => <article key={message.id} className={`space-y-3 ${message.role === "user" ? "border-l-2 pl-4" : ""}`}><p className="type-meta font-medium text-muted-foreground">{message.role === "user" ? "You" : "NomivraAI"}</p><p className="type-small whitespace-pre-wrap leading-relaxed">{message.content}</p>
          {message.cards?.map((card, i) => <CompanionResultCard key={i} card={card} tripId={tripId} />)}
          {message.pending_action_id && state.actions.filter(a => a.id === message.pending_action_id).map(a => <CompanionConfirmation key={a.id} action={a} busy={busy} onAction={act} />)}
          {message.suggested_actions?.map(prompt => <Button key={prompt} type="button" variant="secondary" disabled={busy} onClick={() => { setDraft(prompt); void send(prompt); }}>{prompt}</Button>)}
        </article>)}
        {state.actions.filter(a => !attached.has(a.id) && ["pending", "confirmed"].includes(a.status)).map(a => <CompanionConfirmation key={a.id} action={a} busy={busy} onAction={act} />)}
        {busy && <p role="status" className="type-small text-muted-foreground">Checking your trip…</p>}<div ref={bottom} />
      </div>
    </SurfaceCard>
    <form onSubmit={event => { event.preventDefault(); void send(); }} className="space-y-3"><label htmlFor="companion-message" className="type-small font-medium">Ask about your trip</label><div className="flex items-end gap-3"><Textarea id="companion-message" value={draft} onChange={event => setDraft(event.target.value)} maxLength={2000} rows={2} placeholder={`Ask about your ${destination} trip…`} disabled={loading || busy} className="resize-none bg-card" /><Button type="submit" disabled={loading || busy || !draft.trim()} aria-label="Send message"><ArrowUp className="size-4" aria-hidden="true" /><span className="hidden sm:inline">Send</span></Button></div><p className="type-meta text-muted-foreground">Private to this trip. AI explanations may be imperfect; use the source cards to check details.</p></form>
    {error && <p role="alert" className="type-small text-destructive">{error}</p>}
  </section>;
}
