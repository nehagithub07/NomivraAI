"use client";

import { useEffect, useState } from "react";
import { Menu } from "lucide-react";
import { IconButton } from "@/components/nomvira/icon-button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { SidebarContent } from "./app-sidebar";

export function NavigationDrawer() {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const tablet = window.matchMedia(
      "(min-width: 768px) and (max-width: 1023px)",
    );
    const closeOutsideTablet = () => {
      if (!tablet.matches) setOpen(false);
    };
    tablet.addEventListener("change", closeOutsideTablet);
    return () => tablet.removeEventListener("change", closeOutsideTablet);
  }, []);

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <IconButton
          aria-label="Open navigation"
          variant="ghost"
          className="hidden md:inline-flex lg:hidden"
        >
          <Menu aria-hidden="true" />
        </IconButton>
      </SheetTrigger>
      <SheetContent>
        <SheetTitle className="sr-only">NomviraAI navigation</SheetTitle>
        <SheetDescription className="sr-only">
          Navigate your journeys and application settings.
        </SheetDescription>
        <SidebarContent onNavigate={() => setOpen(false)} />
      </SheetContent>
    </Sheet>
  );
}
