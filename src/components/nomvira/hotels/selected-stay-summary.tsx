import Link from "next/link";
import { BedDouble } from "lucide-react";
import { SurfaceCard } from "@/components/nomvira/surface-card";
import type { StaySelection } from "@/lib/accommodations/validation";

export function SelectedStaySummary({ tripId, selection, recentName }: { tripId: string; selection: StaySelection; recentName?: string }) {
  return <SurfaceCard className="mt-6 p-5 sm:p-6"><p className="type-small flex items-center gap-2 font-medium"><BedDouble className="size-4" aria-hidden="true" />Your selected stay</p>
    <h2 className="type-body mt-3 font-semibold wrap-anywhere">{recentName || selection.selected_name || "Your accommodation choice is saved"}</h2>
    {selection.provider === "fixture" && <p className="type-meta mt-2 text-accent-foreground">Demo selection · fictional accommodation</p>}
    <Link href={`/trips/${tripId}/hotels`} className="type-small mt-3 inline-flex min-h-11 items-center font-medium underline underline-offset-4">Review your stay</Link>
  </SurfaceCard>;
}
