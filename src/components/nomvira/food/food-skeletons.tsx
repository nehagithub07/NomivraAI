import { Skeleton } from "@/components/ui/skeleton";

export function FoodSkeletons() {
  return <div role="status" aria-label="Searching food spots" className="grid gap-5 sm:grid-cols-2"><span className="sr-only">Finding food spots for your trip.</span>{Array.from({ length: 4 }, (_, index) => <div key={index} className="overflow-hidden rounded-2xl border bg-card" aria-hidden="true"><Skeleton className="h-32 rounded-none" /><div className="space-y-4 p-5"><Skeleton className="h-5 w-3/4" /><Skeleton className="h-4 w-1/2" /><Skeleton className="h-4 w-2/3" /><Skeleton className="mt-6 h-11 w-full" /></div></div>)}</div>;
}
