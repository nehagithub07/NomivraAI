import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { PageHeader } from "@/components/nomvira/layout/page-header";
import { TripNavigation } from "@/components/nomvira/trips/trip-navigation";
import { ExportShareWorkspace } from "@/components/nomvira/exports/export-share-workspace";
import { getTrip } from "@/lib/trips/queries";
import { createClient } from "@/lib/supabase/server";
import { buildExportDocument } from "@/lib/exports/server";
import { getShareState } from "@/lib/sharing/server";

export const metadata: Metadata = { title: "Export & Share", robots: { index: false, follow: false } };
export default async function ExportPage({ params }: { params: Promise<{ tripId: string }> }) {
  const trip = await getTrip((await params).tripId);
  if (!trip) notFound();
  const db = await createClient();
  const [document, share] = await Promise.all([buildExportDocument(db, trip), getShareState(db, trip.id, trip.owner_id)]);
  return <><PageHeader title="Export & Share" description="Your saved plan, ready to print or share on your terms." />
    <TripNavigation tripId={trip.id} active="export" />
    <ExportShareWorkspace tripId={trip.id} document={document} initialShare={share} />
  </>;
}
