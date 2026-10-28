"use client";

import { Controller, useFormContext } from "react-hook-form";
import type { LucideIcon } from "lucide-react";
import type { TripFormValues } from "@/lib/trips/validation";
import { cn } from "@/lib/utils";

export type ChoiceOption = { value: string; label: string; description?: string; icon?: LucideIcon };
type ChoiceField = "budgetStyle" | "interests" | "travelPace" | "accommodationPreferences" | "dietaryPreferences";

export function OptionCards({ name, legend, hint, options, multiple = false, compact = false }: {
  name: ChoiceField; legend: string; hint?: string; options: readonly ChoiceOption[]; multiple?: boolean; compact?: boolean;
}) {
  const { control } = useFormContext<TripFormValues>();
  return (
    <Controller name={name} control={control} render={({ field, fieldState }) => {
      const selected: readonly string[] = Array.isArray(field.value) ? field.value : [field.value];
      const errorId = `${name}-error`;
      return (
        <fieldset className="min-w-0" aria-describedby={[hint ? `${name}-hint` : "", fieldState.error ? errorId : ""].filter(Boolean).join(" ") || undefined}>
          <legend className="type-small mb-2 font-medium">{legend}</legend>
          {hint && <p id={`${name}-hint`} className="type-small mb-4 text-muted-foreground">{hint}</p>}
          <div className={cn("grid gap-3", compact ? "grid-cols-1 min-[375px]:grid-cols-2 sm:grid-cols-3" : "sm:grid-cols-3")}>
            {options.map((option, index) => {
              const checked = option.value === "none" ? selected.length === 0 : selected.includes(option.value);
              const Icon = option.icon;
              return (
                <label key={option.value} className={cn(
                  "ui-transition flex min-h-12 min-w-0 cursor-pointer items-start gap-3 rounded-lg border p-4 transition-colors hover:border-border-strong focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-ring has-disabled:cursor-not-allowed has-disabled:opacity-50",
                  checked ? "border-nomvira-orange bg-accent-card" : "border-border bg-card",
                )}>
                  <input type={multiple ? "checkbox" : "radio"} name={field.name} value={option.value}
                    checked={checked} ref={index === 0 ? field.ref : undefined} onBlur={field.onBlur}
                    aria-invalid={!!fieldState.error} aria-describedby={fieldState.error ? errorId : undefined}
                    className="mt-1 size-4 shrink-0 accent-primary"
                    onChange={() => {
                      if (!multiple) return field.onChange(option.value);
                      if (option.value === "none") return field.onChange([]);
                      field.onChange(checked ? selected.filter((value) => value !== option.value) : [...selected, option.value]);
                    }} />
                  <span className="min-w-0">
                    <span className="type-small flex items-center gap-2 font-medium">
                      {Icon && <Icon className="size-4" aria-hidden="true" />}{option.label}
                    </span>
                    {option.description && <span className="type-meta mt-2 block text-muted-foreground">{option.description}</span>}
                  </span>
                </label>
              );
            })}
          </div>
          {fieldState.error && <p id={errorId} role="alert" className="type-small mt-2 text-destructive">{fieldState.error.message}</p>}
        </fieldset>
      );
    }} />
  );
}
