"use client";
import { useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { SurfaceCard } from "@/components/nomvira/surface-card";
import { shareDocument, type ExportDocument, type ShareOptions } from "@/lib/exports/validation";
import type { ShareState } from "@/lib/sharing/server";
import { ExportActions } from "./export-actions";
import { TripDocument } from "./trip-document";

export function ExportShareWorkspace({ tripId, document, initialShare }: { tripId: string; document: ExportDocument; initialShare: ShareState }) {
  const [share, setShare] = useState(initialShare), [options, setOptions] = useState<ShareOptions>(initialShare.options ?? { hotel: false, food: false, budget: false });
  const [expiry, setExpiry] = useState("7"), [approved, setApproved] = useState(false);
  const [busy, setBusy] = useState(false), [message, setMessage] = useState(""), [failed, setFailed] = useState(false);
  const active = useRef(false), requestId = useRef<string | null>(null), link = useRef<HTMLInputElement>(null);
  async function mutate(action: "create" | "revoke") {
    if (active.current || action === "create" && !approved) return;
    active.current = true; setBusy(true); setMessage(""); setFailed(false);
    try {
      if (action === "create") requestId.current ??= crypto.randomUUID();
      const body = action === "revoke" ? { action } : { action, requestId: requestId.current, revision: share.revision, expiresInDays: expiry, options, approved };
      const response = await fetch(`/api/trips/${tripId}/share`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), signal: AbortSignal.timeout(55_000) });
      const result = await response.json().catch(() => null);
      if (!response.ok) throw new Error(result?.error?.message ?? "Sharing couldn't complete. Reload to check the current link.");
      setShare(result); requestId.current = null; setApproved(false);
      setMessage(action === "revoke" ? "Link revoked. The shared snapshot has been removed." : "Read-only link created. Previous links for this trip no longer work.");
    } catch (error) { setFailed(true); setMessage(error instanceof Error ? error.message : "Sharing couldn't complete. Reload to check the current link."); }
    finally { active.current = false; setBusy(false); }
  }
  async function copy() {
    if (!share.url) return;
    try { await navigator.clipboard.writeText(share.url); setFailed(false); setMessage("Link copied."); }
    catch { link.current?.focus(); link.current?.select(); setFailed(true); setMessage("Select and copy the link from the field above."); }
  }
  return <div className="min-w-0 space-y-6">
    <SurfaceCard className="export-controls space-y-4 p-5 sm:p-8" size="panel">
      <h2 className="type-section">Take your itinerary with you</h2>
      <p className="text-sm text-muted-foreground">Download your saved plan, hotel selection, food spots and available budget totals. Exporting does not generate a new itinerary.</p>
      <ExportActions document={document} />
    </SurfaceCard>
    <SurfaceCard className="export-controls space-y-5 p-5 sm:p-8" size="panel" aria-busy={busy}>
      <h2 className="type-section">Share a read-only snapshot</h2>
      <p className="text-sm text-muted-foreground">Destination, trip dates and day-wise activities are included. Choose any extras below. Profile data, memories, conversations, special requests and expense descriptions stay private.</p>
      <p className="text-sm text-muted-foreground">Anyone with the link can view and keep a copy. Revoking stops future access. Later trip changes appear only after you create a new link.</p>
      {!share.available && <p role="alert" className="rounded-lg bg-accent-card p-4 text-sm">Sharing is unavailable. Apply the sharing migration or reload after service recovery. Export is still available.</p>}
      <fieldset disabled={busy || !share.available} className="space-y-5 disabled:opacity-60">
        <legend className="sr-only">Information approved for sharing</legend>
        <div className="flex flex-wrap gap-4">{(["hotel", "food", "budget"] as const).map(key => <label key={key} className="flex min-h-11 items-center gap-2 text-sm"><input type="checkbox" className="accent-primary" checked={options[key]} onChange={e => { setOptions(p => ({ ...p, [key]: e.target.checked })); setApproved(false); requestId.current = null; }} />Include {key === "food" ? "saved food spots" : key === "hotel" ? "selected hotel" : "budget totals"}</label>)}</div>
        <label className="block max-w-xs text-sm">Link expires after<select className="mt-2 min-h-11 w-full rounded-lg border border-border bg-card px-3" value={expiry} onChange={e => { setExpiry(e.target.value); setApproved(false); requestId.current = null; }}><option value="1">1 day</option><option value="7">7 days</option><option value="30">30 days</option></select></label>
        <details className="rounded-xl border border-border p-4"><summary className="min-h-11 cursor-pointer py-2 text-sm font-medium">Preview the next shared snapshot</summary><div className="mt-4"><TripDocument document={shareDocument(document, options)} /></div></details>
        <label className="flex items-start gap-3 text-sm"><input type="checkbox" className="mt-1 accent-primary" checked={approved} onChange={e => setApproved(e.target.checked)} />I approve sharing the destination, dates, activities and selected extras shown in the preview.</label>
        <div className="flex flex-wrap gap-3"><Button disabled={!approved} loading={busy} onClick={() => void mutate("create")}>{share.active ? "Replace sharing link" : "Create sharing link"}</Button>
          {share.revision && <Button variant="secondary" onClick={() => void mutate("revoke")}>Revoke link &amp; remove snapshot</Button>}</div>
      </fieldset>
      {share.active && <div className="space-y-3 rounded-xl bg-surface-secondary p-4">
        <p className="text-sm font-medium">Read-only sharing is active{share.expiresAt ? ` until ${new Date(share.expiresAt).toISOString().slice(0, 10)}` : ""}.</p>
        <p className="text-sm text-muted-foreground">Current link includes destination, dates and activities{share.options ? `${share.options.hotel ? ", selected hotel" : ""}${share.options.food ? ", saved food spots" : ""}${share.options.budget ? ", budget totals" : ""}.` : ". Its saved sharing options are unavailable; replace the link to review them."}</p>
        {share.url ? <div className="flex flex-col gap-3 sm:flex-row"><Input ref={link} aria-label="Read-only sharing link" readOnly value={share.url} className="min-w-0 flex-1" /><Button variant="secondary" disabled={busy} onClick={() => void copy()}>Copy link</Button></div> : <p className="text-sm">The link cannot be recovered with the current configuration. Revoke it or create a new one.</p>}
      </div>}
      {message && <p role={failed ? "alert" : "status"} className={`text-sm ${failed ? "text-destructive" : "text-muted-foreground"}`}>{message}</p>}
    </SurfaceCard>
    <TripDocument document={document} />
  </div>;
}
