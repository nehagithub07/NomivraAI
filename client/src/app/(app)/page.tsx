import type { Metadata } from "next";
import { HomeDashboard } from "@/components/nomvira/dashboard/home-dashboard";
import { DashboardSkeleton } from "@/components/nomvira/dashboard/dashboard-skeletons";
import { dashboardMock, emptyDashboardMock } from "@/lib/mock/dashboard";
import { requireUser } from "@/lib/auth/session";
import { getUserIdentity } from "@/lib/auth/identity";

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
  return (
    <HomeDashboard
      data={{
        ...(preview === "empty" ? emptyDashboardMock : dashboardMock),
        user: { firstName: identity.firstName },
      }}
    />
  );
}
