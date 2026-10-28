import { useFormContext } from "react-hook-form";
import type { TripField, TripFormValues } from "@/lib/trips/validation";

export function FieldError({ name }: { name: TripField }) {
  const { formState: { errors } } = useFormContext<TripFormValues>();
  const message = errors[name]?.message;
  return message ? <p id={`${name}-error`} role="alert" className="type-small mt-2 text-destructive">{message}</p> : null;
}

export function useWizardField(name: TripField) {
  const { formState: { errors } } = useFormContext<TripFormValues>();
  return {
    "aria-invalid": !!errors[name],
    "aria-describedby": errors[name] ? `${name}-error` : undefined,
  };
}
