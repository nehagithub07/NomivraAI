"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import * as Dialog from "@radix-ui/react-dialog";
import { Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";

export function DeleteTripButton({ tripId, destination, redirectAfterDelete = false }: {
  tripId: string;
  destination: string;
  redirectAfterDelete?: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState("");
  const inFlight = useRef(false);
  const cancelButton = useRef<HTMLButtonElement>(null);

  async function removeTrip() {
    if (inFlight.current) return;
    inFlight.current = true;
    setDeleting(true);
    setError("");
    try {
      const response = await fetch(`/api/trips/${encodeURIComponent(tripId)}`, {
        method: "DELETE", headers: { "Content-Type": "application/json" },
        body: "{}", signal: AbortSignal.timeout(40_000),
      });
      if (!response.ok) {
        setError(response.status === 401 ? "Your session expired. Sign in again before deleting this trip."
          : response.status === 404 ? "This trip is no longer available. Refresh My Trips."
          : "We couldn't confirm deletion. Refresh My Trips before trying again.");
        return;
      }
      setOpen(false);
      if (redirectAfterDelete) router.replace("/trips");
      router.refresh();
    } catch {
      setError("We couldn't confirm deletion. Refresh My Trips before trying again.");
    } finally {
      inFlight.current = false;
      setDeleting(false);
    }
  }

  return (
    <Dialog.Root open={open} onOpenChange={next => {
      if (inFlight.current) return;
      setError("");
      setOpen(next);
    }}>
      <Dialog.Trigger asChild>
        <Button variant="ghost" className="text-destructive" aria-label={`Delete trip to ${destination}`}>
          <Trash2 aria-hidden="true" />Delete trip
        </Button>
      </Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-foreground/30" />
        <Dialog.Content role="alertdialog"
          onOpenAutoFocus={event => { event.preventDefault(); cancelButton.current?.focus(); }}
          className="fixed top-1/2 left-1/2 z-50 max-h-[90dvh] w-[calc(100%-2rem)] max-w-md -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-2xl border bg-card p-6 shadow-lg outline-none">
          <Dialog.Title className="type-section wrap-anywhere">Delete your {destination} trip?</Dialog.Title>
          <Dialog.Description className="type-small mt-3 text-muted-foreground">
            This permanently deletes the trip and its saved plans, selections, expenses, chat and trip-linked memories. Shared links will stop working. This cannot be undone.
          </Dialog.Description>
          {error && <p role="alert" className="type-small mt-4 text-destructive">{error}</p>}
          <div className="mt-6 flex flex-wrap justify-end gap-3">
            <Dialog.Close asChild><Button ref={cancelButton} variant="secondary" disabled={deleting}>Keep trip</Button></Dialog.Close>
            <Button variant="destructive" loading={deleting} onClick={() => void removeTrip()}>
              <Trash2 aria-hidden="true" />{deleting ? "Deleting…" : "Delete trip"}
            </Button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
