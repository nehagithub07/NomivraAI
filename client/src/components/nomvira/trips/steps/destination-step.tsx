import { useFormContext } from "react-hook-form";
import { MapPin } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { TripFormValues } from "@/lib/trips/validation";
import { FieldError, useWizardField } from "../wizard-field";

export function DestinationStep() {
  const { register } = useFormContext<TripFormValues>();
  const accessible = useWizardField("destination");
  return (
    <div className="max-w-xl">
      <Label htmlFor="destination">Destination</Label>
      <div className="relative">
        <MapPin className="pointer-events-none absolute top-4 left-4 size-4 text-muted-foreground" aria-hidden="true" />
        <Input id="destination" {...register("destination")} {...accessible} placeholder="Tokyo, Japan" autoComplete="off" maxLength={160} className="pl-11" />
      </div>
      <FieldError name="destination" />
      <p className="type-small mt-3 text-muted-foreground">A city, region, or country is a good place to start.</p>
    </div>
  );
}
