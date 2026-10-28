"use client";

import * as React from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import { IconButton } from "@/components/nomvira/icon-button";
import { cn } from "@/lib/utils";

const Sheet = DialogPrimitive.Root;
const SheetTrigger = DialogPrimitive.Trigger;
const SheetTitle = DialogPrimitive.Title;
const SheetDescription = DialogPrimitive.Description;

function SheetContent({
  children,
  className,
  closeLabel = "Close navigation",
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Content> & { closeLabel?: string }) {
  return (
    <DialogPrimitive.Portal>
      <DialogPrimitive.Overlay className="fixed inset-0 z-40 bg-foreground/20" />
      <DialogPrimitive.Content
        data-slot="sheet-content"
        className={cn(
            "fixed inset-y-0 left-0 z-50 flex w-72 max-w-[calc(100vw-2rem)] flex-col overflow-y-auto border-r bg-background outline-none",
          className,
        )}
        {...props}
      >
        {children}
        <DialogPrimitive.Close asChild>
          <IconButton
            variant="ghost"
            aria-label={closeLabel}
            className="absolute top-6 right-2"
          >
            <X aria-hidden="true" />
          </IconButton>
        </DialogPrimitive.Close>
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  );
}

export { Sheet, SheetTrigger, SheetContent, SheetTitle, SheetDescription };
