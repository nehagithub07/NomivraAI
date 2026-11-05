"use client";

import { LngLatBounds, Map as MapLibreMap, Marker, NavigationControl, Popup, setWorkerUrl } from "maplibre-gl";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import type { RouteResponse } from "@/lib/routing/validation";

// MapLibre 6 ships its module worker separately; let Next emit the package asset.
setWorkerUrl(new URL("maplibre-gl/dist/maplibre-gl-worker.mjs", import.meta.url).toString());

export type TripMapPoint = {
  id: string; name: string; latitude: number; longitude: number;
  kind: "discovered" | "itinerary"; order?: number;
};

export function TripMap({ points, route, center, styleUrl }: {
  points: TripMapPoint[]; route: RouteResponse | null;
  center: { latitude: number; longitude: number }; styleUrl: string;
}) {
  const container = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const loadedMap = useRef<MapLibreMap | null>(null);
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);
  const [loaded, setLoaded] = useState(0);

  useEffect(() => {
    if (!container.current) return;
    let map: MapLibreMap;
    let active = true;
    try {
      map = new MapLibreMap({
        container: container.current, style: styleUrl,
        center: [center.longitude, center.latitude], zoom: 11,
      });
    } catch {
      const timer = setTimeout(() => setError("Your browser could not start the map. Try enabling hardware acceleration or use the map link below."), 0);
      return () => clearTimeout(timer);
    }
    mapRef.current = map;
    map.addControl(new NavigationControl(), "top-right");
    map.on("load", () => {
      if (active) { loadedMap.current = map; setError(""); setLoaded(value => value + 1); }
    });
    map.on("error", () => {
      if (active) setError("Some map data could not load. Retry the map or open this destination in OpenStreetMap.");
    });
    const observer = new ResizeObserver(() => map.resize());
    observer.observe(container.current);
    return () => {
      active = false; observer.disconnect(); loadedMap.current = null; mapRef.current = null; map.remove();
    };
  }, [center.latitude, center.longitude, styleUrl, attempt]);

  useEffect(() => {
    const map = mapRef.current;
    // isStyleLoaded() also becomes false during tile requests after fitBounds.
    // A loaded map can still accept updated markers and sources in that period.
    if (!map || loadedMap.current !== map) return;
    const bounds = new LngLatBounds();
    const markers = points.map(point => {
      const element = document.createElement("button");
      element.type = "button";
      element.setAttribute("aria-label", point.name);
      element.className = "flex size-8 items-center justify-center rounded-full border-2 border-white bg-foreground text-xs font-bold text-background shadow-md";
      if (point.kind === "itinerary") {
        element.style.background = "#ff9a62"; element.style.color = "#111";
        element.textContent = String(point.order ?? "");
      } else element.textContent = "•";
      bounds.extend([point.longitude, point.latitude]);
      return new Marker({ element })
        .setLngLat([point.longitude, point.latitude])
        .setPopup(new Popup({ offset: 18 }).setText(point.name)).addTo(map);
    });
    if (map.getLayer("nomvira-route-line")) map.removeLayer("nomvira-route-line");
    if (map.getSource("nomvira-route")) map.removeSource("nomvira-route");
    if (route) {
      map.addSource("nomvira-route", { type: "geojson", data: {
        type: "Feature", properties: {}, geometry: route.geometry,
      } });
      map.addLayer({ id: "nomvira-route-line", type: "line", source: "nomvira-route",
        layout: { "line-join": "round", "line-cap": "round" },
        paint: { "line-color": "#ff9a62", "line-width": 5, "line-opacity": 0.9 },
      });
      route.geometry.coordinates.forEach(pair => bounds.extend(pair as [number, number]));
    }
    if (!bounds.isEmpty()) map.fitBounds(bounds, { padding: 50, maxZoom: 14, duration: 0 });
    return () => { markers.forEach(marker => marker.remove()); };
  }, [points, route, loaded]);

  return <div className="space-y-3">
    {error && <div role="alert" className="type-small rounded-xl border bg-card p-4">
      <p>{error}</p>
      <Button className="mt-3" variant="secondary" onClick={() => { setError(""); setAttempt(value => value + 1); }}>Retry map</Button>
    </div>}
    <div ref={container} className="h-[520px] w-full overflow-hidden rounded-2xl border bg-muted" aria-label="Trip map" />
    <a className="type-small inline-flex min-h-11 items-center underline underline-offset-4"
      href={`https://www.openstreetmap.org/?mlat=${center.latitude}&mlon=${center.longitude}#map=12/${center.latitude}/${center.longitude}`}
      target="_blank" rel="noopener noreferrer">Open destination in OpenStreetMap</a>
  </div>;
}
