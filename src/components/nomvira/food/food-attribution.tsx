export function FoodAttribution({ demo = false }: { demo?: boolean }) {
  return <p className="type-meta text-muted-foreground">{demo ? "Fictional development places. " : null}<a className="underline underline-offset-4" href="https://www.geoapify.com/" target="_blank" rel="noopener noreferrer">Powered by Geoapify</a>{" · "}<a className="underline underline-offset-4" href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">© OpenStreetMap contributors · ODbL</a>{demo ? " (live data source)" : null}</p>;
}
