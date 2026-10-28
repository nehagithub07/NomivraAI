import * as React from "react";
import { cn } from "@/lib/utils";

function Label({ className, ...props }: React.ComponentProps<"label">) {
  return (
    <label
      data-slot="label"
      className={cn("mb-2 block text-[0.8125rem] font-medium", className)}
      {...props}
    />
  );
}

export { Label };
