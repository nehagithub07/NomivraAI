import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { PageHeader } from "@/components/nomvira/layout/page-header";
import { TripNavigation } from "@/components/nomvira/trips/trip-navigation";
import { BudgetWorkspace } from "@/components/nomvira/budget/budget-workspace";
import { createClient } from "@/lib/supabase/server";
import { getTrip } from "@/lib/trips/queries";
import { getBudgetSummary } from "@/lib/budget/server";
import type { TripBudgetSummary } from "@/lib/budget/validation";

type Props = { params: Promise<{ tripId: string }> };
export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const trip = await getTrip((await params).tripId);
  return { title: trip ? `Budget for ${trip.destination_name}` : "Trip not found" };
}
export default async function BudgetPage({ params }: Props) {
  const trip = await getTrip((await params).tripId);
  if (!trip) notFound();
  let summary: TripBudgetSummary | null = null;
  try { summary = await getBudgetSummary(await createClient(), trip); } catch { /* Safe retry UI. */ }
  return <><PageHeader title={`Budget for ${trip.destination_name}`} description="Plan with confidence. Keep estimates and actual spending clearly in view." />
    <TripNavigation tripId={trip.id} active="budget" />
    <BudgetWorkspace tripId={trip.id} initialSummary={summary} currency={trip.currency} />
  </>;
}
