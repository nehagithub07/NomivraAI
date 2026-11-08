import type { Metadata } from "next";
import { HomeDashboard } from "@/components/nomvira/dashboard/home-dashboard";
import { DashboardSkeleton } from "@/components/nomvira/dashboard/dashboard-skeletons";
import { dashboardMock, emptyDashboardMock } from "@/lib/mock/dashboard";
import { requireUser } from "@/lib/auth/session";
import { getUserIdentity } from "@/lib/auth/identity";
import { todayInTimeZone, tripDuration } from "@/lib/trips/dates";
import { createClient } from "@/lib/supabase/server";
import type { DashboardData } from "@/lib/mock/dashboard";
import type { TripRow } from "@/lib/supabase/database.types";

export const metadata: Metadata = { title: "Home" };

export default async function HomePage({
  searchParams,
}: {
  searchParams: Promise<{ preview?: string | string[] }>;
}) {
  const user = await requireUser();
  const identity = getUserIdentity(user);
  // Preview fixtures are available in development only; there is no simulated loading delay.
  const preview =
    process.env.NODE_ENV === "development"
      ? (await searchParams).preview
      : undefined;
  if (preview === "loading") return <DashboardSkeleton />;
  let upcomingTrip: TripRow | null = null;
  let upcomingError = false;
  let recentError = false;
  let recentTrips: DashboardData["recentTrips"] = [];
  if (preview !== "empty") {
    const db = await createClient();
    const [upcoming, recent] = await Promise.allSettled([
      db.from("trips").select("*").eq("owner_id", user.id).in("status", ["planning", "active"]).gte("start_date", todayInTimeZone("UTC")).order("start_date").limit(1).maybeSingle(),
      db.from("trips").select("id,destination_name,destination_country,start_date,end_date").eq("owner_id", user.id).eq("status", "completed").order("end_date", { ascending: false }).limit(3),
    ]);
    upcomingError = upcoming.status === "rejected" || !!upcoming.value.error;
    if (upcoming.status === "fulfilled" && !upcoming.value.error) upcomingTrip = upcoming.value.data;
    recentError = recent.status === "rejected" || !!recent.value.error;
    if (recent.status === "fulfilled" && !recent.value.error) recentTrips = recent.value.data.map(t => ({ id: t.id, destination: t.destination_name, country: t.destination_country ?? "", startDate: t.start_date, endDate: t.end_date, days: tripDuration(t.start_date, t.end_date), status: "Completed" }));
  }
  const sampleContent = preview === "populated" || preview === "empty";
  return (
    <HomeDashboard
      upcomingTrip={upcomingTrip}
      upcomingError={upcomingError}
      recentError={recentError}
      sampleContent={sampleContent}
      data={{
        ...(sampleContent ? preview === "empty" ? emptyDashboardMock : dashboardMock : {
          recommendations: [], recentTrips,
          insight: { title: "Make every trip feel like yours", description: "Approve your travel defaults and choose what NomviraAI remembers. Your current trip choices always take priority.", destination: "" },
        }),
        user: { firstName: identity.firstName },
      }}
    />
  );
}
