import { useFormContext, useWatch } from "react-hook-form";
import { CalendarDays } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { TripFormValues } from "@/lib/trips/validation";
import { tripDuration, durationLabel } from "@/lib/trips/dates";
import { FieldError, useWizardField } from "../wizard-field";

export function DatesStep({ today }: { today: string }) {
  const { register, control } = useFormContext<TripFormValues>();
  const [start, end] = useWatch({ control, name: ["startDate", "endDate"] });
  const days = tripDuration(start, end);
  const startAccessible = useWizardField("startDate");
  const endAccessible = useWizardField("endDate");
  return (
    <div className="max-w-xl space-y-5">
      <div className="grid min-w-0 gap-5 sm:grid-cols-2">
        <div className="min-w-0">
          <Label htmlFor="startDate">Start date</Label>
          <Input id="startDate" type="date" {...register("startDate")} {...startAccessible} min={today} max="9999-12-31" className="max-w-full" />
          <FieldError name="startDate" />
        </div>
        <div className="min-w-0">
          <Label htmlFor="endDate">End date</Label>
          <Input id="endDate" type="date" {...register("endDate")} {...endAccessible} min={start && start >= today ? start : today} max="9999-12-31" className="max-w-full" />
          <FieldError name="endDate" />
        </div>
      </div>
      <p className="type-small flex items-center gap-2 rounded-lg bg-surface-secondary p-4" role="status" aria-live="polite">
        <CalendarDays className="size-5 text-muted-foreground" aria-hidden="true" />
        {days ? `${durationLabel(days)}, including your arrival and departure days.` : "Choose your dates to see the trip duration."}
      </p>
    </div>
  );
}
