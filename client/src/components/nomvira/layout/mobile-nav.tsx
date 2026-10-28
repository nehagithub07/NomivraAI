import { NavItems } from "@/components/nomvira/navigation/nav-items";

export function MobileNav() {
  return (
    <nav
      aria-label="Mobile navigation"
      className="fixed inset-x-0 bottom-0 z-30 grid grid-cols-5 border-t bg-card px-2 pb-[env(safe-area-inset-bottom)] md:hidden"
    >
      <NavItems mobile />
    </nav>
  );
}
