import { useFormContext, useWatch } from "react-hook-form";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { accommodationTypes, dietaryPreferences, optionLabel } from "@/lib/trips/options";
import type { TripFormValues } from "@/lib/trips/validation";
import { OptionCards } from "../option-cards";
import { FieldError, useWizardField } from "../wizard-field";

export function PreferencesStep() {
  const { register, control } = useFormContext<TripFormValues>();
  const requests = useWatch({ control, name: "specialRequests" });
  const accessible = useWizardField("specialRequests");
  return (
    <div className="space-y-8">
      <OptionCards name="travelPace" legend="Travel pace" options={[
        { value: "relaxed", label: "Relaxed", description: "Fewer activities with more free time." },
        { value: "balanced", label: "Balanced", description: "A comfortable mix of activities and downtime." },
        { value: "packed", label: "Packed", description: "See and experience as much as possible." },
      ]} />
      <OptionCards name="accommodationPreferences" legend="Accommodation preferences" hint="Choose at least one type of stay." multiple compact
        options={accommodationTypes.map((value) => ({ value, label: optionLabel(value) }))} />
      <OptionCards name="dietaryPreferences" legend="Food / dietary preferences (optional)" multiple compact
        options={[{ value: "none", label: "No preference" }, ...dietaryPreferences.map((value) => ({ value, label: optionLabel(value) }))]} />
      <div>
        <Label htmlFor="specialRequests">Anything else NomviraAI should know? <span className="font-normal text-muted-foreground">(optional)</span></Label>
        <Textarea id="specialRequests" {...register("specialRequests")} {...accessible} aria-describedby={[accessible["aria-describedby"], "requests-count"].filter(Boolean).join(" ")}
          maxLength={500} placeholder="I prefer quiet neighborhoods and early mornings..." />
        <FieldError name="specialRequests" />
        <p id="requests-count" className="type-meta mt-2 text-right text-muted-foreground">{requests.length}/500 characters</p>
      </div>
    </div>
  );
}
