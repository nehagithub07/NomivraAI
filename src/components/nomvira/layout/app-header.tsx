import Link from "next/link";
import { Bell, Search } from "lucide-react";
import { IconButton } from "@/components/nomvira/icon-button";
import { NomviraLogo } from "@/components/nomvira/nomvira-logo";
import { PageContainer } from "@/components/nomvira/page-container";
import { Input } from "@/components/ui/input";
import { HeaderContext } from "./header-context";
import { NavigationDrawer } from "./navigation-drawer";
import { ProfileMenu } from "./profile-menu";
import type { UserIdentity } from "@/lib/auth/identity";

export function AppHeader({ identity }: { identity: UserIdentity }) {
  return (
    <header className="border-b bg-background">
      <PageContainer className="flex min-h-20 max-w-[1440px] items-center justify-between gap-3 py-4 lg:min-h-24">
        <div className="flex min-w-0 items-center gap-2">
          <NavigationDrawer />
          <Link
            href="/"
            aria-label="NomviraAI home"
            className="rounded-sm lg:hidden"
          >
            <NomviraLogo className="text-xl" />
          </Link>
          <HeaderContext />
        </div>
        <div className="flex shrink-0 items-center gap-2 md:gap-3">
          <div className="relative hidden md:block">
            <Search
              aria-hidden="true"
              className="pointer-events-none absolute top-3.5 left-4 size-4 text-muted-foreground"
            />
            <Input
              type="search"
              readOnly
              aria-label="Search NomviraAI"
              aria-describedby="global-search-hint"
              placeholder="Search NomviraAI"
              className="h-11 w-52 cursor-default pl-11 lg:w-60"
            />
          </div>
          <p id="global-search-hint" className="sr-only">
            Search is coming soon.
          </p>
          <IconButton
            aria-label="Notifications (coming soon)"
            aria-disabled="true"
            title="Notifications are coming soon"
            className="cursor-default"
          >
            <Bell aria-hidden="true" />
          </IconButton>
          <ProfileMenu identity={identity} />
        </div>
      </PageContainer>
    </header>
  );
}
