"use client";

import {
  LngLatBounds,
  Map as MapLibreMap,
  Marker,
  NavigationControl,
  Popup,
  setWorkerUrl,
} from "maplibre-gl";

import {
  useEffect,
  useRef,
} from "react";

import type {
  RouteResponse,
} from "@/lib/routing/validation";


setWorkerUrl(
  new URL(
    "maplibre-gl/dist/maplibre-gl-worker.mjs",
    import.meta.url,
  ).toString(),
);


export type TripMapPoint = {
  id: string;
  name: string;

  latitude: number;
  longitude: number;

  kind:
    | "discovered"
    | "itinerary";

  order?: number;
};


export function TripMap({
  points,
  route,
  center,
  styleUrl,
}: {
  points: TripMapPoint[];
  route: RouteResponse | null;

  center: {
    latitude: number;
    longitude: number;
  };

  styleUrl: string;
}) {
  const container =
    useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!container.current) {
      return;
    }

    const map = new MapLibreMap({
      container: container.current,

      style: styleUrl,

      center: [
        center.longitude,
        center.latitude,
      ],

      zoom: 11,
    });

    map.addControl(
      new NavigationControl(),
      "top-right",
    );

    const bounds =
      new LngLatBounds();

    const markers: Marker[] = [];

    for (const point of points) {
      const element =
        document.createElement("div");

      if (
        point.kind === "itinerary"
      ) {
        element.style.width = "30px";
        element.style.height = "30px";
        element.style.borderRadius = "999px";
        element.style.background =
          "#ff9a62";
        element.style.border =
          "2px solid #ffffff";
        element.style.boxShadow =
          "0 2px 10px rgba(0,0,0,.18)";
        element.style.display = "grid";
        element.style.placeItems =
          "center";
        element.style.fontSize = "12px";
        element.style.fontWeight =
          "700";

        element.textContent =
          String(point.order ?? "");
      } else {
        element.style.width = "10px";
        element.style.height = "10px";
        element.style.borderRadius =
          "999px";
        element.style.background =
          "#111111";
        element.style.border =
          "2px solid #ffffff";
      }

      const marker = new Marker({
        element,
      })
        .setLngLat([
          point.longitude,
          point.latitude,
        ])
        .setPopup(
          new Popup({
            offset: 18,
          }).setText(point.name),
        )
        .addTo(map);

      markers.push(marker);

      bounds.extend([
        point.longitude,
        point.latitude,
      ]);
    }

    map.on("load", () => {
      if (route) {
        map.addSource(
          "nomvira-route",
          {
            type: "geojson",

            data: {
              type: "Feature",

              properties: {},

              geometry:
                route.geometry,
            },
          },
        );

        map.addLayer({
          id: "nomvira-route-line",

          type: "line",

          source: "nomvira-route",

          layout: {
            "line-join": "round",
            "line-cap": "round",
          },

          paint: {
            "line-color":
              "#ff9a62",

            "line-width": 5,

            "line-opacity":
              0.9,
          },
        });

        for (
          const coordinate
          of route.geometry.coordinates
        ) {
          bounds.extend(
            coordinate as [
              number,
              number,
            ],
          );
        }
      }

      if (!bounds.isEmpty()) {
        map.fitBounds(
          bounds,
          {
            padding: 50,
            maxZoom: 14,
            duration: 0,
          },
        );
      }
    });

    return () => {
      for (const marker of markers) {
        marker.remove();
      }

      map.remove();
    };

  }, [
    center.latitude,
    center.longitude,
    points,
    route,
    styleUrl,
  ]);

  return (
    <div
      ref={container}
      className="h-[520px] w-full overflow-hidden rounded-2xl border bg-muted"
      aria-label="Trip map"
    />
  );
}