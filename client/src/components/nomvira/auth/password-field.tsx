"use client";

import { useState, type ComponentProps } from "react";
import { Eye, EyeOff } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { IconButton } from "@/components/nomvira/icon-button";

type PasswordFieldProps = Omit<ComponentProps<typeof Input>, "type" | "id"> & {
  id: string;
  label: string;
  errors?: string[];
  hint?: string;
};

export function PasswordField({
  id,
  label,
  errors,
  hint,
  disabled,
  ...props
}: PasswordFieldProps) {
  const [visible, setVisible] = useState(false);
  const describedBy =
    [hint && `${id}-hint`, errors?.length && `${id}-error`]
      .filter(Boolean)
      .join(" ") || undefined;
  return (
    <div>
      <Label htmlFor={id}>{label}</Label>
      <div className="relative">
        <Input
          id={id}
          type={visible ? "text" : "password"}
          disabled={disabled}
          aria-invalid={!!errors?.length}
          aria-describedby={describedBy}
          className="pr-12"
          {...props}
        />
        <IconButton
          variant="ghost"
          disabled={disabled}
          aria-label={`${visible ? "Hide" : "Show"} ${label.toLowerCase()}`}
          aria-controls={id}
          aria-pressed={visible}
          className="absolute top-0.5 right-0.5 rounded-md"
          onClick={() => setVisible(!visible)}
        >
          {visible ? <EyeOff aria-hidden="true" /> : <Eye aria-hidden="true" />}
        </IconButton>
      </div>
      {hint && (
        <p id={`${id}-hint`} className="type-meta mt-2 text-muted-foreground">
          {hint}
        </p>
      )}
      {!!errors?.length && (
        <p id={`${id}-error`} className="type-meta mt-2 text-destructive">
          {errors[0]}
        </p>
      )}
    </div>
  );
}
