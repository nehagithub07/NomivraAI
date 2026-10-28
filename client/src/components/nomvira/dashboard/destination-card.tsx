import Image from "next/image";
import Link from "next/link";
import { ArrowUpRight, Sparkles } from "lucide-react";
import { AccentBadge } from "@/components/nomvira/accent-badge";
import { SurfaceCard } from "@/components/nomvira/surface-card";
import type { RecommendedDestination } from "@/lib/mock/dashboard";

export function DestinationCard({
  destination,
}: {
  destination: RecommendedDestination;
}) {
  return (
    <SurfaceCard variant="interactive" className="h-full">
      <Link
        href={`/explore?destination=${encodeURIComponent(destination.destination)}`}
        aria-label={`Explore ${destination.destination}, ${destination.country}`}
        className="block h-full rounded-xl p-2 focus-visible:outline-offset-[-3px]"
      >
        <div className="relative aspect-[4/3] overflow-hidden rounded-lg bg-surface-secondary">
          <Image
            src={destination.visual.src}
            alt={destination.visual.alt}
            fill
            loading="eager"
            sizes="(min-width: 1280px) 25vw, (min-width: 768px) 50vw, 85vw"
            className="object-cover"
          />
          {destination.isNomviraPick && (
            <AccentBadge className="absolute top-3 left-3">
              <Sparkles aria-hidden="true" />
              Nomvira Pick
            </AccentBadge>
          )}
        </div>
        <div className="px-3 pt-4 pb-3">
          <div className="flex items-center justify-between gap-2">
            <h3 className="type-card">{destination.destination}</h3>
            <ArrowUpRight
              className="size-4 text-muted-foreground"
              aria-hidden="true"
            />
          </div>
          <p className="type-small mt-0.5 text-muted-foreground">
            {destination.country}
          </p>
          <p className="type-small mt-3 min-h-11 text-muted-foreground">
            {destination.reason}
          </p>
          <p className="type-meta mt-4 border-t pt-3 text-muted-foreground">
            {destination.interests.join(" · ")}
          </p>
        </div>
      </Link>
    </SurfaceCard>
  );
}
