import type { Metadata } from "next";
import { HomeDashboard } from "@/components/nomvira/dashboard/home-dashboard";
import { DashboardSkeleton } from "@/components/nomvira/dashboard/dashboard-skeletons";
import { dashboardMock, emptyDashboardMock } from "@/lib/mock/dashboard";
import { requireUser } from "@/lib/auth/session";
import { getUserIdentity } from "@/lib/auth/identity";
import { getUpcomingTrip } from "@/lib/trips/queries";
import { todayInTimeZone } from "@/lib/trips/dates";
import type { TripRow } from "@/lib/supabase/database.types";

export const metadata: Metadata = { title: "Home" };

export default async function HomePage({
  searchParams,
}: {
  searchParams: Promise<{ preview?: string | string[] }>;
}) {
  const identity = getUserIdentity(await requireUser());
  // Preview fixtures are available in development only; there is no simulated loading delay.
  const preview =
    process.env.NODE_ENV === "development"
      ? (await searchParams).preview
      : undefined;
  if (preview === "loading") return <DashboardSkeleton />;
  let upcomingTrip: TripRow | null = null;
  let upcomingError = false;
  if (preview !== "empty") {
    try { upcomingTrip = await getUpcomingTrip(todayInTimeZone("UTC")); }
    catch { upcomingError = true; }
  }
  return (
    <HomeDashboard
      upcomingTrip={upcomingTrip}
      upcomingError={upcomingError}
      data={{
        ...(preview === "empty" ? emptyDashboardMock : dashboardMock),
        user: { firstName: identity.firstName },
      }}
    />
  );
}
