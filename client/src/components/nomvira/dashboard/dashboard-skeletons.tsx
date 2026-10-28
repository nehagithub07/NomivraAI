import { Skeleton } from "@/components/ui/skeleton";
import { SurfaceCard } from "@/components/nomvira/surface-card";

export function UpcomingTripSkeleton() {
  return (
    <SurfaceCard
      size="panel"
      aria-hidden="true"
      className="grid overflow-hidden xl:grid-cols-[3fr_2fr]"
    >
      <div className="space-y-6 p-6 sm:p-8">
        <Skeleton className="h-5 w-32" />
        <Skeleton className="h-9 w-3/4" />
        <Skeleton className="h-4 w-full max-w-64" />
        <div className="grid grid-cols-3 gap-5 border-t pt-6">
          {[0, 1, 2].map((key) => (
            <div key={key} className="space-y-3">
              <Skeleton className="h-3 w-3/4" />
              <Skeleton className="h-6 w-3/4" />
              <Skeleton className="h-3 w-full" />
            </div>
          ))}
        </div>
        <div className="flex justify-end border-t pt-5">
          <Skeleton className="h-11 w-full sm:w-48" />
        </div>
      </div>
      <Skeleton className="order-first h-40 rounded-none sm:h-52 xl:order-last xl:h-full xl:min-h-96" />
    </SurfaceCard>
  );
}

export function DestinationCardSkeleton() {
  return (
    <SurfaceCard aria-hidden="true" className="p-2">
      <Skeleton className="aspect-[4/3] rounded-lg" />
      <div className="space-y-3 p-3 pt-4">
        <Skeleton className="h-5 w-3/5" />
        <Skeleton className="h-3 w-2/5" />
        <Skeleton className="mt-4 h-3 w-full" />
        <Skeleton className="h-3 w-4/5" />
        <Skeleton className="mt-5 h-3 w-3/5" />
      </div>
    </SurfaceCard>
  );
}

export function RecentTripsSkeleton() {
  return (
    <div aria-hidden="true" className="space-y-3">
      {[0, 1].map((key) => (
        <SurfaceCard key={key} className="flex items-center gap-4 p-4">
          <Skeleton className="hidden size-14 shrink-0 rounded-lg sm:block" />
          <div className="flex-1 space-y-3">
            <Skeleton className="h-5 w-1/2" />
            <Skeleton className="h-3 w-3/4" />
            <Skeleton className="h-5 w-20" />
          </div>
        </SurfaceCard>
      ))}
    </div>
  );
}

export function DashboardSkeleton() {
  return (
    <div role="status" aria-busy="true" aria-live="polite">
      <h1 className="sr-only">Loading your travel overview</h1>
      <div aria-hidden="true" className="space-y-10 md:space-y-12">
        <div className="space-y-4">
          <Skeleton className="h-4 w-40" />
          <Skeleton className="h-10 w-full max-w-2xl" />
          <SurfaceCard className="mt-6 flex items-center gap-4 p-2">
            <Skeleton className="h-12 flex-1" />
            <Skeleton className="size-12 sm:w-36" />
          </SurfaceCard>
        </div>
        <div>
          <Skeleton className="mb-6 h-6 w-48" />
          <UpcomingTripSkeleton />
        </div>
        <div>
          <Skeleton className="mb-6 h-6 w-56" />
          <div className="grid auto-cols-[84%] grid-flow-col gap-4 overflow-x-auto pb-3 md:auto-cols-auto md:grid-flow-row md:grid-cols-2 md:overflow-visible xl:grid-cols-4">
            {[0, 1, 2, 3].map((key) => (
              <DestinationCardSkeleton key={key} />
            ))}
          </div>
        </div>
        <div className="grid gap-8 xl:grid-cols-[0.95fr_1.05fr] xl:gap-6">
          <SurfaceCard className="space-y-6 p-8">
            <Skeleton className="h-5 w-40" />
            <Skeleton className="h-7 w-3/4" />
            <Skeleton className="h-16 w-full" />
            <Skeleton className="h-5 w-32" />
          </SurfaceCard>
          <div>
            <Skeleton className="mb-6 h-6 w-40" />
            <RecentTripsSkeleton />
          </div>
        </div>
      </div>
    </div>
  );
}
