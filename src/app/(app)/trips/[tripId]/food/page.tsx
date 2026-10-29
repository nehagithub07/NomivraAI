import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { PageHeader } from "@/components/nomvira/layout/page-header";
import { TripNavigation } from "@/components/nomvira/trips/trip-navigation";
import { FoodWorkspace } from "@/components/nomvira/food/food-workspace";
import { getTrip } from "@/lib/trips/queries";
import { getCachedFood, getFoodSelections, validateFoodTrip } from "@/lib/food/server";
import { createClient } from "@/lib/supabase/server";
import type { FoodSelection } from "@/lib/food/validation";

type Props = { params: Promise<{ tripId: string }> };
export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const trip = await getTrip((await params).tripId);
  return { title: trip ? `Food in ${trip.destination_name}` : "Trip not found" };
}
export default async function FoodPage({ params }: Props) {
  const trip = await getTrip((await params).tripId);
  if (!trip) notFound();
  let selections: FoodSelection[] = [], selectionLoadFailed = false, canSearch = true;
  try { selections = await getFoodSelections(await createClient(), trip.id); } catch { selectionLoadFailed = true; }
  try { validateFoodTrip(trip); } catch { canSearch = false; }
  return <><PageHeader title={`Food in ${trip.destination_name}`} description="Find restaurants, cafes and local food that match your trip." /><TripNavigation tripId={trip.id} active="food" /><FoodWorkspace tripId={trip.id} initialResults={getCachedFood(trip.owner_id, trip)} initialSelections={selections} initialDiets={trip.dietary_preferences} selectionLoadFailed={selectionLoadFailed} canSearch={canSearch} allowDemo={process.env.NODE_ENV === "development"} /></>;
}
