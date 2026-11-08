"use client";
import { useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import type { ExportDocument } from "@/lib/exports/validation";

export function ExportActions({ document }: { document: ExportDocument }) {
  const [busy, setBusy] = useState(false), [error, setError] = useState("");
  const lock = useRef(false);
  async function download() {
    if (lock.current) return;
    lock.current = true; setBusy(true); setError("");
    try { const { downloadItineraryPdf } = await import("@/lib/exports/download"); await downloadItineraryPdf(document); }
    catch { setError("PDF download couldn't complete. Use Print / Save PDF, or try again."); }
    finally { lock.current = false; setBusy(false); }
  }
  return <div className="export-controls space-y-3">
    <div className="flex flex-wrap gap-3"><Button loading={busy} onClick={() => void download()}>Download PDF</Button><Button variant="secondary" onClick={() => window.print()}>Print / Save PDF</Button></div>
    {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
  </div>;
}
