import "server-only";

import { cache } from "react";
import { z } from "zod";
import { requireUser } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import type { TripRow } from "@/lib/supabase/database.types";
import type { TripInterest } from "./options";

export type TripWithInterests = TripRow & { trip_interests: { interest: TripInterest }[] };

export function hasCurrentDestination(trip: TripRow) {
  return trip.destination_provider === "open_meteo" && !!trip.destination_provider_id && trip.destination_latitude !== null && trip.destination_longitude !== null;
}

export const getTrips = cache(async (): Promise<TripRow[]> => {
  const user = await requireUser();
  const supabase = await createClient();
  const { data, error } = await supabase.from("trips").select("*")
    .eq("owner_id", user.id).order("start_date", { ascending: true }).order("created_at", { ascending: false });
  if (error) throw new Error("We couldn't load your trips. Please try again.");
  return data;
});

export const getTrip = cache(async (id: string): Promise<TripWithInterests | null> => {
  const user = await requireUser();
  if (!z.uuid().safeParse(id).success) return null;
  const supabase = await createClient();
  const { data, error } = await supabase.from("trips").select("*, trip_interests(interest)")
    .eq("id", id).eq("owner_id", user.id).maybeSingle();
  if (error) throw new Error("We couldn't load this trip. Please try again.");
  return data;
});

export async function getUpcomingTrip(today: string): Promise<TripRow | null> {
  const user = await requireUser();
  const supabase = await createClient();
  const { data, error } = await supabase.from("trips").select("*").eq("owner_id", user.id)
    .in("status", ["planning", "active"]).gte("start_date", today)
    .order("start_date", { ascending: true }).order("created_at", { ascending: false }).limit(1).maybeSingle();
  if (error) throw new Error("We couldn't load your upcoming trip. Please try again.");
  return data;
}
