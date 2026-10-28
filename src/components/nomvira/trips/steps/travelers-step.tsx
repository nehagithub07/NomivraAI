import { Controller, useFormContext, useWatch } from "react-hook-form";
import { Minus, Plus, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { TripFormValues } from "@/lib/trips/validation";
import { travelersLabel } from "@/lib/trips/dates";
import { FieldError, useWizardField } from "../wizard-field";

export function TravelersStep() {
  const { control } = useFormContext<TripFormValues>();
  const count = useWatch({ control, name: "travelers" });
  const accessible = useWizardField("travelers");
  return (
    <div className="max-w-sm">
      <Users className="mb-5 size-7 text-muted-foreground" aria-hidden="true" />
      <Label htmlFor="travelers">Number of travelers</Label>
      <Controller name="travelers" control={control} render={({ field }) => (
        <div className="flex items-center gap-3">
          <Button variant="secondary" size="icon" aria-label="Remove a traveler" disabled={field.value <= 1} onClick={() => field.onChange(Math.max(1, (field.value || 1) - 1))}><Minus aria-hidden="true" /></Button>
          <Input id="travelers" {...field} value={Number.isFinite(field.value) ? field.value : ""} type="number" min={1} max={20} step={1} inputMode="numeric" {...accessible}
            onChange={(event) => field.onChange(event.target.valueAsNumber)} className="w-24 text-center tabular-nums" />
          <Button variant="secondary" size="icon" aria-label="Add a traveler" disabled={field.value >= 20} onClick={() => field.onChange(Math.min(20, (field.value || 0) + 1))}><Plus aria-hidden="true" /></Button>
        </div>
      )} />
      <FieldError name="travelers" />
      <p className="type-small mt-3 text-muted-foreground" role="status">{Number.isInteger(count) && count >= 1 && count <= 20 ? travelersLabel(count) : "Choose between 1 and 20 travelers."}</p>
    </div>
  );
}
