"use client";

import { useRef, useState } from "react";
import { Compass, LoaderCircle, MapPin } from "lucide-react";
import { Button } from "@/components/ui/button";
import { SurfaceCard } from "@/components/nomvira/surface-card";
import { normalizedPlaceSchema, type NormalizedPlace } from "@/lib/destinations/validation";
import { discoveryErrorMessage } from "@/lib/destinations/discovery-errors";
import { z } from "zod";
import { ProviderAttribution } from "./provider-attribution";

export function DestinationPlaces({ tripId, canDiscover, initialPlaces, loadFailed = false }: {
  tripId: string; canDiscover: boolean; initialPlaces: NormalizedPlace[]; loadFailed?: boolean;
}) {
  const [places, setPlaces] = useState(initialPlaces), [loading, setLoading] = useState(false), [searched, setSearched] = useState(false);
  const [error, setError] = useState<string>();
  const lock = useRef(false);
  async function discover() {
    if (lock.current) return; lock.current = true;
    setLoading(true); setError(undefined);
    try {
      const response = await fetch(`/api/trips/${tripId}/discover-places`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
      if (!response.ok) {
        const failure = z.object({ error: z.object({ code: z.string().max(80) }) }).safeParse(await response.json().catch(() => null));
        const code = failure.success ? failure.data.error.code : response.status === 401 ? "unauthorized" : response.status === 429 ? "provider_rate_limited" : undefined;
        setError(discoveryErrorMessage(code));
        return;
      }
      const data = z.object({ places: z.array(normalizedPlaceSchema).max(30) }).parse(await response.json());
      setPlaces(data.places); setSearched(true);
    } catch { setError(discoveryErrorMessage(undefined)); }
    finally { setLoading(false); lock.current = false; }
  }
  return <SurfaceCard size="panel" className="mt-6 min-w-0 p-5 sm:p-8">
    <div className="flex flex-wrap items-start justify-between gap-4">
      <div><h2 className="type-section flex items-center gap-2"><Compass className="size-5 text-accent" aria-hidden="true" />Explore your destination</h2>
        <p className="type-small mt-3 max-w-xl text-muted-foreground">Find attractions, museums, and parks to inspire your trip.</p></div>
      {places.length === 0 && <Button onClick={() => void discover()} disabled={loading || !canDiscover}>
        {loading && <LoaderCircle className="size-4 animate-spin motion-reduce:animate-none" aria-hidden="true" />}{loading ? "Finding places…" : "Discover places"}
      </Button>}
    </div>
    {!canDiscover && <p className="type-small mt-4 text-muted-foreground">Destination details are not available for this older trip. Your saved trip is still here.</p>}
    {loadFailed && <p className="type-small mt-4 text-muted-foreground">Saved places couldn’t be loaded. Please try again.</p>}
    <div role="status" aria-live="polite">
      {loading && <p className="type-small mt-4 text-muted-foreground">Finding places worth exploring…</p>}
      {searched && places.length === 0 && <p className="type-small mt-4 text-muted-foreground">No named attractions were found nearby. Try again later.</p>}
    </div>
    {error && <p role="alert" className="type-small mt-4 text-destructive">{error}</p>}
    {places.length > 0 && <div className="mt-6"><h3 className="type-body font-semibold">Places to explore</h3>
      <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {places.map((place) => <article key={place.provider_place_id} className="min-w-0 rounded-xl border bg-card p-4">
          <h4 className="type-body font-medium wrap-anywhere">{place.name}</h4>
          <p className="type-meta mt-1 text-muted-foreground capitalize">{place.category.replaceAll("_", " ")}</p>
          <p className="type-small mt-3 flex items-start gap-2 text-muted-foreground"><MapPin className="mt-0.5 size-4 shrink-0" aria-hidden="true" />{place.distance_km.toFixed(1)} km from destination center</p>
        </article>)}
      </div></div>}
    {(places.length > 0 || searched) && <ProviderAttribution provider="openstreetmap" />}
  </SurfaceCard>;
}
