export function ProviderAttribution({ provider }: { provider: "open_meteo" | "openstreetmap" }) {
  return <p className="type-meta mt-3 text-muted-foreground">
    {provider === "open_meteo" ? <>Geocoding data: <a href="https://open-meteo.com/en/docs/geocoding-api" target="_blank" rel="noopener noreferrer" className="underline">Open-Meteo</a> / <a href="https://www.geonames.org/" target="_blank" rel="noopener noreferrer" className="underline">GeoNames</a> · <a href="https://creativecommons.org/licenses/by/4.0/" target="_blank" rel="noopener noreferrer" className="underline">CC BY 4.0</a></> : <>Place data © <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer" className="underline">OpenStreetMap contributors · ODbL</a></>}
  </p>;
}
