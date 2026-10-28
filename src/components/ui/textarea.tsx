import * as React from "react";
import { cn } from "@/lib/utils";

function Textarea({ className, ...props }: React.ComponentProps<"textarea">) {
  return (
    <textarea
      data-slot="textarea"
      className={cn("field-control min-h-28 resize-y px-4 py-3", className)}
      {...props}
    />
  );
}

export { Textarea };
