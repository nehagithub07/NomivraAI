import type { ReactNode } from "react";
import { Pencil } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { TripFormValues } from "@/lib/trips/validation";
import { durationLabel, tripDuration, travelersLabel } from "@/lib/trips/dates";
import { optionLabel } from "@/lib/trips/options";
import { formatTripDates, formatTripBudget } from "@/lib/travel-format";
import { ProviderAttribution } from "./provider-attribution";

export function TripSummary({ values, onEdit }: { values: TripFormValues; onEdit?: (step: number) => void }) {
  const sections: { label: string; step: number; content: ReactNode }[] = [
    { label: "Destination", step: 0, content: <>{values.resolvedDestination?.display_name || values.destination}
      {values.resolvedDestination && <><span className="type-small mt-1 block text-muted-foreground">{values.resolvedDestination.country}<br />{values.resolvedDestination.timezone || "Timezone not available"}</span><ProviderAttribution provider="open_meteo" /></>}</> },
    { label: "Dates", step: 1, content: <>{formatTripDates(values.startDate, values.endDate)}<span className="type-small mt-1 block text-muted-foreground">{durationLabel(tripDuration(values.startDate, values.endDate))}</span></> },
    { label: "Travelers", step: 2, content: travelersLabel(values.travelers) },
    { label: "Budget", step: 3, content: <>{formatTripBudget(values.budget, values.currency)}<span className="type-small mt-1 block text-muted-foreground">{optionLabel(values.budgetStyle)} budget</span></> },
    { label: "Interests", step: 4, content: values.interests.map(optionLabel).join(" · ") },
    { label: "Travel pace", step: 5, content: optionLabel(values.travelPace) },
    { label: "Accommodation", step: 5, content: values.accommodationPreferences.map(optionLabel).join(" · ") },
    { label: "Food", step: 5, content: values.dietaryPreferences.length ? values.dietaryPreferences.map(optionLabel).join(" · ") : "No preference" },
    { label: "Special requests", step: 5, content: values.specialRequests || "None" },
  ];
  return (
    <dl className="divide-y">
      {sections.map((section) => (
        <div key={section.label} className="grid gap-x-3 gap-y-1 py-4 first:pt-0 last:pb-0 sm:grid-cols-[9rem_minmax(0,1fr)]">
          <dt className="type-small text-muted-foreground">{section.label}</dt>
          <dd className="type-body flex min-w-0 items-start justify-between gap-3 font-medium">
            <div className="min-w-0 whitespace-pre-wrap wrap-anywhere">{section.content}</div>
            {onEdit && <Button variant="ghost" size="sm" onClick={() => onEdit(section.step)} aria-label={`Edit ${section.label.toLowerCase()}`}
              className="min-h-11 px-3"><Pencil className="size-3.5" aria-hidden="true" />Edit</Button>}
          </dd>
        </div>
      ))}
    </dl>
  );
}
