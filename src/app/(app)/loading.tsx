import { Skeleton } from "@/components/ui/skeleton";
export default function AppLoading() {
  return <div role="status" aria-label="Loading your travel workspace" className="space-y-6"><span className="sr-only">Loading your travel workspace…</span><Skeleton className="h-10 w-3/4 max-w-md" /><Skeleton className="h-5 w-full max-w-xl" /><div className="grid gap-6 md:grid-cols-2"><Skeleton className="h-64 rounded-2xl" /><Skeleton className="h-64 rounded-2xl" /></div></div>;
}
