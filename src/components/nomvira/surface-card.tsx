import type { ComponentProps } from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";

const surfaceVariants = cva("ui-transition", {
  variants: {
    variant: {
      standard: "",
      interactive:
        "transition-[transform,border-color,box-shadow] hover:-translate-y-0.5 hover:border-border-strong hover:shadow-card-hover focus-within:border-border-strong motion-reduce:transform-none",
      muted: "bg-surface-secondary shadow-none",
      accent: "border-nomvira-orange/20 bg-accent-card shadow-none",
    },
    size: {
      default: "rounded-xl",
      panel: "rounded-2xl",
      feature: "rounded-3xl",
    },
  },
  defaultVariants: { variant: "standard", size: "default" },
});

export function SurfaceCard({
  className,
  variant,
  size,
  ...props
}: ComponentProps<typeof Card> & VariantProps<typeof surfaceVariants>) {
  return (
    <Card
      className={cn(surfaceVariants({ variant, size }), className)}
      {...props}
    />
  );
}
