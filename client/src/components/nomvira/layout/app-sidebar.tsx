import Link from "next/link";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { NomviraLogo } from "@/components/nomvira/nomvira-logo";
import { NavItems } from "@/components/nomvira/navigation/nav-items";

export function SidebarContent({ onNavigate }: { onNavigate?: () => void }) {
  return (
    <div className="flex h-full min-h-0 flex-col px-5 pb-6">
      <div className="flex h-24 shrink-0 items-center px-3">
        <Link
          href="/"
          aria-label="NomviraAI home"
          onClick={onNavigate}
          className="rounded-sm"
        >
          <NomviraLogo />
        </Link>
      </div>
      <Button asChild className="w-full">
        <Link href="/trips/new" onClick={onNavigate}>
          <Plus aria-hidden="true" />
          New Trip
        </Link>
      </Button>
      <nav aria-label="Main navigation" className="mt-8 flex flex-col gap-1">
        <NavItems onNavigate={onNavigate} />
      </nav>
      <nav
        aria-label="Support navigation"
        className="mt-auto flex flex-col gap-1 border-t pt-5"
      >
        <NavItems secondary onNavigate={onNavigate} />
      </nav>
    </div>
  );
}

export function AppSidebar() {
  return (
    <aside
      aria-label="Application sidebar"
      className="fixed inset-y-0 left-0 z-20 hidden w-64 overflow-y-auto border-r bg-background lg:block"
    >
      <SidebarContent />
    </aside>
  );
}
