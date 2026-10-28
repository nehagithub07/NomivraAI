import { Controller, useFormContext, useWatch } from "react-hook-form";
import { Wallet } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { currencies, currencyCodes } from "@/lib/trips/options";
import type { TripFormValues } from "@/lib/trips/validation";
import { FieldError, useWizardField } from "../wizard-field";
import { OptionCards } from "../option-cards";

export function BudgetStep() {
  const { register, control } = useFormContext<TripFormValues>();
  const currency = useWatch({ control, name: "currency" });
  const budgetAccessible = useWizardField("budget");
  const currencyAccessible = useWizardField("currency");
  return (
    <div className="space-y-7">
      <div className="grid gap-5 sm:grid-cols-[1fr_12rem]">
        <div className="min-w-0">
          <Label htmlFor="budget">Total budget</Label>
          <div className="relative">
            <span className="type-small pointer-events-none absolute top-3.5 left-4 text-muted-foreground" aria-hidden="true">{currencies[currency].symbol}</span>
            <Input id="budget" {...register("budget")} {...budgetAccessible} type="text" inputMode="decimal" placeholder="2500" maxLength={12} className="pl-14" />
          </div>
          <FieldError name="budget" />
        </div>
        <div className="min-w-0">
          <Label htmlFor="currency">Currency</Label>
          <Controller name="currency" control={control} render={({ field }) => (
            <Select name={field.name} value={field.value} onValueChange={field.onChange}>
              <SelectTrigger id="currency" ref={field.ref} onBlur={field.onBlur} {...currencyAccessible}><SelectValue /></SelectTrigger>
              <SelectContent>{currencyCodes.map((code) => <SelectItem key={code} value={code}>{code} · {currencies[code].label}</SelectItem>)}</SelectContent>
            </Select>
          )} />
          <FieldError name="currency" />
        </div>
      </div>
      <p className="type-small flex items-start gap-2 text-muted-foreground"><Wallet className="mt-0.5 size-4" aria-hidden="true" />Your total trip budget, in the selected currency. No currency conversion is applied.</p>
      <OptionCards name="budgetStyle" legend="Budget style" options={[
        { value: "budget", label: "Budget", description: "Prioritize affordable options and maximum value." },
        { value: "balanced", label: "Balanced", description: "Balance comfort, experience, and cost." },
        { value: "premium", label: "Premium", description: "Prioritize comfort and higher-end experiences." },
      ]} />
    </div>
  );
}
