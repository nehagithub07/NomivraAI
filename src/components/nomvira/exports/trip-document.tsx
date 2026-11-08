import { directionsLink, mapLink, noticeLabels, type ExportDocument } from "@/lib/exports/validation";

const money = (currency: string, amount: string | null) => amount === null ? "Unavailable" : `${currency} ${amount}`;
export function TripDocument({ document: data }: { document: ExportDocument }) {
  return <article className="export-document min-w-0 space-y-6 rounded-2xl border border-border bg-card p-5 [overflow-wrap:anywhere] sm:p-8" aria-label="Itinerary document">
    <header className="border-b border-border pb-5"><p className="text-xs font-semibold tracking-widest text-nomvira-orange">NOMVIRAAI / TRAVEL PLAN</p>
      <h2 className="type-page mt-3">{data.destination}</h2><p className="mt-3 text-sm">{data.startDate} — {data.endDate}</p>
      <p className="mt-2 text-xs text-muted-foreground">Snapshot saved {data.exportedAt.slice(0, 10)}. Information can change.</p>
    </header>
    {data.notices.length > 0 && <ul className="space-y-2 rounded-lg bg-surface-secondary p-4 text-sm" aria-label="Document notes">{data.notices.map(n => <li key={n}>{noticeLabels[n]}</li>)}</ul>}
    {!data.days.length && <p className="text-sm text-muted-foreground">No saved itinerary is available.</p>}
    {data.days.map(day => <section key={day.dayNumber} className="export-day space-y-4">
      <h3 className="type-section">Day {day.dayNumber} · {day.theme}</h3><p className="text-sm text-muted-foreground">{day.date}</p>
      {!day.items.length && <p className="text-sm">No shared activities for this day.</p>}
      <ol className="space-y-3">{day.items.map((item, index) => <li key={index} className="rounded-xl border border-border p-4">
        <p className="text-xs font-medium uppercase text-muted-foreground">{item.period}</p><p className="mt-1 font-medium">{item.title}</p>
        {mapLink(item) && <a className="mt-2 inline-flex min-h-11 items-center text-sm underline underline-offset-4" href={mapLink(item)!} target="_blank" rel="noopener noreferrer">View location on OpenStreetMap</a>}
      </li>)}</ol>
      {directionsLink(day) && <a href={directionsLink(day)!} className="inline-flex min-h-11 items-center text-sm underline underline-offset-4" target="_blank" rel="noopener noreferrer">Directions between first and last mapped stop</a>}
    </section>)}
    <div className="grid gap-6 sm:grid-cols-2">
      <section><h3 className="type-section">Selected hotel</h3><p className="mt-3 text-sm">{data.hotel ? data.hotel.name ?? "A stay is selected; current details are unavailable." : "No hotel included."}</p>
        {data.hotel && mapLink(data.hotel) && <a href={mapLink(data.hotel)!} className="mt-2 inline-flex min-h-11 items-center text-sm underline" target="_blank" rel="noopener noreferrer">View hotel location</a>}
      </section>
      <section><h3 className="type-section">Saved food spots</h3>{!data.food.length ? <p className="mt-3 text-sm">No saved food spots included.</p> : <ul className="mt-3 space-y-2 text-sm">{data.food.map((f, i) => <li key={i}>{f.name} <span className="text-muted-foreground">· {f.category.replaceAll("_", " ")}</span></li>)}</ul>}{data.food.length === 50 && <p className="mt-3 text-xs text-muted-foreground">This document includes the 50 most recently saved food spots.</p>}</section>
    </div>
    <section><h3 className="type-section">Budget</h3>{data.budget ? <>
      <dl className="mt-4 grid gap-4 text-sm sm:grid-cols-2">{[["Trip budget", data.budget.total], ["Planned", data.budget.planned], ["Actual", data.budget.actual], ["Remaining after committed costs", data.budget.remaining]].map(([label, amount]) => <div key={label}><dt className="text-muted-foreground">{label}</dt><dd className="mt-1 font-medium">{money(data.budget!.currency, amount)}</dd></div>)}</dl>
      <p className="mt-4 text-xs text-muted-foreground">Unknown meal, attraction and other costs are excluded. Quotes can expire; this is not a booking or a final cost.</p>
    </> : <p className="mt-3 text-sm">Budget is not included.</p>}</section>
    <footer className="space-y-2 border-t border-border pt-5 text-xs text-muted-foreground">
      <p>Map links open third-party maps. Times are day periods, not verified opening hours or route durations.</p>
      <p>Place facts: <a href="https://www.openstreetmap.org/copyright" className="underline" rel="noreferrer">© OpenStreetMap contributors · ODbL</a>. Food: Geoapify / Google Maps. Hotel references: StayAPI.</p>
    </footer>
  </article>;
}
