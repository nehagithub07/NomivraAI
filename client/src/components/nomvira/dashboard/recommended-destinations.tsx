import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { SectionHeading } from "@/components/nomvira/section-heading";
import type { RecommendedDestination } from "@/lib/mock/dashboard";
import { DestinationCard } from "./destination-card";

export function RecommendedDestinations({
  destinations,
}: {
  destinations: RecommendedDestination[];
}) {
  return (
    <section aria-labelledby="recommendations-title" className="min-w-0">
      <SectionHeading
        id="recommendations-title"
        title="Recommended for you"
        description="A few places for your next chapter."
        trailing={
          <Link
            href="/explore"
            className="type-small inline-flex min-h-11 items-center gap-2 font-medium"
          >
            Explore more
            <ArrowRight className="size-4" aria-hidden="true" />
          </Link>
        }
      />
      <ul
        aria-label="Recommended destinations"
        className="grid auto-cols-[84%] grid-flow-col gap-4 overflow-x-auto overscroll-x-contain pt-1 pb-3 pl-1 -ml-1 snap-x snap-mandatory md:auto-cols-auto md:grid-flow-row md:grid-cols-2 md:overflow-visible xl:grid-cols-4 xl:gap-5"
      >
        {destinations.map((destination) => (
          <li key={destination.id} className="min-w-0 snap-start">
            <DestinationCard destination={destination} />
          </li>
        ))}
      </ul>
    </section>
  );
}
