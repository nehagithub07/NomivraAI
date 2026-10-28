"use client";

import { useState } from "react";
import Image from "next/image";
import { BedDouble, Check, MapPin, Star } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { HotelCandidate } from "@/lib/accommodations/validation";
import { optionLabel } from "@/lib/trips/options";

export function hotelMoney(value: string, currency: string) {
  return new Intl.NumberFormat("en", { style: "currency", currency, maximumFractionDigits: 2 }).format(Number(value));
}
export function HotelPhoto({ hotel }: { hotel: HotelCandidate }) {
  const [failed, setFailed] = useState(false);
  return <div className="relative flex min-h-44 items-center justify-center overflow-hidden bg-surface-secondary sm:min-h-full">
    {hotel.image_url && !failed ? <Image src={hotel.image_url} alt={`${hotel.name} property photo`} fill unoptimized sizes="(min-width: 640px) 192px, 100vw" className="object-cover" referrerPolicy="no-referrer" onError={() => setFailed(true)} />
      : <div className="flex flex-col items-center gap-3 p-6 text-center"><div className="flex size-20 items-center justify-center rounded-3xl border border-border bg-background shadow-sm"><BedDouble className="size-9 text-muted-foreground" strokeWidth={1.25} aria-hidden="true" /></div><span className="type-meta text-muted-foreground">Property photo not supplied</span></div>}
  </div>;
}
export function HotelCard({ hotel, demo, nights, rooms, tripCurrency, selected, disabled, saving, onSelect, onDetails }: {
  hotel: HotelCandidate; demo: boolean; nights: number; rooms: number; tripCurrency: string;
  selected: boolean; disabled: boolean; saving: boolean;
  onSelect: (candidate: HotelCandidate, button: HTMLButtonElement) => void; onDetails: (candidate: HotelCandidate, button: HTMLButtonElement) => void;
}) {
  const currency = hotel.currency;
  return <article aria-label={hotel.name} className={`grid min-w-0 overflow-hidden rounded-2xl border bg-card shadow-sm sm:grid-cols-[10rem_minmax(0,1fr)] xl:grid-cols-[12rem_minmax(0,1fr)] ${selected ? "border-foreground" : "border-border"}`}>
    <HotelPhoto hotel={hotel} />
    <div className="min-w-0 p-5 sm:p-6">
      <div className="flex flex-wrap items-start justify-between gap-3"><h3 className="type-body min-w-0 font-semibold wrap-anywhere">{hotel.name}</h3>{selected && <span className="type-meta inline-flex items-center gap-1 font-medium"><Check className="size-4" aria-hidden="true" />Selected</span>}</div>
      <div className="type-meta mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-muted-foreground">
        {hotel.star_rating !== null && <span className="inline-flex items-center gap-1"><Star className="size-3.5" aria-hidden="true" />{hotel.star_rating}-star {hotel.accommodation_type === "hotel" ? "hotel" : "property"}</span>}
        {hotel.accommodation_type && hotel.accommodation_type !== "hotel" && <span>{optionLabel(hotel.accommodation_type.replaceAll("_", " "))}</span>}
      </div>
      {hotel.guest_rating !== null && hotel.guest_rating_scale !== null && <div className="mt-4 flex flex-wrap items-center gap-2" aria-label={`Guest rating ${hotel.guest_rating} out of ${hotel.guest_rating_scale}${hotel.review_count !== null ? ` from ${hotel.review_count} reviews` : ""}`}>
        <span className="type-small rounded-lg bg-foreground px-2 py-1 font-semibold text-background">{hotel.guest_rating} / {hotel.guest_rating_scale}</span>
        <span className="type-meta text-muted-foreground">Guest score{hotel.review_count !== null && ` · ${hotel.review_count.toLocaleString("en")} reviews`}</span>
      </div>}
      {hotel.distance_km !== null && <p className="type-small mt-3 flex items-start gap-1.5 text-muted-foreground"><MapPin className="mt-0.5 size-4 shrink-0" aria-hidden="true" />{hotel.distance_km.toFixed(1)} km from destination center</p>}
      {hotel.labels.length > 0 && <div className="mt-4 flex flex-wrap gap-2">{hotel.labels.map(label => <span key={label} className={`type-meta rounded-full px-2.5 py-1 font-medium ${label === "Best Match" ? "bg-accent text-accent-foreground" : "bg-surface-secondary text-foreground"}`}>{label}</span>)}</div>}
      <div className="mt-5 flex flex-wrap items-end justify-between gap-4 border-t pt-4">
        <div className="min-w-0">
          {hotel.total_price !== null && currency ? <><p className="text-xl font-semibold tracking-tight wrap-anywhere">{hotelMoney(hotel.total_price, currency)}</p><p className="type-meta mt-1 text-muted-foreground">{demo ? "Demo stay total" : "Quoted stay total"} · {nights} {nights === 1 ? "night" : "nights"}</p></>
            : hotel.advertised_price !== null && currency ? <><p className="text-xl font-semibold tracking-tight">{hotelMoney(hotel.advertised_price, currency)}</p><p className="type-meta mt-1 max-w-60 text-muted-foreground">Advertised price · stay total not supplied</p></>
            : <p className="type-small text-muted-foreground">Stay price not supplied</p>}
          {hotel.nightly_price !== null && currency && <p className="type-meta mt-1 text-muted-foreground">{hotelMoney(hotel.nightly_price, currency)} / night · {rooms} {rooms === 1 ? "room" : "rooms"}</p>}
          {hotel.taxes_and_fees !== null && currency && <p className="type-meta mt-1 text-muted-foreground">Quoted taxes and fees: {hotelMoney(hotel.taxes_and_fees, currency)}</p>}
          {hotel.taxes_included === true && <p className="type-meta mt-1 text-muted-foreground">Provider marks taxes included</p>}
          {!demo && hotel.available === true && <p className="type-meta mt-2">Reported available for your dates</p>}
          {currency && currency !== tripCurrency && <p className="type-meta mt-2 max-w-60 text-muted-foreground">Shown in {currency}; excluded from {tripCurrency} price comparisons.</p>}
          {hotel.within_stay_budget === false && <p className="type-meta mt-2 text-muted-foreground">Above suggested stay budget</p>}
        </div>
        <div className="flex flex-wrap gap-2"><Button variant="secondary" onClick={event => onDetails(hotel, event.currentTarget)}>View details</Button><Button disabled={disabled || selected} loading={saving} onClick={event => onSelect(hotel, event.currentTarget)}>{selected ? "Selected stay" : "Select stay"}</Button></div>
      </div>
    </div>
  </article>;
}
