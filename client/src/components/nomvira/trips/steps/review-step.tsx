import { useFormContext } from "react-hook-form";
import type { TripFormValues } from "@/lib/trips/validation";
import { TripSummary } from "../trip-summary";

export function ReviewStep({ onEdit }: { onEdit: (step: number) => void }) {
  const { getValues } = useFormContext<TripFormValues>();
  return <TripSummary values={getValues()} onEdit={onEdit} />;
}
