import * as React from "react";
import { cn } from "@/lib/utils";

function Input({
  className,
  type = "text",
  ...props
}: React.ComponentProps<"input">) {
  return (
    <input
      data-slot="input"
      type={type}
      className={cn("field-control h-12 px-4 py-3", className)}
      {...props}
    />
  );
}

export { Input };
