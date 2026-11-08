import type { Metadata } from "next";
import { connection } from "next/server";
import { notFound } from "next/navigation";
import { getSharedTrip } from "@/lib/sharing/server";
import { TripDocument } from "@/components/nomvira/exports/trip-document";
import { ExportActions } from "@/components/nomvira/exports/export-actions";
import { NomviraLogo } from "@/components/nomvira/nomvira-logo";

export const metadata: Metadata = { title: "Shared travel plan", robots: { index: false, follow: false, nocache: true } };
export default async function SharedTripPage({ params }: { params: Promise<{ token: string }> }) {
  await connection();
  const document = await getSharedTrip((await params).token);
  if (!document) notFound();
  return <main id="main-content" className="mx-auto min-h-dvh w-full max-w-4xl space-y-6 px-4 py-8 sm:px-6 sm:py-12">
    <header className="export-controls space-y-4"><NomviraLogo /><h1 className="type-page">Shared travel plan</h1><p className="text-sm text-muted-foreground">A read-only snapshot approved by the trip owner. Live availability and future trip changes are not included.</p><ExportActions document={document} /></header>
    <TripDocument document={document} />
  </main>;
}
