import type { ReactNode } from "react";
import { PageContainer } from "@/components/nomvira/page-container";
import { AppHeader } from "./app-header";
import { AppSidebar } from "./app-sidebar";
import { MobileNav } from "./mobile-nav";
import type { UserIdentity } from "@/lib/auth/identity";

export function AppShell({
  children,
  identity,
}: {
  children: ReactNode;
  identity: UserIdentity;
}) {
  return (
    <div className="min-h-dvh">
      <a
        href="#main-content"
        className="sr-only fixed top-4 left-4 z-50 rounded-md bg-primary px-4 py-3 text-primary-foreground focus:not-sr-only"
      >
        Skip to content
      </a>
      <AppSidebar />
      <div className="min-w-0 lg:pl-64">
        <AppHeader identity={identity} />
        <main id="main-content" tabIndex={-1}>
          <PageContainer className="max-w-[1440px] pt-8 pb-[calc(6rem+env(safe-area-inset-bottom))] md:py-10 lg:py-12">
            {children}
          </PageContainer>
        </main>
      </div>
      <MobileNav />
    </div>
  );
}
