import type { Metadata } from "next";
import { PageHeader } from "@/components/nomvira/layout/page-header";
import { CreateTripWizard } from "@/components/nomvira/trips/create-trip-wizard";
import { requireUser } from "@/lib/auth/session";
import { todayInTimeZone } from "@/lib/trips/dates";

export const metadata: Metadata = { title: "Create Trip" };

export default async function CreateTripPage({ searchParams }: {
  searchParams: Promise<{ destination?: string | string[] }>;
}) {
  await requireUser();
  const destination = (await searchParams).destination;
  return (
    <>
      <PageHeader title="Create a new trip" description="Tell NomviraAI about your journey." />
      <CreateTripWizard initialDestination={typeof destination === "string" ? destination.trim().slice(0, 160) : ""} initialToday={todayInTimeZone("UTC")} />
    </>
  );
}
