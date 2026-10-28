import Link from "next/link";
import { ArrowRight, Sparkles } from "lucide-react";
import { AccentBadge } from "@/components/nomvira/accent-badge";
import { SurfaceCard } from "@/components/nomvira/surface-card";
import type { DashboardData } from "@/lib/mock/dashboard";

export function NomviraInsightCard({
  insight,
}: {
  insight: DashboardData["insight"];
}) {
  return (
    <section aria-labelledby="insight-title" className="min-w-0">
      <SurfaceCard
        variant="accent"
        size="panel"
        className="flex h-full flex-col p-6 sm:p-8"
      >
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2
            id="insight-title"
            className="type-small inline-flex items-center gap-2 font-medium"
          >
            <Sparkles
              className="size-4 text-accent-foreground"
              aria-hidden="true"
            />
            NomviraAI Insight
          </h2>
          <AccentBadge className="text-[0.6875rem] font-normal">
            Example insight
          </AccentBadge>
        </div>
        <h3 className="type-section mt-6 max-w-sm text-balance">
          {insight.title}
        </h3>
        <p className="type-body mt-3 max-w-lg text-muted-foreground">
          {insight.description}
        </p>
        <Link
          href={`/explore?destination=${encodeURIComponent(insight.destination)}`}
          className="type-small mt-6 inline-flex min-h-11 w-fit items-center gap-2 font-medium"
        >
          Explore {insight.destination}
          <ArrowRight className="size-4" aria-hidden="true" />
        </Link>
      </SurfaceCard>
    </section>
  );
}
